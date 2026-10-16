import { listApplicants } from './applicants.js';
import { getCaseWithSteps, listCases, listSteps } from './cases.js';
import { listDocuments } from './documents.js';
import { evaluatePassportValidity } from './passport.js';
import { listRequirements, listRequirementChecks } from './requirements.js';
import { listSponsors } from './sponsors.js';
import { WORKFLOW_STEPS } from '@visahobe/shared';

export interface ToolContext {
  userId: string;
  agentKey: string;
  caseId?: string | null;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
}

async function resolveCaseId(args: Record<string, unknown>, ctx: ToolContext): Promise<string | null> {
  if (typeof args.caseId === 'string' && args.caseId) return args.caseId;
  if (typeof args.reference === 'string' && args.reference) {
    const { items } = await listCases({ q: args.reference, pageSize: 5 });
    return items[0]?.id ?? null;
  }
  if (ctx.caseId) return ctx.caseId;
  return null;
}

async function resolveApplicantId(args: Record<string, unknown>): Promise<string | null> {
  if (typeof args.applicantId === 'string' && args.applicantId) return args.applicantId;
  if (typeof args.applicantName === 'string' && args.applicantName) {
    const { items } = await listApplicants({ q: args.applicantName, pageSize: 5 });
    return items[0]?.id ?? null;
  }
  return null;
}

export const TOOLS: Tool[] = [
  {
    name: 'get_case',
    description:
      'Fetch a visa case with its applicant, sponsor and the status of all ten workflow steps. Use a caseId or a case reference such as VM-XXXX.',
    parameters: {
      type: 'object',
      properties: {
        caseId: { type: 'string', description: 'Internal case id' },
        reference: { type: 'string', description: 'Case reference, e.g. VM-7K3D92' },
      },
    },
    async execute(args, ctx) {
      const caseId = await resolveCaseId(args, ctx);
      if (!caseId) return { error: 'No case resolved. Provide caseId or reference.' };
      return getCaseWithSteps(caseId);
    },
  },
  {
    name: 'list_cases',
    description: 'List visa cases, optionally filtered by country or a free-text query (name or reference).',
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string' },
        country: { type: 'string' },
        limit: { type: 'integer' },
      },
    },
    async execute(args) {
      const { items, total } = await listCases({
        q: typeof args.q === 'string' ? args.q : undefined,
        country: typeof args.country === 'string' ? args.country : undefined,
        pageSize: Math.min(25, Number(args.limit) || 10),
      });
      return { total, items };
    },
  },
  {
    name: 'list_requirements',
    description:
      'List the stored, source-linked visa requirements for a country and visa category, including verification state and source URL.',
    parameters: {
      type: 'object',
      properties: {
        country: { type: 'string' },
        visaCategory: { type: 'string' },
      },
    },
    async execute(args) {
      const country = typeof args.country === 'string' ? args.country : undefined;
      const visaCategory = typeof args.visaCategory === 'string' ? args.visaCategory : undefined;
      const items = await listRequirements({ country, visaCategory });
      return { count: items.length, items };
    },
  },
  {
    name: 'list_documents',
    description: 'List documents stored for a case or an applicant, including OCR status and category.',
    parameters: {
      type: 'object',
      properties: {
        caseId: { type: 'string' },
        applicantId: { type: 'string' },
        category: { type: 'string' },
      },
    },
    async execute(args, ctx) {
      const caseId = await resolveCaseId(args, ctx);
      const applicantId = await resolveApplicantId(args);
      const items = await listDocuments({
        caseId: caseId ?? undefined,
        applicantId: applicantId ?? undefined,
        category: typeof args.category === 'string' ? args.category : undefined,
      });
      return {
        count: items.length,
        items: items.map((d) => ({
          id: d.id,
          filename: d.filename,
          category: d.category,
          kind: d.kind,
          size: d.size,
          ocrStatus: d.ocrStatus,
          uploadedAt: d.uploadedAt,
        })),
      };
    },
  },
  {
    name: 'passport_validity',
    description:
      'Evaluate the remaining passport validity for a case or applicant against the configured rule for that country and visa category.',
    parameters: {
      type: 'object',
      properties: { caseId: { type: 'string' }, applicantId: { type: 'string' } },
    },
    async execute(args, ctx) {
      const caseId = await resolveCaseId(args, ctx);
      let country = 'Unknown';
      let visaCategory = 'Unknown';
      let expiry: string | null = null;
      if (caseId) {
        const detail = await getCaseWithSteps(caseId);
        country = detail.case.country;
        visaCategory = detail.case.visaCategory;
        expiry = (detail.applicant as any)?.passportExpiryDate ?? null;
      } else {
        const applicantId = await resolveApplicantId(args);
        if (!applicantId) return { error: 'Could not resolve a case or applicant.' };
        const { items } = await listApplicants({ q: applicantId, pageSize: 5 });
        const applicant = items.find((a) => a.id === applicantId) ?? items[0];
        expiry = applicant?.passportExpiryDate ?? null;
        country = applicant?.nationality || 'Unknown';
      }
      const validity = await evaluatePassportValidity(expiry, country, visaCategory);
      return { country, visaCategory, ...validity };
    },
  },
  {
    name: 'workflow_status',
    description: 'Return the ten-step workflow status for a case.',
    parameters: { type: 'object', properties: { caseId: { type: 'string' } } },
    async execute(args, ctx) {
      const caseId = await resolveCaseId(args, ctx);
      if (!caseId) return { error: 'No case resolved.' };
      const steps = await listSteps(caseId);
      return {
        currentStep: steps.find((s) => s.status === 'in_progress')?.stepNumber ?? null,
        steps: steps.map((s) => ({
          n: s.stepNumber,
          title: WORKFLOW_STEPS.find((w) => w.n === s.stepNumber)?.title ?? s.stepKey,
          status: s.status,
          updatedAt: s.updatedAt,
        })),
      };
    },
  },
  {
    name: 'document_readiness',
    description:
      'Produce a document readiness summary for a case: per-requirement status (available / missing / needs review / expired / preparation required).',
    parameters: { type: 'object', properties: { caseId: { type: 'string' } } },
    async execute(args, ctx) {
      const caseId = await resolveCaseId(args, ctx);
      if (!caseId) return { error: 'No case resolved.' };
      const detail = await getCaseWithSteps(caseId);
      const requirements = await listRequirements({
        country: detail.case.country,
        visaCategory: detail.case.visaCategory,
      });
      const checks = await listRequirementChecks(caseId);
      const documents = await listDocuments({ caseId });
      const categories = new Set(documents.map((d) => d.category));
      const items = requirements.map((r) => {
        const check = checks.find((c) => c.requirementId === r.id);
        return {
          requirement: r.title,
          category: r.category,
          mandatory: !!r.mandatory,
          status: check?.status ?? 'missing',
          sourceUrl: r.sourceUrl,
          verification: r.verifiedAt ? `verified ${r.verifiedAt.slice(0, 10)}` : 'unverified',
          documentCategoriesOnFile: [...categories],
        };
      });
      const summary = items.reduce<Record<string, number>>((acc, i) => {
        acc[i.status] = (acc[i.status] ?? 0) + 1;
        return acc;
      }, {});
      return { summary, items };
    },
  },
  {
    name: 'list_sponsors',
    description: 'Search the sponsor database by name or country, including verification status.',
    parameters: {
      type: 'object',
      properties: { q: { type: 'string' }, country: { type: 'string' } },
    },
    async execute(args) {
      const items = await listSponsors({
        q: typeof args.q === 'string' ? args.q : undefined,
        country: typeof args.country === 'string' ? args.country : undefined,
      });
      return {
        count: items.length,
        items: items.map((s) => ({
          id: s.id,
          name: s.name,
          country: s.country,
          verificationStatus: s.verificationStatus,
          website: s.website,
          sourceUrl: s.sourceUrl,
        })),
      };
    },
  },
];

export function getTool(name: string): Tool | undefined {
  return TOOLS.find((t) => t.name === name);
}
