import { createProviderRuntime } from './providers/index.js';
import type { ProviderRecord } from '../domain/providers.js';
import type { ProviderTestResult } from './types.js';

interface CacheEntry {
  at: number;
  result: ProviderTestResult;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<ProviderTestResult>>();
const TTL_MS = 60_000;

/**
 * Probe a provider so the UI can show an honest connection state.
 * Results are cached briefly because a probe performs a real network call.
 */
export async function probeProvider(
  record: (ProviderRecord & { apiKey?: string }) | null | undefined,
): Promise<ProviderTestResult & { checkedAt: string; cached: boolean }> {
  if (!record) {
    return {
      ok: true,
      message: 'VisaHOBe Local Engine is always available (offline, deterministic).',
      checkedAt: new Date().toISOString(),
      cached: false,
    };
  }
  if (record.kind === 'builtin') {
    return {
      ok: true,
      message: 'VisaHOBe Local Engine is always available (offline, deterministic).',
      checkedAt: new Date().toISOString(),
      cached: false,
    };
  }
  const key = record.id;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return { ...hit.result, checkedAt: new Date(hit.at).toISOString(), cached: true };
  }
  const existing = inFlight.get(key);
  if (existing) {
    const result = await existing;
    return { ...result, checkedAt: new Date().toISOString(), cached: false };
  }
  const promise = (async (): Promise<ProviderTestResult> => {
    try {
      const runtime = createProviderRuntime(record);
      return await runtime.test();
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  })();
  inFlight.set(key, promise);
  const result = await promise;
  inFlight.delete(key);
  cache.set(key, { at: Date.now(), result });
  return { ...result, checkedAt: new Date().toISOString(), cached: false };
}

export function clearProviderHealth(): void {
  cache.clear();
}
