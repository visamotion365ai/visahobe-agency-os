import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { env } from '../env.js';
import { signFileToken } from '../lib/crypto.js';

const SAFE_NAME = /[^A-Za-z0-9._-]+/g;

export function safeFilename(name: string): string {
  const cleaned = name.replace(SAFE_NAME, '_').replace(/_{2,}/g, '_');
  return cleaned.slice(0, 120) || 'file';
}

/** Resolve a storage key to an absolute path, refusing traversal attempts. */
export function resolveStoragePath(storageKey: string): string {
  const base = resolve(env.storageDir);
  const target = resolve(base, storageKey);
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error('Invalid storage key');
  }
  return target;
}

export async function saveBuffer(
  buffer: Buffer,
  filename: string,
  folder = 'uploads',
): Promise<{ storageKey: string; sha256: string; size: number }> {
  const now = new Date();
  const key = `${folder}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomBytes(
    12,
  ).toString('hex')}-${safeFilename(filename)}`;
  const target = resolveStoragePath(key);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, buffer, { mode: 0o600 });
  return { storageKey: key, sha256: createHash('sha256').update(buffer).digest('hex'), size: buffer.length };
}

export async function readStoredFile(storageKey: string): Promise<Buffer> {
  return readFile(resolveStoragePath(storageKey));
}

export async function deleteStoredFile(storageKey: string): Promise<void> {
  await rm(resolveStoragePath(storageKey), { force: true });
}

export function extensionFor(mime?: string | null, filename?: string): string {
  if (filename) {
    const ext = extname(filename).toLowerCase();
    if (ext) return ext;
  }
  switch ((mime ?? '').toLowerCase()) {
    case 'application/pdf':
      return '.pdf';
    case 'image/png':
      return '.png';
    case 'image/jpeg':
      return '.jpg';
    case 'image/tiff':
      return '.tiff';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return '.docx';
    default:
      return '.bin';
  }
}

/** Short-lived capability URL for private downloads. */
export function signedDownloadUrl(storageKey: string, ttlSeconds = 300): string {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `/api/files/download?token=${encodeURIComponent(signFileToken(storageKey, expires))}`;
}
