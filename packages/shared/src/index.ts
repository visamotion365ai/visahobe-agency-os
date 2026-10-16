import { z } from 'zod';

/* ------------------------------------------------------------------ *
 * Core domain vocabulary shared by the API, the web app and the worker
 * ------------------------------------------------------------------ */

export const COUNTRIES = [
  'Australia',
  'Serbia',
  'Russia',
  'Turkey',
  'Singapore',
  'Malaysia',
  'Saudi Arabia',
  'Bahrain',
] as const;
export type Country = (typeof COUNTRIES)[number];
export const countrySchema = z.enum(COUNTRIES);

/** The ten operational steps of the VisaHOBe SOP. */
export const WORKFLOW_STEPS = [
  { n: 1, key: 'intake', title: 'Intake', titleBn: 'আবেদন গ্রহণ' },
  { n: 2, key: 'ocr', title: 'OCR & Data Extraction', titleBn: 'OCR ও তথ্য বিশ্লেষণ' },
  { n: 3, key: 'passport_validity', title: 'Passport Validity', titleBn: 'পাসপোর্ট মেয়াদ' },
  { n: 4, key: 'country_checklist', title: 'Country Checklist', titleBn: 'দেশভেদিক চেকলিস্ট' },
  { n: 5, key: 'gap_analysis', title: 'Document Gap Analysis', titleBn: 'ডকুমেন্ট ঘাটতি বিশ্লেষণ' },
  { n: 6, key: 'dossier', title: 'Applicant Dossier', titleBn: 'আবেদনকারী ডসিয়ার' },
  { n: 7, key: 'package_generation', title: 'Document Package', titleBn: 'ডকুমেন্ট প্যাকেজ' },
  { n: 8, key: 'review_approval', title: 'Human Review & Approval', titleBn: 'মানব পর্যালোচনা' },
  { n: 9, key: 'portal_submission', title: 'Assisted Portal Submission', titleBn: 'সহায়ক পোর্টাল জমা' },
  { n: 10, key: 'tracking', title: 'Post-Submission Tracking', titleBn: 'জমার পরবর্তী ট্র্যাকিং' },
] as const;
export type WorkflowStepKey = (typeof WORKFLOW_STEPS)[number]['key'];
export const stepKeySchema = z.enum(
  WORKFLOW_STEPS.map((s) => s.key) as [WorkflowStepKey, ...WorkflowStepKey[]],
);

export const STEP_STATUSES = [
  'locked',
  'pending',
  'in_progress',
  'waiting_approval',
  'completed',
  'blocked',
  'skipped',
] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export const DOC_STATUSES = [
  'available',
  'missing',
  'needs_review',
  'expired',
  'preparation_required',
] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

export const AGENT_KEYS = ['raffi', 'nova', 'maestro', 'tanya', 'zayyad'] as const;
export type AgentKey = (typeof AGENT_KEYS)[number];

export const AGENT_PROFILES: Record<
  AgentKey,
  { name: string; role: string; focus: string; avatar: string; accent: string }
> = {
  raffi: {
    name: 'Raffi',
    role: 'Visa Specialist',
    focus: 'Explains visa processes, builds case action plans and names the next operational step.',
    avatar: 'R',
    accent: '#0a84ff',
  },
  nova: {
    name: 'Nova',
    role: 'Document Expert',
    focus: 'Runs OCR, extracts structured data and produces document readiness reports.',
    avatar: 'N',
    accent: '#30d158',
  },
  maestro: {
    name: 'Maestro',
    role: 'Workflow Manager',
    focus: 'Orchestrates the 10-step SOP, keeps timelines and raises approval gates.',
    avatar: 'M',
    accent: '#bf5af2',
  },
  tanya: {
    name: 'Tanya',
    role: 'Compliance Advisor',
    focus: 'Checks configured country requirements, flags gaps, never invents rules.',
    avatar: 'T',
    accent: '#ff9f0a',
  },
  zayyad: {
    name: 'Zayyad',
    role: 'Travel Consultant',
    focus: 'Organises itineraries and prepares travel document checklists.',
    avatar: 'Z',
    accent: '#64d2ff',
  },
};

export const AGENT_TASK_STATUSES = [
  'queued',
  'running',
  'waiting_approval',
  'completed',
  'failed',
  'cancelled',
] as const;
export type AgentTaskStatus = (typeof AGENT_TASK_STATUSES)[number];

export const BROWSER_SESSION_STATUSES = [
  'idle',
  'starting',
  'ready',
  'busy',
  'paused',
  'stopped',
  'error',
  'disconnected',
] as const;
export type BrowserSessionStatus = (typeof BROWSER_SESSION_STATUSES)[number];

export const SPONSOR_STATUSES = [
  'unverified',
  'pending_verification',
  'verified',
  'inactive',
] as const;
export type SponsorStatus = (typeof SPONSOR_STATUSES)[number];

export const PROVIDER_KINDS = [
  'ollama',
  'openai',
  'anthropic',
  'gemini',
  'deepseek',
  'custom',
  'builtin',
] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/* ----------------------------- Schemas ----------------------------- */

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const applicantInputSchema = z.object({
  fullName: z.string().min(2).max(200),
  passportNumber: z.string().max(40).optional(),
  nationality: z.string().max(80).optional(),
  dateOfBirth: z.string().optional(),
  gender: z.enum(['male', 'female', 'other', '']).optional(),
  passportIssueDate: z.string().optional(),
  passportExpiryDate: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().max(40).optional(),
  address: z.string().max(500).optional(),
  notes: z.string().max(4000).optional(),
});
export type ApplicantInput = z.infer<typeof applicantInputSchema>;

export const caseInputSchema = z.object({
  applicantId: z.string().min(1),
  sponsorId: z.string().optional(),
  country: countrySchema,
  visaCategory: z.string().min(2).max(120),
  purpose: z.string().max(400).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  assignedTo: z.string().optional(),
});
export type CaseInput = z.infer<typeof caseInputSchema>;

export const sponsorInputSchema = z.object({
  name: z.string().min(2).max(200),
  legalName: z.string().max(240).optional(),
  country: z.string().min(2).max(120),
  jurisdiction: z.string().max(120).optional(),
  registrationId: z.string().max(120).optional(),
  website: z.string().max(300).optional(),
  sourceUrl: z.string().max(500).optional(),
  contactPerson: z.string().max(160).optional(),
  email: z.string().max(200).optional(),
  phone: z.string().max(60).optional(),
  sponsorType: z.string().max(80).optional(),
  verificationStatus: z.enum(SPONSOR_STATUSES).default('unverified'),
  notes: z.string().max(4000).optional(),
});
export type SponsorInput = z.infer<typeof sponsorInputSchema>;

export const providerInputSchema = z.object({
  name: z.string().min(2).max(120),
  kind: z.enum(PROVIDER_KINDS),
  baseUrl: z.string().max(400).optional(),
  model: z.string().min(1).max(200),
  apiKey: z.string().max(400).optional(),
  settings: z.record(z.unknown()).optional(),
});
export type ProviderInput = z.infer<typeof providerInputSchema>;

export const agentSchema = z.enum(AGENT_KEYS);
export const chatSchema = z.object({
  agentKey: agentSchema,
  message: z.string().min(1).max(8000),
  conversationId: z.string().optional(),
  caseId: z.string().optional(),
});
export type ChatInput = z.infer<typeof chatSchema>;

export const browserTaskSchema = z.object({
  sessionId: z.string().optional(),
  instruction: z.string().min(3).max(4000),
  url: z.string().max(2000).optional(),
  viewport: z.enum(['desktop', 'mobile']).default('desktop'),
  mode: z.enum(['assisted', 'human_takeover']).default('assisted'),
});
export type BrowserTaskInput = z.infer<typeof browserTaskSchema>;

export const requirementsInputSchema = z.object({
  country: countrySchema,
  visaCategory: z.string().min(2).max(120),
  title: z.string().min(2).max(240),
  description: z.string().max(2000).optional(),
  category: z.string().max(80).default('general'),
  mandatory: z.boolean().default(true),
  sourceUrl: z.string().max(600).optional(),
  sourceTitle: z.string().max(240).optional(),
  verifiedAt: z.string().optional(),
  effectiveDate: z.string().optional(),
});
export type RequirementsInput = z.infer<typeof requirementsInputSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
