# Deployment

## 1. Docker Compose (recommended)

```bash
cp .env.example .env
# set at least JWT_SECRET, ENCRYPTION_KEY, WORKER_TOKEN
docker compose up -d --build
docker compose --profile postgres up -d    # optional PostgreSQL
docker compose --profile ollama up -d     # optional local model
```

* `web` → nginx on port 8080, proxies `/api` (including the WebSocket upgrade) to `api`.
* `api` → Fastify on 8787, data in the `visahobe-data` volume.
* `worker` → Playwright image with `shm_size: 1gb` (Chromium needs more than the default 64 MB).

## 2. Behind a reverse proxy (public deployment)

```nginx
server {
  listen 443 ssl http2;
  server_name agency.example.com;

  ssl_certificate     /etc/letsencrypt/live/agency.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/agency.example.com/privkey.pem;

  client_max_body_size 30M;

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Add `ALLOWED_ORIGINS=https://agency.example.com` and `TRUST_PROXY=true` to `.env`.

Caddy works with almost no configuration:

```
agency.example.com {
  reverse_proxy 127.0.0.1:8080
}
```

## 3. Mobile access from outside the office

The PWA talks to the API over HTTPS/WebSocket, so a normal public hostname is enough. The **browser
worker** stays on your infrastructure:

* **Single host** — run the API and the worker on the same machine (simplest).
* **Private server** — run both in Docker on a VPS you control.
* **Remote worker** — run the worker at the office and point the API at it over a private network
  (WireGuard/Tailscale) by setting `WORKER_URL=ws://office.tailnet:8787/api/browser/worker` on the
  API and the matching URL on the worker. The worker authenticates with `WORKER_TOKEN`.

## 4. PostgreSQL

```bash
docker compose --profile postgres up -d
# in .env
DATABASE_URL=postgres://visahobe:<password>@postgres:5432/visahobe
```

Migrations run automatically on start and are recorded in `schema_migrations`.

## 5. Backup and restore

```bash
# PostgreSQL
docker compose exec postgres pg_dump -U visahobe visahobe > backup.sql

# SQLite + documents
docker run --rm -v visahobe-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/visahobe-data.tgz -C /data .
```

Restore by stopping the stack, restoring the database and the `data/storage` tree, then starting it.
Documents are content-addressed by random key, so restoring the storage tree as-is is sufficient.

## 6. Upgrades

```bash
git pull
docker compose up -d --build
```

Migrations are applied at boot. Take a backup first — migrations are additive in this release, but
backups are cheap.

## 7. Health checks

* `GET /health` — liveness.
* `GET /ready` — readiness: database reachable, browser worker state, AI provider state.

Use `/ready` for load-balancer checks; it reports `browserWorker: connected | not_connected` without
failing when no worker is deployed.
