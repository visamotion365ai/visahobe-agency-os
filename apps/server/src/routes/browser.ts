import type { FastifyInstance } from 'fastify';
import { env } from '../env.js';
import { hub } from '../browser/hub.js';
import { assertUrlAllowed, UrlBlockedError } from '../browser/ssrf.js';
import { planBrowserTask } from '../browser/planner.js';
import {
  addArtifact,
  createBrowserSession,
  getBrowserSession,
  listBrowserEvents,
  listBrowserSessions,
  listArtifacts,
  updateBrowserSession,
} from '../browser/sessions.js';
import { AppError, badRequest, notFound, unavailable } from '../lib/errors.js';
import { recordAudit } from '../domain/audit.js';
import { getSkill, recordSkillRun } from '../domain/skills.js';
import { parseBody } from '../lib/http.js';
import { browserTaskSchema } from '@visahobe/shared';
import { saveBuffer } from '../services/storage.js';
import { verifyToken } from '../lib/jwt.js';

export async function browserRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/browser/status', { preHandler: app.requireAuth }, async () => ({
    worker: hub.worker
      ? {
          connected: hub.connected,
          id: hub.worker.id,
          label: hub.worker.label,
          connectedAt: hub.worker.connectedAt,
          lastSeenAt: hub.worker.lastSeenAt,
          playwrightVersion: hub.worker.playwrightVersion,
        }
      : { connected: false, label: null },
    workerUrl: env.WORKER_URL,
    sessions: await listBrowserSessions(),
    live: hub.listSessions(),
  }));

  app.post('/api/browser/sessions', { preHandler: app.requireAuth }, async (req, reply) => {
    if (!hub.connected) {
      throw unavailable(
        'No browser worker is connected. Start the self-hosted worker (npm run dev -w @visahobe/browser-worker) and retry.',
      );
    }
    const body = (req.body ?? {}) as { label?: string; viewport?: 'desktop' | 'mobile' };
    const viewport = body.viewport === 'mobile' ? 'mobile' : 'desktop';
    const record = await createBrowserSession({
      label: body.label || `Session ${new Date().toISOString().slice(11, 19)}`,
      viewport,
      createdBy: req.user!.id,
      workerId: hub.worker?.id ?? null,
      workerLabel: hub.worker?.label ?? null,
    });
    hub.registerSession(record.id, viewport);
    try {
      hub.send({ type: 'create_session', sessionId: record.id, viewport, allowDomains: env.allowDomains });
    } catch (err) {
      await updateBrowserSession(record.id, { status: 'error', endedAt: new Date().toISOString() });
      throw unavailable((err as Error).message);
    }
    reply.code(201);
    return { session: record };
  });

  app.get('/api/browser/sessions/:id', { preHandler: app.requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const session = await getBrowserSession(id);
    if (!session) throw notFound('Browser session not found');
    return { session, live: hub.getSession(id) ?? null, events: await listBrowserEvents(id) };
  });

  app.post('/api/browser/sessions/:id/stop', { preHandler: app.requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    if (hub.connected) {
      try {
        hub.send({ type: 'close_session', sessionId: id });
      } catch {
        /* worker may already be gone */
      }
    }
    hub.endSession(id);
    await updateBrowserSession(id, { status: 'stopped', endedAt: new Date().toISOString() });
    return { ok: true };
  });

  app.post('/api/browser/sessions/:id/navigate', { preHandler: app.requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { url?: string };
    if (!body.url) throw badRequest('A url is required');
    try {
      await assertUrlAllowed(body.url);
    } catch (err) {
      if (err instanceof UrlBlockedError) throw badRequest(err.message, { reason: err.reason });
      throw err;
    }
    if (!hub.connected) throw unavailable('Browser worker is not connected');
    const result = await hub.request(
      { type: 'navigate', sessionId: id, url: body.url, requestId: '', allowDomains: env.allowDomains },
      env.BROWSER_TIMEOUT_MS,
    ).catch((err) => {
      throw new AppError(502, 'browser_error', (err as Error).message);
    });
    await recordAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'browser.navigate',
      entity: 'browser_session',
      entityId: id,
      meta: { url: body.url },
      ip: req.ip,
    });
    return { ok: true, result };
  });

  app.post('/api/browser/sessions/:id/actions', { preHandler: app.requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { action?: any };
    if (!body.action?.kind) throw badRequest('An action is required');
    if (!hub.connected) throw unavailable('Browser worker is not connected');
    const result = await hub.request(
      { type: 'action', sessionId: id, action: body.action, requestId: '' },
      env.BROWSER_TIMEOUT_MS,
    ).catch((err) => {
      throw new AppError(502, 'browser_error', (err as Error).message);
    });
    return { ok: true, result };
  });

  app.post('/api/browser/sessions/:id/screenshot', { preHandler: app.requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    if (!hub.connected) throw unavailable('Browser worker is not connected');
    const body = (req.body ?? {}) as { quality?: number };
    const result = await hub.request(
      { type: 'screenshot_request', sessionId: id, quality: body.quality ?? 70, requestId: '' },
      30_000,
    );
    return { ok: true, result };
  });

  app.post('/api/browser/sessions/:id/viewport', { preHandler: app.requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { viewport?: string };
    const viewport = body.viewport === 'mobile' ? 'mobile' : 'desktop';
    if (hub.connected) hub.send({ type: 'set_viewport', sessionId: id, viewport });
    await updateBrowserSession(id, { viewport });
    return { ok: true, viewport };
  });

  app.post('/api/browser/sessions/:id/pause', { preHandler: app.requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    if (hub.connected) hub.send({ type: 'pause', sessionId: id });
    const runtime = hub.getSession(id);
    if (runtime) runtime.paused = true;
    await hub.logEvent(id, undefined, 'Human takeover: session paused for manual interaction.', 'warn');
    return { ok: true, paused: true };
  });

  app.post('/api/browser/sessions/:id/resume', { preHandler: app.requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    if (hub.connected) hub.send({ type: 'resume', sessionId: id });
    const runtime = hub.getSession(id);
    if (runtime) runtime.paused = false;
    await hub.logEvent(id, undefined, 'Human takeover released: session resumed.', 'info');
    return { ok: true, paused: false };
  });

  app.get('/api/browser/sessions/:id/events', { preHandler: app.requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    return { events: await listBrowserEvents(id) };
  });

  app.get('/api/browser/sessions/:id/artifacts', { preHandler: app.requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    return { artifacts: await listArtifacts(id) };
  });

  /** Run an instruction through the planner and the real browser worker. */
  app.post('/api/browser/tasks', { preHandler: app.requireRole('staff') }, async (req, reply) => {
    const body = parseBody(browserTaskSchema, req.body);
    if (!hub.connected) {
      throw unavailable('Browser worker is not connected — the preview is not live.');
    }
    let sessionId = body.sessionId;
    if (!sessionId) {
      const record = await createBrowserSession({
        label: body.instruction.slice(0, 60),
        viewport: body.viewport,
        mode: body.mode,
        createdBy: req.user!.id,
        workerId: hub.worker?.id ?? null,
        workerLabel: hub.worker?.label ?? null,
      });
      sessionId = record.id;
      hub.registerSession(sessionId, body.viewport);
      hub.send({ type: 'create_session', sessionId, viewport: body.viewport, allowDomains: env.allowDomains });
    }
    if (body.url) {
      try {
        await assertUrlAllowed(body.url);
      } catch (err) {
        if (err instanceof UrlBlockedError) throw badRequest(err.message, { reason: err.reason });
        throw err;
      }
    }
    const { steps, planner } = await planBrowserTask(body.instruction);
    const taskId = `btask_${Date.now().toString(36)}`;
    await updateBrowserSession(sessionId, { taskId, mode: body.mode });
    const runtime = hub.getSession(sessionId);
    if (runtime) runtime.taskId = taskId;
    await hub.logEvent(sessionId, taskId, `Planned ${steps.length} step(s) with ${planner}.`, 'info', { steps });
    hub.send({ type: 'run_task', sessionId, taskId, steps });
    reply.code(202);
    return { sessionId, taskId, steps, planner };
  });

  /**
   * Run a browser-kind Skill workflow against a session. Each step is mapped to
   * the fixed worker action vocabulary — a skill never executes arbitrary code.
   */
  app.post('/api/browser/skills/:skillId/run', { preHandler: app.requireRole('staff') }, async (req, reply) => {
    const { skillId } = req.params as { skillId: string };
    const body = (req.body ?? {}) as { sessionId?: string; url?: string; variables?: Record<string, string> };
    const skill = await getSkill(skillId);
    if (!skill) throw notFound('Skill not found');
    if (skill.kind !== 'browser') throw badRequest('This skill has no browser workflow');
    if (!skill.workflow?.length) throw badRequest('This skill has an empty workflow');
    if (!hub.connected) throw unavailable('Browser worker is not connected — the preview is not live.');

    let sessionId = body.sessionId;
    if (!sessionId) {
      const record = await createBrowserSession({
        label: skill.name,
        viewport: 'desktop',
        mode: 'assisted',
        createdBy: req.user!.id,
        workerId: hub.worker?.id ?? null,
        workerLabel: hub.worker?.label ?? null,
      });
      sessionId = record.id;
      hub.registerSession(sessionId, 'desktop');
      hub.send({ type: 'create_session', sessionId, viewport: 'desktop', allowDomains: env.allowDomains });
    }

    // Substitute {{variable}} placeholders in every string field.
    const vars = body.variables ?? {};
    const fill = (value?: string): string | undefined =>
      value?.replace(/\{\{(\w+)\}\}/g, (_, name) => vars[name] ?? '');

    const steps: any[] = [];
    for (const step of skill.workflow) {
      if (step.kind === 'navigate') {
        const target = fill(step.url) || body.url;
        if (!target) throw badRequest('A url is required for the navigate step');
        try {
          await assertUrlAllowed(target);
        } catch (err) {
          if (err instanceof UrlBlockedError) throw badRequest(err.message, { reason: err.reason });
          throw err;
        }
        await hub.request({ type: 'navigate', sessionId, url: target, requestId: '' }, env.BROWSER_TIMEOUT_MS);
        continue;
      }
      const action: any = { kind: step.kind };
      if (step.selector) action.selector = step.selector;
      if (step.value !== undefined) {
        const value = fill(step.value) ?? '';
        if (step.kind === 'scroll') action.deltaY = Number(value) || 0;
        else if (step.kind === 'wait') action.ms = Number(value) || step.ms || 500;
        else action.text = value;
      }
      if (step.kind === 'wait' && action.ms === undefined) action.ms = step.ms ?? 500;
      if (step.kind === 'fill' && step.value !== undefined) action.value = fill(step.value) ?? '';
      if (step.kind === 'press' && step.key) action.key = step.key;
      if (step.kind === 'extract' && !action.selector) action.selector = 'body';
      await hub.request({ type: 'action', sessionId, action, requestId: '' }, env.BROWSER_TIMEOUT_MS);
      steps.push(step.kind);
    }

    await recordSkillRun({
      skillId: skill.id,
      agentKey: null,
      caseId: null,
      input: body.url ?? null,
      output: JSON.stringify({ steps }),
      status: 'completed',
      createdBy: req.user!.id,
    }).catch(() => undefined);
    await recordAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'browser.skill_run',
      entity: 'skill',
      entityId: skill.id,
      meta: { sessionId, steps },
      ip: req.ip,
    });
    reply.code(202);
    return { sessionId, skillId: skill.id, steps, count: steps.length };
  });

  /* ------------------------- WebSocket endpoints ------------------------ */

  /** The self-hosted browser worker connects here. */
  app.get('/api/browser/worker', { websocket: true }, (socket, req) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    const token = url.searchParams.get('token') ?? (req.headers['x-worker-token'] as string | undefined);
    if (!token || token !== env.WORKER_TOKEN) {
      socket.close(4401, 'unauthorised');
      return;
    }
    hub.attachWorker(socket, url.searchParams.get('label') ?? env.WORKER_LABEL);
    socket.send(JSON.stringify({ type: 'ready', workerId: 'pending', label: url.searchParams.get('label') ?? env.WORKER_LABEL }));
  });

  /** Authenticated live preview channel used by the PWA. */
  app.get('/api/browser/stream', { websocket: true }, (socket, req) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    const token = url.searchParams.get('token');
    const payload = token ? verifyToken(token, env.JWT_SECRET) : null;
    if (!payload) {
      socket.close(4401, 'unauthorised');
      return;
    }
    const sessionId = url.searchParams.get('sessionId');
    if (!sessionId) {
      socket.close(4400, 'sessionId is required');
      return;
    }
    hub.subscribe(sessionId, socket);
    const runtime = hub.getSession(sessionId);
    socket.send(
      JSON.stringify({
        type: 'hello',
        sessionId,
        status: runtime?.status ?? 'idle',
        url: runtime?.url ?? null,
        title: runtime?.title ?? null,
        paused: runtime?.paused ?? false,
        viewport: runtime?.viewport ?? 'desktop',
      }),
    );
    if (runtime?.lastScreenshot) {
      socket.send(JSON.stringify({ type: 'screenshot', sessionId, ...runtime.lastScreenshot, url: runtime.url, title: runtime.title }));
    }
  });
}
