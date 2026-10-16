/**
 * Vercel serverless entry.
 *
 * Vercel's Node runtime hands us a Node.js (IncomingMessage, ServerResponse)
 * pair. Fastify can serve that pair directly through its underlying Node
 * server, so the whole REST + WebSocket surface is exposed on Vercel without a
 * separate hosting product.
 *
 * The database is Postgres (DATABASE_URL + DB_SCHEMA); SQLite would not persist
 * between invocations. Migrations and seeding run once per cold start and are
 * idempotent.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { initServer } from '../apps/server/src/index';

type VercelRequest = IncomingMessage & { body?: unknown; query?: unknown; cookies?: Record<string, string> };
type VercelResponse = ServerResponse & { status?: (code: number) => VercelResponse; json?: (body: unknown) => void };

let bootPromise: Promise<Awaited<ReturnType<typeof initServer>>> | null = null;

function boot() {
  if (!bootPromise) {
    bootPromise = initServer().catch((error) => {
      bootPromise = null;
      throw error;
    });
  }
  return bootPromise;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const app = await boot();
  // Hand the raw Node request straight to Fastify's Node server.
  app.server.emit('request', req, res);
}
