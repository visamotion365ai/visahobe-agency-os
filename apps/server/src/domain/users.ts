import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { camelize, nowIso } from '../lib/rows.js';
import { conflict, unauthorized } from '../lib/errors.js';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'staff' | 'viewer';
  active: number;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function createUser(input: {
  email: string;
  password: string;
  name: string;
  role?: 'admin' | 'staff' | 'viewer';
}): Promise<User> {
  const db = getDb();
  const existing = await db.get('SELECT id FROM users WHERE lower(email) = lower(?)', [input.email]);
  if (existing) throw conflict('A user with this email already exists');
  const id = newId('usr');
  const now = nowIso();
  await db.run(
    `INSERT INTO users (id, email, password_hash, name, role, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    [id, input.email.toLowerCase(), await hashPassword(input.password), input.name, input.role ?? 'staff', now, now],
  );
  return (await getUserById(id))!;
}

export async function getUserById(id: string): Promise<User | undefined> {
  return camelize<User>(await getDb().get('SELECT * FROM users WHERE id = ?', [id]));
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
  return camelize<User>(await getDb().get('SELECT * FROM users WHERE lower(email) = lower(?)', [email]));
}

export async function listUsers(): Promise<User[]> {
  const rows = await getDb().all('SELECT * FROM users ORDER BY created_at DESC');
  return rows.map((r) => camelize<User>(r)!);
}

export async function authenticate(email: string, password: string): Promise<User> {
  const row = await getDb().get('SELECT * FROM users WHERE lower(email) = lower(?)', [email]);
  if (!row) throw unauthorized('Invalid email or password');
  if (!row.active) throw unauthorized('This account is disabled');
  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) throw unauthorized('Invalid email or password');
  await getDb().run('UPDATE users SET last_login_at = ? WHERE id = ?', [nowIso(), row.id]);
  return camelize<User>(row)!;
}

export async function updateUser(id: string, patch: Partial<{ name: string; role: string; active: number; password: string }>) {
  const db = getDb();
  const fields: string[] = [];
  const params: any[] = [];
  if (patch.name !== undefined) {
    fields.push('name = ?');
    params.push(patch.name);
  }
  if (patch.role !== undefined) {
    fields.push('role = ?');
    params.push(patch.role);
  }
  if (patch.active !== undefined) {
    fields.push('active = ?');
    params.push(patch.active);
  }
  if (patch.password) {
    fields.push('password_hash = ?');
    params.push(await hashPassword(patch.password));
  }
  if (!fields.length) return getUserById(id);
  fields.push('updated_at = ?');
  params.push(nowIso(), id);
  await db.run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params);
  return getUserById(id);
}
