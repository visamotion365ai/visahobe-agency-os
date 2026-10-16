import { getDb } from '../db/index.js';
import { newId, newReference } from '../lib/ids.js';
import { camelize, camelizeAll, json, nowIso } from '../lib/rows.js';
import { notFound, conflict } from '../lib/errors.js';
import { WORKFLOW_STEPS, type CaseInput, type StepStatus } from '@visahobe/shared';

export interface CaseStep {
  caseId: string;
  stepNumber: number;
  stepKey: string;
  status: StepStatus;
  data: unknown;
  notes: string | null;
  completedBy: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface VisaCase {
  id: string;
  reference: string;
  applicantId: string;
  sponsorId: string | null;
  country: string;
  visaCategory: string;
  purpose: string | null;
  priority: string;
  status: string;
  currentStep: number;
  assignedTo: string | null;
  createdBy: string | null;
  submissionDate: string | null;
  receiptNumber: string | null;
  outcome: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function createCase(input: CaseInput, createdBy?: string): Promise<VisaCase> {
  const db = getDb();
  const id = newId('cas');
  const now = nowIso();
  const reference = newReference('VM');
  await db.run(
    `INSERT INTO visa_cases (
       id, reference, applicant_id, sponsor_id, country, visa_category, purpose, priority,
       status, current_step, assigned_to, created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?, ?)`,
    [
      id,
      reference,
      input.applicantId,
      input.sponsorId || null,
      input.country,
      input.visaCategory,
      input.purpose || null,
      input.priority ?? 'normal',
      input.assignedTo || null,
      createdBy ?? null,
      now,
      now,
    ],
  );
  for (const step of WORKFLOW_STEPS) {
    await db.run(
      `INSERT INTO case_steps (case_id, step_number, step_key, status, updated_at)
       VALUES (?, ?, ?, 'pending', ?)`,
      [id, step.n, step.key, now],
    );
  }
  await db.run(`UPDATE case_steps SET status = 'in_progress' WHERE case_id = ? AND step_number = 1`, [id]);
  return (await getCase(id))!;
}

export async function getCase(id: string): Promise<VisaCase | undefined> {
  return camelize<VisaCase>(await getDb().get('SELECT * FROM visa_cases WHERE id = ?', [id]));
}

export async function getCaseWithSteps(id: string) {
  const visaCase = await getCase(id);
  if (!visaCase) throw notFound('Case not found');
  const steps = await listSteps(id);
  const applicant = camelize(await getDb().get('SELECT * FROM applicants WHERE id = ?', [visaCase.applicantId]));
  const sponsor = visaCase.sponsorId
    ? camelize(await getDb().get('SELECT * FROM sponsors WHERE id = ?', [visaCase.sponsorId]))
    : undefined;
  return { case: visaCase, steps, applicant, sponsor };
}

export async function listSteps(caseId: string): Promise<CaseStep[]> {
  const rows = await getDb().all(
    'SELECT * FROM case_steps WHERE case_id = ? ORDER BY step_number ASC',
    [caseId],
  );
  return camelizeAll<CaseStep>(rows).map((s) => ({ ...s, data: json(s.data, {}) }));
}

export async function listCases(opts: {
  q?: string;
  country?: string;
  status?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<{ items: any[]; total: number }> {
  const db = getDb();
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));
  const where: string[] = [];
  const params: any[] = [];
  if (opts.q) {
    where.push('(lower(c.reference) LIKE ? OR lower(a.full_name) LIKE ?)');
    const like = `%${opts.q.toLowerCase()}%`;
    params.push(like, like);
  }
  if (opts.country) {
    where.push('c.country = ?');
    params.push(opts.country);
  }
  if (opts.status) {
    where.push('c.status = ?');
    params.push(opts.status);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const totalRow = await db.get(
    `SELECT COUNT(*) AS c FROM visa_cases c JOIN applicants a ON a.id = c.applicant_id ${clause}`,
    params,
  );
  const rows = await db.all(
    `SELECT c.*, a.full_name AS applicant_name, a.passport_number AS applicant_passport,
            s.name AS sponsor_name
       FROM visa_cases c
       JOIN applicants a ON a.id = c.applicant_id
       LEFT JOIN sponsors s ON s.id = c.sponsor_id
       ${clause}
      ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  return { items: camelizeAll(rows), total: Number(totalRow?.c ?? 0) };
}

export async function updateCase(
  id: string,
  patch: Partial<{
    sponsorId: string;
    country: string;
    visaCategory: string;
    purpose: string;
    priority: string;
    status: string;
    assignedTo: string;
    submissionDate: string;
    receiptNumber: string;
    outcome: string;
  }>,
): Promise<VisaCase> {
  const db = getDb();
  if (!(await getCase(id))) throw notFound('Case not found');
  const map: Record<string, string> = {
    sponsorId: 'sponsor_id',
    country: 'country',
    visaCategory: 'visa_category',
    purpose: 'purpose',
    priority: 'priority',
    status: 'status',
    assignedTo: 'assigned_to',
    submissionDate: 'submission_date',
    receiptNumber: 'receipt_number',
    outcome: 'outcome',
  };
  const fields: string[] = [];
  const params: any[] = [];
  for (const [key, column] of Object.entries(map)) {
    const value = (patch as any)[key];
    if (value === undefined) continue;
    fields.push(`${column} = ?`);
    params.push(value === '' ? null : value);
  }
  if (!fields.length) return (await getCase(id))!;
  fields.push('updated_at = ?');
  params.push(nowIso(), id);
  await db.run(`UPDATE visa_cases SET ${fields.join(', ')} WHERE id = ?`, params);
  return (await getCase(id))!;
}

export async function setStepStatus(
  caseId: string,
  stepNumber: number,
  status: StepStatus,
  opts: { data?: unknown; notes?: string; userId?: string } = {},
): Promise<CaseStep> {
  const db = getDb();
  const step = await db.get('SELECT * FROM case_steps WHERE case_id = ? AND step_number = ?', [
    caseId,
    stepNumber,
  ]);
  if (!step) throw notFound('Case step not found');
  const now = nowIso();
  const completed = status === 'completed' || status === 'skipped';
  await db.run(
    `UPDATE case_steps
        SET status = ?, data = COALESCE(?, data), notes = COALESCE(?, notes),
            completed_by = CASE WHEN ? THEN ? ELSE completed_by END,
            completed_at = CASE WHEN ? THEN ? ELSE completed_at END,
            updated_at = ?
      WHERE case_id = ? AND step_number = ?`,
    [
      status,
      opts.data === undefined ? null : JSON.stringify(opts.data),
      opts.notes ?? null,
      completed ? 1 : 0,
      opts.userId ?? null,
      completed ? 1 : 0,
      completed ? now : null,
      now,
      caseId,
      stepNumber,
    ],
  );
  if (completed) {
    const next = WORKFLOW_STEPS.find((s) => s.n === stepNumber + 1);
    if (next) {
      await db.run(
        `UPDATE case_steps SET status = CASE WHEN status = 'pending' THEN 'in_progress' ELSE status END, updated_at = ? WHERE case_id = ? AND step_number = ?`,
        [now, caseId, next.n],
      );
      await db.run('UPDATE visa_cases SET current_step = ?, updated_at = ? WHERE id = ?', [
        next.n,
        now,
        caseId,
      ]);
    } else {
      await db.run(`UPDATE visa_cases SET current_step = ?, updated_at = ? WHERE id = ?`, [stepNumber, now, caseId]);
    }
  } else if (status === 'in_progress') {
    await db.run('UPDATE visa_cases SET current_step = ?, updated_at = ? WHERE id = ?', [
      stepNumber,
      now,
      caseId,
    ]);
  }
  const updated = await db.get('SELECT * FROM case_steps WHERE case_id = ? AND step_number = ?', [
    caseId,
    stepNumber,
  ]);
  return { ...camelize<CaseStep>(updated)!, data: json((updated as any).data, {}) };
}

/** Workflow progression is strictly sequential by design. */
export function assertStepTransition(current: StepStatus, next: StepStatus): void {
  const order: StepStatus[] = ['locked', 'pending', 'in_progress', 'waiting_approval', 'completed', 'skipped'];
  const allowed = new Set<string>([
    'pending>in_progress',
    'pending>blocked',
    'in_progress>completed',
    'in_progress>blocked',
    'in_progress>waiting_approval',
    'waiting_approval>completed',
    'waiting_approval>in_progress',
    'blocked>in_progress',
    'completed>in_progress',
  ]);
  const key = `${current}>${next}`;
  if (!allowed.has(key)) {
    throw conflict(`Illegal workflow transition ${current} -> ${next}`);
  }
  void order;
}
