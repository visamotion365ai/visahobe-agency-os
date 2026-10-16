import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { camelize, camelizeAll, json, nowIso } from '../lib/rows.js';
import { notFound } from '../lib/errors.js';
import { decryptSecret, encryptSecret } from '../lib/crypto.js';
import type { ProviderInput, ProviderKind } from '@visahobe/shared';

export interface ProviderRecord {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string | null;
  model: string;
  apiKeyEnc: string | null;
  settings: Record<string, unknown> | null;
  isDefault: number;
  enabled: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderPublic extends Omit<ProviderRecord, 'apiKeyEnc' | 'settings'> {
  hasApiKey: boolean;
  settings: Record<string, unknown>;
}

function toPublic(record: ProviderRecord): ProviderPublic {
  const { apiKeyEnc, settings, ...rest } = record;
  return { ...rest, hasApiKey: !!apiKeyEnc, settings: settings ?? {} };
}

export async function listProviders(): Promise<ProviderPublic[]> {
  const rows = await getDb().all('SELECT * FROM ai_providers ORDER BY is_default DESC, created_at ASC');
  return camelizeAll<ProviderRecord>(rows).map(toPublic);
}

export async function getProvider(id: string): Promise<ProviderRecord | undefined> {
  return camelize<ProviderRecord>(await getDb().get('SELECT * FROM ai_providers WHERE id = ?', [id]));
}

export async function getProviderWithSecret(id: string): Promise<(ProviderRecord & { apiKey?: string }) | undefined> {
  const record = await getProvider(id);
  if (!record) return undefined;
  let apiKey: string | undefined;
  if (record.apiKeyEnc) {
    try {
      apiKey = decryptSecret(record.apiKeyEnc);
    } catch {
      apiKey = undefined;
    }
  }
  return { ...record, apiKey };
}

export async function createProvider(input: ProviderInput): Promise<ProviderPublic> {
  const db = getDb();
  const id = newId('prv');
  const now = nowIso();
  await db.run(
    `INSERT INTO ai_providers (id, name, kind, base_url, model, api_key_enc, settings, is_default, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`,
    [
      id,
      input.name,
      input.kind,
      input.baseUrl || null,
      input.model,
      input.apiKey ? encryptSecret(input.apiKey) : null,
      JSON.stringify(input.settings ?? {}),
      now,
      now,
    ],
  );
  return toPublic((await getProvider(id))!);
}

export async function updateProvider(
  id: string,
  input: Partial<ProviderInput> & { isDefault?: boolean; enabled?: boolean },
): Promise<ProviderPublic> {
  const db = getDb();
  if (!(await getProvider(id))) throw notFound('Provider not found');
  const fields: string[] = [];
  const params: any[] = [];
  if (input.name !== undefined) {
    fields.push('name = ?');
    params.push(input.name);
  }
  if (input.kind !== undefined) {
    fields.push('kind = ?');
    params.push(input.kind);
  }
  if (input.baseUrl !== undefined) {
    fields.push('base_url = ?');
    params.push(input.baseUrl || null);
  }
  if (input.model !== undefined) {
    fields.push('model = ?');
    params.push(input.model);
  }
  if (input.apiKey !== undefined) {
    fields.push('api_key_enc = ?');
    params.push(input.apiKey ? encryptSecret(input.apiKey) : null);
  }
  if (input.settings !== undefined) {
    fields.push('settings = ?');
    params.push(JSON.stringify(input.settings));
  }
  if (input.isDefault !== undefined) {
    fields.push('is_default = ?');
    params.push(input.isDefault ? 1 : 0);
  }
  if (input.enabled !== undefined) {
    fields.push('enabled = ?');
    params.push(input.enabled ? 1 : 0);
  }
  if (!fields.length) return toPublic((await getProvider(id))!);
  fields.push('updated_at = ?');
  params.push(nowIso(), id);
  await db.run(`UPDATE ai_providers SET ${fields.join(', ')} WHERE id = ?`, params);
  if (input.isDefault) await db.run('UPDATE ai_providers SET is_default = 0 WHERE id <> ?', [id]);
  return toPublic((await getProvider(id))!);
}

export async function deleteProvider(id: string): Promise<void> {
  await getDb().run('DELETE FROM ai_providers WHERE id = ?', [id]);
}

export async function getDefaultProvider(): Promise<ProviderRecord | undefined> {
  const row =
    (await getDb().get('SELECT * FROM ai_providers WHERE is_default = 1 AND enabled = 1')) ??
    (await getDb().get('SELECT * FROM ai_providers WHERE enabled = 1 ORDER BY created_at ASC LIMIT 1'));
  return camelize<ProviderRecord>(row);
}

/** Built-in local inference is always available, even with no provider configured. */
export const BUILTIN_PROVIDER = {
  id: 'builtin',
  name: 'VisaHOBe Local Engine',
  kind: 'builtin' as const,
  model: 'deterministic-ops-engine',
};

export async function seedOllamaProviderIfMissing(): Promise<void> {
  const db = getDb();
  const existing = await db.get(`SELECT id FROM ai_providers WHERE kind = 'ollama'`);
  if (existing) return;
  const id = newId('prv');
  const now = nowIso();
  await db.run(
    `INSERT INTO ai_providers (id, name, kind, base_url, model, api_key_enc, settings, is_default, enabled, created_at, updated_at)
     VALUES (?, ?, 'ollama', ?, ?, NULL, ?, 0, 1, ?, ?)`,
    [
      id,
      'Local Ollama',
      'http://127.0.0.1:11434/v1',
      'llama3.2',
      JSON.stringify({ note: 'Detected automatically; enable once Ollama is running.' }),
      now,
      now,
    ],
  );
}
