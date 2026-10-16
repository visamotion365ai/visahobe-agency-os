import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../env.js';

const KEY = createHmac('sha256', env.ENCRYPTION_KEY).update('visahobe:at-rest:v1').digest();

/** AES-256-GCM encryption for provider API keys at rest. */
export function encryptSecret(plain: string): string {
  if (!plain) return '';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${b64(iv)}.${b64(enc)}.${b64(tag)}`;
}

export function decryptSecret(payload: string): string {
  if (!payload) return '';
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('malformed secret');
  const iv = Buffer.from(parts[1], 'base64url');
  const enc = Buffer.from(parts[2], 'base64url');
  const tag = Buffer.from(parts[3], 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

const b64 = (b: Buffer) => b.toString('base64url');

/** Short-lived signed capability for private file downloads. */
export function signFileToken(payload: string, expiresAt: number): string {
  const body = b64(Buffer.from(JSON.stringify({ p: payload, e: expiresAt }), 'utf8'));
  return `${body}.${signRaw(body)}`;
}

export function verifyFileToken(token: string): { p: string; e: number } | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = signRaw(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { p: string; e: number };
    if (!parsed.e || parsed.e * 1000 < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

function signRaw(data: string): string {
  return createHmac('sha256', env.ENCRYPTION_KEY).update(`filetoken:${data}`).digest('base64url');
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
