import { WORKFLOW_STEPS } from '@visahobe/shared';

export type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'kv'; rows: Array<[string, string]> }
  | { kind: 'table'; headers: string[]; rows: string[][] }
  | { kind: 'notice'; text: string; tone: 'draft' | 'info' | 'warn' };

export interface DocumentModel {
  title: string;
  subtitle: string;
  reference?: string;
  blocks: Block[];
}

export interface CaseBundle {
  case: {
    id: string;
    reference: string;
    country: string;
    visaCategory: string;
    purpose: string | null;
    status: string;
    currentStep: number;
    createdAt: string;
  };
  applicant: Record<string, any> | null;
  sponsor: Record<string, any> | null;
  steps: Array<{ stepNumber: number; stepKey: string; status: string; updatedAt: string }>;
  requirements: Array<{
    id: string;
    title: string;
    category: string;
    mandatory: number;
    status: string;
    sourceUrl: string | null;
    verifiedAt: string | null;
    version: number;
  }>;
  checks: Array<{ requirementId: string; status: string; note: string | null }>;
  documents: Array<{
    id: string;
    filename: string;
    category: string;
    kind: string;
    size: number;
    ocrStatus: string;
    uploadedAt: string;
  }>;
  validity: {
    status: string;
    monthsRemaining: number | null;
    requiredMonths: number;
    message: string;
    ruleSource: string;
    ruleConfigured: boolean;
  } | null;
  agencyName?: string;
  generatedBy?: string;
}

const d = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
};

const DRAFT_NOTICE =
  'DRAFT — prepared by the VisaHOBe Agency OS for staff review. Not an official document, not issued by any ' +
  'government authority, and not valid for submission until a human reviewer approves it.';

function applicantRows(bundle: CaseBundle): Array<[string, string]> {
  const a = bundle.applicant ?? {};
  return [
    ['Full name', d(a.fullName)],
    ['Passport number', d(a.passportNumber)],
    ['Nationality', d(a.nationality)],
    ['Date of birth', d(a.dateOfBirth)],
    ['Gender', d(a.gender)],
    ['Passport issued', d(a.passportIssueDate)],
    ['Passport expires', d(a.passportExpiryDate)],
    ['Email', d(a.email)],
    ['Phone', d(a.phone)],
    ['Address', d(a.address)],
  ];
}

export function applicationInformationModel(bundle: CaseBundle): DocumentModel {
  return {
    title: 'Application Information Sheet',
    subtitle: `${bundle.case.country} — ${bundle.case.visaCategory}`,
    reference: bundle.case.reference,
    blocks: [
      { kind: 'notice', tone: 'draft', text: DRAFT_NOTICE },
      { kind: 'heading', text: 'Applicant' },
      { kind: 'kv', rows: applicantRows(bundle) },
      { kind: 'heading', text: 'Application' },
      {
        kind: 'kv',
        rows: [
          ['Case reference', bundle.case.reference],
          ['Destination country', bundle.case.country],
          ['Visa category', bundle.case.visaCategory],
          ['Purpose of travel', d(bundle.case.purpose)],
          ['Current SOP step', `${bundle.case.currentStep} of 10`],
          ['Case status', bundle.case.status],
        ],
      },
      { kind: 'heading', text: 'Sponsor / Employer' },
      {
        kind: 'kv',
        rows: [
          ['Name', d(bundle.sponsor?.name)],
          ['Country', d(bundle.sponsor?.country)],
          ['Registration ID', d(bundle.sponsor?.registrationId)],
          ['Verification status', d(bundle.sponsor?.verificationStatus)],
        ],
      },
      { kind: 'heading', text: 'Passport validity' },
      { kind: 'paragraph', text: bundle.validity?.message ?? 'Passport expiry date is not recorded.' },
      {
        kind: 'paragraph',
        text: bundle.validity
          ? `Rule applied: ${bundle.validity.requiredMonths} month(s) — source: ${bundle.validity.ruleSource}.${
              bundle.validity.ruleConfigured ? '' : ' This is an agency default and not a legal determination.'
            }`
          : '',
      },
    ],
  };
}

export function coverLetterModel(bundle: CaseBundle): DocumentModel {
  const a = bundle.applicant ?? {};
  const s = bundle.sponsor ?? {};
  return {
    title: 'Cover Letter',
    subtitle: `${bundle.case.country} — ${bundle.case.visaCategory}`,
    reference: bundle.case.reference,
    blocks: [
      { kind: 'notice', tone: 'draft', text: DRAFT_NOTICE },
      {
        kind: 'paragraph',
        text: `To: The Visa Officer / Competent Authority, ${bundle.case.country}`,
      },
      {
        kind: 'paragraph',
        text: `Subject: Application for ${bundle.case.visaCategory} — ${d(a.fullName)} (case ${bundle.case.reference})`,
      },
      { kind: 'heading', text: 'Body' },
      {
        kind: 'paragraph',
        text: `I, ${d(a.fullName)}, holder of passport ${d(a.passportNumber)} of ${d(a.nationality)}, respectfully submit an application for ${bundle.case.visaCategory} to ${bundle.case.country}. The intended purpose of travel is: ${d(bundle.case.purpose)}.`,
      },
      {
        kind: 'paragraph',
        text: `The application is sponsored by ${d(s.name)}${s.legalName ? ` (${s.legalName})` : ''}${s.country ? `, ${s.country}` : ''}. Supporting documents as per the official checklist accompany this application.`,
      },
      {
        kind: 'paragraph',
        text: 'I confirm that the information provided in this application is true and complete to the best of my knowledge, and I am available for any further clarification or interview.',
      },
      { kind: 'heading', text: 'Declaration' },
      {
        kind: 'paragraph',
        text: 'This draft was prepared by VisaHOBe Agency OS. The applicant must read, correct and sign the final version personally before it is submitted.',
      },
      { kind: 'paragraph', text: 'Signature: ______________________    Date: ____________' },
    ],
  };
}

export function jobOfferModel(bundle: CaseBundle): DocumentModel {
  const a = bundle.applicant ?? {};
  const s = bundle.sponsor ?? {};
  return {
    title: 'Job Offer Letter',
    subtitle: `${d(s.name)} — ${bundle.case.country}`,
    reference: bundle.case.reference,
    blocks: [
      {
        kind: 'notice',
        tone: 'warn',
        text:
          'DRAFT TEMPLATE — this is not a real employment offer. It must be issued and signed by the sponsor company. ' +
          'VisaHOBe does not create employment offers on a sponsor’s behalf.',
      },
      { kind: 'kv', rows: [['Employer', d(s.name)], ['Legal name', d(s.legalName)], ['Country', d(s.country)], ['Registration ID', d(s.registrationId)]] },
      { kind: 'heading', text: 'Proposed appointment' },
      {
        kind: 'kv',
        rows: [
          ['Position title', '[to be completed by the employer]'],
          ['Monthly salary', '[to be completed by the employer]'],
          ['Contract duration', '[to be completed by the employer]'],
          ['Joining date', '[to be completed by the employer]'],
          ['Work location', '[to be completed by the employer]'],
        ],
      },
      { kind: 'heading', text: 'Employee' },
      { kind: 'kv', rows: [['Name', d(a.fullName)], ['Passport number', d(a.passportNumber)], ['Nationality', d(a.nationality)]] },
      { kind: 'paragraph', text: 'Employer acknowledgement: ______________________   Date: ____________' },
    ],
  };
}

export function sponsorshipLetterModel(bundle: CaseBundle): DocumentModel {
  const a = bundle.applicant ?? {};
  const s = bundle.sponsor ?? {};
  return {
    title: 'Sponsorship Letter',
    subtitle: `${d(s.name)} — ${bundle.case.country}`,
    reference: bundle.case.reference,
    blocks: [
      {
        kind: 'notice',
        tone: 'warn',
        text:
          'DRAFT TEMPLATE — sponsorship must be confirmed and signed by the sponsor. Verification status of the ' +
          `sponsor record: ${d(s.verificationStatus)}.`,
      },
      { kind: 'kv', rows: [['Sponsor', d(s.name)], ['Legal name', d(s.legalName)], ['Registration ID', d(s.registrationId)], ['Website', d(s.website)], ['Source', d(s.sourceUrl)]] },
      { kind: 'heading', text: 'Declaration' },
      {
        kind: 'paragraph',
        text: `We, ${d(s.name)}, confirm our sponsorship of ${d(a.fullName)} for the purpose of ${bundle.case.visaCategory} in ${bundle.case.country}. We will be responsible for the applicant's employment, accommodation and repatriation as required by the applicable rules.`,
      },
      { kind: 'paragraph', text: 'Authorised signatory: ______________________   Date: ____________' },
    ],
  };
}

export function documentChecklistModel(bundle: CaseBundle): DocumentModel {
  const rows = bundle.requirements.map((r) => {
    const check = bundle.checks.find((c) => c.requirementId === r.id);
    return [
      r.title,
      r.category,
      r.mandatory ? 'Mandatory' : 'Optional',
      check?.status ?? 'missing',
      r.sourceUrl ?? '—',
      r.verifiedAt ? String(r.verifiedAt).slice(0, 10) : 'unverified',
    ];
  });
  const onFile = bundle.documents.map((doc) => [doc.filename, doc.category, doc.kind, doc.ocrStatus, String(doc.size), doc.uploadedAt.slice(0, 10)]);
  return {
    title: 'Document Checklist',
    subtitle: `${bundle.case.country} — ${bundle.case.visaCategory}`,
    reference: bundle.case.reference,
    blocks: [
      { kind: 'notice', tone: 'info', text: 'This checklist reflects the requirements stored in the agency database with their source and verification state. Items marked "unverified" must be confirmed against the official source before they are relied upon.' },
      { kind: 'heading', text: 'Required documents' },
      { kind: 'table', headers: ['Document', 'Category', 'Mandatory', 'Status', 'Source', 'Verified'], rows },
      { kind: 'heading', text: 'Files on record' },
      { kind: 'table', headers: ['File', 'Category', 'Kind', 'OCR', 'Bytes', 'Uploaded'], rows: onFile },
    ],
  };
}

export function sopInstructionsModel(bundle: CaseBundle): DocumentModel {
  const steps = WORKFLOW_STEPS.map((s) => {
    const state = bundle.steps.find((x) => x.stepNumber === s.n);
    return `${s.n}. ${s.title} — ${state?.status ?? 'pending'}`;
  });
  return {
    title: 'Applicant Instructions (SOP)',
    subtitle: `${bundle.case.country} — ${bundle.case.visaCategory}`,
    reference: bundle.case.reference,
    blocks: [
      { kind: 'notice', tone: 'info', text: 'Instructions for the applicant. Steps marked completed or in progress reflect the agency workflow, not a government decision.' },
      { kind: 'heading', text: 'Your checklist' },
      { kind: 'bullets', items: steps },
      {
        kind: 'bullets',
        items: [
          'Bring the original passport and two photocopies of the data page.',
          'Upload clear scans; ensure all four corners and the machine readable zone are visible.',
          'Confirm that your passport is valid for the required period before travelling.',
          'Keep every issued receipt and reference number — it is needed for tracking.',
        ],
      },
    ],
  };
}

export function dossierModel(bundle: CaseBundle): DocumentModel {
  const readiness = bundle.requirements.map((r) => {
    const check = bundle.checks.find((c) => c.requirementId === r.id);
    return [r.title, check?.status ?? 'missing', r.verifiedAt ? String(r.verifiedAt).slice(0, 10) : 'unverified'];
  });
  const stepSummary = bundle.steps.map((s) => {
    const title = WORKFLOW_STEPS.find((w) => w.n === s.stepNumber)?.title ?? s.stepKey;
    return `${s.stepNumber}. ${title} — ${s.status}`;
  });
  return {
    title: 'Applicant Case Dossier',
    subtitle: `${bundle.case.country} — ${bundle.case.visaCategory}`,
    reference: bundle.case.reference,
    blocks: [
      { kind: 'notice', tone: 'info', text: 'Single-page internal case summary. Confidential — contains applicant personal data.' },
      { kind: 'kv', rows: applicantRows(bundle) },
      { kind: 'heading', text: 'Case' },
      {
        kind: 'kv',
        rows: [
          ['Reference', bundle.case.reference],
          ['Destination', bundle.case.country],
          ['Category', bundle.case.visaCategory],
          ['Purpose', d(bundle.case.purpose)],
          ['Sponsor', d(bundle.sponsor?.name)],
          ['Sponsor verification', d(bundle.sponsor?.verificationStatus)],
          ['Current step', `${bundle.case.currentStep} of 10`],
          ['Passport validity', bundle.validity?.message ?? 'not evaluated'],
        ],
      },
      { kind: 'heading', text: 'Document readiness' },
      { kind: 'table', headers: ['Requirement', 'Status', 'Verified'], rows: readiness },
      { kind: 'heading', text: 'Workflow' },
      { kind: 'bullets', items: stepSummary },
    ],
  };
}

export const TEMPLATES: Record<
  string,
  { label: string; build: (bundle: CaseBundle) => DocumentModel }
> = {
  application_information: { label: 'Application Information', build: applicationInformationModel },
  cover_letter: { label: 'Cover Letter', build: coverLetterModel },
  job_offer: { label: 'Job Offer', build: jobOfferModel },
  sponsorship_letter: { label: 'Sponsorship Letter', build: sponsorshipLetterModel },
  document_checklist: { label: 'Document Checklist', build: documentChecklistModel },
  applicant_sop: { label: 'Applicant SOP Instructions', build: sopInstructionsModel },
  dossier: { label: 'Applicant Dossier', build: dossierModel },
};

export function isDraftTemplate(key: string): boolean {
  return ['job_offer', 'sponsorship_letter', 'cover_letter', 'application_information'].includes(key);
}
