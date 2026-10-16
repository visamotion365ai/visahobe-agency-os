import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { env } from '../env.js';
import { migrations } from './migrations.js';

const require = createRequire(import.meta.url);

export type Dialect = 'sqlite' | 'postgres';
export type SqlParam = string | number | boolean | null | Buffer;
export type Row = Record<string, any>;

export interface Db {
  readonly dialect: Dialect;
  all<T = Row>(sql: string, params?: SqlParam[]): Promise<T[]>;
  get<T = Row>(sql: string, params?: SqlParam[]): Promise<T | undefined>;
  run(sql: string, params?: SqlParam[]): Promise<{ changes: number }>;
  exec(sql: string): Promise<void>;
  tx<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** `?` placeholders are rewritten to `$n` for postgres. */
function toPgParams(sql: string): string {
  let index = 0;
  let out = '';
  let inString = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'") inString = !inString;
    if (ch === '?' && !inString) {
      index += 1;
      out += `$${index}`;
    } else {
      out += ch;
    }
  }
  return out;
}

class SqliteDb implements Db {
  readonly dialect: Dialect = 'sqlite';
  private stmt: any;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private file: string) {
    const Database = require('better-sqlite3');
    mkdirSync(dirname(file), { recursive: true });
    this.stmt = new Database(file);
    // WAL needs shared-memory (-shm) support, which some network/FUSE mounts and
    // containers do not provide; fall back to the default journal rather than
    // failing to open the database at all.
    try {
      this.stmt.pragma('journal_mode = WAL');
    } catch {
      this.stmt.pragma('journal_mode = DELETE');
    }
    this.stmt.pragma('foreign_keys = ON');
    this.stmt.pragma('busy_timeout = 5000');
  }

  async all<T = Row>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    return this.stmt.prepare(sql).all(...params) as T[];
  }
  async get<T = Row>(sql: string, params: SqlParam[] = []): Promise<T | undefined> {
    return this.stmt.prepare(sql).get(...params) as T | undefined;
  }
  async run(sql: string, params: SqlParam[] = []): Promise<{ changes: number }> {
    const info = this.stmt.prepare(sql).run(...params);
    return { changes: info.changes };
  }
  async exec(sql: string): Promise<void> {
    this.stmt.exec(sql);
  }
  async tx<T>(fn: () => Promise<T>): Promise<T> {
    // Serialise transactions: better-sqlite3 is synchronous and cannot be
    // interleaved with another transaction on the same connection.
    const run = async (): Promise<T> => {
      this.stmt.exec('BEGIN');
      try {
        const result = await fn();
        this.stmt.exec('COMMIT');
        return result;
      } catch (err) {
        try {
          this.stmt.exec('ROLLBACK');
        } catch {
          /* ignore */
        }
        throw err;
      }
    };
    const next = this.queue.then(run, run);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
  async close(): Promise<void> {
    this.stmt.close();
  }
}

class PostgresDb implements Db {
  readonly dialect: Dialect = 'postgres';
  private client: any;
  private depth = 0;

  constructor(private url: string) {
    const { Pool } = require('pg');
    // Serverless-friendly pool: few connections, no long idle waits. Managed
    // Postgres (Supabase/Neon) needs TLS; a local Postgres does not.
    const needsSsl = /supabase|neon|render|aws|azure|sslmode=require/i.test(url);
    const schema = process.env.DB_SCHEMA?.trim();
    const connectionString = schema
      ? `${url}${url.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${schema}`)}`
      : url;
    this.client = new Pool({
      connectionString,
      max: Number(process.env.DB_POOL_MAX) || 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 15_000,
      ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    });
    // A dropped idle client must not crash the process.
    this.client.on('error', () => undefined);
  }

  async all<T = Row>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    const res = await this.client.query(toPgParams(sql), params);
    return res.rows as T[];
  }
  async get<T = Row>(sql: string, params: SqlParam[] = []): Promise<T | undefined> {
    const res = await this.client.query(toPgParams(sql), params);
    return res.rows[0] as T | undefined;
  }
  async run(sql: string, params: SqlParam[] = []): Promise<{ changes: number }> {
    const res = await this.client.query(toPgParams(sql), params);
    return { changes: res.rowCount ?? 0 };
  }
  async exec(sql: string): Promise<void> {
    await this.client.query(sql);
  }
  async tx<T>(fn: () => Promise<T>): Promise<T> {
    if (this.depth > 0) return fn();
    const conn = await this.client.connect();
    this.depth += 1;
    try {
      await conn.query('BEGIN');
      const scoped = new PostgresDb(this.url);
      scoped.client = conn;
      const result = await fn();
      await conn.query('COMMIT');
      return result;
    } catch (err) {
      await conn.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      this.depth -= 1;
      conn.release();
    }
  }
  async close(): Promise<void> {
    await this.client.end();
  }
}

let instance: Db | null = null;

export function getDb(): Db {
  if (instance) return instance;
  instance = env.DATABASE_URL?.startsWith('postgres')
    ? new PostgresDb(env.DATABASE_URL)
    : new SqliteDb(resolve(process.cwd(), env.DB_FILE));
  return instance;
}

export async function runMigrations(db: Db = getDb()): Promise<string[]> {
  const applied: string[] = [];
  await db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       id TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL
     )`,
  );
  const done = new Set((await db.all<{ id: string }>('SELECT id FROM schema_migrations')).map((r) => r.id));
  for (const migration of migrations) {
    if (done.has(migration.id)) continue;
    for (const stmt of migration.statements) await db.exec(stmt);
    await db.run('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)', [
      migration.id,
      new Date().toISOString(),
    ]);
    applied.push(migration.id);
  }
  return applied;
}
