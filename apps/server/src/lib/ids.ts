import { randomBytes, randomUUID } from 'node:crypto';

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

/** Short, sortable-ish, URL-safe identifier with a type prefix. */
export function newId(prefix: string): string {
  const time = Date.now().toString(36).padStart(8, '0');
  const bytes = randomBytes(8);
  let rand = '';
  for (const b of bytes) rand += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${time}${rand}`;
}

export const newUuid = (): string => randomUUID();

/** Human readable case reference such as VM-7K3D92. */
export function newReference(prefix = 'VM'): string {
  const bytes = randomBytes(4);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length].toUpperCase();
  return `${prefix}-${out}${Date.now().toString(36).slice(-2).toUpperCase()}`;
}
