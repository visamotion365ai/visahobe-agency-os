import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { env } from '../env.js';

export class UrlBlockedError extends Error {
  constructor(
    message: string,
    public reason: string,
  ) {
    super(message);
    this.name = 'UrlBlockedError';
  }
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
]);

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('::ffff:')) {
    const mapped = lower.slice(7);
    if (isIP(mapped) === 4) return isPrivateIPv4(mapped);
  }
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) return isPrivateIPv4(ip);
  if (isIP(ip) === 6) return isPrivateIPv6(ip);
  return false;
}

function hostMatches(host: string, pattern: string): boolean {
  const h = host.toLowerCase();
  const p = pattern.toLowerCase();
  if (p.startsWith('*.')) return h === p.slice(2) || h.endsWith(p.slice(1));
  return h === p || h.endsWith(`.${p}`);
}

/**
 * Validate a navigation target.
 *
 * The browser worker may only reach public http(s) destinations. Private,
 * loopback, link-local and cloud-metadata addresses are refused unless the
 * operator explicitly allow-listed them (needed for a local test site).
 */
export async function assertUrlAllowed(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UrlBlockedError(`Invalid URL: ${rawUrl}`, 'invalid_url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlBlockedError(`Only http and https are permitted (got ${url.protocol})`, 'bad_scheme');
  }
  const host = url.hostname.toLowerCase();

  if (env.blockDomains.some((d) => hostMatches(host, d))) {
    throw new UrlBlockedError(`Host ${host} is on the operator block list.`, 'blocked_domain');
  }
  if (env.allowDomains.length) {
    if (!env.allowDomains.some((d) => hostMatches(host, d))) {
      throw new UrlBlockedError(
        `Host ${host} is not on the operator allow list (${env.allowDomains.join(', ')}).`,
        'not_allowlisted',
      );
    }
  } else if (BLOCKED_HOSTNAMES.has(host)) {
    throw new UrlBlockedError(`Host ${host} resolves to a local or metadata address.`, 'private_host');
  }

  if (isIP(host)) {
    if (isPrivateAddress(host) && !env.allowDomains.length) {
      throw new UrlBlockedError(`Host ${host} is a private address.`, 'private_host');
    }
  } else {
    let addresses: Array<{ address: string }> = [];
    try {
      addresses = await lookup(host, { all: true });
    } catch {
      throw new UrlBlockedError(`Could not resolve host ${host}.`, 'dns_failure');
    }
    if (!addresses.length) throw new UrlBlockedError(`Host ${host} has no addresses.`, 'dns_failure');
    const allPrivate = addresses.every((a) => isPrivateAddress(a.address));
    if (allPrivate && !env.allowDomains.length) {
      throw new UrlBlockedError(
        `Host ${host} resolves only to private addresses — refusing to connect (SSRF protection).`,
        'private_host',
      );
    }
  }
  return url;
}

export function isHostBlocked(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return env.blockDomains.some((d) => hostMatches(host, d));
  } catch {
    return true;
  }
}

/** Redact secrets before anything is written to a log or a transcript. */
export function redact(text: string): string {
  return String(text)
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [redacted]')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[email]')
    .replace(/\b\d{6,}\b/g, '[number]');
}
