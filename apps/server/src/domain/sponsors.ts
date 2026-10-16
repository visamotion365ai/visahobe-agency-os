import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { camelize, camelizeAll, nowIso } from '../lib/rows.js';
import { notFound } from '../lib/errors.js';
import type { SponsorInput, SponsorStatus } from '@visahobe/shared';

export interface Sponsor extends Omit<SponsorInput, 'verificationStatus'> {
  id: string;
  verificationStatus: SponsorStatus;
  lastVerifiedAt: string | null;
  verifiedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function createSponsor(input: SponsorInput): Promise<Sponsor> {
  const db = getDb();
  const id = newId('spo');
  const now = nowIso();
  await db.run(
    `INSERT INTO sponsors (
        id, name, legal_name, country, jurisdiction, registration_id, website, source_url,
        contact_person, email, phone, sponsor_type, verification_status, notes, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name,
      input.legalName || null,
      input.country,
      input.jurisdiction || null,
      input.registrationId || null,
      input.website || null,
      input.sourceUrl || null,
      input.contactPerson || null,
      input.email || null,
      input.phone || null,
      input.sponsorType || null,
      input.verificationStatus ?? 'unverified',
      input.notes || null,
      now,
      now,
    ],
  );
  return (await getSponsor(id))!;
}

export async function getSponsor(id: string): Promise<Sponsor | undefined> {
  return camelize<Sponsor>(await getDb().get('SELECT * FROM sponsors WHERE id = ?', [id]));
}

export async function listSponsors(opts: {
  q?: string;
  country?: string;
  status?: string;
} = {}): Promise<Sponsor[]> {
  const where: string[] = [];
  const params: any[] = [];
  if (opts.q) {
    where.push('(lower(name) LIKE ? OR lower(legal_name) LIKE ? OR lower(registration_id) LIKE ?)');
    const like = `%${opts.q.toLowerCase()}%`;
    params.push(like, like, like);
  }
  if (opts.country) {
    where.push('country = ?');
    params.push(opts.country);
  }
  if (opts.status) {
    where.push('verification_status = ?');
    params.push(opts.status);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await getDb().all(
    `SELECT * FROM sponsors ${clause} ORDER BY verification_status = 'verified' DESC, name ASC`,
    params,
  );
  return camelizeAll<Sponsor>(rows);
}

export async function updateSponsor(id: string, input: Partial<SponsorInput>): Promise<Sponsor> {
  const db = getDb();
  if (!(await getSponsor(id))) throw notFound('Sponsor not found');
  const map: Record<string, string> = {
    name: 'name',
    legalName: 'legal_name',
    country: 'country',
    jurisdiction: 'jurisdiction',
    registrationId: 'registration_id',
    website: 'website',
    sourceUrl: 'source_url',
    contactPerson: 'contact_person',
    email: 'email',
    phone: 'phone',
    sponsorType: 'sponsor_type',
    verificationStatus: 'verification_status',
    notes: 'notes',
  };
  const fields: string[] = [];
  const params: any[] = [];
  for (const [key, column] of Object.entries(map)) {
    const value = (input as any)[key];
    if (value === undefined) continue;
    fields.push(`${column} = ?`);
    params.push(value === '' ? null : value);
  }
  if (!fields.length) return (await getSponsor(id))!;
  fields.push('updated_at = ?');
  params.push(nowIso(), id);
  await db.run(`UPDATE sponsors SET ${fields.join(', ')} WHERE id = ?`, params);
  return (await getSponsor(id))!;
}

export async function markSponsorVerified(
  id: string,
  status: SponsorStatus,
  reviewer: string,
  note?: string,
): Promise<Sponsor> {
  const db = getDb();
  if (!(await getSponsor(id))) throw notFound('Sponsor not found');
  const now = nowIso();
  await db.run(
    `UPDATE sponsors SET verification_status = ?, last_verified_at = ?, verified_by = ?,
       notes = CASE WHEN ? IS NULL THEN notes ELSE notes END, updated_at = ? WHERE id = ?`,
    [status, status === 'verified' ? now : null, reviewer, note ?? null, now, id],
  );
  return (await getSponsor(id))!;
}
