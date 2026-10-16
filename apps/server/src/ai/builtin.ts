import type { AgentContext } from './types.js';

/**
 * The VisaHOBe Local Engine.
 *
 * This is a deterministic, offline reasoner that works directly against the
 * agency database. It is NOT a large language model: it composes answers from
 * stored records only. It exists so that the product remains fully functional
 * (navigation, case work, document readiness, workflow) with no paid API and
 * no local model installed. The UI labels it clearly as the local engine.
 */

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'not recorded');

function stepTitle(key: string): string {
  const titles: Record<string, string> = {
    intake: 'Intake',
    ocr: 'OCR & Data Extraction',
    passport_validity: 'Passport Validity',
    country_checklist: 'Country Checklist',
    gap_analysis: 'Document Gap Analysis',
    dossier: 'Applicant Dossier',
    package_generation: 'Document Package',
    review_approval: 'Human Review & Approval',
    portal_submission: 'Assisted Portal Submission',
    tracking: 'Post-Submission Tracking',
  };
  return titles[key] ?? key;
}

function caseHeader(ctx: AgentContext): string {
  if (!ctx.case) return '';
  const applicant = ctx.applicant as any;
  return [
    `**Case ${ctx.case.reference}** — ${applicant?.fullName ?? 'applicant on file'}`,
    `Destination: ${ctx.case.country} · Category: ${ctx.case.visaCategory} · Status: ${ctx.case.status}`,
  ].join('\n');
}

function workflowBlock(ctx: AgentContext): string {
  if (!ctx.steps?.length) return 'No workflow steps recorded for this case.';
  return ctx.steps
    .map((s) => {
      const marker =
        s.status === 'completed' ? '✅' : s.status === 'in_progress' ? '🟡' : s.status === 'blocked' ? '⛔' : s.status === 'waiting_approval' ? '⏳' : '⚪️';
      return `${marker} ${s.stepNumber}. ${s.title ?? stepTitle(s.stepKey)} — ${s.status.replace('_', ' ')}`;
    })
    .join('\n');
}

function requirementsBlock(ctx: AgentContext): string {
  if (!ctx.requirements?.length) {
    return 'No requirement records are stored for this country/category yet. Staff must add them from an official source before they can be checked against a case.';
  }
  return ctx.requirements
    .map((r) => {
      const check = ctx.checks?.find((c) => c.requirementId === r.id);
      const status = check?.status ?? 'not checked';
      const verified = r.verifiedAt ? `verified ${fmtDate(r.verifiedAt)}` : 'NOT verified';
      const source = r.sourceUrl ? ` — ${r.sourceUrl}` : ' — no source recorded';
      return `- **${r.title}** (${r.category}) — ${status}; ${verified}${source}`;
    })
    .join('\n');
}

function documentsBlock(ctx: AgentContext): string {
  if (!ctx.documents?.length) return 'No documents are on file for this case.';
  const byCategory = new Map<string, number>();
  for (const d of ctx.documents) byCategory.set(d.category, (byCategory.get(d.category) ?? 0) + 1);
  const ocr = ctx.documents.filter((d) => d.ocrStatus === 'done').length;
  const lines = [...byCategory.entries()].map(([cat, n]) => `- ${cat}: ${n} file(s)`);
  return [`${ctx.documents.length} document(s) on file, ${ocr} with completed OCR.`, ...lines].join('\n');
}

function nextStepAdvice(ctx: AgentContext): string {
  const pending = ctx.steps?.find((s) => s.status === 'in_progress') ?? ctx.steps?.find((s) => s.status === 'pending');
  if (!pending) return 'All recorded steps are complete — confirm the case outcome.';
  return `Next operational step: **${pending.stepNumber}. ${pending.title ?? stepTitle(pending.stepKey)}** (currently ${pending.status.replace('_', ' ')}).`;
}

export interface BuiltinAnswer {
  content: string;
  toolsUsed: string[];
}

export function builtinAnswer(
  agentKey: string,
  userMessage: string,
  ctx: AgentContext,
): BuiltinAnswer {
  const msg = userMessage.toLowerCase();
  const toolsUsed: string[] = [];
  const parts: string[] = [];

  const wantsWorkflow = /(step|workflow|sop|process|progress|status|next)/.test(msg);
  const wantsDocuments = /(document|ready|readiness|missing|upload|ocr|passport scan)/.test(msg);
  const wantsRequirements = /(requirement|checklist|document needed|rule|policy|compliance|eligib)/.test(msg);
  const wantsTravel = /(travel|itinerar|flight|hotel|ticket|accommodation)/.test(msg);
  const wantsPlan = /(plan|action|next step|what should i do|to do)/.test(msg);

  if (!ctx.case && !wantsWorkflow) {
    return {
      content:
        'I could not tie this question to a case. Share a case reference (for example VM-7K3D92) or select a case in the Cases tab, and I will answer from the agency records rather than from general knowledge.',
      toolsUsed,
    };
  }

  if (ctx.case) {
    parts.push(caseHeader(ctx));
    parts.push('');
  }

  switch (agentKey) {
    case 'raffi': {
      toolsUsed.push('get_case', 'workflow_status');
      if (wantsRequirements) {
        toolsUsed.push('list_requirements');
        parts.push('**Configured requirements for this route**');
        parts.push(requirementsBlock(ctx));
        parts.push('');
      }
      if (wantsDocuments) {
        toolsUsed.push('list_documents');
        parts.push('**Documents on file**');
        parts.push(documentsBlock(ctx));
        parts.push('');
      }
      if (wantsPlan || wantsWorkflow) {
        parts.push('**Action plan**');
        parts.push(workflowBlock(ctx));
        parts.push('');
        parts.push(nextStepAdvice(ctx));
      } else {
        parts.push('**Where the case stands**');
        parts.push(workflowBlock(ctx));
        parts.push('');
        parts.push(nextStepAdvice(ctx));
      }
      parts.push('');
      parts.push('_Answered by the VisaHOBe Local Engine from agency records._');
      break;
    }
    case 'nova': {
      toolsUsed.push('list_documents', 'document_readiness', 'passport_validity');
      parts.push('**Document readiness report**');
      parts.push(documentsBlock(ctx));
      parts.push('');
      parts.push('**Requirement-by-requirement status**');
      parts.push(requirementsBlock(ctx));
      parts.push('');
      if (ctx.validity) {
        parts.push(`**Passport validity** — ${ctx.validity.message}`);
        parts.push(
          `Rule applied: ${ctx.validity.requiredMonths} month(s) from ${ctx.validity.ruleSource}.` +
            (ctx.validity.ruleConfigured ? '' : ' This is an agency default, not a legal determination.'),
        );
        parts.push('');
      }
      parts.push(
        '_I report only what is stored. I cannot confirm that a document is authentic, and expired or unreadable files must be re-supplied by the applicant._',
      );
      break;
    }
    case 'maestro': {
      toolsUsed.push('workflow_status', 'get_case');
      parts.push('**Ten-step SOP status**');
      parts.push(workflowBlock(ctx));
      parts.push('');
      parts.push(nextStepAdvice(ctx));
      const blocked = ctx.steps?.filter((s) => s.status === 'blocked' || s.status === 'waiting_approval') ?? [];
      if (blocked.length) {
        parts.push('');
        parts.push('**Blocks requiring a human decision**');
        for (const b of blocked) {
          parts.push(`- ${b.stepNumber}. ${b.title ?? stepTitle(b.stepKey)} — ${b.status.replace('_', ' ')}`);
        }
      }
      parts.push('');
      parts.push(
        '_Consequential steps (portal submission, payments, account changes) stop for human approval; I never mark them complete on your behalf._',
      );
      break;
    }
    case 'tanya': {
      toolsUsed.push('list_requirements', 'document_readiness');
      parts.push('**Requirements on record (source-linked)**');
      parts.push(requirementsBlock(ctx));
      const unverified = ctx.requirements?.filter((r) => !r.verifiedAt) ?? [];
      if (unverified.length) {
        parts.push('');
        parts.push(
          `⚠️ ${unverified.length} requirement(s) have no verification date. Treat them as unverified working notes, not as official rules.`,
        );
      }
      parts.push('');
      parts.push(
        '_I quote the stored records with their source URL and verification date. I do not generate requirements myself and I cannot guarantee approval._',
      );
      break;
    }
    case 'zayyad': {
      toolsUsed.push('list_requirements', 'list_documents');
      parts.push('**Travel document checklist (derived from stored requirements)**');
      const travelReqs = ctx.requirements?.filter((r) => r.category.toLowerCase().includes('travel')) ?? [];
      if (travelReqs.length) {
        for (const r of travelReqs) {
          const check = ctx.checks?.find((c) => c.requirementId === r.id);
          parts.push(`- ${r.title} — ${check?.status ?? 'not checked'}`);
        }
      } else {
        parts.push(
          '- No travel-category requirements are stored for this route yet. Typical supporting material (itinerary, accommodation proof, travel dates) should be confirmed against the official checklist before use.',
        );
      }
      parts.push('');
      parts.push('**Suggested itinerary fields to complete**');
      parts.push('- Departure date and port of departure');
      parts.push('- Intended duration of stay and purpose of travel');
      parts.push('- Accommodation details');
      parts.push('- Companion/dependent details, if applicable');
      parts.push('');
      parts.push(
        '_I can structure travel paperwork, but I cannot issue or confirm tickets, bookings or itineraries. Those must come from the traveller or an authorised booking._',
      );
      break;
    }
    default: {
      parts.push(workflowBlock(ctx));
      parts.push('');
      parts.push(nextStepAdvice(ctx));
    }
  }

  return { content: parts.join('\n'), toolsUsed };
}
