import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { camelize, camelizeAll, json, nowIso } from '../lib/rows.js';
import { notFound } from '../lib/errors.js';
import { recordAudit } from './audit.js';

export interface SkillRecord {
  id: string;
  key: string;
  name: string;
  description: string;
  category: string;
  kind: 'agent' | 'browser';
  instructions: string;
  workflow: BrowserWorkflowStep[] | null;
  triggers: string[] | null;
  tools: string[] | null;
  agentKeys: string[] | null;
  enabled: number;
  builtin: number;
  version: number;
  sortOrder: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A single step of a reusable, browser-kind skill workflow. */
export interface BrowserWorkflowStep {
  kind:
    | 'navigate'
    | 'click'
    | 'type'
    | 'fill'
    | 'select'
    | 'press'
    | 'extract'
    | 'wait'
    | 'scroll'
    | 'screenshot';
  label?: string;
  url?: string;
  x?: number;
  y?: number;
  selector?: string;
  value?: string;
  key?: string;
  ms?: number;
}

export interface SkillRun {
  id: string;
  skillId: string;
  agentKey: string | null;
  caseId: string | null;
  input: string | null;
  output: string | null;
  status: string;
  createdBy: string | null;
  createdAt: string;
}

export interface SkillInput {
  key?: string;
  name: string;
  description?: string;
  category?: string;
  kind?: 'agent' | 'browser';
  instructions: string;
  workflow?: BrowserWorkflowStep[] | null;
  triggers?: string[];
  tools?: string[];
  agentKeys?: string[] | null;
  enabled?: boolean | number;
  sortOrder?: number;
}

/** Turn a free-text skill name into a stable slug used as the public key. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'skill';
}

const BUILTIN_SKILLS: Array<Omit<SkillInput, 'enabled'> & { key: string; sortOrder: number }> = [
  {
    key: 'document-triage',
    name: 'Document triage',
    description: 'Screens uploaded documents, flags unreadable or inconsistent scans and lists what is missing.',
    category: 'documents',
    kind: 'agent',
    instructions:
      'When asked to review documents, produce a table of each document with its category, OCR state and a verdict ' +
      '(readable / needs re-scan / inconsistent). List every required document that is still missing. Never assert a ' +
      'document is genuine — only report what the OCR and metadata show.',
    triggers: ['documents', 'scan', 'ocr', 'missing'],
    tools: ['list_documents', 'document_readiness', 'get_case'],
    sortOrder: 0,
  },
  {
    key: 'readiness-brief',
    name: 'Case readiness brief',
    description: 'A one-page readiness summary: passport validity, requirement gaps and the next action.',
    category: 'workflow',
    kind: 'agent',
    instructions:
      'Produce a concise readiness brief with three sections: Passport (validity months and required months), ' +
      'Requirement gaps (only from stored records with their source), and Next action (the single most useful next step). ' +
      'State clearly when a value is not recorded.',
    triggers: ['readiness', 'brief', 'status', 'summary'],
    tools: ['get_case', 'passport_validity', 'workflow_status', 'document_readiness'],
    sortOrder: 1,
  },
  {
    key: 'client-reply-draft',
    name: 'Client reply draft',
    description: 'Drafts a polite, factual reply to an applicant listing exactly what is still needed.',
    category: 'communication',
    kind: 'agent',
    instructions:
      'Draft a short, warm and factual message to the applicant. State only what the records show is outstanding. ' +
      'Do not promise timelines, approval outcomes or government decisions. End with a clear, numbered list of next steps.',
    triggers: ['reply', 'email', 'client', 'message'],
    tools: ['get_case', 'document_readiness', 'workflow_status'],
    sortOrder: 2,
  },
  {
    key: 'sponsor-diligence',
    name: 'Sponsor diligence',
    description: 'Summarises a sponsor record, its verification state and what evidence is still outstanding.',
    category: 'compliance',
    kind: 'agent',
    instructions:
      'Summarise the linked sponsor: legal name, jurisdiction, registration id, website and current verification state. ' +
      'Explicitly list what evidence would be required to move it from unverified to verified. Never mark it verified yourself.',
    triggers: ['sponsor', 'employer', 'verification', 'diligence'],
    tools: ['list_sponsors', 'get_case'],
    sortOrder: 3,
  },
  /* ----------------------- Browser workflow skills ---------------------- */
  {
    key: 'portal-research',
    name: 'Portal research',
    description: 'Opens an official page, scrolls the whole document and extracts the readable text for citation.',
    category: 'research',
    kind: 'browser',
    instructions:
      'Research an official government page: open the URL, wait for it to settle, scroll down through the whole page, ' +
      'then extract the visible text. Report the page title, URL and the extracted text with the retrieval time.',
    triggers: ['research', 'official', 'requirement', 'checklist'],
    workflow: [
      { kind: 'navigate', label: 'Open the official page' },
      { kind: 'wait', ms: 1500 },
      { kind: 'scroll', label: 'Scroll to load', value: '2200' },
      { kind: 'extract', selector: 'body' },
      { kind: 'screenshot' },
    ],
    sortOrder: 10,
  },
  {
    key: 'form-filler',
    name: 'Application form filler',
    description: 'Fills a web application form field-by-field from the case data, without submitting it.',
    category: 'application',
    kind: 'browser',
    instructions:
      'Fill the application form using the applicant values supplied. Fill one field at a time, re-checking the page ' +
      'between fields. Take a screenshot after each screen. Stop before any final submit and ask the operator for approval.',
    triggers: ['form', 'fill', 'apply', 'application'],
    workflow: [
      { kind: 'fill', label: 'Full name', selector: 'input[name="fullName"]' },
      { kind: 'fill', label: 'Passport number', selector: 'input[name="passportNumber"]' },
      { kind: 'fill', label: 'Nationality', selector: 'input[name="nationality"]' },
      { kind: 'fill', label: 'Email', selector: 'input[name="email"]' },
      { kind: 'screenshot', label: 'Review before submit' },
    ],
    sortOrder: 11,
  },
  {
    key: 'data-extractor',
    name: 'Data extraction',
    description: 'Extracts a structured snapshot of a page (title, url, text) and returns it as JSON.',
    category: 'research',
    kind: 'browser',
    instructions:
      'Extract the current page into a structured record: title, url, the readable text and a screenshot. ' +
      'Return the result as JSON and never modify the page.',
    triggers: ['extract', 'scrape', 'data', 'json'],
    workflow: [{ kind: 'wait', ms: 800 }, { kind: 'extract', selector: 'body' }, { kind: 'screenshot' }],
    sortOrder: 12,
  },
  {
    key: 'report-capture',
    name: 'Report capture',
    description: 'Walks a page, captures full screenshots and returns them as a report-ready evidence set.',
    category: 'reporting',
    kind: 'browser',
    instructions:
      'Capture evidence for a report: open the URL, wait, then take a screenshot of each section while scrolling down. ' +
      'Return the ordered screenshots with the page URL so they can be attached to the case report.',
    triggers: ['report', 'evidence', 'capture', 'screenshot'],
    workflow: [
      { kind: 'navigate', label: 'Open the page to capture' },
      { kind: 'wait', ms: 1200 },
      { kind: 'screenshot', label: 'Top of page' },
      { kind: 'scroll', value: '900' },
      { kind: 'screenshot', label: 'Middle' },
      { kind: 'scroll', value: '900' },
      { kind: 'screenshot', label: 'Bottom' },
    ],
    sortOrder: 13,
  },
];

export async function seedSkills(): Promise<void> {
  const db = getDb();
  const now = nowIso();
  for (const skill of BUILTIN_SKILLS) {
    const existing = await db.get('SELECT id FROM skills WHERE key = ?', [skill.key]);
    if (existing) continue;
    await db.run(
      `INSERT INTO skills (id, key, name, description, category, kind, instructions, workflow, triggers, tools, agent_keys, enabled, builtin, version, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, ?, ?, ?)`,
      [
        newId('skl'),
        skill.key,
        skill.name,
        skill.description ?? '',
        skill.category ?? 'general',
        skill.kind ?? 'agent',
        skill.instructions,
        skill.workflow ? JSON.stringify(skill.workflow) : null,
        JSON.stringify(skill.triggers ?? []),
        JSON.stringify(skill.tools ?? []),
        null,
        skill.sortOrder ?? 0,
        now,
        now,
      ],
    );
  }
}

function hydrate(row: Record<string, any>): SkillRecord | undefined {
  const s = camelize<SkillRecord>(row);
  if (!s) return undefined;
  s.triggers = json<string[]>(s.triggers, []);
  s.tools = json<string[]>(s.tools, []);
  s.agentKeys = json<string[] | null>(s.agentKeys, null);
  s.kind = (s.kind as any) === 'browser' ? 'browser' : 'agent';
  s.workflow = json<BrowserWorkflowStep[] | null>(s.workflow, null);
  return s;
}

export async function listSkills(opts: { enabledOnly?: boolean; agentKey?: string } = {}): Promise<SkillRecord[]> {
  const where: string[] = [];
  const params: any[] = [];
  if (opts.enabledOnly) where.push('enabled = 1');
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await getDb().all(`SELECT * FROM skills ${clause} ORDER BY sort_order ASC, name ASC`, params);
  let skills = rows.map(hydrate).filter(Boolean) as SkillRecord[];
  if (opts.agentKey) {
    skills = skills.filter((s) => !s.agentKeys?.length || s.agentKeys.includes(opts.agentKey!));
  }
  return skills;
}

export async function getSkill(idOrKey: string): Promise<SkillRecord | undefined> {
  const db = getDb();
  const row = (await db.get('SELECT * FROM skills WHERE id = ?', [idOrKey])) ?? (await db.get('SELECT * FROM skills WHERE key = ?', [idOrKey]));
  return row ? hydrate(row) : undefined;
}

export async function createSkill(input: SkillInput, actor?: { id: string; email: string }): Promise<SkillRecord> {
  const db = getDb();
  const now = nowIso();
  const key = (input.key ? slugify(input.key) : slugify(input.name)) || `skill-${Date.now()}`;
  const clash = await db.get('SELECT id FROM skills WHERE key = ?', [key]);
  const finalKey = clash ? `${key}-${Math.random().toString(36).slice(2, 6)}` : key;
  const id = newId('skl');
  await db.run(
    `INSERT INTO skills (id, key, name, description, category, kind, instructions, workflow, triggers, tools, agent_keys, enabled, builtin, version, sort_order, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?)`,
    [
      id,
      finalKey,
      input.name,
      input.description ?? '',
      input.category ?? 'general',
      input.kind ?? 'agent',
      input.instructions,
      input.workflow ? JSON.stringify(input.workflow) : null,
      JSON.stringify(input.triggers ?? []),
      JSON.stringify(input.tools ?? []),
      input.agentKeys ? JSON.stringify(input.agentKeys) : null,
      input.enabled === false ? 0 : 1,
      input.sortOrder ?? 100,
      actor?.id ?? null,
      now,
      now,
    ],
  );
  if (actor) {
    await recordAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'skill.created',
      entity: 'skill',
      entityId: id,
      meta: { key: finalKey, name: input.name },
    });
  }
  return (await getSkill(id))!;
}

export async function updateSkill(
  id: string,
  patch: Partial<SkillInput>,
  actor?: { id: string; email: string },
): Promise<SkillRecord> {
  const existing = await getSkill(id);
  if (!existing) throw notFound('Skill not found');
  const db = getDb();
  const fields: string[] = [];
  const params: any[] = [];
  const set = (column: string, value: any) => {
    fields.push(`${column} = ?`);
    params.push(value);
  };
  if (patch.name !== undefined) set('name', patch.name);
  if (patch.description !== undefined) set('description', patch.description);
  if (patch.category !== undefined) set('category', patch.category);
  if (patch.kind !== undefined) set('kind', patch.kind);
  if (patch.instructions !== undefined) set('instructions', patch.instructions);
  if (patch.workflow !== undefined) set('workflow', patch.workflow ? JSON.stringify(patch.workflow) : null);
  if (patch.triggers !== undefined) set('triggers', JSON.stringify(patch.triggers ?? []));
  if (patch.tools !== undefined) set('tools', JSON.stringify(patch.tools ?? []));
  if (patch.agentKeys !== undefined) set('agent_keys', patch.agentKeys ? JSON.stringify(patch.agentKeys) : null);
  if (patch.enabled !== undefined) set('enabled', patch.enabled === false ? 0 : patch.enabled === true ? 1 : patch.enabled);
  if (patch.sortOrder !== undefined) set('sort_order', patch.sortOrder);
  // Editing the instructions of a skill bumps its version so changes are traceable.
  if (patch.instructions !== undefined && patch.instructions !== existing.instructions) {
    set('version', existing.version + 1);
  }
  if (!fields.length) return existing;
  fields.push('updated_at = ?');
  params.push(nowIso(), id);
  await db.run(`UPDATE skills SET ${fields.join(', ')} WHERE id = ?`, params);
  if (actor) {
    await recordAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'skill.updated',
      entity: 'skill',
      entityId: id,
      meta: patch,
    });
  }
  return (await getSkill(id))!;
}

export async function deleteSkill(id: string, actor?: { id: string; email: string }): Promise<{ deleted: boolean }> {
  const existing = await getSkill(id);
  if (!existing) throw notFound('Skill not found');
  await getDb().run('DELETE FROM skills WHERE id = ?', [id]);
  if (actor) {
    await recordAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'skill.deleted',
      entity: 'skill',
      entityId: id,
      meta: { key: existing.key, name: existing.name },
    });
  }
  return { deleted: true };
}

export async function recordSkillRun(input: {
  skillId: string;
  agentKey?: string | null;
  caseId?: string | null;
  input?: string | null;
  output?: string | null;
  status?: string;
  createdBy?: string | null;
}): Promise<SkillRun> {
  const db = getDb();
  const id = newId('skr');
  await db.run(
    `INSERT INTO skill_runs (id, skill_id, agent_key, case_id, input, output, status, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.skillId,
      input.agentKey ?? null,
      input.caseId ?? null,
      input.input ?? null,
      input.output ?? null,
      input.status ?? 'completed',
      input.createdBy ?? null,
      nowIso(),
    ],
  );
  const row = await db.get('SELECT * FROM skill_runs WHERE id = ?', [id]);
  return camelize<SkillRun>(row)!;
}

export async function listSkillRuns(skillId: string, limit = 50): Promise<SkillRun[]> {
  const rows = await getDb().all('SELECT * FROM skill_runs WHERE skill_id = ? ORDER BY created_at DESC LIMIT ?', [skillId, limit]);
  return camelizeAll<SkillRun>(rows);
}

/**
 * Assemble the "Skills" block injected into an agent's system prompt. Only
 * enabled skills that the agent is allowed to use are included.
 */
export function renderSkillsForPrompt(skills: SkillRecord[]): string {
  if (!skills.length) return '';
  const lines = skills.map(
    (s) => `- ${s.name} [${s.category}]: ${s.instructions}`,
  );
  return [
    'The agency has enabled the following Skills. Apply the relevant Skill automatically when the request matches its triggers. Skills complement, never override, the honesty rules above.',
    ...lines,
  ].join('\n');
}

export async function activeSkillsForAgent(agentKey: string): Promise<SkillRecord[]> {
  const skills = await listSkills({ enabledOnly: true, agentKey });
  return skills;
}
