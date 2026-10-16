import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import WebSocket from 'ws';

const root = resolve(__dirname, '../..', '..');
const API_PORT = 8799;
const SITE_PORT = 4601;
const SITE_URL = `http://127.0.0.1:${SITE_PORT}/index.html`;

let app: any;
let token = '';
let worker: ChildProcess | null = null;
let site: ChildProcess | null = null;
let sessionId = '';

beforeAll(async () => {
  process.env.DB_FILE = resolve(root, 'data', 'test-browser.db');
  process.env.PORT = String(API_PORT);
  process.env.WORKER_URL = `ws://127.0.0.1:${API_PORT}/api/browser/worker`;
  rmSync(resolve(root, 'data', 'test-browser.db'), { force: true });

  const { getDb, runMigrations } = await import('../src/db/index.js');
  await runMigrations(getDb());
  const { seedDatabase } = await import('../src/domain/seed.js');
  await seedDatabase();
  const { buildServer } = await import('../src/index.js');
  app = await buildServer();
  await app.listen({ port: API_PORT, host: '127.0.0.1' });

  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'admin@test.local', password: 'TestPassword!2024' },
  });
  token = login.json().token;

  // Controlled local test website (never a live government portal).
  site = spawn(process.execPath, [resolve(root, 'scripts', 'test-site.mjs')], {
    env: { ...process.env, TEST_SITE_PORT: String(SITE_PORT) },
    stdio: 'ignore',
  });

  // The real self-hosted browser worker.
  worker = spawn(
    process.execPath,
    [resolve(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), resolve(root, 'apps', 'browser-worker', 'src', 'index.ts')],
    {
      cwd: root,
      env: {
        ...process.env,
        WORKER_URL: `ws://127.0.0.1:${API_PORT}/api/browser/worker`,
        WORKER_TOKEN: process.env.WORKER_TOKEN,
        WORKER_LABEL: 'test-worker',
        PREVIEW_INTERVAL_MS: '400',
        BROWSER_ALLOW_DOMAINS: '127.0.0.1,localhost',
      },
      stdio: 'ignore',
    },
  );

  // Wait for the worker to authenticate with the server.
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const status = await app.inject({
      method: 'GET',
      url: '/api/browser/status',
      headers: { authorization: `Bearer ${token}` },
    });
    if (status.json()?.worker?.connected) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('The browser worker did not connect in time');
}, 90_000);

afterAll(async () => {
  worker?.kill('SIGTERM');
  site?.kill('SIGTERM');
  await app?.close().catch(() => undefined);
});

describe('self-hosted browser worker', () => {
  it('reports the connected worker', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/browser/status',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().worker.connected).toBe(true);
    expect(response.json().worker.label).toBe('test-worker');
  });

  it('creates a session and navigates a real Chromium page to the test site', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/browser/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: { label: 'vitest', viewport: 'desktop' },
    });
    expect(created.statusCode).toBe(201);
    sessionId = created.json().session.id;

    const navigated = await app.inject({
      method: 'POST',
      url: `/api/browser/sessions/${sessionId}/navigate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { url: SITE_URL },
    });
    expect(navigated.statusCode).toBe(200);
    expect(navigated.json().result.title).toContain('VisaHOBe Test Portal');
    expect(navigated.json().result.url).toContain('127.0.0.1');
  }, 60_000);

  it('streams a live preview frame over the authenticated WebSocket', async () => {
    const wsToken = (
      await app.inject({
        method: 'GET',
        url: '/api/auth/ws-token',
        headers: { authorization: `Bearer ${token}` },
      })
    ).json().token;

    const frames = await new Promise<any[]>((resolve, reject) => {
      const received: any[] = [];
      const socket = new WebSocket(
        `ws://127.0.0.1:${API_PORT}/api/browser/stream?sessionId=${sessionId}&token=${encodeURIComponent(wsToken)}`,
      );
      const timer = setTimeout(() => {
        socket.close();
        resolve(received);
      }, 15_000);
      socket.on('message', (raw) => {
        const message = JSON.parse(String(raw));
        if (message.type === 'screenshot') {
          received.push(message);
          if (received.length >= 2) {
            clearTimeout(timer);
            socket.close();
            resolve(received);
          }
        }
      });
      socket.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    expect(frames.length).toBeGreaterThan(0);
    expect(frames[0].data.length).toBeGreaterThan(1000);
    expect(frames[0].width).toBeGreaterThan(0);
    expect(frames[0].height).toBeGreaterThan(0);
  }, 40_000);

  it('runs a real task against the test site and records the activity', async () => {
    const task = await app.inject({
      method: 'POST',
      url: '/api/browser/tasks',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        sessionId,
        instruction: `go to ${SITE_URL} and fill Full name with Ayesha Rahman and screenshot`,
        viewport: 'desktop',
        mode: 'assisted',
      },
    });
    expect(task.statusCode).toBe(202);
    expect(task.json().steps.length).toBeGreaterThan(0);

    const deadline = Date.now() + 40_000;
    let events: any[] = [];
    while (Date.now() < deadline) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/browser/sessions/${sessionId}/events`,
        headers: { authorization: `Bearer ${token}` },
      });
      events = response.json().events;
      if (events.some((event) => event.message.includes('Task completed'))) break;
      await new Promise((r) => setTimeout(r, 700));
    }
    const messages = events.map((event) => event.message).join('\n');
    expect(messages).toContain('Navigating to');
    expect(messages).toContain('Task completed');
  }, 60_000);

  it('pauses for human takeover and resumes', async () => {
    const paused = await app.inject({
      method: 'POST',
      url: `/api/browser/sessions/${sessionId}/pause`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(paused.statusCode).toBe(200);
    expect(paused.json().paused).toBe(true);

    const resumed = await app.inject({
      method: 'POST',
      url: `/api/browser/sessions/${sessionId}/resume`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resumed.json().paused).toBe(false);
  });

  it('detects the worker going away', async () => {
    worker?.kill('SIGTERM');
    worker = null;
    const deadline = Date.now() + 20_000;
    let connected = true;
    while (Date.now() < deadline) {
      const status = await app.inject({
        method: 'GET',
        url: '/api/browser/status',
        headers: { authorization: `Bearer ${token}` },
      });
      connected = status.json().worker.connected;
      if (!connected) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(connected).toBe(false);
  }, 40_000);
});
