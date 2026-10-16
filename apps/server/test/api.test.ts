import { beforeAll, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..', '..');

let app: any;
let token = '';
let staffToken = '';
let viewerToken = '';
let applicantId = '';
let caseId = '';

beforeAll(async () => {
  rmSync(resolve(root, 'data', 'test-suite.db'), { force: true });
  const { getDb, runMigrations } = await import('../src/db/index.js');
  await runMigrations(getDb());
  const { seedDatabase } = await import('../src/domain/seed.js');
  await seedDatabase();
  const { buildServer } = await import('../src/index.js');
  app = await buildServer();
  await app.ready();

  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'admin@test.local', password: 'TestPassword!2024' },
  });
  token = login.json().token;

  const { createUser } = await import('../src/domain/users.js');
  await createUser({ email: 'staff@test.local', password: 'TestPassword!2024', name: 'Staff User', role: 'staff' });
  await createUser({ email: 'viewer@test.local', password: 'TestPassword!2024', name: 'Viewer User', role: 'viewer' });
  staffToken = (
    await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'staff@test.local', password: 'TestPassword!2024' },
    })
  ).json().token;
  viewerToken = (
    await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'viewer@test.local', password: 'TestPassword!2024' },
    })
  ).json().token;
});

const auth = (value: string) => ({ authorization: `Bearer ${value}` });

describe('authentication and security boundaries', () => {
  it('rejects a wrong password', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@test.local', password: 'wrong-password' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('refuses unauthenticated access to applicant data', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/applicants' });
    expect(response.statusCode).toBe(401);
  });

  it('refuses an invalid token', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/applicants', headers: auth('not-a-token') });
    expect(response.statusCode).toBe(401);
  });

  it('keeps provider administration away from non-admin roles', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/providers',
      headers: auth(staffToken),
      payload: { name: 'Should not work', kind: 'openai', model: 'x' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('keeps approval review away from viewers', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/approvals',
      headers: auth(staffToken),
      payload: { kind: 'portal_submission', title: 'Submit application' },
    });
    expect(created.statusCode).toBe(200);
    const id = created.json().approval.id;
    const rejected = await app.inject({
      method: 'POST',
      url: `/api/approvals/${id}/review`,
      headers: auth(viewerToken),
      payload: { status: 'approved' },
    });
    expect(rejected.statusCode).toBe(403);
    const approved = await app.inject({
      method: 'POST',
      url: `/api/approvals/${id}/review`,
      headers: auth(staffToken),
      payload: { status: 'approved', note: 'Reviewed by the case officer' },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().approval.status).toBe('approved');
    expect(approved.json().approval.reviewedBy).toBeTruthy();
  });

  it('blocks SSRF targets on the browser navigation endpoint', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/browser/sessions/does-not-exist/navigate',
      headers: auth(token),
      payload: { url: 'http://169.254.169.254/latest/meta-data/' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/private|metadata|allow/i);
  });
});

describe('applicant and case workflow over HTTP', () => {
  it('creates and updates an applicant', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/applicants',
      headers: auth(token),
      payload: {
        fullName: 'HTTP Applicant',
        passportNumber: 'HT123456',
        nationality: 'Bangladesh',
        passportExpiryDate: '2028-06-30',
      },
    });
    expect(created.statusCode).toBe(200);
    applicantId = created.json().applicant.id;

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/applicants/${applicantId}`,
      headers: auth(token),
      payload: { passportNumber: 'HT7654321', passportExpiryDate: '2029-01-31' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().applicant.passportNumber).toBe('HT7654321');
    expect(updated.json().applicant.passportNumberNorm).toBe('HT7654321');
  });

  it('creates a case with the ten step workflow and advances it', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/cases',
      headers: auth(token),
      payload: { applicantId, country: 'Turkey', visaCategory: 'Work Visa', priority: 'normal' },
    });
    expect(created.statusCode).toBe(200);
    caseId = created.json().case.id;
    expect(created.json().steps).toHaveLength(10);

    const stepped = await app.inject({
      method: 'POST',
      url: `/api/cases/${caseId}/steps/1`,
      headers: auth(token),
      payload: { status: 'completed' },
    });
    expect(stepped.statusCode).toBe(200);
    expect(stepped.json().step.status).toBe('completed');

    // Step 4 is still pending — completing a pending step is not a legal transition.
    const illegal = await app.inject({
      method: 'POST',
      url: `/api/cases/${caseId}/steps/4`,
      headers: auth(token),
      payload: { status: 'completed' },
    });
    expect(illegal.statusCode).toBe(400);
    expect(illegal.json().error.message).toMatch(/Illegal workflow transition/);
  });

  it('evaluates the passport validity of the case', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/cases/${caseId}/passport-validity`,
      headers: auth(token),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().validity.requiredMonths).toBeGreaterThan(0);
    expect(response.json().validity.message).toBeTruthy();
  });
});

describe('document vault', () => {
  it('stores an upload privately and serves it only with a valid session and signature', async () => {
    const boundary = '----visahobetest';
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="passport.txt"',
      'Content-Type: text/plain',
      '',
      'PASSPORT DATA',
      `--${boundary}`,
      'Content-Disposition: form-data; name="category"',
      '',
      'passport',
      `--${boundary}`,
      'Content-Disposition: form-data; name="caseId"',
      '',
      caseId,
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const upload = await app.inject({
      method: 'POST',
      url: '/api/documents',
      headers: { ...auth(token), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(upload.statusCode).toBe(201);
    const document = upload.json().document;
    expect(document.category).toBe('passport');
    expect(document.downloadUrl).toContain('/api/files/download?token=');

    const unauthenticated = await app.inject({ method: 'GET', url: document.downloadUrl });
    expect(unauthenticated.statusCode).toBe(401);

    const tampered = await app.inject({
      method: 'GET',
      url: `/api/files/download?token=${encodeURIComponent('forged.token')}`,
      headers: auth(token),
    });
    expect(tampered.statusCode).toBe(400);

    const download = await app.inject({ method: 'GET', url: document.downloadUrl, headers: auth(token) });
    expect(download.statusCode).toBe(200);
    expect(download.body).toContain('PASSPORT DATA');
  });

  it('rejects a disallowed file type', async () => {
    const boundary = '----visahobetest2';
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="payload.exe"',
      'Content-Type: application/x-msdownload',
      '',
      'MZ',
      `--${boundary}--`,
      '',
    ].join('\r\n');
    const response = await app.inject({
      method: 'POST',
      url: '/api/documents',
      headers: { ...auth(token), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(response.statusCode).toBe(400);
  });

  it('generates the real case documents', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/cases/${caseId}/documents/generate`,
      headers: auth(staffToken),
      payload: { template: 'dossier' },
    });
    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.documents).toHaveLength(2);
    expect(payload.html).toContain('Applicant Case Dossier');
    expect(payload.html).toContain('Confidential');
    expect(payload.documents[0].size).toBeGreaterThan(500);
  });

  it('marks draft templates as drafts', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/cases/${caseId}/documents/generate`,
      headers: auth(staffToken),
      payload: { template: 'cover_letter' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().html).toContain('DRAFT');
    expect(response.json().model.title).toBe('Cover Letter');
  });
});

describe('agents over HTTP', () => {
  it('answers with the grounded local engine when no provider is reachable', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/chat',
      headers: auth(token),
      payload: { agentKey: 'maestro', message: 'What is the next step?', caseId },
    });
    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.content).toContain('VM-');
    expect(payload.toolsUsed).toContain('get_case');
    expect(payload.usedLocalEngine).toBe(true);
  });

  it('records the conversation and the task', async () => {
    const messages = await app.inject({ method: 'GET', url: '/api/conversations/x/messages', headers: auth(token) });
    expect([200, 404]).toContain(messages.statusCode);

    const tasks = await app.inject({ method: 'GET', url: '/api/tasks?limit=5', headers: auth(token) });
    expect(tasks.statusCode).toBe(200);
    expect(tasks.json().tasks.length).toBeGreaterThan(0);
  });

  it('lists agent tasks by agent key and by agent id', async () => {
    const byKey = await app.inject({
      method: 'GET',
      url: '/api/tasks?agentId=maestro',
      headers: auth(token),
    });
    expect(byKey.statusCode).toBe(200);
    expect(byKey.json().tasks.length).toBeGreaterThan(0);

    const agents = await app.inject({ method: 'GET', url: '/api/agents', headers: auth(token) });
    const raffi = agents.json().agents.find((agent: any) => agent.key === 'maestro');
    const byId = await app.inject({
      method: 'GET',
      url: `/api/tasks?agentId=${raffi.id}`,
      headers: auth(token),
    });
    expect(byId.json().tasks.length).toBe(byKey.json().tasks.length);

    const unknown = await app.inject({
      method: 'GET',
      url: '/api/tasks?agentId=does-not-exist',
      headers: auth(token),
    });
    expect(unknown.json().tasks).toEqual([]);
  });

  it('cancels a task', async () => {
    const tasks = await app.inject({ method: 'GET', url: '/api/tasks?limit=1', headers: auth(token) });
    const id = tasks.json().tasks[0].id;
    const response = await app.inject({ method: 'POST', url: `/api/tasks/${id}/cancel`, headers: auth(token) });
    expect(response.statusCode).toBe(200);
    const after = await app.inject({ method: 'GET', url: `/api/tasks/${id}`, headers: auth(token) });
    expect(after.json().task.status).toBe('cancelled');
  });
});

describe('browser endpoints without a worker', () => {
  it('reports that no worker is connected instead of pretending to be online', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/browser/status', headers: auth(token) });
    expect(response.statusCode).toBe(200);
    expect(response.json().worker.connected).toBe(false);
  });

  it('refuses to create a session while the worker is offline', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/browser/sessions',
      headers: auth(token),
      payload: { label: 'test' },
    });
    expect(response.statusCode).toBe(503);
  });
});
