import type { FastifyInstance } from 'fastify';
import { allSettings, getSetting, setSetting } from '../domain/settings.js';
import { listAudit } from '../domain/audit.js';
import { createUser, listUsers, updateUser } from '../domain/users.js';
import { newId } from '../lib/ids.js';
import { getDb } from '../db/index.js';
import { nowIso, camelizeAll } from '../lib/rows.js';
import { recordAudit } from '../domain/audit.js';
import { badRequest, notFound } from '../lib/errors.js';

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/admin/settings', { preHandler: app.requireRole('staff') }, async () => ({
    settings: await allSettings(),
    passportValidityRules: await getSetting('passport_validity_rules', {}),
  }));

  app.put('/api/admin/settings', { preHandler: app.requireRole('admin') }, async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(body)) {
      await setSetting(key, value);
    }
    await recordAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'settings.updated',
      entity: 'settings',
      meta: { keys: Object.keys(body) },
      ip: req.ip,
    });
    return { settings: await allSettings() };
  });

  app.get('/api/admin/audit', { preHandler: app.requireRole('staff') }, async (req) => {
    const query = req.query as any;
    return { events: camelizeAll(await listAudit(Number(query.limit) || 100, query.entity)) };
  });

  app.get('/api/admin/users', { preHandler: app.requireRole('admin') }, async () => ({
    users: await listUsers(),
  }));

  app.post('/api/admin/users', { preHandler: app.requireRole('admin') }, async (req) => {
    const body = (req.body ?? {}) as { email?: string; password?: string; name?: string; role?: string };
    if (!body.email || !body.password || !body.name) throw badRequest('email, password and name are required');
    const user = await createUser({
      email: body.email,
      password: body.password,
      name: body.name,
      role: (body.role as any) ?? 'staff',
    });
    return { user };
  });

  app.patch('/api/admin/users/:id', { preHandler: app.requireRole('admin') }, async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as any;
    const user = await updateUser(id, body);
    return { user };
  });

  /* ------------------------------ Approvals ----------------------------- */

  app.get('/api/approvals', { preHandler: app.requireAuth }, async (req) => {
    const query = req.query as any;
    const rows = query.status
      ? await getDb().all('SELECT * FROM approvals WHERE status = ? ORDER BY created_at DESC', [query.status])
      : await getDb().all('SELECT * FROM approvals ORDER BY created_at DESC LIMIT 100');
    return { approvals: camelizeAll(rows) };
  });

  app.post('/api/approvals', { preHandler: app.requireAuth }, async (req) => {
    const body = (req.body ?? {}) as { kind?: string; title?: string; description?: string; payload?: unknown };
    if (!body.kind || !body.title) throw badRequest('kind and title are required');
    const db = getDb();
    const id = newId('apr');
    const now = nowIso();
    await db.run(
      `INSERT INTO approvals (id, kind, title, description, payload, status, requested_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      [
        id,
        body.kind,
        body.title,
        body.description ?? '',
        body.payload === undefined ? null : JSON.stringify(body.payload),
        req.user!.id,
        now,
        now,
      ],
    );
    return { approval: camelizeAll(await db.all('SELECT * FROM approvals WHERE id = ?', [id]))[0] };
  });

  app.post('/api/approvals/:id/review', { preHandler: app.requireRole('staff') }, async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { status?: string; note?: string };
    if (!body.status || !['approved', 'rejected'].includes(body.status)) {
      throw badRequest('status must be approved or rejected');
    }
    const db = getDb();
    const existing = await db.get('SELECT * FROM approvals WHERE id = ?', [id]);
    if (!existing) throw notFound('Approval not found');
    const now = nowIso();
    await db.run(
      `UPDATE approvals SET status = ?, reviewed_by = ?, reviewed_at = ?, note = ?, updated_at = ? WHERE id = ?`,
      [body.status, req.user!.id, now, body.note ?? null, now, id],
    );
    await recordAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: `approval.${body.status}`,
      entity: 'approval',
      entityId: id,
      meta: { note: body.note },
      ip: req.ip,
    });
    return { approval: camelizeAll(await db.all('SELECT * FROM approvals WHERE id = ?', [id]))[0] };
  });

  /* ------------------------------ Reminders ----------------------------- */

  app.get('/api/reminders', { preHandler: app.requireAuth }, async (req) => {
    const query = req.query as any;
    const rows = query.status
      ? await getDb().all('SELECT * FROM reminders WHERE status = ? ORDER BY due_at ASC', [query.status])
      : await getDb().all('SELECT * FROM reminders ORDER BY due_at ASC LIMIT 100');
    return { reminders: camelizeAll(rows) };
  });

  app.post('/api/reminders', { preHandler: app.requireAuth }, async (req) => {
    const body = (req.body ?? {}) as { caseId?: string; title?: string; dueAt?: string; note?: string; channel?: string };
    if (!body.title) throw badRequest('title is required');
    const db = getDb();
    const id = newId('rem');
    const now = nowIso();
    await db.run(
      `INSERT INTO reminders (id, case_id, title, due_at, status, channel, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
      [id, body.caseId ?? null, body.title, body.dueAt ?? null, body.channel ?? 'in_app', body.note ?? null, now, now],
    );
    return { reminder: camelizeAll(await db.all('SELECT * FROM reminders WHERE id = ?', [id]))[0] };
  });
}
