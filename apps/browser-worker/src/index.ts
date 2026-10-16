import WebSocket from 'ws';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { isIP } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
/** Minimal .env loader so the worker picks up the shared WORKER_TOKEN. */
function loadDotEnv(file: string) {
  if (!existsSync(file)) return;
  const raw = readFileSync(file, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv(resolve(process.cwd(), '.env'));
loadDotEnv(resolve(process.cwd(), '../../.env'));


interface WorkerConfig {
  serverUrl: string;
  token: string;
  label: string;
  previewIntervalMs: number;
  screenshotQuality: number;
  allowPrivateHosts: boolean;
  taskTimeoutMs: number;
}

const config: WorkerConfig = {
  serverUrl: process.env.WORKER_URL ?? 'ws://127.0.0.1:8787/api/browser/worker',
  token: process.env.WORKER_TOKEN ?? 'dev-worker-token',
  label: process.env.WORKER_LABEL ?? 'local-worker',
  previewIntervalMs: Number(process.env.PREVIEW_INTERVAL_MS ?? 1000),
  screenshotQuality: Number(process.env.SCREENSHOT_QUALITY ?? 70),
  allowPrivateHosts: (process.env.WORKER_ALLOW_PRIVATE ?? 'false') === 'true',
  taskTimeoutMs: Number(process.env.BROWSER_TASK_TIMEOUT_MS ?? 180000),
};

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

interface Session {
  id: string;
  context: BrowserContext;
  page: Page;
  viewport: 'desktop' | 'mobile';
  paused: boolean;
  closed: boolean;
  lastActivity: number;
  taskRunning: boolean;
  cancelRequested: boolean;
  allowDomains: string[];
}

const sessions = new Map<string, Session>();
let browser: Browser | null = null;
let socket: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;

function log(message: string, data?: unknown) {
  console.log(`[worker] ${message}`, data ?? '');
}

function send(payload: unknown): void {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    log('Chromium launched');
  }
  return browser;
}

function isPrivateHost(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.localhost') || host === 'metadata.google.internal') return true;
  if (isIP(host) === 4) {
    const [a, b] = host.split('.').map(Number);
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
  }
  if (isIP(host) === 6 && (host === '::1' || host.startsWith('fc') || host.startsWith('fd'))) return true;
  return false;
}

function hostAllowed(host: string, allowDomains: string[]): boolean {
  return allowDomains.some((pattern) => {
    const p = pattern.toLowerCase();
    const h = host.toLowerCase();
    if (p.startsWith('*.')) return h === p.slice(2) || h.endsWith(p.slice(1));
    return h === p || h.endsWith(`.${p}`);
  });
}

async function assertUrl(rawUrl: string, allowDomains: string[] = []): Promise<void> {
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Refusing to open ${url.protocol} URLs`);
  }
  const host = url.hostname.toLowerCase();
  if (hostAllowed(host, allowDomains) || config.allowPrivateHosts) return;
  if (isPrivateHost(host)) {
    throw new Error(`Refusing to open a private or loopback host: ${url.hostname}`);
  }
}

async function createSession(
  id: string,
  viewport: 'desktop' | 'mobile',
  url?: string,
  allowDomains: string[] = [],
): Promise<Session> {
  const browserInstance = await getBrowser();
  const context = await browserInstance.newContext({
    viewport: VIEWPORTS[viewport],
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 VisaHOBeAgentOS/1.0',
    ignoreHTTPSErrors: false,
  });
  const page = await context.newPage();
  page.on('console', (message) => {
    send({
      type: 'log',
      sessionId: id,
      level: message.type() === 'error' ? 'error' : 'info',
      message: `console.${message.type()}: ${message.text().slice(0, 400)}`,
    });
  });
  page.on('pageerror', (error) => {
    send({ type: 'log', sessionId: id, level: 'error', message: `pageerror: ${error.message.slice(0, 400)}` });
  });
  page.on('requestfailed', (request) => {
    send({
      type: 'log',
      sessionId: id,
      level: 'warn',
      message: `request failed: ${request.url().slice(0, 160)} — ${request.failure()?.errorText ?? 'unknown'}`,
    });
  });
  const session: Session = {
    id,
    context,
    page,
    viewport,
    paused: false,
    closed: false,
    lastActivity: Date.now(),
    taskRunning: false,
    cancelRequested: false,
    allowDomains,
  };
  sessions.set(id, session);
  if (url) {
    try {
      await assertUrl(url);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch (err) {
      send({ type: 'log', sessionId: id, level: 'error', message: `Initial navigation failed: ${(err as Error).message}` });
    }
  }
  send({ type: 'session_state', sessionId: id, status: 'ready', url: page.url(), title: await safeTitle(page) });
  return session;
}

async function safeTitle(page: Page): Promise<string> {
  try {
    return await page.title();
  } catch {
    return '';
  }
}

async function captureScreenshot(session: Session, taskId?: string): Promise<void> {
  if (session.closed) return;
  try {
    const buffer = await session.page.screenshot({ type: 'jpeg', quality: config.screenshotQuality });
    const size = session.page.viewportSize();
    send({
      type: 'screenshot',
      sessionId: session.id,
      taskId,
      data: buffer.toString('base64'),
      width: size?.width ?? 0,
      height: size?.height ?? 0,
      url: session.page.url(),
      title: await safeTitle(session.page),
      ts: Date.now(),
    });
  } catch (err) {
    send({ type: 'log', sessionId: session.id, level: 'warn', message: `Screenshot failed: ${(err as Error).message}` });
  }
}

async function performAction(session: Session, action: any): Promise<unknown> {
  const page = session.page;
  switch (action?.kind) {
    case 'click': {
      if (action.selector) {
        await page.locator(action.selector).first().click({ timeout: 15000 });
      } else if (action.text) {
        await page.getByText(action.text, { exact: false }).first().click({ timeout: 15000 });
      } else if (typeof action.x === 'number' && typeof action.y === 'number') {
        await page.mouse.click(action.x, action.y);
      } else {
        throw new Error('click needs a selector, a text label or coordinates');
      }
      return { clicked: action.selector ?? action.text ?? { x: action.x, y: action.y } };
    }
    case 'scroll': {
      const delta = action.deltaY ?? 400;
      await page.mouse.wheel(0, delta);
      return { scrolled: delta };
    }
    case 'type': {
      if (action.selector) await page.locator(action.selector).first().fill('');
      await page.keyboard.type(action.text ?? '', { delay: 20 });
      return { typed: (action.text ?? '').length };
    }
    case 'fill': {
      const locator = resolveField(page, action);
      if (!locator) throw new Error(`Could not find a field for "${action.label ?? action.name ?? action.selector ?? ''}"`);
      await locator.first().fill(action.value ?? '', { timeout: 15000 });
      return { filled: action.label ?? action.name ?? action.selector };
    }
    case 'select': {
      const locator = resolveField(page, action);
      if (!locator) throw new Error(`Could not find a select for "${action.label ?? action.name ?? ''}"`);
      await locator.first().selectOption({ label: action.value ?? '' }).catch(async () => {
        await locator.first().selectOption(action.value ?? '');
      });
      return { selected: action.value };
    }
    case 'press': {
      await page.keyboard.press(action.key ?? 'Enter');
      return { pressed: action.key };
    }
    case 'screenshot': {
      await captureScreenshot(session);
      return { screenshot: true };
    }
    case 'refresh': {
      await page.reload({ waitUntil: 'domcontentloaded' });
      return { url: page.url() };
    }
    case 'back': {
      await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
      return { url: page.url() };
    }
    case 'forward': {
      await page.goForward({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
      return { url: page.url() };
    }
    case 'extract': {
      const selector = action.selector ?? 'body';
      const text = await page.locator(selector).first().innerText({ timeout: 15000 }).catch(() => '');
      const fields = await page
        .evaluate(() => {
          const out: Record<string, string> = {};
          document.querySelectorAll('input,select,textarea').forEach((el: any) => {
            const key = el.name || el.id || el.getAttribute('aria-label') || el.placeholder;
            if (key) out[key] = el.value ?? '';
          });
          return out;
        })
        .catch(() => ({}));
      return { text: text.slice(0, 20000), fields };
    }
    case 'wait': {
      await page.waitForTimeout(Math.min(10000, action.ms ?? 1000));
      return { waited: action.ms ?? 1000 };
    }
    default:
      throw new Error(`Unknown action: ${action?.kind}`);
  }
}

function resolveField(page: Page, action: any): ReturnType<Page['locator']> | null {
  if (action.selector) return page.locator(action.selector);
  const label = action.label ?? action.name;
  if (!label) return null;
  const byLabel = page.getByLabel(label, { exact: false });
  const count = byLabel.count().catch(() => 0);
  return byLabel;
}

/** Prefer a field that carries a matching label; fall back to name/placeholder. */
async function fillField(page: Page, action: any): Promise<void> {
  const label = action.label ?? action.name;
  if (action.selector) {
    await page.locator(action.selector).first().fill(action.value ?? '', { timeout: 15000 });
    return;
  }
  if (!label) throw new Error('fill needs a selector or a label');
  const labelled = page.getByLabel(label, { exact: false });
  if ((await labelled.count().catch(() => 0)) > 0) {
    await labelled.first().fill(action.value ?? '', { timeout: 15000 });
    return;
  }
  const named = page.locator(`[name*="${label}" i], [id*="${label}" i], [placeholder*="${label}" i]`);
  if ((await named.count().catch(() => 0)) > 0) {
    await named.first().fill(action.value ?? '', { timeout: 15000 });
    return;
  }
  throw new Error(`No field matching "${label}" was found on the page`);
}

async function waitWhilePaused(session: Session): Promise<void> {
  while (session.paused && !session.cancelRequested) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function runTask(session: Session, taskId: string, steps: any[]): Promise<void> {
  session.taskRunning = true;
  session.cancelRequested = false;
  const started = Date.now();
  try {
    for (const step of steps) {
      if (session.cancelRequested) {
        send({ type: 'task_result', sessionId: session.id, taskId, status: 'cancelled' });
        return;
      }
      if (Date.now() - started > config.taskTimeoutMs) {
        throw new Error('Task exceeded the configured time limit');
      }
      await waitWhilePaused(session);
      if (session.cancelRequested) {
        send({ type: 'task_result', sessionId: session.id, taskId, status: 'cancelled' });
        return;
      }
      session.lastActivity = Date.now();
      try {
        if (step.kind === 'navigate') {
          if (!step.url) throw new Error('Navigate step without a URL');
          await assertUrl(step.url, session.allowDomains);
          send({ type: 'log', sessionId: session.id, taskId, level: 'info', message: `Navigating to ${step.url}` });
          await session.page.goto(step.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        } else if (step.kind === 'action') {
          if (step.action?.kind === 'fill' || step.action?.kind === 'select') {
            const label = step.action.label ?? step.action.name;
            if (label && !step.action.selector) {
              await fillField(session.page, step.action);
            } else {
              await performAction(session, step.action);
            }
          } else {
            await performAction(session, step.action);
          }
        } else if (step.kind === 'wait') {
          await session.page.waitForTimeout(Math.min(10000, step.ms ?? 1000));
        } else if (step.kind === 'screenshot') {
          await captureScreenshot(session, taskId);
        } else if (step.kind === 'extract') {
          const result = await performAction(session, { kind: 'extract', selector: step.selector });
          send({ type: 'log', sessionId: session.id, taskId, level: 'info', message: 'Extracted page content', data: result });
        }
        send({
          type: 'log',
          sessionId: session.id,
          taskId,
          level: 'info',
          message: `Step completed: ${step.kind}${step.note ? ` — ${step.note}` : ''}`,
        });
        send({
          type: 'session_state',
          sessionId: session.id,
          status: 'busy',
          url: session.page.url(),
          title: await safeTitle(session.page),
        });
        await captureScreenshot(session, taskId);
      } catch (err) {
        const message = (err as Error).message;
        send({ type: 'log', sessionId: session.id, taskId, level: 'error', message });
        send({ type: 'task_result', sessionId: session.id, taskId, status: 'failed', error: message });
        return;
      }
    }
    const result = { url: session.page.url(), title: await safeTitle(session.page) };
    send({ type: 'task_result', sessionId: session.id, taskId, status: 'completed', result });
  } finally {
    session.taskRunning = false;
  }
}

/** Give the browser a moment to materialise a session that was just created. */
async function waitForSession(id: string, timeoutMs = 20_000): Promise<Session | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const session = sessions.get(id);
    if (session) return session;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return sessions.get(id);
}

async function handleCommand(command: any): Promise<void> {
  switch (command.type) {
    case 'create_session': {
      try {
        await createSession(command.sessionId, command.viewport ?? 'desktop', command.url, command.allowDomains ?? []);
      } catch (err) {
        send({ type: 'error', sessionId: command.sessionId, message: (err as Error).message });
      }
      return;
    }
    case 'close_session': {
      const session = sessions.get(command.sessionId);
      if (session) {
        session.closed = true;
        await session.context.close().catch(() => undefined);
        sessions.delete(command.sessionId);
      }
      send({ type: 'session_state', sessionId: command.sessionId, status: 'stopped' });
      return;
    }
    case 'navigate': {
      const session = await waitForSession(command.sessionId);
      if (!session) {
        send({ type: 'action_result', sessionId: command.sessionId, requestId: command.requestId, ok: false, error: 'Unknown session' });
        return;
      }
      try {
        await assertUrl(command.url, command.allowDomains ?? session.allowDomains);
        await session.page.goto(command.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        const result = { url: session.page.url(), title: await safeTitle(session.page) };
        send({ type: 'session_state', sessionId: session.id, status: 'ready', url: result.url, title: result.title });
        send({ type: 'action_result', sessionId: session.id, requestId: command.requestId, ok: true, result });
        await captureScreenshot(session);
      } catch (err) {
        send({ type: 'action_result', sessionId: command.sessionId, requestId: command.requestId, ok: false, error: (err as Error).message });
      }
      return;
    }
    case 'action': {
      const session = sessions.get(command.sessionId);
      if (!session) {
        send({ type: 'action_result', sessionId: command.sessionId, requestId: command.requestId, ok: false, error: 'Unknown session' });
        return;
      }
      try {
        session.lastActivity = Date.now();
        const result = await performAction(session, command.action);
        send({ type: 'action_result', sessionId: session.id, requestId: command.requestId, ok: true, result });
        send({
          type: 'session_state',
          sessionId: session.id,
          status: session.paused ? 'paused' : 'ready',
          url: session.page.url(),
          title: await safeTitle(session.page),
        });
        await captureScreenshot(session);
      } catch (err) {
        send({ type: 'action_result', sessionId: session.id, requestId: command.requestId, ok: false, error: (err as Error).message });
      }
      return;
    }
    case 'screenshot_request': {
      const session = sessions.get(command.sessionId);
      if (!session) {
        send({ type: 'action_result', sessionId: command.sessionId, requestId: command.requestId, ok: false, error: 'Unknown session' });
        return;
      }
      await captureScreenshot(session);
      send({ type: 'action_result', sessionId: session.id, requestId: command.requestId, ok: true, result: { captured: true } });
      return;
    }
    case 'run_task': {
      const session = sessions.get(command.sessionId);
      if (!session) {
        send({ type: 'error', sessionId: command.sessionId, taskId: command.taskId, message: 'Unknown session' });
        return;
      }
      void runTask(session, command.taskId, command.steps ?? []);
      return;
    }
    case 'pause': {
      const session = sessions.get(command.sessionId);
      if (session) {
        session.paused = true;
        send({ type: 'session_state', sessionId: session.id, status: 'paused', url: session.page.url(), title: await safeTitle(session.page) });
      }
      return;
    }
    case 'resume': {
      const session = sessions.get(command.sessionId);
      if (session) {
        session.paused = false;
        send({ type: 'session_state', sessionId: session.id, status: 'ready', url: session.page.url(), title: await safeTitle(session.page) });
      }
      return;
    }
    case 'set_viewport': {
      const session = sessions.get(command.sessionId);
      if (session) {
        session.viewport = command.viewport ?? 'desktop';
        await session.page.setViewportSize(VIEWPORTS[session.viewport]);
        await captureScreenshot(session);
      }
      return;
    }
    case 'ready':
      return;
    case 'ping':
      send({ type: 'pong' });
      return;
    default:
      log('Unknown command', command);
  }
}

function connect(): void {
  const url = new URL(config.serverUrl);
  url.searchParams.set('token', config.token);
  url.searchParams.set('label', config.label);
  socket = new WebSocket(url.toString());
  socket.on('open', () => {
    log(`Connected to ${config.serverUrl}`);
    send({ type: 'ready', workerId: `worker-${process.pid}`, label: config.label });
  });
  // Commands are serialised so that a navigation never races the creation of
  // its session or a previous step of the same task.
  let chain: Promise<unknown> = Promise.resolve();
  socket.on('message', (raw) => {
    let command: any;
    try {
      command = JSON.parse(String(raw));
    } catch {
      return;
    }
    chain = chain
      .then(() => handleCommand(command))
      .catch((error) => {
        send({
          type: 'error',
          sessionId: command?.sessionId,
          taskId: command?.taskId,
          message: (error as Error).message,
        });
      });
  });
  socket.on('close', () => {
    log('Disconnected from server, retrying in 3s');
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 3000);
  });
  socket.on('error', (err) => {
    log('Socket error', err.message);
  });
}

/** Continuously stream the most recently active session for the live preview. */
function startPreviewLoop(): void {
  setInterval(() => {
    const active = [...sessions.values()]
      .filter((s) => !s.closed)
      .sort((a, b) => b.lastActivity - a.lastActivity)[0];
    if (active) void captureScreenshot(active);
  }, config.previewIntervalMs);
}

async function shutdown(): Promise<void> {
  log('Shutting down worker');
  for (const session of sessions.values()) {
    await session.context.close().catch(() => undefined);
  }
  if (browser) await browser.close().catch(() => undefined);
  socket?.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

connect();
startPreviewLoop();
