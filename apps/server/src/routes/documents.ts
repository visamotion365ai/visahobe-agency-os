import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { env } from '../env.js';
import { parseBody } from '../lib/http.js';
import { badRequest, notFound } from '../lib/errors.js';
import { recordAudit } from '../domain/audit.js';
import {
  addDocumentVersion,
  createDocument,
  getDocument,
  listDocuments,
  updateDocument,
} from '../domain/documents.js';
import { readStoredFile, saveBuffer, signedDownloadUrl } from '../services/storage.js';
import { runOcr, extractPassportFields } from '../services/docs/ocr.js';
import { updateApplicant } from '../domain/applicants.js';
import { getCaseWithSteps } from '../domain/cases.js';
import { listDocuments as listCaseDocuments } from '../domain/documents.js';
import { listRequirementChecks, listRequirements } from '../domain/requirements.js';
import { evaluatePassportValidity } from '../domain/passport.js';
import { TEMPLATES, type CaseBundle } from '../services/docs/templates.js';
import { modelToHtml } from '../services/docs/html.js';
import { modelToDocx } from '../services/docs/docx.js';
import { htmlToPdf } from '../services/docs/render.js';

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
]);

export const DOCUMENT_CATEGORIES = [
  'passport',
  'photo',
  'cv',
  'education',
  'employment',
  'sponsorship',
  'police_clearance',
  'medical',
  'travel',
  'financial',
  'other',
];

export async function documentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/documents', { preHandler: app.requireAuth }, async (req) => {
    const query = req.query as any;
    const documents = await listDocuments({
      applicantId: query.applicantId,
      caseId: query.caseId,
      category: query.category,
      kind: query.kind,
      q: query.q,
    });
    return {
      documents: documents.map((d) => ({ ...d, downloadUrl: signedDownloadUrl(d.storageKey) })),
    };
  });

  app.get('/api/documents/categories', { preHandler: app.requireAuth }, async () => ({
    categories: DOCUMENT_CATEGORIES,
  }));

  app.get('/api/documents/templates', { preHandler: app.requireAuth }, async () => ({
    templates: Object.entries(TEMPLATES).map(([key, value]) => ({ key, label: value.label })),
  }));

  app.post('/api/documents', { preHandler: app.requireAuth }, async (req, reply) => {
    const file = await (req as any).file();
    if (!file) throw badRequest('No file was uploaded');
    const fields = file.fields ?? {};
    const value = (name: string) => {
      const field = fields[name];
      if (!field) return undefined;
      if (Array.isArray(field)) return field[0]?.value;
      return (field as any).value;
    };
    const mime = file.mimetype ?? '';
    if (!ALLOWED_MIME.has(mime)) {
      throw badRequest(`Unsupported file type: ${mime}. Allowed: PDF, DOCX, JPG, PNG, TIFF, TXT.`);
    }
    const buffer = await file.toBuffer();
    const maxBytes = env.MAX_UPLOAD_MB * 1024 * 1024;
    if (buffer.length > maxBytes) {
      throw badRequest(`File exceeds the ${env.MAX_UPLOAD_MB} MB limit`);
    }
    const stored = await saveBuffer(buffer, file.filename ?? 'document', 'uploads');
    const document = await createDocument({
      applicantId: value('applicantId') ?? null,
      caseId: value('caseId') ?? null,
      kind: 'uploaded',
      category: value('category') ?? 'other',
      title: value('title') || file.filename,
      filename: file.filename ?? 'document',
      mime,
      size: stored.size,
      storageKey: stored.storageKey,
      sha256: stored.sha256,
      uploadedBy: req.user!.id,
      ocrStatus: mime.startsWith('image/') || mime === 'application/pdf' ? 'pending' : 'skipped',
    });
    await recordAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'document.uploaded',
      entity: 'document',
      entityId: document.id,
      meta: { filename: document.filename, size: document.size },
      ip: req.ip,
    });
    reply.code(201);
    return { document: { ...document, downloadUrl: signedDownloadUrl(document.storageKey) } };
  });

  app.get('/api/documents/:id', { preHandler: app.requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const document = await getDocument(id);
    if (!document) throw notFound('Document not found');
    return { document: { ...document, downloadUrl: signedDownloadUrl(document.storageKey) } };
  });

  app.post('/api/documents/:id/ocr', { preHandler: app.requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const document = await getDocument(id);
    if (!document) throw notFound('Document not found');
    await updateDocument(id, { ocrStatus: 'running' });
    try {
      const buffer = await readStoredFile(document.storageKey);
      const result = await runOcr(buffer, document.mime);
      const fields = extractPassportFields(result.text);
      await updateDocument(id, {
        ocrStatus: 'done',
        ocrText: result.text.slice(0, 60000),
        ocrJson: { fields, confidence: result.confidence, engine: result.engine },
      });
      return { ocr: { text: result.text.slice(0, 20000), fields, confidence: result.confidence, engine: result.engine } };
    } catch (err) {
      await updateDocument(id, { ocrStatus: 'failed' });
      throw badRequest(`OCR failed: ${(err as Error).message}`);
    }
  });

  app.post('/api/documents/:id/apply-fields', { preHandler: app.requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const document = await getDocument(id);
    if (!document) throw notFound('Document not found');
    const body = (req.body ?? {}) as Record<string, string>;
    if (!document.applicantId) throw badRequest('This document is not linked to an applicant');
    const applicant = await updateApplicant(document.applicantId, {
      fullName: body.fullName,
      passportNumber: body.passportNumber,
      nationality: body.nationality,
      dateOfBirth: body.dateOfBirth,
      gender: body.gender as any,
      passportIssueDate: body.passportIssueDate,
      passportExpiryDate: body.passportExpiryDate,
    });
    await recordAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'document.fields_applied',
      entity: 'applicant',
      entityId: document.applicantId,
      meta: { documentId: id, fields: Object.keys(body) },
      ip: req.ip,
    });
    return { applicant };
  });

  app.post('/api/documents/:id/versions', { preHandler: app.requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const document = await getDocument(id);
    if (!document) throw notFound('Document not found');
    const file = await (req as any).file();
    if (!file) throw badRequest('No file was uploaded');
    const buffer = await file.toBuffer();
    const stored = await saveBuffer(buffer, file.filename ?? document.filename, 'uploads');
    const version = await addDocumentVersion({
      documentId: id,
      filename: file.filename ?? document.filename,
      storageKey: stored.storageKey,
      size: stored.size,
      sha256: stored.sha256,
      note: (req.query as any)?.note,
      createdBy: req.user!.id,
    });
    return { version };
  });

  /** Short-lived signed download for a private file. */
  app.get('/api/files/download', { preHandler: app.requireAuth }, async (req, reply) => {
    const { token } = req.query as { token?: string };
    if (!token) throw badRequest('A download token is required');
    const { verifyFileToken } = await import('../lib/crypto.js');
    const verified = verifyFileToken(token);
    if (!verified) throw badRequest('The download link is invalid or has expired');
    const buffer = await readStoredFile(verified.p);
    const name = verified.p.split('/').pop() ?? 'file';
    reply.header('content-type', 'application/octet-stream');
    reply.header('content-disposition', `attachment; filename="${name}"`);
    reply.header('cache-control', 'private, no-store');
    return reply.send(buffer);
  });

  app.get('/api/documents/:id/preview', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const document = await getDocument(id);
    if (!document) throw notFound('Document not found');
    const buffer = await readStoredFile(document.storageKey);
    reply.header('content-type', document.mime ?? 'application/octet-stream');
    reply.header('content-disposition', `inline; filename="${document.filename}"`);
    reply.header('cache-control', 'private, no-store');
    return reply.send(buffer);
  });

  /** Generate the real case documents (PDF + DOCX) from the stored records. */
  app.post('/api/cases/:id/documents/generate', { preHandler: app.requireRole('staff') }, async (req) => {
    const { id } = req.params as { id: string };
    const body = parseBody(
      (await import('zod')).z.object({ template: (await import('zod')).z.string().min(2) }),
      req.body,
    );
    const template = TEMPLATES[body.template];
    if (!template) throw badRequest(`Unknown template: ${body.template}`);
    const bundle = await buildCaseBundle(id);
    const model = template.build(bundle);
    const html = modelToHtml(model);
    const pdf = await htmlToPdf(html);
    const docxBuffer = await modelToDocx(model);

    const pdfStore = await saveBuffer(pdf, `${body.template}.pdf`, 'generated');
    const docxStore = await saveBuffer(docxBuffer, `${body.template}.docx`, 'generated');

    const pdfDoc = await createDocument({
      applicantId: bundle.applicant?.id ?? null,
      caseId: id,
      kind: 'generated',
      category: 'generated',
      title: `${model.title} (PDF)`,
      filename: `${body.template}.pdf`,
      mime: 'application/pdf',
      size: pdfStore.size,
      storageKey: pdfStore.storageKey,
      sha256: pdfStore.sha256,
      uploadedBy: req.user!.id,
      ocrStatus: 'skipped',
    });
    const docxDoc = await createDocument({
      applicantId: bundle.applicant?.id ?? null,
      caseId: id,
      kind: 'generated',
      category: 'generated',
      title: `${model.title} (DOCX)`,
      filename: `${body.template}.docx`,
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: docxStore.size,
      storageKey: docxStore.storageKey,
      sha256: docxStore.sha256,
      uploadedBy: req.user!.id,
      ocrStatus: 'skipped',
    });
    await recordAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'document.generated',
      entity: 'case',
      entityId: id,
      meta: { template: body.template },
      ip: req.ip,
    });
    return {
      model: { title: model.title, subtitle: model.subtitle, reference: model.reference },
      html,
      documents: [pdfDoc, docxDoc].map((d) => ({ ...d, downloadUrl: signedDownloadUrl(d.storageKey) })),
    };
  });
}

export async function buildCaseBundle(caseId: string): Promise<CaseBundle> {
  const detail = await getCaseWithSteps(caseId);
  const requirements = await listRequirements({
    country: detail.case.country,
    visaCategory: detail.case.visaCategory,
  });
  const checks = await listRequirementChecks(caseId);
  const documents = await listCaseDocuments({ caseId });
  const validity = await evaluatePassportValidity(
    (detail.applicant as any)?.passportExpiryDate ?? null,
    detail.case.country,
    detail.case.visaCategory,
  );
  return {
    case: detail.case as any,
    applicant: detail.applicant as any,
    sponsor: detail.sponsor as any,
    steps: detail.steps as any,
    requirements: requirements as any,
    checks: checks as any,
    documents: documents as any,
    validity,
  };
}
