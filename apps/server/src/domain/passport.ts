import { env } from '../env.js';
import { getSetting } from './settings.js';
import { addMonths, monthsBetween, parseDate, todayUtc } from '../lib/date.js';

export interface ValidityRule {
  months: number;
  source: string;
  configured: boolean;
}

/**
 * Passport validity rules are configurable per country + visa category.
 * The six month figure is a common (not universal) rule, so it is stored as
 * configuration rather than hard-coded law.
 */
export async function getValidityRule(
  country: string,
  visaCategory: string,
): Promise<ValidityRule> {
  const rules = await getSetting<Record<string, { months: number; source?: string }>>(
    'passport_validity_rules',
    {},
  );
  const exact = rules[`${country}|${visaCategory}`];
  if (exact?.months) {
    return { months: exact.months, source: exact.source ?? 'agency configuration', configured: true };
  }
  const countryWide = rules[`${country}|*`];
  if (countryWide?.months) {
    return { months: countryWide.months, source: countryWide.source ?? 'agency configuration', configured: true };
  }
  const global = rules['*|*'];
  if (global?.months) {
    return { months: global.months, source: global.source ?? 'agency configuration', configured: true };
  }
  return {
    months: env.PASSPORT_VALIDITY_MONTHS,
    source: 'default agency policy (not a legal determination)',
    configured: false,
  };
}

export interface ValidityResult {
  expiryDate: string | null;
  monthsRemaining: number | null;
  daysRemaining: number | null;
  requiredMonths: number;
  ruleSource: string;
  ruleConfigured: boolean;
  status: 'unknown' | 'valid' | 'warning' | 'expired' | 'insufficient';
  message: string;
}

export async function evaluatePassportValidity(
  expiryDate: string | null | undefined,
  country: string,
  visaCategory: string,
  referenceDate = todayUtc(),
): Promise<ValidityResult> {
  const rule = await getValidityRule(country, visaCategory);
  const expiry = parseDate(expiryDate);
  if (!expiry) {
    return {
      expiryDate: expiryDate ?? null,
      monthsRemaining: null,
      daysRemaining: null,
      requiredMonths: rule.months,
      ruleSource: rule.source,
      ruleConfigured: rule.configured,
      status: 'unknown',
      message: 'Passport expiry date is missing — cannot evaluate validity.',
    };
  }
  const monthsRemaining = monthsBetween(referenceDate, expiry);
  const daysRemaining = Math.floor((expiry.getTime() - referenceDate.getTime()) / 86_400_000);
  const threshold = addMonths(referenceDate, rule.months);
  let status: ValidityResult['status'];
  let message: string;
  if (daysRemaining < 0) {
    status = 'expired';
    message = `Passport expired ${Math.abs(daysRemaining)} day(s) ago.`;
  } else if (expiry.getTime() < threshold.getTime()) {
    status = 'insufficient';
    message = `Only ${monthsRemaining} month(s) of validity remain; the configured rule for ${country} / ${visaCategory} requires ${rule.months} month(s).`;
  } else if (monthsRemaining <= rule.months + 3) {
    status = 'warning';
    message = `${monthsRemaining} month(s) of validity remain — close to the configured ${rule.months} month rule.`;
  } else {
    status = 'valid';
    message = `${monthsRemaining} month(s) of validity remain (rule: ${rule.months} month(s)).`;
  }
  return {
    expiryDate: expiry.toISOString().slice(0, 10),
    monthsRemaining,
    daysRemaining,
    requiredMonths: rule.months,
    ruleSource: rule.source,
    ruleConfigured: rule.configured,
    status,
    message,
  };
}
