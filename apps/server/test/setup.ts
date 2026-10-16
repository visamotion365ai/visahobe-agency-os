import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '../..', '..');

const storage = mkdtempSync(join(tmpdir(), 'visahobe-test-storage-'));

// The database is written to a temp directory: SQLite WAL needs shared-memory
// support that some CI containers and network/FUSE mounts do not provide, and
// tests must run on any filesystem.
const tempDb = mkdtempSync(join(tmpdir(), 'visahobe-test-db-'));

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.DB_FILE = join(tempDb, 'test-suite.db');
process.env.STORAGE_DIR = storage;
process.env.JWT_SECRET = 'test_jwt_secret_0123456789abcdef0123456789abcdef';
process.env.ENCRYPTION_KEY = 'test_encryption_key_0123456789abcdef0123456789';
process.env.WORKER_TOKEN = 'test_worker_token_0123456789abcdef0123456789';
process.env.BOOTSTRAP_ADMIN_EMAIL = 'admin@test.local';
process.env.BOOTSTRAP_ADMIN_PASSWORD = 'TestPassword!2024';
process.env.BROWSER_ALLOW_DOMAINS = '127.0.0.1,localhost';
process.env.WORKER_URL = 'ws://127.0.0.1:8799/api/browser/worker';
process.env.WORKER_LABEL = 'test-worker';
process.env.ALLOWED_ORIGINS = '';
process.env.PORT = '8799';

export const testRoot = root;
export const testStorage = storage;

export function cleanup() {
  try {
    rmSync(storage, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
