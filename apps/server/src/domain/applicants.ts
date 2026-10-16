import { getDb } from '../db/index.js';
import { newId, newReference } from '../lib/ids.js';
import { camelize, camelizeAll, nowIso } from '../lib/rows.js';
import { notFound } from '../lib/errors.js';
import type { ApplicantInput } from '@visahobe/shared';

export interface Applicant extends ApplicantInput {
  id: string;
  reference: string;
  createdAt: string;
  updatedAt: string;
}

export function normalisePassport(value?: string | null): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return cleaned.length ? cleaned : null;
}

export async function createApplicant(
  input: ApplicantInput,
  createdBy?: string,
): Promise<Applicant> {
  const db = getDb();
  const id = newId('app');
  const now = nowIso();
  const reference = newReference('AP');
  await db.run(
    `INSERT INTO applicants (
        id, reference, full_name, passport_number, passport_number_norm, nationality,
        date_of_birth, gender, passport_issue_date, passport_expiry_date,
        email, phone, address, notes, created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      reference,
      input.fullName,
      input.passportNumber || null,
      normalisePassport(input.passportNumber),
      input.nationality || null,
      input.dateOfBirth || null,
      input.gender || null,
      input.passportIssueDate || null,
      input.passportExpiryDate || null,
      input.email || null,
      input.phone || null,
      input.address || null,
      input.notes || null,
      createdBy ?? null,
      now,
      now,
    ],
  );
  return (await getApplicant(id))!;
}

export async function getApplicant(id: string): Promise<Applicant | undefined> {
  return camelize<Applicant>(await getDb().get('SELECT * FROM applicants WHERE id = ?', [id]));
}

export async function listApplicants(opts: {
  q?: string;
  country?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<{ items: Applicant[]; total: number }> {
  const db = getDb();
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));
  const where: string[] = [];
  const params: any[] = [];
  if (opts.q) {
    where.push('(lower(full_name) LIKE ? OR lower(passport_number_norm) LIKE ? OR lower(reference) LIKE ?)');
    const like = `%${opts.q.toLowerCase()}%`;
    params.push(like, like, like);
  }
  if (opts.country) {
    where.push('id IN (SELECT applicant_id FROM visa_cases WHERE country = ?)');
    params.push(opts.country);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const totalRow = await db.get(`SELECT COUNT(*) AS c FROM applicants ${clause}`, params);
  const rows = await db.all(
    `SELECT * FROM applicants ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  return { items: camelizeAll<Applicant>(rows), total: Number(totalRow?.c ?? 0) };
}

export async function updateApplicant(id: string, input: Partial<ApplicantInput>): Promise<Applicant> {
  const db = getDb();
  const current = await getApplicant(id);
  if (!current) throw notFound('Applicant not found');
  const map: Record<string, string> = {
    fullName: 'full_name',
    passportNumber: 'passport_number',
    nationality: 'nationality',
    dateOfBirth: 'date_of_birth',
    gender: 'gender',
    passportIssueDate: 'passport_issue_date',
    passportExpiryDate: 'passport_expiry_date',
    email: 'email',
    phone: 'phone',
    address: 'address',
    notes: 'notes',
  };
  const fields: string[] = [];
  const params: any[] = [];
  for (const [key, column] of Object.entries(map)) {
    const value = (input as any)[key];
    if (value === undefined) continue;
    fields.push(`${column} = ?`);
    params.push(value === '' ? null : value);
    if (key === 'passportNumber') {
      fields.push('passport_number_norm = ?');
      params.push(normalisePassport(value));
    }
  }
  if (!fields.length) return current;
  fields.push('updated_at = ?');
  params.push(nowIso(), id);
  await db.run(`UPDATE applicants SET ${fields.join(', ')} WHERE id = ?`, params);
  return (await getApplicant(id))!;
}

export async function deleteApplicant(id: string): Promise<void> {
  await getDb().run('DELETE FROM applicants WHERE id = ?', [id]);
}
