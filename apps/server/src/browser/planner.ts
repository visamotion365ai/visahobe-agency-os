import { getDefaultProvider, getProviderWithSecret } from '../domain/providers.js';
import { createProviderRuntime } from '../ai/providers/index.js';
import { assertUrlAllowed } from './ssrf.js';
import type { BrowserStep } from './protocol.js';

const MAX_STEPS = 25;

function extractUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s"'<>]+/i);
  return match ? match[0] : null;
}

/**
 * Deterministic fallback planner used when no LLM provider is configured.
 * It understands a small, explicit command grammar and never guesses URLs.
 */
export function heuristicPlan(instruction: string): BrowserStep[] {
  const steps: BrowserStep[] = [];
  const text = instruction.trim();
  const url = extractUrl(text);

  // Split compound instructions into clauses so each clause becomes one step.
  const clauses = text
    .split(/\s*(?:,\s*|\s+and then\s+|\s+then\s+|\s+and\s+)/i)
    .map((c) => c.trim())
    .filter(Boolean);

  for (const clause of clauses) {
    const clauseUrl = extractUrl(clause);
    const navMatch = clause.match(/^(?:go to|open|visit|navigate to|browse|load)\s+(?:the\s+)?(?:page\s+)?(.+)$/i);
    if (navMatch) {
      const target = clauseUrl ?? navMatch[1].trim();
      if (clauseUrl) {
        steps.push({ kind: 'navigate', url: clauseUrl, note: 'Navigate to the supplied address' });
      } else if (/^https?:\/\//i.test(target)) {
        steps.push({ kind: 'navigate', url: target });
      } else {
        steps.push({
          kind: 'navigate',
          note: `Target "${target}" is not a full address; a human should confirm the destination.`,
        });
      }
      continue;
    }
    if (clauseUrl && !url) {
      steps.push({ kind: 'navigate', url: clauseUrl });
      continue;
    }

    const fillMatch = clause.match(/^(?:fill|enter)\s+(?:the\s+)?(.+?)\s+(?:with|as)\s+(.+)$/i);
    if (fillMatch) {
      steps.push({
        kind: 'action',
        action: { kind: 'fill', label: fillMatch[1].trim(), value: fillMatch[2].trim() },
      });
      continue;
    }

    const typeMatch = clause.match(/^(?:type)\s+(.+?)\s+into\s+(.+)$/i);
    if (typeMatch) {
      steps.push({
        kind: 'action',
        action: { kind: 'type', selector: typeMatch[2].trim(), text: typeMatch[1].trim() },
      });
      continue;
    }

    const clickMatch = clause.match(/^(?:click|tap|press)\s+(?:on\s+)?(?:the\s+)?(.+)$/i);
    if (clickMatch) {
      steps.push({ kind: 'action', action: { kind: 'click', text: clickMatch[1].trim() } });
      continue;
    }

    const selectMatch = clause.match(/^select\s+(.+?)\s+(?:in|from)\s+(.+)$/i);
    if (selectMatch) {
      steps.push({
        kind: 'action',
        action: { kind: 'select', label: selectMatch[1].trim(), name: selectMatch[2].trim(), value: selectMatch[1].trim() },
      });
      continue;
    }

    if (/^screenshot$/i.test(clause)) {
      steps.push({ kind: 'screenshot' });
      continue;
    }
    if (/^(extract|read the page|get the text)/i.test(clause)) {
      steps.push({ kind: 'extract', schema: 'text' });
      continue;
    }
    const waitMatch = clause.match(/^wait\s+(\d+)\s*(ms|milliseconds|seconds?)?/i);
    if (waitMatch) {
      const value = Number(waitMatch[1]);
      const ms = waitMatch[2]?.toLowerCase().startsWith('s') ? value * 1000 : value;
      steps.push({ kind: 'wait', ms });
      continue;
    }
    if (/^(refresh|reload)$/i.test(clause)) {
      steps.push({ kind: 'action', action: { kind: 'refresh' } });
      continue;
    }
  }

  if (!steps.length) {
    steps.push({ kind: 'screenshot', note: 'No executable step could be derived; captured the current page.' });
  }
  return steps.slice(0, MAX_STEPS);
}

const PLANNER_SYSTEM = `You are the VisaHOBe browser planner. Convert the operator instruction into a short, safe sequence of browser steps.
Reply with JSON only, matching:
{"steps":[{"kind":"navigate","url":"https://..."},{"kind":"action","action":{"kind":"click","text":"button label"}},{"kind":"action","action":{"kind":"fill","label":"field label","value":"text"}},{"kind":"action","action":{"kind":"select","label":"option","name":"field","value":"text"}},{"kind":"action","action":{"kind":"type","selector":"css","text":"text"}},{"kind":"action","action":{"kind":"press","key":"Enter"}},{"kind":"wait","ms":1000},{"kind":"screenshot"},{"kind":"extract","schema":"text"}]}
Rules: only use URLs that appear in the instruction; never invent a government portal address; never include steps that submit, pay or sign in. Maximum 20 steps.`;

/** Plan a browser task with an LLM when one is configured, otherwise heuristically. */
export async function planBrowserTask(instruction: string): Promise<{ steps: BrowserStep[]; planner: string }> {
  const provider = await getDefaultProvider();
  if (provider && provider.enabled && provider.kind !== 'builtin') {
    try {
      const record = await getProviderWithSecret(provider.id);
      if (record) {
        const runtime = createProviderRuntime(record);
        const result = await runtime.chat({
          system: PLANNER_SYSTEM,
          messages: [{ role: 'user', content: instruction }],
          temperature: 0,
          maxTokens: 900,
        });
        const parsed = extractJson(result.content);
        if (parsed && Array.isArray((parsed as any).steps)) {
          const steps = await sanitiseSteps((parsed as any).steps);
          if (steps.length) return { steps, planner: `${runtime.name} (${runtime.model})` };
        }
      }
    } catch {
      /* fall through to the deterministic planner */
    }
  }
  return { steps: heuristicPlan(instruction), planner: 'VisaHOBe deterministic planner' };
}

function extractJson(text: string): unknown {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function sanitiseSteps(raw: any[]): Promise<BrowserStep[]> {
  const steps: BrowserStep[] = [];
  for (const item of raw.slice(0, MAX_STEPS)) {
    if (!item || typeof item !== 'object') continue;
    if (item.kind === 'navigate') {
      if (typeof item.url !== 'string') continue;
      try {
        await assertUrlAllowed(item.url);
      } catch {
        continue; // refuse unsafe destinations silently by dropping the step
      }
      steps.push({ kind: 'navigate', url: item.url, note: item.note });
    } else if (item.kind === 'action' && item.action?.kind) {
      const action = { ...item.action };
      if (action.kind === 'fill' || action.kind === 'select' || action.kind === 'type') {
        if (typeof action.value !== 'string' && typeof action.text !== 'string') continue;
      }
      if (action.kind === 'click' && !action.text && !action.selector && action.x === undefined) continue;
      steps.push({ kind: 'action', action, note: item.note });
    } else if (item.kind === 'wait') {
      steps.push({ kind: 'wait', ms: Math.min(10_000, Number(item.ms) || 1000) });
    } else if (item.kind === 'screenshot') {
      steps.push({ kind: 'screenshot', note: item.note });
    } else if (item.kind === 'extract') {
      steps.push({ kind: 'extract', schema: item.schema ?? 'text', selector: item.selector, note: item.note });
    }
  }
  return steps;
}
