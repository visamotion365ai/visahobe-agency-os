import { env } from '../../env.js';
import { decryptSecret, encryptSecret } from '../../lib/crypto.js';
import { getDb } from '../../db/index.js';
import { newId } from '../../lib/ids.js';
import { nowIso } from '../../lib/rows.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/gmail.compose',
];

export interface GoogleConnection {
  id: string;
  status: 'disconnected' | 'connected' | 'expired' | 'error';
  accountEmail: string | null;
  scopes: string[] | null;
  tokenEnc: string | null;
  refreshEnc: string | null;
  meta: Record<string, unknown> | null;
}

export function isGoogleConfigured(): boolean {
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export function googleScopes(): string[] {
  return SCOPES;
}

export function googleAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: env.GOOGLE_REDIRECT_URI ?? '',
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES.join(' '),
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function tokenRequest(body: Record<string, string>): Promise<any> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error_description || json?.error || 'Token request failed');
  return json;
}

export async function exchangeCode(code: string): Promise<void> {
  const json = await tokenRequest({
    code,
    client_id: env.GOOGLE_CLIENT_ID ?? '',
    client_secret: env.GOOGLE_CLIENT_SECRET ?? '',
    redirect_uri: env.GOOGLE_REDIRECT_URI ?? '',
    grant_type: 'authorization_code',
  });
  await saveConnection({
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    scopes: String(json.scope ?? SCOPES.join(' ')).split(' ').filter(Boolean),
  });
}

export async function saveConnection(input: {
  accessToken: string;
  refreshToken?: string;
  scopes?: string[];
  accountEmail?: string;
}): Promise<void> {
  const db = getDb();
  const now = nowIso();
  const existing = await db.get('SELECT * FROM integration_connections WHERE provider = ?', ['google']);
  const values = [
    'connected',
    input.accountEmail ?? null,
    JSON.stringify(input.scopes ?? SCOPES),
    encryptSecret(input.accessToken),
    input.refreshToken ? encryptSecret(input.refreshToken) : existing?.refresh_enc ?? null,
    JSON.stringify({ connectedAt: now }),
  ];
  if (existing) {
    await db.run(
      `UPDATE integration_connections SET status = ?, account_email = ?, scopes = ?, token_enc = ?, refresh_enc = ?, meta = ?, updated_at = ? WHERE id = ?`,
      [...values, now, existing.id],
    );
  } else {
    await db.run(
      `INSERT INTO integration_connections (id, provider, status, account_email, scopes, token_enc, refresh_enc, meta, created_at, updated_at)
       VALUES (?, 'google', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId('int'), ...values, now, now],
    );
  }
}

export async function getConnection(provider = 'google'): Promise<GoogleConnection | null> {
  const row = await getDb().get('SELECT * FROM integration_connections WHERE provider = ?', [provider]);
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    accountEmail: row.account_email,
    scopes: row.scopes ? String(row.scopes).split(' ').filter(Boolean) : null,
    tokenEnc: row.token_enc,
    refreshEnc: row.refresh_enc,
    meta: row.meta ? JSON.parse(row.meta) : null,
  };
}

export async function disconnect(provider = 'google'): Promise<void> {
  const db = getDb();
  const now = nowIso();
  const existing = await db.get('SELECT id FROM integration_connections WHERE provider = ?', [provider]);
  if (existing) {
    await db.run(
      `UPDATE integration_connections SET status = 'disconnected', token_enc = NULL, refresh_enc = NULL, updated_at = ? WHERE id = ?`,
      [now, existing.id],
    );
  }
}

export async function getAccessToken(): Promise<string> {
  const connection = await getConnection();
  if (!connection?.tokenEnc) throw new Error('Google is not connected');
  try {
    return decryptSecret(connection.tokenEnc);
  } catch {
    throw new Error('Stored Google token could not be decrypted');
  }
}

async function googleFetch(url: string, init: RequestInit = {}): Promise<any> {
  const token = await getAccessToken();
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': (init.headers as Record<string, string> | undefined)?.['content-type'] ?? 'application/json' } : {}),
    },
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(json?.error?.message ?? `Google API error ${res.status}`);
  return json;
}

export async function createDriveFolder(name: string): Promise<string> {
  const json = await googleFetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' }),
  });
  return json.id;
}

export async function uploadFileToDrive(
  name: string,
  mimeType: string,
  data: Buffer,
  folderId?: string,
): Promise<string> {
  const boundary = `vh-${Date.now().toString(36)}`;
  const metadata = { name, mimeType, ...(folderId ? { parents: [folderId] } : {}) };
  const head = `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
    metadata,
  )}\r\n--${boundary}\r\ncontent-type: ${mimeType}\r\n\r\n`;
  const body = Buffer.concat([
    Buffer.from(head, 'utf8'),
    data,
    Buffer.from(`\r\n--${boundary}--`, 'utf8'),
  ]);
  const json = await googleFetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: { 'content-type': `multipart/related; boundary=${boundary}` },
      body,
    },
  );
  return json.id;
}

export async function createGoogleDoc(title: string, bodyText: string): Promise<string> {
  const json = await googleFetch('https://www.googleapis.com/docs/v1/documents', {
    method: 'POST',
    body: JSON.stringify({
      title,
      body: { content: [ { paragraph: { elements: [ { textRun: { content: bodyText } } ] } } ] },
    }),
  });
  return json.documentId;
}

export async function createGmailDraft(input: {
  to: string;
  subject: string;
  body: string;
}): Promise<string> {
  const raw = [
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    input.body,
  ].join('\n');
  const encoded = Buffer.from(raw, 'utf8').toString('base64url');
  const json = await googleFetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
    method: 'POST',
    body: JSON.stringify({ message: { raw: encoded } }),
  });
  return json.id;
}
