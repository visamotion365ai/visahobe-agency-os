# Architecture

## Processes

| Process | Package | Responsibility |
| --- | --- | --- |
| API | `@visahobe/server` | REST + WebSocket, auth, AI engine, workflow, documents, sponsors, requirements, integrations |
| Browser worker | `@visahobe/browser-worker` | Playwright + Chromium, browser sessions, screenshots, task execution |
| Web | `@visahobe/web` | Installable PWA (React 19, TanStack Router, TanStack-free fetch client) |
| Shared | `@visahobe/shared` | Domain vocabulary + zod schemas used by all three |

The API and the worker are separate processes on purpose: the browser is a resource-heavy, crash-prone
subsystem and must never take the API down with it. They talk over one authenticated WebSocket.

## Data model

```
users ──< audit_events
applicants ──< visa_cases ──< case_steps
                 │   └──< requirement_checks >── requirements (versioned, source linked)
                 │   └──< documents ──< document_versions
                 └── sponsor_id >── sponsors
agents ──< conversations ──< messages
       └──< agent_tasks ──< agent_task_events
browser_sessions ──< browser_task_events
                 └──< task_artifacts
ai_providers · approvals · reminders · integration_connections · settings
```

All identifiers are application generated text IDs. Timestamps are ISO-8601 text so the same schema
runs on SQLite and PostgreSQL. Migrations live in `apps/server/src/db/migrations.ts` and are applied
at boot, tracked in `schema_migrations`.

## Server ↔ worker protocol

Server → worker (`WorkerCommand`):

| Command | Purpose |
| --- | --- |
| `create_session` | launch an isolated browser context, optional start URL, allow list |
| `navigate` | validated navigation |
| `action` | click, scroll, type, fill, select, press, screenshot, refresh, back, forward, extract, wait |
| `run_task` | execute a planned step list |
| `pause` / `resume` | human takeover (2FA, CAPTCHA) |
| `set_viewport` | desktop / mobile emulation |
| `screenshot_request` | force a frame |

Worker → server (`WorkerEvent`): `ready`, `session_state`, `log`, `screenshot`, `action_result`,
`task_result`, `error`.

The worker serialises commands so a navigation can never race the creation of its session. The
server relays screenshots to the UI over `/api/browser/stream` (authenticated with a 15-minute
single-use WebSocket token).

## AI engine

```
message ──▶ resolve case (explicit id, or a VM-… reference in the text)
        ──▶ build context (case, applicant, sponsor, steps, requirements, checks, documents, validity)
        ──▶ select provider (agent override ▸ default provider ▸ VisaHOBe Local Engine)
        ──▶ tool loop (max 4 iterations, tools: get_case, list_cases, list_requirements,
        │              list_documents, passport_validity, workflow_status,
        │              document_readiness, list_sponsors)
        ──▶ persist messages + task events
```

If the selected provider cannot be reached the engine **falls back to the Local Engine and says so**
in the answer and in the task event log. It never silently pretends an LLM answered.

Providers: `ollama`, `openai`, `anthropic`, `gemini`, `deepseek`, `custom` (any OpenAI-compatible
endpoint) and `builtin`. API keys are encrypted with AES-256-GCM before storage and are never
returned by the API.

## Ten-step SOP

`intake → ocr → passport_validity → country_checklist → gap_analysis → dossier →
package_generation → review_approval → portal_submission → tracking`

Steps are strictly sequential. Transitions are validated (`pending → in_progress → completed`,
with `blocked`, `waiting_approval` and `skipped` branches); illegal transitions are rejected by the
API with HTTP 400. Human approval is a first-class record: consequential steps stop and wait for a
staff member to approve or reject, and the reviewer plus timestamp are stored.

## Storage

* **Database** — SQLite (`data/visahobe.db`) by default, PostgreSQL when `DATABASE_URL` is set.
* **Files** — `data/storage/<year>/<month>/<random>-<name>` with `0600` permissions.
* **Downloads** — signed, short-lived capability tokens, *and* a valid session is required.
* **Generated documents** — stored as first-class document records so they appear in the vault, with
  version history and audit entries.
