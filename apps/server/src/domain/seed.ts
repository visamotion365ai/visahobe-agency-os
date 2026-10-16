import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { nowIso } from '../lib/rows.js';
import { createUser, getUserByEmail } from './users.js';
import { seedAgents } from './agents.js';
import { seedSkills } from './skills.js';
import { seedOllamaProviderIfMissing } from './providers.js';
import { createSponsor, listSponsors } from './sponsors.js';
import { createRequirement, listRequirements } from './requirements.js';
import { env } from '../env.js';
import { COUNTRIES } from '@visahobe/shared';

/** Sponsor names supplied by the agency. Legal details still have to be confirmed. */
const SPONSOR_PRESETS: Array<{ name: string; country: string; type?: string }> = [
  { name: 'RED Appointments', country: 'To be confirmed', type: 'Recruitment / job placement' },
  { name: 'HR Bulevar', country: 'To be confirmed', type: 'Human resources / job placement' },
  { name: 'Manpower Türkiye', country: 'Turkey', type: 'Recruitment / staffing' },
  { name: 'PeopleFirst', country: 'To be confirmed', type: 'Recruitment / job placement' },
  { name: 'DBS Group', country: 'Singapore', type: 'Group employer' },
  { name: 'Andaraya', country: 'To be confirmed', type: 'Employer' },
  { name: 'Al Saqib', country: 'To be confirmed', type: 'Employer' },
  { name: 'Al Nooh', country: 'To be confirmed', type: 'Employer' },
];

/** Official government home pages used as the starting point for requirement research. */
const OFFICIAL_PORTALS: Record<string, string> = {
  Australia: 'https://immi.homeaffairs.gov.au',
  Serbia: 'https://www.mfa.gov.rs',
  Russia: 'https://mid.ru',
  Turkey: 'https://www.mfa.gov.tr',
  Singapore: 'https://www.mom.gov.sg',
  Malaysia: 'https://www.imi.gov.my',
  'Saudi Arabia': 'https://www.mofa.gov.sa',
  Bahrain: 'https://www.mofa.gov.bh',
};

const SEED_REQUIREMENTS: Array<{
  title: string;
  category: string;
  description: string;
}> = [
  {
    title: 'Valid passport with sufficient remaining validity',
    category: 'identity',
    description:
      'A passport that is valid on the intended travel date. The minimum remaining validity is an agency-configurable rule and must be confirmed against the official checklist for the specific visa category.',
  },
  {
    title: 'Completed application form / online application',
    category: 'application',
    description: 'The official application form for the destination country and visa category.',
  },
  {
    title: 'Passport size photographs',
    category: 'identity',
    description: 'Recent photographs meeting the official size and background requirements.',
  },
  {
    title: 'Proof of financial capacity',
    category: 'financial',
    description: 'Bank statements or equivalent evidence required by the official checklist.',
  },
];

export async function seedDatabase(): Promise<void> {
  const db = getDb();

  const admin = await getUserByEmail(env.BOOTSTRAP_ADMIN_EMAIL);
  if (!admin) {
    await createUser({
      email: env.BOOTSTRAP_ADMIN_EMAIL,
      password: env.BOOTSTRAP_ADMIN_PASSWORD!,
      name: env.BOOTSTRAP_ADMIN_NAME,
      role: 'admin',
    });
  }

  await seedAgents();
  await seedSkills();
  await seedOllamaProviderIfMissing();

  const existingSponsors = await listSponsors();
  for (const preset of SPONSOR_PRESETS) {
    if (existingSponsors.some((s) => s.name.toLowerCase() === preset.name.toLowerCase())) continue;
    await createSponsor({
      name: preset.name,
      legalName: '',
      country: preset.country,
      jurisdiction: '',
      registrationId: '',
      website: '',
      sourceUrl: '',
      contactPerson: '',
      email: '',
      phone: '',
      sponsorType: preset.type ?? '',
      verificationStatus: 'unverified',
      notes:
        'Seed record created from the agency sponsor list. Legal name, registration identifier, country and official contacts have NOT been verified and must be confirmed by a staff member before use.',
    });
  }

  const existingRequirements = await listRequirements({ includeSuperseded: true });
  for (const country of COUNTRIES) {
    for (const item of SEED_REQUIREMENTS) {
      const exists = existingRequirements.some(
        (r) => r.country === country && r.visaCategory === '*' && r.title === item.title,
      );
      if (exists) continue;
      await createRequirement({
        country,
        visaCategory: '*',
        title: item.title,
        description: item.description,
        category: item.category,
        mandatory: true,
        sourceUrl: OFFICIAL_PORTALS[country] ?? '',
        sourceTitle: `${country} — official government portal (starting point for verification)`,
        verifiedAt: '',
        effectiveDate: '',
      });
    }
  }

  // Passport validity defaults are configuration, not law.
  const { getSetting, setSetting } = await import('./settings.js');
  const rules = await getSetting<Record<string, unknown>>('passport_validity_rules', {});
  if (!Object.keys(rules).length) {
    await setSetting('passport_validity_rules', {
      '*|*': {
        months: env.PASSPORT_VALIDITY_MONTHS,
        source: 'agency default policy — confirm per country and visa category before use',
      },
    });
  }

  const now = nowIso();
  await db.run('INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)', [
    'seed_version',
    JSON.stringify('1.0.0'),
    now,
  ]);
  void newId;
}
