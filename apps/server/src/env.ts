import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const num = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .refine((n) => Number.isFinite(n), 'must be a number');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: num(8787),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().optional(),
  DB_FILE: z.string().default('./data/visahobe.db'),
  DB_SCHEMA: z.string().optional(),

  JWT_SECRET: z.string().min(16).optional(),
  ENCRYPTION_KEY: z.string().min(16).optional(),
  SESSION_TTL_HOURS: num(24 * 14),

  STORAGE_DIR: z.string().default('./data/storage'),
  MAX_UPLOAD_MB: num(25),

  WORKER_TOKEN: z.string().min(16).optional(),
  WORKER_URL: z.string().default('ws://127.0.0.1:8787/api/browser/worker'),
  WORKER_LABEL: z.string().default('local-worker'),
  BROWSER_ALLOW_DOMAINS: z.string().default(''),
  BROWSER_BLOCK_DOMAINS: z.string().default(''),
  BROWSER_TIMEOUT_MS: num(120000),
  BROWSER_MAX_CONCURRENCY: num(2),

  OLLAMA_BASE_URL: z.string().default('http://127.0.0.1:11434'),
  OLLAMA_MODEL: z.string().default('llama3.2'),
  FIRECRAWL_URL: z.string().optional(),
  FIRECRAWL_API_KEY: z.string().optional(),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),

  PASSPORT_VALIDITY_MONTHS: num(6),
  BOOTSTRAP_ADMIN_EMAIL: z.string().default('admin@visahobe.local'),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().optional(),
  BOOTSTRAP_ADMIN_NAME: z.string().default('VisaHOBe Admin'),

  ALLOWED_ORIGINS: z.string().default(''),
  TRUST_PROXY: bool(false),
});

/** Minimal .env loader (no dependency) — never overrides real process env. */
function loadDotEnv(file: string) {
  if (!existsSync(file)) return;
  const raw = readFileSync(file, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv(resolve(process.cwd(), '.env'));
loadDotEnv(resolve(process.cwd(), '../../.env'));

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

const raw = parsed.data;
const isProd = raw.NODE_ENV === 'production';

const warnings: string[] = [];
if (!raw.JWT_SECRET) {
  if (isProd) throw new Error('JWT_SECRET is required in production. Generate one with: openssl rand -hex 32');
  raw.JWT_SECRET = randomBytes(32).toString('hex');
  warnings.push('JWT_SECRET not set — generated an ephemeral development secret.');
}
if (!raw.ENCRYPTION_KEY) {
  if (isProd) throw new Error('ENCRYPTION_KEY is required in production.');
  raw.ENCRYPTION_KEY = randomBytes(32).toString('hex');
  warnings.push('ENCRYPTION_KEY not set — derived ephemeral development key; stored secrets will not survive restart.');
}
if (!raw.WORKER_TOKEN) {
  if (isProd) throw new Error('WORKER_TOKEN is required in production.');
  raw.WORKER_TOKEN = randomBytes(24).toString('hex');
  warnings.push('WORKER_TOKEN not set — generated ephemeral development worker token.');
}
if (!raw.BOOTSTRAP_ADMIN_PASSWORD) {
  raw.BOOTSTRAP_ADMIN_PASSWORD = 'VisaHOBe!2024';
  warnings.push('BOOTSTRAP_ADMIN_PASSWORD not set — using the documented development default. Change it.');
}

export const env = {
  ...raw,
  JWT_SECRET: raw.JWT_SECRET!,
  ENCRYPTION_KEY: raw.ENCRYPTION_KEY!,
  WORKER_TOKEN: raw.WORKER_TOKEN!,
  BOOTSTRAP_ADMIN_PASSWORD: raw.BOOTSTRAP_ADMIN_PASSWORD!,
  isProd,
  warnings,
  dataDir: resolve(process.cwd(), raw.DB_FILE).split('/').slice(0, -1).join('/') || '.',
  storageDir: resolve(process.cwd(), raw.STORAGE_DIR),
  corsOrigins: raw.ALLOWED_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  allowDomains: raw.BROWSER_ALLOW_DOMAINS.split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  blockDomains: raw.BROWSER_BLOCK_DOMAINS.split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
};

export type Env = typeof env;
