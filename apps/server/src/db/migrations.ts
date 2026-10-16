/**
 * Schema migrations.
 *
 * Every statement is written in the portable subset shared by SQLite and
 * PostgreSQL: TEXT / INTEGER columns, TEXT ids generated in application code
 * and ISO-8601 timestamps stored as TEXT. Only the placeholder syntax differs
 * between the two engines, and that is handled by the adapter in ./index.ts.
 */
export interface Migration {
  id: string;
  name: string;
  statements: string[];
}

const core: Migration = {
  id: '0001_core',
  name: 'core platform tables',
  statements: [
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'staff',
      active INTEGER NOT NULL DEFAULT 1,
      last_login_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      actor_id TEXT,
      actor_email TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entity_id TEXT,
      meta TEXT,
      ip TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events (created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events (entity, entity_id)`,
    `CREATE TABLE IF NOT EXISTS ai_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      base_url TEXT,
      model TEXT NOT NULL,
      api_key_enc TEXT,
      settings TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      system_prompt TEXT NOT NULL DEFAULT '',
      provider_id TEXT,
      model TEXT,
      temperature REAL NOT NULL DEFAULT 0.2,
      tools TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'New conversation',
      case_id TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_conv_agent ON conversations (agent_id, updated_at DESC)`,
    `CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      agent_id TEXT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      meta TEXT,
      task_id TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages (conversation_id, created_at ASC)`,
    `CREATE TABLE IF NOT EXISTS agent_tasks (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      conversation_id TEXT,
      user_id TEXT,
      case_id TEXT,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      input TEXT,
      plan TEXT,
      progress INTEGER NOT NULL DEFAULT 0,
      result TEXT,
      error TEXT,
      requires_approval INTEGER NOT NULL DEFAULT 0,
      started_at TEXT,
      finished_at TEXT,
      cancelled_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_task_agent ON agent_tasks (agent_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_task_status ON agent_tasks (status)`,
    `CREATE TABLE IF NOT EXISTS agent_task_events (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      data TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_task_events ON agent_task_events (task_id, created_at ASC)`,
    `CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      payload TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_by TEXT,
      reviewed_by TEXT,
      reviewed_at TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals (status, created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      case_id TEXT,
      title TEXT NOT NULL,
      due_at TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      channel TEXT NOT NULL DEFAULT 'in_app',
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS integration_connections (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'disconnected',
      account_email TEXT,
      scopes TEXT,
      token_enc TEXT,
      refresh_enc TEXT,
      meta TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  ],
};

const operations: Migration = {
  id: '0002_operations',
  name: 'visa operations tables',
  statements: [
    `CREATE TABLE IF NOT EXISTS applicants (
      id TEXT PRIMARY KEY,
      reference TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      passport_number TEXT,
      passport_number_norm TEXT,
      nationality TEXT,
      date_of_birth TEXT,
      gender TEXT,
      passport_issue_date TEXT,
      passport_expiry_date TEXT,
      email TEXT,
      phone TEXT,
      address TEXT,
      notes TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_applicant_passport ON applicants (passport_number_norm)`,
    `CREATE INDEX IF NOT EXISTS idx_applicant_name ON applicants (full_name)`,
    `CREATE TABLE IF NOT EXISTS sponsors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      legal_name TEXT,
      country TEXT NOT NULL,
      jurisdiction TEXT,
      registration_id TEXT,
      website TEXT,
      source_url TEXT,
      contact_person TEXT,
      email TEXT,
      phone TEXT,
      sponsor_type TEXT,
      verification_status TEXT NOT NULL DEFAULT 'unverified',
      last_verified_at TEXT,
      verified_by TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_sponsor_country ON sponsors (country)`,
    `CREATE TABLE IF NOT EXISTS visa_cases (
      id TEXT PRIMARY KEY,
      reference TEXT NOT NULL UNIQUE,
      applicant_id TEXT NOT NULL,
      sponsor_id TEXT,
      country TEXT NOT NULL,
      visa_category TEXT NOT NULL,
      purpose TEXT,
      priority TEXT NOT NULL DEFAULT 'normal',
      status TEXT NOT NULL DEFAULT 'active',
      current_step INTEGER NOT NULL DEFAULT 1,
      assigned_to TEXT,
      created_by TEXT,
      submission_date TEXT,
      receipt_number TEXT,
      outcome TEXT,
      closed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_case_applicant ON visa_cases (applicant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_case_country ON visa_cases (country)`,
    `CREATE TABLE IF NOT EXISTS case_steps (
      case_id TEXT NOT NULL,
      step_number INTEGER NOT NULL,
      step_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      data TEXT,
      notes TEXT,
      completed_by TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (case_id, step_number)
    )`,
    `CREATE TABLE IF NOT EXISTS requirements (
      id TEXT PRIMARY KEY,
      country TEXT NOT NULL,
      visa_category TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL DEFAULT 'general',
      mandatory INTEGER NOT NULL DEFAULT 1,
      source_url TEXT,
      source_title TEXT,
      verified_at TEXT,
      effective_date TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'unverified',
      superseded_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_req_lookup ON requirements (country, visa_category, status)`,
    `CREATE TABLE IF NOT EXISTS requirement_checks (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      requirement_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'missing',
      evidence_document_id TEXT,
      note TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE (case_id, requirement_id)
    )`,
    `CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      applicant_id TEXT,
      case_id TEXT,
      kind TEXT NOT NULL DEFAULT 'uploaded',
      category TEXT NOT NULL DEFAULT 'other',
      title TEXT NOT NULL DEFAULT '',
      filename TEXT NOT NULL,
      mime TEXT,
      size INTEGER NOT NULL DEFAULT 0,
      storage_key TEXT NOT NULL,
      sha256 TEXT,
      status TEXT NOT NULL DEFAULT 'available',
      ocr_status TEXT NOT NULL DEFAULT 'pending',
      ocr_text TEXT,
      ocr_json TEXT,
      uploaded_by TEXT,
      uploaded_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      retention_until TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_doc_applicant ON documents (applicant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_doc_case ON documents (case_id)`,
    `CREATE INDEX IF NOT EXISTS idx_doc_category ON documents (category)`,
    `CREATE TABLE IF NOT EXISTS document_versions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      filename TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT,
      note TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_docver ON document_versions (document_id, version DESC)`,
  ],
};

const browser: Migration = {
  id: '0003_browser',
  name: 'browser automation tables',
  statements: [
    `CREATE TABLE IF NOT EXISTS browser_sessions (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'idle',
      worker_id TEXT,
      worker_label TEXT,
      viewport TEXT NOT NULL DEFAULT 'desktop',
      url TEXT,
      title TEXT,
      task_id TEXT,
      mode TEXT NOT NULL DEFAULT 'assisted',
      created_by TEXT,
      created_at TEXT NOT NULL,
      ended_at TEXT,
      meta TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_bsession_created ON browser_sessions (created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS browser_task_events (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      task_id TEXT,
      type TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      data TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_bevent_session ON browser_task_events (session_id, created_at ASC)`,
    `CREATE TABLE IF NOT EXISTS task_artifacts (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      session_id TEXT,
      kind TEXT NOT NULL,
      filename TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      mime TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_artifact_task ON task_artifacts (task_id)`,
  ],
};

const skills: Migration = {
  id: '0004_skills',
  name: 'agent skills and custom abilities',
  statements: [
    `CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'general',
      instructions TEXT NOT NULL,
      triggers TEXT,
      tools TEXT,
      agent_keys TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      builtin INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_skill_enabled ON skills (enabled, sort_order)`,
    `CREATE INDEX IF NOT EXISTS idx_skill_category ON skills (category)`,
    `CREATE TABLE IF NOT EXISTS skill_runs (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL,
      agent_key TEXT,
      case_id TEXT,
      input TEXT,
      output TEXT,
      status TEXT NOT NULL DEFAULT 'completed',
      created_by TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_skillrun_skill ON skill_runs (skill_id, created_at DESC)`,
  ],
};

const skillKinds: Migration = {
  id: '0005_skill_kinds',
  name: 'skill kinds and browser workflows',
  statements: [
    // kind: 'agent' (prompt ability) or 'browser' (playwright workflow)
    `ALTER TABLE skills ADD COLUMN kind TEXT NOT NULL DEFAULT 'agent'`,
    // workflow: JSON array of browser steps for browser-kind skills
    `ALTER TABLE skills ADD COLUMN workflow TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_skill_kind ON skills (kind, enabled)`,
  ],
};

export const migrations: Migration[] = [core, operations, browser, skills, skillKinds];
