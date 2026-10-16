import type { FastifyInstance } from 'fastify';
import { env } from '../env.js';
import { badRequest, notFound } from '../lib/errors.js';
import { getConnection, isGoogleConfigured, googleAuthorizeUrl, exchangeCode, disconnect, createDriveFolder, uploadFileToDrive, createGoogleDoc, createGmailDraft } from '../services/google/client.js';
import { scrapePage } from '../services/web/scrape.js';
import { buildCaseBundle } from './documents.js';
import { modelToHtml } from '../services/docs/html.js';
import { htmlToPdf } from '../services/docs/render.js';
import { TEMPLATES } from '../services/docs/templates.js';
import { recordAudit } from '../domain/audit.js';

export async function integrationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/integrations', { preHandler: app.requireAuth }, async () => {
    const google = await getConnection('google');
    return {
      google: {
        configured: isGoogleConfigured(),
        connected: google?.status === 'connected',
        status: google?.status ?? 'disconnected',
        accountEmail: google?.accountEmail ?? null,
        scopes: google?.scopes ?? null,
        services: {
          drive: google?.status === 'connected',
          docs: google?.status === 'connected',
          gmail: google?.status === 'connected',
        },
      },
      firecrawl: {
        configured: !!env.FIRECRAWL_URL,
        url: env.FIRECRAWL_URL ?? null,
        note: env.FIRECRAWL_URL
          ? 'Self-hosted Firecrawl endpoint configured.'
          : 'No Firecrawl endpoint configured — the Playwright extraction fallback is used.',
      },
      ollama: {
        configured: true,
        baseUrl: env.OLLAMA_BASE_URL,
        defaultModel: env.OLLAMA_MODEL,
        note: 'Detected automatically; set the model in the provider settings if your local runtime uses another tag.',
      },
    };
  });

  app.get('/api/integrations/google/start', { preHandler: app.requireAuth }, async (req, reply) => {
    if (!isGoogleConfigured()) throw badRequest('Google integration is not configured on this server');
    const state = Buffer.from(JSON.stringify({ userId: req.user!.id, ts: Date.now() })).toString('base64url');
    return reply.redirect(googleAuthorizeUrl(state));
  });

  app.get('/api/integrations/google/callback', async (req, reply) => {
    const query = req.query as { code?: string; error?: string; state?: string };
    if (query.error) throw badRequest(`Google authorization failed: ${query.error}`);
    if (!query.code) throw badRequest('Missing authorization code');
    await exchangeCode(query.code);
    await recordAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'integration.google_connected',
      entity: 'integration',
      entityId: 'google',
      ip: req.ip,
    });
    return reply.redirect('/more/integrations?connected=google');
  });

  app.post('/api/integrations/google/disconnect', { preHandler: app.requireRole('staff') }, async (req) => {
    await disconnect('google');
    await recordAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'integration.google_disconnected',
      entity: 'integration',
      entityId: 'google',
      ip: req.ip,
    });
    return { ok: true };
  });

  app.post('/api/integrations/google/export-case', { preHandler: app.requireRole('staff') }, async (req) => {
    const body = (req.body ?? {}) as { caseId?: string; template?: string };
    if (!body.caseId) throw badRequest('caseId is required');
    const bundle = await buildCaseBundle(body.caseId);
    const template = TEMPLATES[body.template ?? 'dossier'];
    if (!template) throw badRequest(`Unknown template: ${body.template}`);
    const model = template.build(bundle);
    const pdf = await htmlToPdf(modelToHtml(model));
    const folderName = `${bundle.case.reference} — ${bundle.applicant?.fullName ?? 'Applicant'}`;
    const folderId = await createDriveFolder(folderName);
    const fileId = await uploadFileToDrive(`${model.title}.pdf`, 'application/pdf', pdf, folderId);
    const docId = await createGoogleDoc(
      `${model.title} — ${bundle.case.reference}`,
      `${model.title}\n\n${model.subtitle}\n\n${model.blocks
        .map((b) => ('text' in b ? b.text : ''))
        .join('\n\n')}`,
    );
    await recordAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'integration.google_exported',
      entity: 'case',
      entityId: body.caseId,
      meta: { folderId, fileId, docId },
      ip: req.ip,
    });
    return { ok: true, folderId, fileId, docId };
  });

  app.post('/api/integrations/google/draft-email', { preHandler: app.requireRole('staff') }, async (req) => {
    const body = (req.body ?? {}) as { caseId?: string; to?: string; subject?: string; body?: string };
    if (!body.to) throw badRequest('A recipient address is required');
    const draftId = await createGmailDraft({
      to: body.to,
      subject: body.subject ?? 'Visa application update',
      body: body.body ?? '',
    });
    return { ok: true, draftId, note: 'A draft was created in Gmail. Nothing was sent automatically.' };
  });

  /** Official web intelligence: extract text and compare with stored requirements. */
  app.post('/api/integrations/scrape', { preHandler: app.requireRole('staff') }, async (req) => {
    const body = (req.body ?? {}) as { url?: string };
    if (!body.url) throw badRequest('A url is required');
    const page = await scrapePage(body.url);
    await recordAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'integration.scrape',
      entity: 'web',
      entityId: body.url,
      meta: { source: page.source, length: page.text.length },
      ip: req.ip,
    });
    return { page };
  });

  app.get('/api/integrations/scrape', { preHandler: app.requireAuth }, async (req) => {
    const query = req.query as { url?: string };
    if (!query.url) throw badRequest('A url is required');
    const page = await scrapePage(query.url);
    return { page };
  });
}
