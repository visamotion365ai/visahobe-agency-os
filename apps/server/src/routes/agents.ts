import type { FastifyInstance } from 'fastify';
import { AGENT_PROFILES, AGENT_KEYS, chatSchema } from '@visahobe/shared';
import { parseBody } from '../lib/http.js';
import { badRequest, notFound } from '../lib/errors.js';
import { runAgentTurn, cancelTask, listRunningTasks } from '../ai/engine.js';
import {
  addTaskEvent,
  getAgentByKey,
  getAgentById,
  listAgents,
  listConversations,
  listMessages,
  listTaskEvents,
  listTasks,
  updateAgent,
  updateTask,
} from '../domain/agents.js';
import { getDefaultProvider } from '../domain/providers.js';
import { probeProvider } from '../ai/health.js';
import { recordAudit } from '../domain/audit.js';

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/agents', { preHandler: app.requireAuth }, async () => {
    const agents = await listAgents();
    const defaultProvider = await getDefaultProvider();
    const running = new Set(listRunningTasks());
    const defaultProbe = await probeProvider(
      defaultProvider ? { ...defaultProvider, apiKey: undefined } : null,
    );
    return {
      agents: agents.map((agent) => {
        const profile = AGENT_PROFILES[agent.key];
        const provider = agent.providerId ? undefined : defaultProvider;
        return {
          ...agent,
          name: profile?.name ?? agent.name,
          role: profile?.role ?? agent.role,
          focus: profile?.focus ?? agent.description,
          avatar: profile?.avatar ?? '?',
          accent: profile?.accent ?? '#0a84ff',
          provider: agent.providerId
            ? { id: agent.providerId, name: 'Assigned provider', kind: 'assigned', model: agent.model }
            : provider
              ? {
                  id: provider.id,
                  name: provider.name,
                  kind: provider.kind,
                  model: agent.model || provider.model,
                  status: defaultProbe.ok ? 'ready' : 'unreachable',
                  statusMessage: defaultProbe.message,
                }
              : {
                  id: 'builtin',
                  name: 'VisaHOBe Local Engine',
                  kind: 'builtin',
                  model: 'deterministic-ops-engine',
                  status: 'ready',
                  statusMessage: 'Offline deterministic engine — always available.',
                },
          running: running.has(agent.id),
        };
      }),
    };
  });

  app.patch('/api/agents/:id', { preHandler: app.requireRole('staff') }, async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { providerId?: string | null; model?: string | null; temperature?: number; enabled?: number };
    const agent = await updateAgent(id, body);
    await recordAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'agent.updated',
      entity: 'agent',
      entityId: id,
      meta: body,
      ip: req.ip,
    });
    return { agent };
  });

  app.get('/api/agents/:key/conversations', { preHandler: app.requireAuth }, async (req) => {
    const { key } = req.params as { key: string };
    const agent = await getAgentByKey(key);
    if (!agent) throw notFound('Agent not found');
    return { conversations: await listConversations(agent.id, req.user!.id) };
  });

  app.post('/api/agents/chat', { preHandler: app.requireAuth }, async (req) => {
    const body = parseBody(chatSchema, req.body);
    if (!AGENT_KEYS.includes(body.agentKey)) throw badRequest('Unknown agent');
    const result = await runAgentTurn({
      agentKey: body.agentKey,
      userMessage: body.message,
      conversationId: body.conversationId,
      caseId: body.caseId,
      userId: req.user!.id,
    });
    await recordAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'agent.chat',
      entity: 'agent',
      entityId: body.agentKey,
      meta: { taskId: result.taskId, provider: result.providerName },
      ip: req.ip,
    });
    return result;
  });

  app.get('/api/conversations/:id/messages', { preHandler: app.requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    return { messages: await listMessages(id) };
  });

  app.get('/api/tasks', { preHandler: app.requireAuth }, async (req) => {
    const query = req.query as any;
    // The client may pass either the agent id or the friendly agent key.
    let agentId = query.agentId as string | undefined;
    if (agentId && !agentId.startsWith('agt_')) {
      const agent = await getAgentByKey(agentId);
      agentId = agent?.id;
      if (!agentId) return { tasks: [] };
    }
    return {
      tasks: await listTasks({ agentId, status: query.status, limit: Number(query.limit) || 50 }),
    };
  });

  app.get('/api/tasks/:id', { preHandler: app.requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const task = await listTasks({ limit: 1000 }).then((tasks) => tasks.find((t) => t.id === id));
    if (!task) throw notFound('Task not found');
    return { task, events: await listTaskEvents(id) };
  });

  app.post('/api/tasks/:id/cancel', { preHandler: app.requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const cancelled = cancelTask(id);
    await updateTask(id, { status: 'cancelled' });
    await addTaskEvent({ taskId: id, type: 'cancelled', message: 'Cancellation requested by operator.' });
    return { cancelled };
  });

  app.post('/api/tasks/:id/retry', { preHandler: app.requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const task = (await listTasks({ limit: 1000 })).find((t) => t.id === id);
    if (!task) throw notFound('Task not found');
    if (!task.input) throw badRequest('This task has no stored input to retry');
    const agent = await getAgentById(task.agentId);
    if (!agent) throw notFound('Agent not found');
    const result = await runAgentTurn({
      agentKey: agent.key as any,
      userMessage: task.input,
      conversationId: task.conversationId ?? undefined,
      caseId: task.caseId,
      userId: req.user!.id,
    });
    return result;
  });

  app.post('/api/tasks/:id/resume', { preHandler: app.requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const task = (await listTasks({ limit: 1000 })).find((t) => t.id === id);
    if (!task) throw notFound('Task not found');
    if (!task.input) throw badRequest('This task has no stored input to resume');
    const agent = await getAgentById(task.agentId);
    if (!agent) throw notFound('Agent not found');
    const result = await runAgentTurn({
      agentKey: agent.key as any,
      userMessage: task.input,
      conversationId: task.conversationId ?? undefined,
      caseId: task.caseId,
      userId: req.user!.id,
      resumed: true,
    });
    return result;
  });

}
