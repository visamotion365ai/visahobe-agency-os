# Local setup

VisaHOBe runs on **Node.js 20+** and a Chromium build installed by Playwright. No cloud account is
needed to start.

## 1. Prerequisites

| Requirement | Version | Why |
| --- | --- | --- |
| Node.js | 20 LTS or newer | API, worker and PWA toolchain |
| npm | 10+ | workspace management |
| Chromium (Playwright build) | installed by Playwright | browser automation + PDF rendering |
| Optional: Ollama | any recent | local LLM for the agents |

### Windows (PowerShell)

```powershell
git clone <your-repo> visahobe
cd visahobe
Copy-Item .env.example .env
notepad .env
npm install
npx playwright install chromium
npm run dev
```

Chromium needs these Windows components (installed automatically by the Playwright installer on
Windows 10/11). If the browser fails to start, install the *Visual C++ Redistributable* and reboot.

### macOS

```bash
brew install node@20
git clone <your-repo> visahobe && cd visahobe
cp .env.example .env && $EDITOR .env
npm install
npx playwright install chromium
npm run dev
```

On Apple Silicon the bundled Chromium runs natively; no Rosetta is required.

### Linux (Debian/Ubuntu)

```bash
sudo apt-get update
sudo apt-get install -y curl libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 \
  libatspi2.0-0t64 libxdamage1 libxkbcommon0 libasound2t64 libcups2t64 libdrm2 \
  libgbm1 libpango-1.0-0 libcairo2 libxcomposite1 libxrandr2 libxfixes3 libxkbfile1
git clone <your-repo> visahobe && cd visahobe
cp .env.example .env && $EDITOR .env
npm install
npx playwright install chromium
npm run dev
```

`npx playwright install --with-deps chromium` installs the system libraries for you if you have sudo.

## 2. Configure `.env`

| Variable | Required | Notes |
| --- | --- | --- |
| `JWT_SECRET` | production | `openssl rand -hex 32` |
| `ENCRYPTION_KEY` | production | encrypts provider API keys at rest |
| `WORKER_TOKEN` | production | shared secret between API and browser worker |
| `DATABASE_URL` | optional | PostgreSQL URL; empty uses the bundled SQLite file |
| `DB_FILE` | optional | SQLite path, default `./data/visahobe.db` |
| `STORAGE_DIR` | optional | private document storage, default `./data/storage` |
| `BROWSER_ALLOW_DOMAINS` | optional | comma separated allow list; empty = public hosts only |
| `BROWSER_BLOCK_DOMAINS` | optional | comma separated block list |
| `OLLAMA_BASE_URL` | optional | default `http://127.0.0.1:11434` |
| `FIRECRAWL_URL` | optional | self-hosted Firecrawl endpoint |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | optional | Google Workspace connectors |
| `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` | optional | first-run administrator |

In development the server generates ephemeral secrets and prints a warning; nothing breaks, but
sessions do not survive a restart.

## 3. Run the stack

```bash
npm run dev
```

| Process | URL | Notes |
| --- | --- | --- |
| Web app | http://localhost:5173 | proxies `/api` to the server |
| API | http://127.0.0.1:8787 | `/health` and `/ready` probes |
| Browser worker | `ws://127.0.0.1:8787/api/browser/worker` | drives local Chromium |
| Local test site | http://127.0.0.1:4599 | controlled page used by the browser tests |

Run the components separately if you prefer:

```bash
npm run dev -w @visahobe/server
npm run dev -w @visahobe/browser-worker
npm run dev -w @visahobe/web
```

## 4. Enable a local model (optional)

```bash
ollama serve
ollama pull llama3.2
```

Then open **Settings → AI providers** in the app, edit *Local Ollama*, press *Test connection* and
*Make default*. Until then the agents answer with the VisaHOBe Local Engine.

## 5. Install the PWA on a phone

1. Put the web app on your LAN (or a VPS) and open it in the phone browser.
2. **iOS**: Share → *Add to Home Screen*. The app launches standalone with the safe-area layout.
3. **Android/Chrome**: the install banner appears, or use ⋮ → *Install app*.
4. The iOS installation guide is also available inside the app under *More*.

## 6. Backups

```bash
# database + documents
tar czf visahobe-backup-$(date +%F).tgz data/
```

Restore by stopping the stack, extracting the archive over `data/` and starting it again.
