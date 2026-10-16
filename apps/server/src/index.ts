import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from './env.js';
import { getDb, runMigrations } from './db/index.js';
import { authPlugin } from './plugins/auth.js';
import { AppError } from './lib/errors.js';
import { authRoutes } from './routes/auth.js';
import { applicantRoutes } from './routes/applicants.js';
import { sponsorRoutes } from './routes/sponsors.js';
import { caseRoutes } from './routes/cases.js';
import { requirementRoutes } from './routes/requirements.js';
import { documentRoutes } from './routes/documents.js';
import { agentRoutes } from './routes/agents.js';
import { providerRoutes } from './routes/providers.js';
import { browserRoutes } from './routes/browser.js';
import { integrationRoutes } from './routes/integrations.js';
import { reportRoutes } from './routes/reports.js';
import { adminRoutes } from './routes/admin.js';
import { skillRoutes } from './routes/skills.js';
import { seedDatabase } from './domain/seed.js';
import { closeRenderer } from './services/docs/render.js';
import { closeScraper } from './services/web/scrape.js';
import { hub } from './browser/hub.js';

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-worker-token"]'],
    },
    bodyLimit: env.MAX_UPLOAD_MB * 1024 * 1024 + 1024 * 1024,
    trustProxy: env.TRUST_PROXY,
  });

  await app.register(cookie);
  // Cross-origin handling: the same host (including tunnel/preview hosts) and
  // the configured allow-list are accepted; everything else is rejected.
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (!origin) return;
    let originHost = '';
    try {
      originHost = new URL(origin).host;
    } catch {
      reply.code(403).send({ error: { code: 'forbidden', message: 'Invalid origin' } });
      return;
    }
    const sameHost = originHost === request.headers.host;
    const allowed = sameHost || env.corsOrigins.includes(origin);
    if (!allowed) {
      reply.code(403).send({ error: { code: 'forbidden', message: 'Origin not allowed' } });
      return;
    }
    reply.header('access-control-allow-origin', origin);
    reply.header('access-control-allow-credentials', 'true');
    reply.header('access-control-allow-headers', 'content-type, authorization');
    reply.header('access-control-allow-methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
    reply.header('vary', 'Origin');
    if (request.method === 'OPTIONS') {
      reply.code(204).send();
    }
  });
  await app.register(multipart, {
    limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 5 },
  });
  await app.register(websocket, { options: { maxPayload: 8 * 1024 * 1024 } });
  await app.register(authPlugin);

  app.setErrorHandler((rawError, request, reply) => {
    const error = rawError as any;
    if (rawError instanceof AppError) {
      reply.code(rawError.statusCode).send({ error: { code: rawError.code, message: rawError.message, details: rawError.details } });
      return;
    }
    if ((error as any).validation) {
      reply.code(400).send({ error: { code: 'validation', message: error.message } });
      return;
    }
    if ((error as any).code === 'FST_REQ_FILE_TOO_LARGE') {
      reply.code(413).send({ error: { code: 'file_too_large', message: `File exceeds the ${env.MAX_UPLOAD_MB} MB limit` } });
      return;
    }
    request.log.error({ err: error }, 'unhandled error');
    reply.code(500).send({ error: { code: 'internal_error', message: 'An unexpected error occurred' } });
  });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'visahobe-server',
    version: '1.0.0',
    uptime: Math.round(process.uptime()),
  }));

  app.get('/ready', async (_req, reply) => {
    const db = getDb();
    try {
      await db.get('SELECT 1 AS ok');
    } catch {
      reply.code(503);
      return { status: 'not_ready', database: 'unreachable' };
    }
    return {
      status: 'ready',
      database: 'ok',
      browserWorker: hub.connected ? 'connected' : 'not_connected',
      aiProvider: 'available',
    };
  });

  await app.register(authRoutes);
  await app.register(applicantRoutes);
  await app.register(sponsorRoutes);
  await app.register(caseRoutes);
  await app.register(requirementRoutes);
  await app.register(documentRoutes);
  await app.register(agentRoutes);
  await app.register(providerRoutes);
  await app.register(browserRoutes);
  await app.register(integrationRoutes);
  await app.register(reportRoutes);
  await app.register(adminRoutes);
  await app.register(skillRoutes);

  const webDistCandidates = [
    resolve(process.cwd(), '../web/dist'),
    resolve(process.cwd(), 'apps/web/dist'),
    resolve(process.cwd(), '../../apps/web/dist'),
    resolve(import.meta.dirname, '../../web/dist'),
  ];
  const webDist = webDistCandidates.find((candidate) => existsSync(candidate));
  if (webDist) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/' });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api') || request.url.startsWith('/health') || request.url.startsWith('/ready')) {
        reply.code(404).send({ error: { code: 'not_found', message: 'Route not found' } });
        return;
      }
      reply.sendFile('index.html');
    });
  }

  return app;
}

/**
 * Prepare the server for a serverless runtime: build the app, apply migrations
 * and seed the database, but never call listen(). Safe to await on every cold
 * start because migrations and seeding are idempotent.
 */
export async function initServer() {
  const app = await buildServer();
  const db = getDb();
  const applied = await runMigrations(db);
  if (applied.length) app.log.info({ applied }, 'database migrations applied');
  await seedDatabase();
  await app.ready();
  return app;
}

export async function start() {
  const app = await buildServer();
  const db = getDb();
  const applied = await runMigrations(db);
  if (applied.length) app.log.info({ applied }, 'database migrations applied');
  await seedDatabase();

  for (const warning of env.warnings) app.log.warn(warning);

  await app.listen({ port: env.PORT, host: env.HOST });
  app.log.info(
    {
      browserWorker: env.WORKER_URL,
      database: env.DATABASE_URL ? 'postgres' : 'sqlite',
      storage: env.storageDir,
    },
    'VisaHOBe Agency OS server ready',
  );

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await closeRenderer().catch(() => undefined);
    await closeScraper().catch(() => undefined);
    await app.close().catch(() => undefined);
    await db.close().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  return app;
}

const isMain = process.argv[1]?.endsWith('index.js') || process.argv[1]?.endsWith('index.ts');
if (isMain) {
  start().catch((err) => {
    console.error('Failed to start VisaHOBe server:', err);
    process.exit(1);
  });
}
