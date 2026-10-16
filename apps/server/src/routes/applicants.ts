import type { FastifyInstance } from 'fastify';
import { applicantInputSchema } from '@visahobe/shared';
import { parseBody, pagination } from '../lib/http.js';
import { createApplicant, getApplicant, listApplicants, updateApplicant } from '../domain/applicants.js';
import { recordAudit } from '../domain/audit.js';
import { notFound } from '../lib/errors.js';

export async function applicantRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/applicants', { preHandler: app.requireAuth }, async (req) => {
    const { page, pageSize } = pagination(req.query as any);
    const query = req.query as any;
    return listApplicants({ q: query.q, country: query.country, page, pageSize });
  });

  app.get('/api/applicants/:id', { preHandler: app.requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const applicant = await getApplicant(id);
    if (!applicant) throw notFound('Applicant not found');
    return { applicant };
  });

  app.post('/api/applicants', { preHandler: app.requireAuth }, async (req) => {
    const body = parseBody(applicantInputSchema, req.body);
    const applicant = await createApplicant(body, req.user!.id);
    await recordAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'applicant.created',
      entity: 'applicant',
      entityId: applicant.id,
      ip: req.ip,
    });
    return { applicant };
  });

  app.patch('/api/applicants/:id', { preHandler: app.requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const body = parseBody(applicantInputSchema.partial(), req.body);
    const applicant = await updateApplicant(id, body);
    await recordAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'applicant.updated',
      entity: 'applicant',
      entityId: id,
      meta: { fields: Object.keys(body) },
      ip: req.ip,
    });
    return { applicant };
  });
}
