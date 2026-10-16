import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { camelize, camelizeAll, json, nowIso } from '../lib/rows.js';
import { notFound } from '../lib/errors.js';

export interface BrowserSessionRecord {
  id: string;
  label: string;
  status: string;
  workerId: string | null;
  workerLabel: string | null;
  viewport: string;
  url: string | null;
  title: string | null;
  taskId: string | null;
  mode: string;
  createdBy: string | null;
  createdAt: string;
  endedAt: string | null;
  meta: Record<string, unknown> | null;
}

export async function createBrowserSession(input: {
  label: string;
  viewport: 'desktop' | 'mobile';
  mode?: string;
  createdBy?: string | null;
  taskId?: string | null;
  workerId?: string | null;
  workerLabel?: string | null;
}): Promise<BrowserSessionRecord> {
  const db = getDb();
  const id = newId('bsn');
  const now = nowIso();
  await db.run(
    `INSERT INTO browser_sessions (id, label, status, worker_id, worker_label, viewport, url, title, task_id, mode, created_by, created_at, meta)
     VALUES (?, ?, 'starting', ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)`,
    [
      id,
      input.label,
      input.workerId ?? null,
      input.workerLabel ?? null,
      input.viewport,
      input.taskId ?? null,
      input.mode ?? 'assisted',
      input.createdBy ?? null,
      now,
      JSON.stringify({}),
    ],
  );
  return (await getBrowserSession(id))!;
}

export async function getBrowserSession(id: string): Promise<BrowserSessionRecord | undefined> {
  const row = await getDb().get('SELECT * FROM browser_sessions WHERE id = ?', [id]);
  if (!row) return undefined;
  const rec = camelize<BrowserSessionRecord>(row)!;
  rec.meta = json<Record<string, unknown>>(rec.meta, {}) as Record<string, unknown>;
  return rec;
}

export async function listBrowserSessions(limit = 50): Promise<BrowserSessionRecord[]> {
  const rows = await getDb().all('SELECT * FROM browser_sessions ORDER BY created_at DESC LIMIT ?', [limit]);
  return camelizeAll<BrowserSessionRecord>(rows).map((r) => ({
    ...r,
    meta: json<Record<string, unknown>>(r.meta, {}) as Record<string, unknown>,
  }));
}

export async function updateBrowserSession(
  id: string,
  patch: Partial<{
    status: string;
    url: string | null;
    title: string | null;
    taskId: string | null;
    viewport: string;
    mode: string;
    endedAt: string | null;
  }>,
): Promise<BrowserSessionRecord | undefined> {
  const db = getDb();
  if (!(await getBrowserSession(id))) throw notFound('Browser session not found');
  const map: Record<string, string> = {
    status: 'status',
    url: 'url',
    title: 'title',
    taskId: 'task_id',
    viewport: 'viewport',
    mode: 'mode',
    endedAt: 'ended_at',
  };
  const fields: string[] = [];
  const params: any[] = [];
  for (const [key, column] of Object.entries(map)) {
    const value = (patch as any)[key];
    if (value === undefined) continue;
    fields.push(`${column} = ?`);
    params.push(value === '' ? null : value);
  }
  if (!fields.length) return getBrowserSession(id);
  params.push(id);
  await db.run(`UPDATE browser_sessions SET ${fields.join(', ')} WHERE id = ?`, params);
  return getBrowserSession(id);
}

export async function listBrowserEvents(sessionId: string, limit = 300) {
  const rows = await getDb().all(
    'SELECT * FROM browser_task_events WHERE session_id = ? ORDER BY created_at ASC LIMIT ?',
    [sessionId, limit],
  );
  return camelizeAll(rows).map((r) => ({ ...r, data: json(r.data, null) }));
}

export async function addArtifact(input: {
  taskId?: string | null;
  sessionId?: string | null;
  kind: string;
  filename: string;
  storageKey: string;
  size: number;
  mime?: string | null;
}) {
  const db = getDb();
  const id = newId('art');
  await db.run(
    `INSERT INTO task_artifacts (id, task_id, session_id, kind, filename, storage_key, size, mime, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.taskId ?? null,
      input.sessionId ?? null,
      input.kind,
      input.filename,
      input.storageKey,
      input.size,
      input.mime ?? null,
      nowIso(),
    ],
  );
  return id;
}

export async function listArtifacts(sessionId: string) {
  return camelizeAll(await getDb().all('SELECT * FROM task_artifacts WHERE session_id = ? ORDER BY created_at DESC', [sessionId]));
}
