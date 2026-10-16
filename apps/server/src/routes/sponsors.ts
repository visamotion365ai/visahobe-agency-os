import type { FastifyInstance } from 'fastify';
import { sponsorInputSchema } from '@visahobe/shared';
import { parseBody } from '../lib/http.js';
import { createSponsor, getSponsor, listSponsors, markSponsorVerified, updateSponsor } from '../domain/sponsors.js';
import { recordAudit } from '../domain/audit.js';
import { notFound } from '../lib/errors.js';

export async function sponsorRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/sponsors', { preHandler: app.requireAuth }, async (req) => {
    const query = req.query as any;
    return { sponsors: await listSponsors({ q: query.q, country: query.country, status: query.status }) };
  });

  app.get('/api/sponsors/:id', { preHandler: app.requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const sponsor = await getSponsor(id);
    if (!sponsor) throw notFound('Sponsor not found');
    return { sponsor };
  });

  app.post('/api/sponsors', { preHandler: app.requireAuth }, async (req) => {
    const body = parseBody(sponsorInputSchema, req.body);
    const sponsor = await createSponsor({ ...body, verificationStatus: body.verificationStatus ?? 'unverified' });
    await recordAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'sponsor.created',
      entity: 'sponsor',
      entityId: sponsor.id,
      ip: req.ip,
    });
    return { sponsor };
  });

  app.patch('/api/sponsors/:id', { preHandler: app.requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const body = parseBody(sponsorInputSchema.partial(), req.body);
    const sponsor = await updateSponsor(id, body);
    await recordAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'sponsor.updated',
      entity: 'sponsor',
      entityId: id,
      meta: { fields: Object.keys(body) },
      ip: req.ip,
    });
    return { sponsor };
  });

  app.post('/api/sponsors/:id/verification', { preHandler: app.requireRole('staff') }, async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { status?: string; note?: string };
    const status = (body?.status ?? 'unverified') as any;
    const sponsor = await markSponsorVerified(id, status, req.user!.id, body?.note);
    await recordAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'sponsor.verification_changed',
      entity: 'sponsor',
      entityId: id,
      meta: { status, note: body?.note },
      ip: req.ip,
    });
    return { sponsor };
  });
}
