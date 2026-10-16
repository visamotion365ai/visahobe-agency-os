import { describe, expect, it, beforeAll } from 'vitest';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..', '..');

beforeAll(async () => {
  rmSync(resolve(root, 'data', 'test-suite.db'), { force: true });
  rmSync(resolve(root, 'data', 'test-suite.db-wal'), { force: true });
  rmSync(resolve(root, 'data', 'test-suite.db-shm'), { force: true });
  const { getDb, runMigrations } = await import('../src/db/index.js');
  await runMigrations(getDb());
  const { seedDatabase } = await import('../src/domain/seed.js');
  await seedDatabase();
});

describe('applicants', () => {
  it('creates an applicant with a reference and normalises the passport number', async () => {
    const { createApplicant, getApplicant } = await import('../src/domain/applicants.js');
    const applicant = await createApplicant({
      fullName: 'Ayesha Rahman',
      passportNumber: 'ab 12-3456',
      nationality: 'Bangladesh',
      dateOfBirth: '1994-03-12',
      gender: 'female',
      passportIssueDate: '2019-05-01',
      passportExpiryDate: '2027-04-30',
    });
    expect(applicant.id).toMatch(/^app_/);
    expect(applicant.reference).toMatch(/^AP-/);
    expect(applicant.passportNumberNorm).toBe('AB123456');
    const stored = await getApplicant(applicant.id);
    expect(stored?.fullName).toBe('Ayesha Rahman');
  });

  it('allows a passport correction and keeps the normalised index in sync', async () => {
    const { createApplicant, updateApplicant } = await import('../src/domain/applicants.js');
    const applicant = await createApplicant({ fullName: 'Corrected Applicant', passportNumber: 'OLD111' });
    const updated = await updateApplicant(applicant.id, {
      passportNumber: 'NEW999',
      passportExpiryDate: '2030-01-31',
    });
    expect(updated.passportNumber).toBe('NEW999');
    expect(updated.passportNumberNorm).toBe('NEW999');
    expect(updated.passportExpiryDate).toBe('2030-01-31');
  });

  it('rejects a blank name', async () => {
    const { applicantInputSchema } = await import('@visahobe/shared');
    const result = applicantInputSchema.safeParse({ fullName: '' });
    expect(result.success).toBe(false);
  });
});

describe('passport validity rules', () => {
  it('uses the default rule and warns near the threshold', async () => {
    const { evaluatePassportValidity } = await import('../src/domain/passport.js');
    const { setSetting } = await import('../src/domain/settings.js');
    await setSetting('passport_validity_rules', {
      '*|*': { months: 6, source: 'agency default policy' },
    });
    const today = new Date('2026-01-01T00:00:00Z');
    const result = await evaluatePassportValidity('2026-05-01', 'Turkey', 'Work Visa', today);
    expect(result.requiredMonths).toBe(6);
    expect(result.monthsRemaining).toBe(4);
    expect(['insufficient', 'warning']).toContain(result.status);
  });

  it('honours a country and category specific override', async () => {
    const { evaluatePassportValidity } = await import('../src/domain/passport.js');
    const { setSetting } = await import('../src/domain/settings.js');
    await setSetting('passport_validity_rules', {
      '*|*': { months: 6, source: 'agency default policy' },
      'Turkey|Work Visa': { months: 12, source: 'official checklist reviewed 2026-01-01' },
    });
    const today = new Date('2026-01-01T00:00:00Z');
    const result = await evaluatePassportValidity('2026-08-01', 'Turkey', 'Work Visa', today);
    expect(result.requiredMonths).toBe(12);
    expect(result.status).toBe('insufficient');
    expect(result.ruleConfigured).toBe(true);
  });

  it('treats an expired passport as expired', async () => {
    const { evaluatePassportValidity } = await import('../src/domain/passport.js');
    const today = new Date('2026-01-01T00:00:00Z');
    const result = await evaluatePassportValidity('2025-06-01', 'Bahrain', 'Visit Visa', today);
    expect(result.status).toBe('expired');
  });

  it('reports an unknown state when no expiry date is recorded', async () => {
    const { evaluatePassportValidity } = await import('../src/domain/passport.js');
    const result = await evaluatePassportValidity(null, 'Singapore', 'Employment Pass');
    expect(result.status).toBe('unknown');
  });
});

describe('sponsors', () => {
  it('starts unverified and records the reviewer on verification', async () => {
    const { createSponsor, markSponsorVerified, getSponsor } = await import('../src/domain/sponsors.js');
    const sponsor = await createSponsor({
      name: 'Test Employer',
      country: 'Turkey',
      verificationStatus: 'unverified',
    });
    expect(sponsor.verificationStatus).toBe('unverified');
    const verified = await markSponsorVerified(sponsor.id, 'verified', 'usr_test');
    expect(verified.verificationStatus).toBe('verified');
    expect(verified.verifiedBy).toBe('usr_test');
    expect(verified.lastVerifiedAt).toBeTruthy();
    const stored = await getSponsor(sponsor.id);
    expect(stored?.verificationStatus).toBe('verified');
  });

  it('seeds the requested sponsor presets as unverified', async () => {
    const { listSponsors } = await import('../src/domain/sponsors.js');
    const sponsors = await listSponsors();
    for (const name of [
      'RED Appointments',
      'HR Bulevar',
      'Manpower Türkiye',
      'PeopleFirst',
      'DBS Group',
      'Andaraya',
      'Al Saqib',
      'Al Nooh',
    ]) {
      const found = sponsors.find((item) => item.name === name);
      expect(found, `missing seed sponsor ${name}`).toBeTruthy();
      expect(['unverified', 'pending_verification']).toContain(found!.verificationStatus);
    }
  });
});

describe('workflow', () => {
  it('creates the ten steps and advances on completion', async () => {
    const { createApplicant } = await import('../src/domain/applicants.js');
    const { createCase, getCaseWithSteps, listSteps, setStepStatus } = await import('../src/domain/cases.js');
    const applicant = await createApplicant({ fullName: 'Workflow Applicant' });
    const created = await createCase(
      { applicantId: applicant.id, country: 'Turkey', visaCategory: 'Work Visa', priority: 'normal' },
      'usr_test',
    );
    const steps = await listSteps(created.id);
    expect(steps).toHaveLength(10);
    expect(steps[0].status).toBe('in_progress');

    await setStepStatus(created.id, 1, 'completed', { userId: 'usr_test' });
    const after = await listSteps(created.id);
    expect(after[0].status).toBe('completed');
    expect(after[1].status).toBe('in_progress');

    const detail = await getCaseWithSteps(created.id);
    expect(detail.case.currentStep).toBe(2);
  });

  it('rejects an illegal transition', async () => {
    const { assertStepTransition } = await import('../src/domain/cases.js');
    expect(() => assertStepTransition('pending', 'completed')).toThrow();
    expect(() => assertStepTransition('pending', 'in_progress')).not.toThrow();
  });
});

describe('requirements', () => {
  it('versions a requirement and supersedes the previous record', async () => {
    const { createRequirement, listRequirements } = await import('../src/domain/requirements.js');
    const first = await createRequirement({
      country: 'Malaysia',
      visaCategory: '*',
      title: 'Versioned requirement',
      category: 'general',
      mandatory: true,
    });
    expect(first.version).toBe(1);
    const second = await createRequirement({
      country: 'Malaysia',
      visaCategory: '*',
      title: 'Versioned requirement',
      category: 'general',
      mandatory: true,
    });
    expect(second.version).toBe(2);
    const current = await listRequirements({ country: 'Malaysia' });
    const versions = current.filter((item) => item.title === 'Versioned requirement');
    expect(versions).toHaveLength(1);
    expect(versions[0].id).toBe(second.id);
    expect(versions[0].version).toBe(2);

    const history = await listRequirements({ country: 'Malaysia', includeSuperseded: true });
    const archived = history.filter((item) => item.title === 'Versioned requirement');
    expect(archived).toHaveLength(2);
    expect(archived.find((item) => item.id === first.id)?.status).toBe('superseded');
  });

  it('keeps unverified requirements unverified until a reviewer confirms the source', async () => {
    const { createRequirement, verifyRequirement } = await import('../src/domain/requirements.js');
    const requirement = await createRequirement({
      country: 'Serbia',
      visaCategory: '*',
      title: 'Needs verification',
      category: 'general',
      mandatory: true,
    });
    expect(requirement.status).toBe('unverified');
    const verified = await verifyRequirement(requirement.id, { sourceUrl: 'https://example.gov/rule' });
    expect(verified.status).toBe('verified');
    expect(verified.sourceUrl).toBe('https://example.gov/rule');
  });
});

describe('browser planner and url policy', () => {
  it('turns a compound instruction into ordered steps', async () => {
    const { heuristicPlan } = await import('../src/browser/planner.js');
    const steps = heuristicPlan(
      'go to http://127.0.0.1:4599/index.html and fill Full name with Ayesha Rahman and screenshot',
    );
    expect(steps[0].kind).toBe('navigate');
    expect(steps[0].url).toBe('http://127.0.0.1:4599/index.html');
    const fill = steps.find((step) => step.action?.kind === 'fill');
    expect(fill?.action).toMatchObject({ kind: 'fill', label: 'Full name', value: 'Ayesha Rahman' });
    expect(steps.some((step) => step.kind === 'screenshot')).toBe(true);
  });

  it('refuses private, loopback and metadata destinations', async () => {
    const { assertUrlAllowed, UrlBlockedError } = await import('../src/browser/ssrf.js');
    const { env } = await import('../src/env.js');
    const allow = env.allowDomains;
    env.allowDomains = [];
    try {
      await expect(assertUrlAllowed('http://127.0.0.1:22/')).rejects.toBeInstanceOf(UrlBlockedError);
      await expect(assertUrlAllowed('http://169.254.169.254/latest/meta-data/')).rejects.toBeInstanceOf(UrlBlockedError);
      await expect(assertUrlAllowed('file:///etc/passwd')).rejects.toBeInstanceOf(UrlBlockedError);
      await expect(assertUrlAllowed('http://10.0.0.5/')).rejects.toBeInstanceOf(UrlBlockedError);
      await expect(assertUrlAllowed('http://localhost:4599/')).rejects.toBeInstanceOf(UrlBlockedError);
    } finally {
      env.allowDomains = allow;
    }
  });

  it('allows an allow-listed host', async () => {
    const { assertUrlAllowed } = await import('../src/browser/ssrf.js');
    const url = await assertUrlAllowed('http://127.0.0.1:4599/index.html');
    expect(url.hostname).toBe('127.0.0.1');
  });

  it('classifies private address ranges', async () => {
    const { isPrivateAddress } = await import('../src/browser/ssrf.js');
    expect(isPrivateAddress('127.0.0.1')).toBe(true);
    expect(isPrivateAddress('10.1.2.3')).toBe(true);
    expect(isPrivateAddress('172.16.0.1')).toBe(true);
    expect(isPrivateAddress('192.168.1.1')).toBe(true);
    expect(isPrivateAddress('169.254.169.254')).toBe(true);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
  });
});

describe('document generation', () => {
  it('produces a PDF and a DOCX and marks drafts explicitly', async () => {
    const { createApplicant } = await import('../src/domain/applicants.js');
    const { createCase } = await import('../src/domain/cases.js');
    const { buildCaseBundle } = await import('../src/routes/documents.js');
    const { TEMPLATES, isDraftTemplate } = await import('../src/services/docs/templates.js');
    const { modelToHtml } = await import('../src/services/docs/html.js');
    const { modelToDocx } = await import('../src/services/docs/docx.js');
    const { htmlToPdf } = await import('../src/services/docs/render.js');

    const applicant = await createApplicant({
      fullName: 'Document Applicant',
      passportNumber: 'PP1234567',
      passportExpiryDate: '2029-01-01',
    });
    const created = await createCase(
      { applicantId: applicant.id, country: 'Saudi Arabia', visaCategory: 'Work Visa', priority: 'normal' },
      'usr_test',
    );
    const bundle = await buildCaseBundle(created.id);
    const model = TEMPLATES.cover_letter.build(bundle);
    expect(isDraftTemplate('cover_letter')).toBe(true);
    const html = modelToHtml(model);
    expect(html).toContain('DRAFT');
    expect(html).toContain('Document Applicant');
    const docx = await modelToDocx(model);
    expect(docx.length).toBeGreaterThan(1000);
    const pdf = await htmlToPdf(html);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });
});

describe('provider configuration', () => {
  it('stores the API key encrypted and never returns it', async () => {
    const { createProvider, listProviders, getProviderWithSecret } = await import('../src/domain/providers.js');
    const created = await createProvider({
      name: 'Test Provider',
      kind: 'openai',
      model: 'gpt-test',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'super-secret-value',
    });
    expect(created.hasApiKey).toBe(true);
    expect(JSON.stringify(created)).not.toContain('super-secret-value');
    const listed = await listProviders();
    expect(JSON.stringify(listed)).not.toContain('super-secret-value');
    const withSecret = await getProviderWithSecret(created.id);
    expect(withSecret?.apiKey).toBe('super-secret-value');
  });

  it('validates the provider input schema', async () => {
    const { providerInputSchema } = await import('@visahobe/shared');
    expect(providerInputSchema.safeParse({ name: 'OpenAI key', kind: 'openai', model: '' }).success).toBe(false);
    expect(providerInputSchema.safeParse({ name: 'Local model', kind: 'ollama', model: 'llama3.2' }).success).toBe(true);
  });
});
