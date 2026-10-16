import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { camelize, camelizeAll, nowIso } from '../lib/rows.js';
import { notFound } from '../lib/errors.js';
import type { RequirementsInput } from '@visahobe/shared';

export interface Requirement {
  id: string;
  country: string;
  visaCategory: string;
  title: string;
  description: string | null;
  category: string;
  mandatory: number;
  sourceUrl: string | null;
  sourceTitle: string | null;
  verifiedAt: string | null;
  effectiveDate: string | null;
  version: number;
  status: 'unverified' | 'verified' | 'stale' | 'superseded';
  supersededBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RequirementCheck {
  id: string;
  caseId: string;
  requirementId: string;
  status: 'available' | 'missing' | 'needs_review' | 'expired' | 'preparation_required';
  evidenceDocumentId: string | null;
  note: string | null;
  updatedAt: string;
}

export async function listRequirements(opts: {
  country?: string;
  visaCategory?: string;
  includeSuperseded?: boolean;
}): Promise<Requirement[]> {
  const where: string[] = [];
  const params: any[] = [];
  if (opts.country) {
    where.push('country = ?');
    params.push(opts.country);
  }
  if (opts.visaCategory) {
    where.push('(visa_category = ? OR visa_category = ?)');
    params.push(opts.visaCategory, '*');
  }
  if (!opts.includeSuperseded) where.push('superseded_by IS NULL');
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await getDb().all(`SELECT * FROM requirements ${clause} ORDER BY country, category, title`, params);
  return camelizeAll<Requirement>(rows);
}

export async function getRequirement(id: string): Promise<Requirement | undefined> {
  return camelize<Requirement>(await getDb().get('SELECT * FROM requirements WHERE id = ?', [id]));
}

/**
 * Requirements are versioned. Re-adding the same requirement for a country and
 * category creates a new version and supersedes the previous one instead of
 * overwriting history.
 */
export async function createRequirement(input: RequirementsInput): Promise<Requirement> {
  const db = getDb();
  const id = newId('req');
  const now = nowIso();
  const previous = await db.get(
    `SELECT * FROM requirements WHERE country = ? AND visa_category = ? AND lower(title) = lower(?)`,
    [input.country, input.visaCategory, input.title],
  );
  const version = previous ? Number(previous.version) + 1 : 1;
  await db.run(
    `INSERT INTO requirements (
       id, country, visa_category, title, description, category, mandatory, source_url, source_title,
       verified_at, effective_date, version, status, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unverified', ?, ?)`,
    [
      id,
      input.country,
      input.visaCategory,
      input.title,
      input.description || null,
      input.category || 'general',
      input.mandatory ? 1 : 0,
      input.sourceUrl || null,
      input.sourceTitle || null,
      input.verifiedAt || null,
      input.effectiveDate || null,
      version,
      now,
      now,
    ],
  );
  if (previous) {
    await db.run('UPDATE requirements SET superseded_by = ?, status = ? , updated_at = ? WHERE id = ?', [
      id,
      'superseded',
      now,
      previous.id,
    ]);
  }
  return (await getRequirement(id))!;
}

export async function updateRequirement(
  id: string,
  patch: Partial<RequirementsInput & { status: string }>,
): Promise<Requirement> {
  const db = getDb();
  if (!(await getRequirement(id))) throw notFound('Requirement not found');
  const map: Record<string, string> = {
    title: 'title',
    description: 'description',
    category: 'category',
    mandatory: 'mandatory',
    sourceUrl: 'source_url',
    sourceTitle: 'source_title',
    verifiedAt: 'verified_at',
    effectiveDate: 'effective_date',
    status: 'status',
  };
  const fields: string[] = [];
  const params: any[] = [];
  for (const [key, column] of Object.entries(map)) {
    const value = (patch as any)[key];
    if (value === undefined) continue;
    fields.push(`${column} = ?`);
    params.push(typeof value === 'boolean' ? (value ? 1 : 0) : value === '' ? null : value);
  }
  if (!fields.length) return (await getRequirement(id))!;
  fields.push('updated_at = ?');
  params.push(nowIso(), id);
  await db.run(`UPDATE requirements SET ${fields.join(', ')} WHERE id = ?`, params);
  return (await getRequirement(id))!;
}

/** Verification is an explicit, evidence-based human action. */
export async function verifyRequirement(id: string, evidence: { sourceUrl?: string; verifiedAt?: string; sourceTitle?: string }) {
  return updateRequirement(id, {
    status: 'verified',
    verifiedAt: evidence.verifiedAt ?? nowIso(),
    sourceUrl: evidence.sourceUrl,
    sourceTitle: evidence.sourceTitle,
  });
}

export async function listRequirementChecks(caseId: string): Promise<RequirementCheck[]> {
  const rows = await getDb().all('SELECT * FROM requirement_checks WHERE case_id = ?', [caseId]);
  return camelizeAll<RequirementCheck>(rows);
}

export async function setRequirementCheck(
  caseId: string,
  requirementId: string,
  status: RequirementCheck['status'],
  opts: { evidenceDocumentId?: string | null; note?: string } = {},
): Promise<RequirementCheck> {
  const db = getDb();
  const existing = await db.get('SELECT * FROM requirement_checks WHERE case_id = ? AND requirement_id = ?', [
    caseId,
    requirementId,
  ]);
  const now = nowIso();
  if (existing) {
    await db.run(
      `UPDATE requirement_checks SET status = ?, evidence_document_id = ?, note = ?, updated_at = ? WHERE id = ?`,
      [status, opts.evidenceDocumentId ?? null, opts.note ?? null, now, existing.id],
    );
    return camelize<RequirementCheck>(await db.get('SELECT * FROM requirement_checks WHERE id = ?', [existing.id]))!;
  }
  const id = newId('chk');
  await db.run(
    `INSERT INTO requirement_checks (id, case_id, requirement_id, status, evidence_document_id, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, caseId, requirementId, status, opts.evidenceDocumentId ?? null, opts.note ?? null, now],
  );
  return camelize<RequirementCheck>(await db.get('SELECT * FROM requirement_checks WHERE id = ?', [id]))!;
}
