# VisaHOBe Agency OS

A **self-hosted visa agency operations platform**: a premium, installable mobile PWA backed by a real
API, a real database, real AI agents that call backend tools, a real self-hosted Playwright browser
worker with a live preview, a private document vault, and the ten-step visa workflow persisted end to end.

Everything runs on hardware you control. No paid cloud browser, no mandatory hosted AI API.

> **Status of this repository.** It was written as a complete, working implementation from scratch. The
> original project path referenced in the brief (`/projects/0124c123-…`) was **not present** in the
> build environment, so there was no existing code base to extend or preserve. Every module below is
> real, executed and covered by automated tests — nothing here is a mock-up.

---

## 1. What actually works

| Capability | Implementation | Verified by |
| --- | --- | --- |
| Mobile PWA | Vite + React + TanStack Router, installable manifest, service worker, safe-area layout, floating bottom nav | `apps/web/test/pwa.test.ts`, `scripts/ui-check.mjs` |
| Auth & roles | scrypt password hashing, signed session cookie, admin / staff / viewer roles, audit trail | `apps/server/test/api.test.ts` |
| Database | SQLite by default, PostgreSQL supported, versioned migrations, foreign keys and indexes | `apps/server/test/unit.test.ts` |
| Five AI agents | Raffi, Nova, Maestro, Tanya, Zayyad — each with its own profile, conversation history, tools, task state, provider/model display | `apps/server/test/api.test.ts`, `/api/agents` |
| Conversational chat | Real backend round-trip; agents call eight grounded tools (case, requirements, documents, passport validity, workflow, readiness, sponsors) | `POST /api/agents/chat` |
| Offline AI | **VisaHOBe Local Engine** — a deterministic, database-backed reasoner so the product works with no API key at all | `ai/builtin.ts` |
| Local + BYOK AI | Ollama (local), OpenAI-compatible, Anthropic, Gemini, DeepSeek, custom endpoints; encrypted key storage, connection test | `ai/providers/*` |
| Browser automation | Separate worker process, real Chromium, Playwright locators, task queue, structured logs | `apps/server/test/browser.test.ts` |
| Live preview | Authenticated WebSocket streaming **real screenshots** of the controlled page | `apps/server/test/browser.test.ts` |
| Remote control | Click / scroll / type mapped into the live page, pause = human takeover for 2FA and CAPTCHA | `apps/web/src/routes/browser.tsx` |
| Ten-step SOP | Sequential workflow with per-case step state, transitions, readiness checks | `apps/server/test/unit.test.ts` |
| Document vault | Private filesystem storage, short-lived signed downloads, version history, OCR extraction | `apps/server/test/api.test.ts` |
| Document generation | Real A4 PDF (Chromium print) and DOCX (docx) for 7 templates, drafts clearly marked | `apps/server/test/unit.test.ts` |
| Sponsor database | Searchable, editable, verification states, audit of who verified what and when | `apps/server/test/unit.test.ts` |
| Requirements base | Versioned, source-linked, verification dates, stale/unverified flags | `apps/server/test/unit.test.ts` |
| Web intelligence | Self-hosted Firecrawl with a Playwright extraction fallback | `services/web/scrape.ts` |
| Google Workspace | Optional Drive / Docs / Gmail connectors (minimal scopes, explicit consent) | `services/google/client.ts` |

### Deliberate honesty rules baked into the code

* An agent **never** claims a task succeeded unless the backend confirmed it.
* The UI shows **“worker offline”** when no browser worker is connected — it never fakes a live preview.
* Documents that are not officially issued are stamped **DRAFT** in the PDF and DOCX.
* Sponsors start **unverified**; only an explicit human review moves them to *verified*.
* Requirements are **unverified** until a staff member records the official source URL and date.
* The six-month passport rule is **configuration**, not law — it is editable per country and category.
* No government submission, receipt, appointment or visa outcome is ever fabricated.

---

## 2. Architecture

```
┌───────────────────────────────┐        ┌──────────────────────────────────────────┐
│  PWA (installable, offline-   │  HTTPS │  API server (Fastify, TypeScript)        │
│  capable, mobile first)       │◀──────▶│  • REST + WebSocket (preview stream)     │
│  Home · Agents · Chat ·       │        │  • auth, RBAC, audit trail                │
│  Cases · Documents · More     │        │  • AI engine + provider adapters          │
└───────────────────────────────┘        │  • workflow, documents, sponsors          │
                                         │  • SQLite or PostgreSQL                  │
                                         │  • private file storage                  │
                                         └───────────┬──────────────┬────────────────┘
                                                     │              │
                                       WebSocket (token)│              │ REST + file IO
                                                     ▼              ▼
                              ┌──────────────────────────────┐  ┌──────────────────────┐
                              │ Browser worker (Playwright)  │  │ Ollama / BYOK API    │
                              │ • real Chromium              │  │ (optional)           │
                              │ • per-task browser contexts  │  └──────────────────────┘
                              │ • screenshot streaming       │
                              │ • SSRF-checked navigation    │  ┌──────────────────────┐
                              └──────────────────────────────┘  │ Firecrawl (optional) │
                                                              └──────────────────────┘
```

The browser engine **never** runs inside the PWA. The phone is a remote control; Chromium runs on your
own computer, server or VPS.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the component map, data model and the
server ↔ worker wire protocol.

---

## 3. Quick start (local, free)

```bash
git clone <your-repo> visahobe && cd visahobe
cp .env.example .env          # then edit the secrets (see docs/SETUP.md)
npm install
npx playwright install chromium   # the local browser used by the worker and the PDF renderer
npm run dev                     # api :8787 · web :5173 · worker · local test site :4599
```

Open <http://localhost:5173> and sign in with the bootstrap administrator
(`BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`, default `admin@visahobe.local` / `VisaHOBe!2024`).

### Docker (self-hosted)

```bash
cp .env.example .env   # set JWT_SECRET, ENCRYPTION_KEY, WORKER_TOKEN
docker compose up -d --build
docker compose --profile postgres up -d   # optional PostgreSQL
docker compose --profile ollama up -d      # optional local model runtime
```

The web app is then served on <http://localhost:8080>.

### Tests

```bash
npm test        # server (unit + HTTP API + real browser worker) and web (PWA + components)
npm run typecheck
```

Last executed result in this repository (**45 server + 13 web = 58 passing**):

| Suite | File | Tests | What it proves |
| --- | --- | --- | --- |
| Domain unit tests | `apps/server/test/unit.test.ts` | 20 | applicant CRUD + normalisation, passport correction, configurable validity rules, sponsor states, workflow transitions, requirement versioning, planner, SSRF policy, private-address classification, **real PDF + DOCX generation**, provider secret encryption/validation |
| HTTP integration | `apps/server/test/api.test.ts` | 19 | auth failures, RBAC boundaries (401/403), approval gates, SSRF refusal, applicant/case HTTP flows, 10-step workflow + illegal transition rejection, **document upload + signed-URL authorisation + forged-token rejection + file-type rejection**, dossier generation, DRAFT marking, grounded agent chat, task listing by key/id, task cancellation, browser-offline behaviour |
| Real browser worker | `apps/server/test/browser.test.ts` | 6 | worker connect, **real Chromium navigation to the local test site**, live preview frames over the authenticated WebSocket, real task execution with recorded activity, pause/resume (human takeover), **worker-disconnect detection** |
| PWA configuration | `apps/web/test/pwa.test.ts` | 8 | manifest validity, icon presence, iOS meta tags, **service worker never caches API or private files**, 16px inputs, safe-area usage, mobile bottom nav vs desktop sidebar, liquid-glass styling |
| UI components | `apps/web/test/components.test.tsx` | 5 | status pills, avatars, empty states, labelled fields |

The browser suite launches a real Chromium, drives the **local test site** in
`apps/server/test/fixtures/site` and asserts live-preview frames, task execution, human-takeover
pause/resume and worker-disconnect detection. It never touches a live government portal.

`scripts/ui-check.mjs` additionally renders the production build in a 390×844 mobile viewport and a
1280×900 desktop viewport and writes the screenshots in `screenshots/`.

---

## 4. Cost reality check

| Item | Cost |
| --- | --- |
| Application code | Free (MIT-friendly open source stack: Fastify, React, Playwright, SQLite) |
| Local AI via Ollama | Free — your own CPU/GPU |
| Browser automation | Free — local Chromium via Playwright |
| Storage | Whatever disk you already have (or a small VPS volume) |
| Hosting 24/7 | **Only real cost**: a small VPS (≈ €4–8/month) if you want it always on |
| Electricity | Whatever your machine draws |
| Optional BYOK AI | Only if you choose a hosted provider (OpenAI/Anthropic/Gemini/DeepSeek) |
| Optional Firecrawl / Google | Only if you enable them; the app works without both |

Nothing in the default configuration sends applicant data to a third party.

---

## 5. Repository layout

```
packages/shared        Shared domain vocabulary and zod schemas
apps/server            Fastify API, AI engine, browser hub, documents, tests
apps/browser-worker    Self-hosted Playwright worker (separate process)
apps/web               Installable PWA (React + TanStack Router + Vite)
docker/                API, worker and web images + nginx config
docs/                  Setup, architecture, security and deployment guides
scripts/               dev launcher, icon generator, local test site, UI smoke check
```

---

## 6. Known limitations (stated plainly)

* **OCR** uses `tesseract.js`; it needs language data to download on first use. When that is impossible
  the UI says so and staff enter the values manually — nothing is fabricated.
* The **live preview is frame-based**, not a full remote desktop: screenshots at an adjustable rate
  plus mapped click/scroll/type. The UI states this explicitly.
* **Browser Use** (the open-source Python agent) is not wired in. The equivalent capability is provided
  by the built-in planner plus the Playwright worker; adding Browser Use means another worker
  implementation behind the same protocol.
* **Google Workspace** and **Firecrawl** need credentials/endpoints; without them the corresponding
  screens honestly report *not configured*.
* The PWA is verified in Chromium and WebKit-family engines; iOS Safari installation is supported via
  *Add to Home Screen* but the automated checks run on Chromium only.
