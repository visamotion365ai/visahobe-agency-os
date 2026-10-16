import type { FastifyInstance } from 'fastify';
import { requirementsInputSchema } from '@visahobe/shared';
import { parseBody } from '../lib/http.js';
import {
  createRequirement,
  listRequirements,
  updateRequirement,
  verifyRequirement,
} from '../domain/requirements.js';
import { recordAudit } from '../domain/audit.js';
import { badRequest } from '../lib/errors.js';

export async function requirementRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/requirements', { preHandler: app.requireAuth }, async (req) => {
    const query = req.query as any;
    return {
      requirements: await listRequirements({
        country: query.country,
        visaCategory: query.visaCategory,
        includeSuperseded: query.includeSuperseded === 'true',
      }),
    };
  });

  app.post('/api/requirements', { preHandler: app.requireRole('staff') }, async (req) => {
    const body = parseBody(requirementsInputSchema, req.body);
    const requirement = await createRequirement({
      ...body,
      category: body.category ?? 'general',
      mandatory: body.mandatory ?? true,
    });
    await recordAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'requirement.created',
      entity: 'requirement',
      entityId: requirement.id,
      meta: { country: requirement.country, version: requirement.version },
      ip: req.ip,
    });
    return { requirement };
  });

  app.patch('/api/requirements/:id', { preHandler: app.requireRole('staff') }, async (req) => {
    const { id } = req.params as { id: string };
    const body = parseBody(requirementsInputSchema.partial().extend({ status: z_status() }).partial(), req.body);
    const requirement = await updateRequirement(id, body as any);
    await recordAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'requirement.updated',
      entity: 'requirement',
      entityId: id,
      ip: req.ip,
    });
    return { requirement };
  });

  app.post('/api/requirements/:id/verify', { preHandler: app.requireRole('staff') }, async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { sourceUrl?: string; sourceTitle?: string; verifiedAt?: string };
    if (!body.sourceUrl) throw badRequest('A source URL is required before a requirement can be marked verified');
    const requirement = await verifyRequirement(id, body);
    await recordAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'requirement.verified',
      entity: 'requirement',
      entityId: id,
      meta: { sourceUrl: body.sourceUrl },
      ip: req.ip,
    });
    return { requirement };
  });
}

function z_status() {
  return {
    type: 'string',
    enum: ['unverified', 'verified', 'stale', 'superseded'],
  } as any;
}
