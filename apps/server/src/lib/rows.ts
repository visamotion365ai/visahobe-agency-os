import type { Row } from '../db/index.js';

/** snake_case DB row -> camelCase domain object. */
export function camelize<T = any>(row: Row | undefined | null): T | undefined {
  if (!row) return undefined;
  const out: any = {};
  for (const [key, value] of Object.entries(row)) {
    out[key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())] = value;
  }
  return out as T;
}

export function camelizeAll<T = any>(rows: Row[]): T[] {
  return rows.map((r) => camelize<T>(r)!);
}

export function json<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value as T;
  try {
    const parsed = JSON.parse(String(value));
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function bool(v: unknown): boolean {
  return v === 1 || v === true || v === '1' || v === 'true';
}

export function toBoolInt(v: boolean): number {
  return v ? 1 : 0;
}
