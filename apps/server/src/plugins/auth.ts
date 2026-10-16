import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { env } from '../env.js';
import { signToken, verifyToken, type TokenPayload } from '../lib/jwt.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { getUserById } from '../domain/users.js';

export const SESSION_COOKIE = 'vh_session';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'staff' | 'viewer';
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (role: 'admin' | 'staff') => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    signSession: (user: AuthUser) => string;
  }
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('user', undefined);

  app.decorate('signSession', (user: AuthUser) =>
    signToken({ sub: user.id, email: user.email, role: user.role }, env.JWT_SECRET, env.SESSION_TTL_HOURS),
  );

  app.decorate('requireAuth', async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const token = bearer ?? (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    if (!token) throw unauthorized();
    const payload = verifyToken(token, env.JWT_SECRET);
    if (!payload) throw unauthorized('Session expired or invalid');
    const user = await getUserById(payload.sub);
    if (!user || !user.active) throw unauthorized('Account is not active');
    req.user = { id: user.id, email: user.email, name: user.name, role: user.role as AuthUser['role'] };
  });

  app.decorate(
    'requireRole',
    (role: 'admin' | 'staff') =>
      async (req: FastifyRequest) => {
        await app.requireAuth(req, {} as FastifyReply);
        if (!req.user) throw unauthorized();
        if (role === 'admin' && req.user.role !== 'admin') throw forbidden('Administrator role required');
        if (role === 'staff' && req.user.role === 'viewer') throw forbidden('Staff role required');
      },
  );
});

/**
 * Origin check for cookie-authenticated mutations (basic CSRF defence).
 * Bearer-token requests are not subject to it because they cannot be issued
 * by a third-party site automatically.
 */
export function assertSameOrigin(req: FastifyRequest): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
  if (req.headers.authorization?.startsWith('Bearer ')) return;
  const origin = req.headers.origin;
  if (!origin) return;
  let originHost = '';
  try {
    originHost = new URL(origin).host;
  } catch {
    throw forbidden('Cross-origin request rejected');
  }
  if (originHost === req.headers.host) return;
  if (env.corsOrigins.includes(origin)) return;
  throw forbidden('Cross-origin request rejected');
}
