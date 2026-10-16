import { getDb } from '../db/index.js';
import { nowIso, json } from '../lib/rows.js';

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await getDb().get('SELECT value FROM settings WHERE key = ?', [key]);
  if (!row) return fallback;
  return json<T>(row.value, fallback);
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await getDb().run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, JSON.stringify(value), nowIso()],
  );
}

export async function allSettings(): Promise<Record<string, unknown>> {
  const rows = await getDb().all('SELECT key, value FROM settings');
  const out: Record<string, unknown> = {};
  for (const row of rows) out[row.key] = json(row.value, null);
  return out;
}
