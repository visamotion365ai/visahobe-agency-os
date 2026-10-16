import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { camelize, camelizeAll, json, nowIso } from '../lib/rows.js';
import { notFound } from '../lib/errors.js';

export interface DocumentRecord {
  id: string;
  applicantId: string | null;
  caseId: string | null;
  kind: 'uploaded' | 'generated';
  category: string;
  title: string;
  filename: string;
  mime: string | null;
  size: number;
  storageKey: string;
  sha256: string | null;
  status: string;
  ocrStatus: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  ocrText: string | null;
  ocrJson: Record<string, unknown> | null;
  uploadedBy: string | null;
  uploadedAt: string;
  createdAt: string;
  updatedAt: string;
  retentionUntil: string | null;
}

export async function createDocument(input: {
  applicantId?: string | null;
  caseId?: string | null;
  kind?: 'uploaded' | 'generated';
  category: string;
  title?: string;
  filename: string;
  mime?: string | null;
  size: number;
  storageKey: string;
  sha256?: string | null;
  uploadedBy?: string | null;
  ocrStatus?: DocumentRecord['ocrStatus'];
  ocrText?: string | null;
  ocrJson?: unknown;
}): Promise<DocumentRecord> {
  const db = getDb();
  const id = newId('doc');
  const now = nowIso();
  await db.run(
    `INSERT INTO documents (
      id, applicant_id, case_id, kind, category, title, filename, mime, size, storage_key, sha256,
      status, ocr_status, ocr_text, ocr_json, uploaded_by, uploaded_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.applicantId ?? null,
      input.caseId ?? null,
      input.kind ?? 'uploaded',
      input.category,
      input.title || input.filename,
      input.filename,
      input.mime ?? null,
      input.size,
      input.storageKey,
      input.sha256 ?? null,
      input.ocrStatus ?? 'pending',
      input.ocrText ?? null,
      input.ocrJson === undefined ? null : JSON.stringify(input.ocrJson),
      input.uploadedBy ?? null,
      now,
      now,
      now,
    ],
  );
  return (await getDocument(id))!;
}

export async function getDocument(id: string): Promise<DocumentRecord | undefined> {
  const row = await getDb().get('SELECT * FROM documents WHERE id = ?', [id]);
  if (!row) return undefined;
  const doc = camelize<DocumentRecord>(row)!;
  doc.ocrJson = json<Record<string, unknown>>(doc.ocrJson, {}) as Record<string, unknown>;
  return doc;
}

export async function listDocuments(opts: {
  applicantId?: string;
  caseId?: string;
  category?: string;
  q?: string;
  kind?: string;
} = {}): Promise<DocumentRecord[]> {
  const where: string[] = [];
  const params: any[] = [];
  if (opts.applicantId) {
    where.push('applicant_id = ?');
    params.push(opts.applicantId);
  }
  if (opts.caseId) {
    where.push('case_id = ?');
    params.push(opts.caseId);
  }
  if (opts.category) {
    where.push('category = ?');
    params.push(opts.category);
  }
  if (opts.kind) {
    where.push('kind = ?');
    params.push(opts.kind);
  }
  if (opts.q) {
    where.push('(lower(filename) LIKE ? OR lower(title) LIKE ? OR lower(ocr_text) LIKE ?)');
    const like = `%${opts.q.toLowerCase()}%`;
    params.push(like, like, like);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await getDb().all(`SELECT * FROM documents ${clause} ORDER BY uploaded_at DESC LIMIT 500`, params);
  return camelizeAll<DocumentRecord>(rows);
}

export async function updateDocument(
  id: string,
  patch: Partial<{
    category: string;
    title: string;
    status: string;
    ocrStatus: DocumentRecord['ocrStatus'];
    ocrText: string | null;
    ocrJson: unknown;
    caseId: string | null;
    applicantId: string | null;
    retentionUntil: string | null;
  }>,
): Promise<DocumentRecord> {
  const db = getDb();
  if (!(await getDocument(id))) throw notFound('Document not found');
  const map: Record<string, string> = {
    category: 'category',
    title: 'title',
    status: 'status',
    ocrStatus: 'ocr_status',
    ocrText: 'ocr_text',
    caseId: 'case_id',
    applicantId: 'applicant_id',
    retentionUntil: 'retention_until',
  };
  const fields: string[] = [];
  const params: any[] = [];
  for (const [key, column] of Object.entries(map)) {
    const value = (patch as any)[key];
    if (value === undefined) continue;
    fields.push(`${column} = ?`);
    params.push(value === '' ? null : value);
  }
  if (patch.ocrJson !== undefined) {
    fields.push('ocr_json = ?');
    params.push(JSON.stringify(patch.ocrJson));
  }
  if (!fields.length) return (await getDocument(id))!;
  fields.push('updated_at = ?');
  params.push(nowIso(), id);
  await db.run(`UPDATE documents SET ${fields.join(', ')} WHERE id = ?`, params);
  return (await getDocument(id))!;
}

export async function addDocumentVersion(input: {
  documentId: string;
  filename: string;
  storageKey: string;
  size: number;
  sha256?: string | null;
  note?: string;
  createdBy?: string | null;
}) {
  const db = getDb();
  const row = await db.get('SELECT MAX(version) AS v FROM document_versions WHERE document_id = ?', [
    input.documentId,
  ]);
  const version = Number(row?.v ?? 0) + 1;
  const id = newId('dov');
  await db.run(
    `INSERT INTO document_versions (id, document_id, version, filename, storage_key, size, sha256, note, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.documentId,
      version,
      input.filename,
      input.storageKey,
      input.size,
      input.sha256 ?? null,
      input.note ?? null,
      input.createdBy ?? null,
      nowIso(),
    ],
  );
  return { id, version };
}

export async function listDocumentVersions(documentId: string) {
  const rows = await getDb().all(
    'SELECT * FROM document_versions WHERE document_id = ? ORDER BY version DESC',
    [documentId],
  );
  return camelizeAll(rows);
}
