import type { FastifyInstance } from 'fastify';
import { env } from '../env.js';
import { SESSION_COOKIE } from '../plugins/auth.js';
import { signToken } from '../lib/jwt.js';
import { authenticate, getUserById } from '../domain/users.js';
import { recordAudit } from '../domain/audit.js';
import { badRequest } from '../lib/errors.js';
import { parseBody } from '../lib/http.js';
import { loginSchema } from '@visahobe/shared';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/login', async (req, reply) => {
    const body = parseBody(loginSchema, req.body);
    const user = await authenticate(body.email, body.password);
    const token = app.signSession({ id: user.id, email: user.email, name: user.name, role: user.role as any });
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.isProd,
      path: '/',
      maxAge: env.SESSION_TTL_HOURS * 3600,
    });
    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: 'auth.login',
      entity: 'user',
      entityId: user.id,
      ip: req.ip,
    });
    return { token, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  });

  /** Short-lived token for WebSocket connections (the browser cannot set headers on a WS handshake). */
  app.get('/api/auth/ws-token', { preHandler: app.requireAuth }, async (req) => {
    const token = signToken(
      { sub: req.user!.id, email: req.user!.email, role: 'ws' },
      env.JWT_SECRET,
      0.25,
    );
    return { token, expiresInSeconds: 900 };
  });

  app.post('/api/auth/logout', { preHandler: app.requireAuth }, async (req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    await recordAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'auth.logout',
      ip: req.ip,
    });
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: app.requireAuth }, async (req) => {
    const user = await getUserById(req.user!.id);
    return {
      user: {
        id: req.user!.id,
        email: req.user!.email,
        name: req.user!.name,
        role: req.user!.role,
        lastLoginAt: user?.lastLoginAt ?? null,
      },
    };
  });

  app.post('/api/auth/change-password', { preHandler: app.requireAuth }, async (req) => {
    const body = req.body as { currentPassword?: string; newPassword?: string };
    if (!body?.newPassword || body.newPassword.length < 8) {
      throw badRequest('A new password of at least 8 characters is required');
    }
    const { updateUser } = await import('../domain/users.js');
    const user = await authenticate(req.user!.email, body.currentPassword ?? '');
    await updateUser(user.id, { password: body.newPassword });
    await recordAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'auth.password_changed',
      entity: 'user',
      entityId: user.id,
      ip: req.ip,
    });
    return { ok: true };
  });
}
