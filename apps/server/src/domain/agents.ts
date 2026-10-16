import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { camelize, camelizeAll, json, nowIso } from '../lib/rows.js';
import { notFound } from '../lib/errors.js';
import { AGENT_PROFILES, AGENT_KEYS, type AgentKey } from '@visahobe/shared';

export interface AgentRecord {
  id: string;
  key: AgentKey;
  name: string;
  role: string;
  description: string;
  systemPrompt: string;
  providerId: string | null;
  model: string | null;
  temperature: number;
  tools: string[] | null;
  enabled: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  agentId: string;
  userId: string;
  title: string;
  caseId: string | null;
  archived: number;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  agentId: string | null;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  meta: Record<string, unknown> | null;
  taskId: string | null;
  createdAt: string;
}

export interface AgentTask {
  id: string;
  agentId: string;
  conversationId: string | null;
  userId: string | null;
  caseId: string | null;
  kind: string;
  status: 'queued' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled';
  title: string;
  input: string | null;
  plan: unknown;
  progress: number;
  result: unknown;
  error: string | null;
  requiresApproval: number;
  startedAt: string | null;
  finishedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_PROMPTS: Record<AgentKey, string> = {
  raffi:
    'You are Raffi, the VisaHOBe visa operations specialist. Explain the configured visa workflow clearly, ' +
    'reference the agency SOP steps, and always state the next concrete operational action. Never invent a ' +
    'government rule, an approval or a receipt. If a rule is not present in the configured requirements, say so.',
  nova:
    'You are Nova, the VisaHOBe document expert. Work with OCR output and document metadata. List documents that ' +
    'are missing, expired, unreadable or inconsistent with the extracted passport data. Produce a document ' +
    'readiness report. Never claim a document is genuine or verified beyond the evidence available.',
  maestro:
    'You are Maestro, the VisaHOBe workflow manager. Orchestrate the ten step SOP, keep dependencies, and raise a ' +
    'human approval request whenever a consequential step (submission, payment, account change) is reached. ' +
    'Report only what the workflow records actually contain.',
  tanya:
    'You are Tanya, the VisaHOBe compliance advisor. Use only the stored, source-linked requirement records. State ' +
    'the source URL and verification date when you cite a requirement. If a requirement is unverified or stale, say ' +
    'so explicitly. Never present a requirement as an official legal determination and never guarantee approval.',
  zayyad:
    'You are Zayyad, the VisaHOBe travel consultant. Help structure itineraries, travel dates and supporting ' +
    'travel document checklists using the configured travel requirements. Do not fabricate ticket, hotel or ' +
    'itinerary confirmations.',
};

export async function seedAgents(): Promise<void> {
  const db = getDb();
  const now = nowIso();
  let order = 0;
  for (const key of AGENT_KEYS) {
    const profile = AGENT_PROFILES[key];
    const existing = await db.get('SELECT id FROM agents WHERE key = ?', [key]);
    if (!existing) {
      await db.run(
        `INSERT INTO agents (id, key, name, role, description, system_prompt, temperature, tools, enabled, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0.2, ?, 1, ?, ?, ?)`,
        [
          newId('agt'),
          key,
          profile.name,
          profile.role,
          profile.focus,
          DEFAULT_PROMPTS[key],
          JSON.stringify(['get_case', 'list_requirements', 'list_documents', 'passport_validity', 'workflow_status', 'request_approval']),
          order,
          now,
          now,
        ],
      );
    }
    order += 1;
  }
}

export async function listAgents(): Promise<AgentRecord[]> {
  const rows = await getDb().all('SELECT * FROM agents ORDER BY sort_order ASC');
  return camelizeAll<AgentRecord>(rows).map((a) => ({ ...a, tools: json<string[]>(a.tools, []) }));
}

export async function getAgentByKey(key: string): Promise<AgentRecord | undefined> {
  const row = await getDb().get('SELECT * FROM agents WHERE key = ?', [key]);
  if (!row) return undefined;
  const agent = camelize<AgentRecord>(row)!;
  agent.tools = json<string[]>(agent.tools, []);
  return agent;
}

export async function getAgentById(id: string): Promise<AgentRecord | undefined> {
  const row = await getDb().get('SELECT * FROM agents WHERE id = ?', [id]);
  if (!row) return undefined;
  const agent = camelize<AgentRecord>(row)!;
  agent.tools = json<string[]>(agent.tools, []);
  return agent;
}

export async function updateAgent(
  id: string,
  patch: Partial<{ providerId: string | null; model: string | null; temperature: number; enabled: number; description: string }>,
): Promise<AgentRecord> {
  const db = getDb();
  const fields: string[] = [];
  const params: any[] = [];
  if (patch.providerId !== undefined) {
    fields.push('provider_id = ?');
    params.push(patch.providerId);
  }
  if (patch.model !== undefined) {
    fields.push('model = ?');
    params.push(patch.model);
  }
  if (patch.temperature !== undefined) {
    fields.push('temperature = ?');
    params.push(patch.temperature);
  }
  if (patch.enabled !== undefined) {
    fields.push('enabled = ?');
    params.push(patch.enabled);
  }
  if (patch.description !== undefined) {
    fields.push('description = ?');
    params.push(patch.description);
  }
  if (!fields.length) return (await getAgentById(id))!;
  fields.push('updated_at = ?');
  params.push(nowIso(), id);
  await db.run(`UPDATE agents SET ${fields.join(', ')} WHERE id = ?`, params);
  return (await getAgentById(id))!;
}

/* ------------------------- Conversations ------------------------- */

export async function listConversations(agentId?: string, userId?: string): Promise<Conversation[]> {
  const where: string[] = [];
  const params: any[] = [];
  if (agentId) {
    where.push('agent_id = ?');
    params.push(agentId);
  }
  if (userId) {
    where.push('user_id = ?');
    params.push(userId);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await getDb().all(
    `SELECT * FROM conversations ${clause} ORDER BY updated_at DESC LIMIT 100`,
    params,
  );
  return camelizeAll<Conversation>(rows);
}

export async function getConversation(id: string): Promise<Conversation | undefined> {
  return camelize<Conversation>(await getDb().get('SELECT * FROM conversations WHERE id = ?', [id]));
}

export async function createConversation(input: {
  agentId: string;
  userId: string;
  title?: string;
  caseId?: string | null;
}): Promise<Conversation> {
  const db = getDb();
  const id = newId('cnv');
  const now = nowIso();
  await db.run(
    `INSERT INTO conversations (id, agent_id, user_id, title, case_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.agentId, input.userId, input.title || 'New conversation', input.caseId ?? null, now, now],
  );
  return (await getConversation(id))!;
}

export async function touchConversation(id: string): Promise<void> {
  await getDb().run('UPDATE conversations SET updated_at = ? WHERE id = ?', [nowIso(), id]);
}

/* ----------------------------- Messages --------------------------- */

export async function addMessage(input: {
  conversationId: string;
  agentId?: string | null;
  role: Message['role'];
  content: string;
  meta?: unknown;
  taskId?: string | null;
}): Promise<Message> {
  const db = getDb();
  const id = newId('msg');
  const now = nowIso();
  await db.run(
    `INSERT INTO messages (id, conversation_id, agent_id, role, content, meta, task_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.conversationId,
      input.agentId ?? null,
      input.role,
      input.content,
      input.meta === undefined ? null : JSON.stringify(input.meta),
      input.taskId ?? null,
      now,
    ],
  );
  await touchConversation(input.conversationId);
  const row = await db.get('SELECT * FROM messages WHERE id = ?', [id]);
  const msg = camelize<Message>(row)!;
  msg.meta = json<Record<string, unknown>>(msg.meta, {}) as Record<string, unknown>;
  return msg;
}

export async function listMessages(conversationId: string, limit = 200): Promise<Message[]> {
  const rows = await getDb().all(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?',
    [conversationId, limit],
  );
  return camelizeAll<Message>(rows).map((m) => ({
    ...m,
    meta: json<Record<string, unknown>>(m.meta, {}) as Record<string, unknown>,
  }));
}

/* ------------------------------ Tasks ----------------------------- */

export async function createTask(input: {
  agentId: string;
  conversationId?: string | null;
  userId?: string | null;
  caseId?: string | null;
  kind: string;
  title: string;
  input?: string;
  plan?: unknown;
  status?: AgentTask['status'];
}): Promise<AgentTask> {
  const db = getDb();
  const id = newId('tsk');
  const now = nowIso();
  await db.run(
    `INSERT INTO agent_tasks (id, agent_id, conversation_id, user_id, case_id, kind, status, title, input, plan, progress, created_at, updated_at, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [
      id,
      input.agentId,
      input.conversationId ?? null,
      input.userId ?? null,
      input.caseId ?? null,
      input.kind,
      input.status ?? 'running',
      input.title,
      input.input ?? null,
      input.plan === undefined ? null : JSON.stringify(input.plan),
      now,
      now,
      now,
    ],
  );
  return (await getTask(id))!;
}

export async function getTask(id: string): Promise<AgentTask | undefined> {
  const row = await getDb().get('SELECT * FROM agent_tasks WHERE id = ?', [id]);
  if (!row) return undefined;
  const task = camelize<AgentTask>(row)!;
  task.plan = json(task.plan, null);
  task.result = json(task.result, null);
  return task;
}

export async function updateTask(
  id: string,
  patch: Partial<{
    status: AgentTask['status'];
    progress: number;
    result: unknown;
    error: string | null;
    plan: unknown;
    title: string;
    requiresApproval: number;
  }>,
): Promise<AgentTask | undefined> {
  const db = getDb();
  const fields: string[] = [];
  const params: any[] = [];
  if (patch.status !== undefined) {
    fields.push('status = ?');
    params.push(patch.status);
    if (patch.status === 'completed' || patch.status === 'failed' || patch.status === 'cancelled') {
      fields.push('finished_at = ?');
      params.push(nowIso());
    }
    if (patch.status === 'cancelled') {
      fields.push('cancelled_at = ?');
      params.push(nowIso());
    }
  }
  if (patch.progress !== undefined) {
    fields.push('progress = ?');
    params.push(patch.progress);
  }
  if (patch.result !== undefined) {
    fields.push('result = ?');
    params.push(JSON.stringify(patch.result));
  }
  if (patch.error !== undefined) {
    fields.push('error = ?');
    params.push(patch.error);
  }
  if (patch.plan !== undefined) {
    fields.push('plan = ?');
    params.push(JSON.stringify(patch.plan));
  }
  if (patch.title !== undefined) {
    fields.push('title = ?');
    params.push(patch.title);
  }
  if (patch.requiresApproval !== undefined) {
    fields.push('requires_approval = ?');
    params.push(patch.requiresApproval);
  }
  if (!fields.length) return getTask(id);
  fields.push('updated_at = ?');
  params.push(nowIso(), id);
  await db.run(`UPDATE agent_tasks SET ${fields.join(', ')} WHERE id = ?`, params);
  return getTask(id);
}

export async function listTasks(opts: { agentId?: string; status?: string; limit?: number } = {}) {
  const where: string[] = [];
  const params: any[] = [];
  if (opts.agentId) {
    where.push('agent_id = ?');
    params.push(opts.agentId);
  }
  if (opts.status) {
    where.push('status = ?');
    params.push(opts.status);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await getDb().all(
    `SELECT * FROM agent_tasks ${clause} ORDER BY created_at DESC LIMIT ?`,
    [...params, opts.limit ?? 50],
  );
  return camelizeAll<AgentTask>(rows).map((t) => ({ ...t, plan: json(t.plan, null), result: json(t.result, null) }));
}

export async function addTaskEvent(input: {
  taskId: string;
  type: string;
  message: string;
  data?: unknown;
}) {
  const db = getDb();
  const id = newId('evt');
  await db.run(
    `INSERT INTO agent_task_events (id, task_id, type, message, data, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, input.taskId, input.type, input.message, input.data === undefined ? null : JSON.stringify(input.data), nowIso()],
  );
  return id;
}

export async function listTaskEvents(taskId: string) {
  const rows = await getDb().all(
    'SELECT * FROM agent_task_events WHERE task_id = ? ORDER BY created_at ASC',
    [taskId],
  );
  return camelizeAll(rows).map((r) => ({ ...r, data: json(r.data, null) }));
}
