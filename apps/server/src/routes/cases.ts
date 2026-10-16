import type { FastifyInstance } from 'fastify';
import { caseInputSchema, WORKFLOW_STEPS } from '@visahobe/shared';
import { parseBody, pagination } from '../lib/http.js';
import { assertStepTransition, createCase, getCaseWithSteps, listCases, setStepStatus, updateCase } from '../domain/cases.js';
import { evaluatePassportValidity } from '../domain/passport.js';
import { listRequirementChecks, setRequirementCheck } from '../domain/requirements.js';
import { recordAudit } from '../domain/audit.js';
import { badRequest, notFound } from '../lib/errors.js';

export async function caseRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/cases', { preHandler: app.requireAuth }, async (req) => {
    const { page, pageSize } = pagination(req.query as any);
    const query = req.query as any;
    return listCases({ q: query.q, country: query.country, status: query.status, page, pageSize });
  });

  app.get('/api/cases/:id', { preHandler: app.requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const detail = await getCaseWithSteps(id);
    const checks = await listRequirementChecks(id);
    return { ...detail, checks, stepsTemplate: WORKFLOW_STEPS };
  });

  app.post('/api/cases', { preHandler: app.requireAuth }, async (req) => {
    const body = parseBody(caseInputSchema, req.body);
    const created = await createCase({ ...body, priority: body.priority ?? 'normal' }, req.user!.id);
    await recordAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'case.created',
      entity: 'case',
      entityId: created.id,
      meta: { reference: created.reference },
      ip: req.ip,
    });
    const detail = await getCaseWithSteps(created.id);
    return detail;
  });

  app.patch('/api/cases/:id', { preHandler: app.requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;
    const updated = await updateCase(id, body as any);
    await recordAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'case.updated',
      entity: 'case',
      entityId: id,
      meta: { fields: Object.keys(body) },
      ip: req.ip,
    });
    return { case: updated };
  });

  app.post('/api/cases/:id/steps/:stepNumber', { preHandler: app.requireAuth }, async (req) => {
    const { id, stepNumber } = req.params as { id: string; stepNumber: string };
    const body = req.body as { status?: string; data?: unknown; notes?: string };
    const detail = await getCaseWithSteps(id);
    const current = detail.steps.find((s) => s.stepNumber === Number(stepNumber));
    if (!current) throw notFound('Case step not found');
    const status = (body?.status ?? 'in_progress') as any;
    try {
      assertStepTransition(current.status, status);
    } catch (err) {
      throw badRequest((err as Error).message);
    }
    const step = await setStepStatus(id, Number(stepNumber), status, {
      data: body?.data,
      notes: body?.notes,
      userId: req.user!.id,
    });
    await recordAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'case.step_updated',
      entity: 'case',
      entityId: id,
      meta: { step: Number(stepNumber), status },
      ip: req.ip,
    });
    return { step };
  });

  app.get('/api/cases/:id/passport-validity', { preHandler: app.requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const detail = await getCaseWithSteps(id);
    const validity = await evaluatePassportValidity(
      (detail.applicant as any)?.passportExpiryDate ?? null,
      detail.case.country,
      detail.case.visaCategory,
    );
    return { validity };
  });

  app.put('/api/cases/:id/requirements/:requirementId', { preHandler: app.requireAuth }, async (req) => {
    const { id, requirementId } = req.params as { id: string; requirementId: string };
    const body = req.body as { status?: string; note?: string; evidenceDocumentId?: string };
    if (!body?.status) throw badRequest('status is required');
    const check = await setRequirementCheck(id, requirementId, body.status as any, {
      note: body.note,
      evidenceDocumentId: body.evidenceDocumentId,
    });
    return { check };
  });
}
