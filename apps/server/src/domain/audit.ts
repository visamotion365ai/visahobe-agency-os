import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { nowIso } from '../lib/rows.js';

export interface AuditEntry {
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  entity?: string | null;
  entityId?: string | null;
  meta?: unknown;
  ip?: string | null;
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  await getDb().run(
    `INSERT INTO audit_events (id, actor_id, actor_email, action, entity, entity_id, meta, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId('aud'),
      entry.actorId ?? null,
      entry.actorEmail ?? null,
      entry.action,
      entry.entity ?? null,
      entry.entityId ?? null,
      entry.meta === undefined ? null : JSON.stringify(entry.meta),
      entry.ip ?? null,
      nowIso(),
    ],
  );
}

export async function listAudit(limit = 100, entity?: string) {
  const db = getDb();
  const rows = entity
    ? await db.all('SELECT * FROM audit_events WHERE entity = ? ORDER BY created_at DESC LIMIT ?', [entity, limit])
    : await db.all('SELECT * FROM audit_events ORDER BY created_at DESC LIMIT ?', [limit]);
  return rows;
}
