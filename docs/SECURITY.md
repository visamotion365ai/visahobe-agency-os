# Security notes

VisaHOBe handles passport scans, personal identifiers and government paperwork. Treat the deployment
as sensitive: run it on hardware you control, behind TLS, with a strong `WORKER_TOKEN`.

## Authentication

* Passwords are hashed with **scrypt** (N=16384, r=8, p=1) and a per-user random salt.
* Sessions are HMAC-SHA256 signed tokens in an `httpOnly`, `SameSite=Lax` cookie (`Secure` in production).
* WebSocket handshakes use a separate **15-minute** token issued by `GET /api/auth/ws-token`.
* Roles: `admin` (everything, incl. providers and users), `staff` (cases, documents, approvals,
  browser tasks), `viewer` (read-only).

## Browser worker

* The worker authenticates with `WORKER_TOKEN`; an unauthenticated socket is closed with code 4401.
* **No DevTools port is exposed.** The worker is a library consumer of Playwright, not a CDP server.
* Natural-language tasks cannot execute shell commands — the planner only emits a fixed action
  vocabulary.
* **SSRF protection**: only `http`/`https`; hostnames are resolved and refused when they point at
  loopback, private, link-local or cloud-metadata ranges (`169.254.169.254`, `metadata.google.internal`,
  `10/8`, `172.16/12`, `192.168/16`, `::1`, `fc00::/7`). `BROWSER_ALLOW_DOMAINS` is the only way to
  permit a private target, and it is enforced on both the API and the worker.
* A block list (`BROWSER_BLOCK_DOMAINS`) is applied before the allow list.
* Task timeouts, per-session browser contexts and automatic cleanup bound the damage of a bad task.
* **The agent never bypasses CAPTCHAs, MFA or access controls.** *Pause* exists so a human can
  complete a challenge in the live session.
* **Consequential actions** (final portal submission, payments, account changes) require explicit human
  confirmation — the approval record and reviewer are stored.

## Secrets

* Provider API keys are encrypted at rest with AES-256-GCM (key derived from `ENCRYPTION_KEY`).
* Secrets never appear in the frontend bundle, in browser storage, or in logs. The Fastify logger
  redacts `authorization`, `cookie` and the worker token header.
* `GET /api/providers` returns `hasApiKey: true/false` — never the key.
* Log and transcript text is redacted (bearer tokens, e-mail addresses, long digit runs).

## Documents

* Files live outside the web root in a private directory with `0600` permissions.
* Downloads need **both** a valid session and a short-lived HMAC-signed token; a forged or expired
  token is rejected.
* Uploads are validated by MIME type and size (25 MB default) and stored with a random name; the
  original filename is only metadata.
* The service worker caches the application shell and static assets **only**. API responses, private
  documents and tokens are never written to a cache.

## Network exposure

* Terminate TLS in front of the API (nginx, Caddy, Traefik). The app itself expects a reverse proxy.
* Set `ALLOWED_ORIGINS` to the exact public origins. Same-host requests are always allowed so
  preview and tunnel hosts keep working.
* Set `TRUST_PROXY=true` when running behind a proxy you control.
* Keep the worker on the same private network as the API. It needs outbound internet access for the
  portals it is allowed to visit, but it should never be published to the internet.

## Reporting

Please report issues privately to the agency operator. Do not include applicant documents in a report.
