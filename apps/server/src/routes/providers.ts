import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { providerInputSchema } from '@visahobe/shared';
import { parseBody } from '../lib/http.js';
import { badRequest, notFound } from '../lib/errors.js';
import {
  createProvider,
  deleteProvider,
  getDefaultProvider,
  getProviderWithSecret,
  listProviders,
  updateProvider,
} from '../domain/providers.js';
import { createProviderRuntime } from '../ai/providers/index.js';
import { probeProvider } from '../ai/health.js';
import { recordAudit } from '../domain/audit.js';

const providerPatchSchema = providerInputSchema.partial().extend({
  isDefault: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

export async function providerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/providers', { preHandler: app.requireAuth }, async () => ({
    providers: await listProviders(),
  }));

  app.get('/api/providers/default', { preHandler: app.requireAuth }, async () => {
    const provider = await getDefaultProvider();
    const probe = await probeProvider(provider ? { ...provider, apiKey: undefined } : null);
    return {
      provider: provider
        ? { id: provider.id, name: provider.name, kind: provider.kind, model: provider.model }
        : { id: 'builtin', name: 'VisaHOBe Local Engine', kind: 'builtin', model: 'deterministic-ops-engine' },
      health: probe,
    };
  });

  app.post('/api/providers', { preHandler: app.requireRole('admin') }, async (req) => {
    const body = parseBody(providerInputSchema, req.body);
    const provider = await createProvider(body);
    await recordAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'provider.created',
      entity: 'provider',
      entityId: provider.id,
      meta: { kind: provider.kind, model: provider.model },
      ip: req.ip,
    });
    return { provider };
  });

  app.patch('/api/providers/:id', { preHandler: app.requireRole('admin') }, async (req) => {
    const { id } = req.params as { id: string };
    const body = parseBody(providerPatchSchema, req.body);
    const provider = await updateProvider(id, body as any);
    await recordAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'provider.updated',
      entity: 'provider',
      entityId: id,
      meta: { fields: Object.keys(body) },
      ip: req.ip,
    });
    return { provider };
  });

  app.delete('/api/providers/:id', { preHandler: app.requireRole('admin') }, async (req) => {
    const { id } = req.params as { id: string };
    await deleteProvider(id);
    return { ok: true };
  });

  app.post('/api/providers/:id/test', { preHandler: app.requireRole('staff') }, async (req) => {
    const { id } = req.params as { id: string };
    const record = await getProviderWithSecret(id);
    if (!record) throw notFound('Provider not found');
    if (record.kind === 'builtin') {
      return { ok: true, message: 'VisaHOBe Local Engine is always available (offline, deterministic).' };
    }
    try {
      const runtime = createProviderRuntime(record);
      const result = await runtime.test();
      return result;
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  });
}
