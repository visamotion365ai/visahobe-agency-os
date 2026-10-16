import type { ProviderKind } from '@visahobe/shared';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ProviderChatResult {
  content: string;
  toolCalls: ToolCallRequest[];
  usage?: { promptTokens?: number; completionTokens?: number };
  model?: string;
  raw?: unknown;
}

export interface ProviderChatRequest {
  messages: ChatMessage[];
  system?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  /** Structured ground truth assembled by the engine (case, steps, requirements, documents). */
  context?: AgentContext;
}

export interface AgentContext {
  case?: {
    id: string;
    reference: string;
    country: string;
    visaCategory: string;
    purpose?: string | null;
    status: string;
    currentStep: number;
    priority: string;
  } | null;
  applicant?: Record<string, unknown> | null;
  sponsor?: Record<string, unknown> | null;
  steps?: Array<{ stepNumber: number; stepKey: string; title: string; status: string; updatedAt: string }>;
  requirements?: Array<{
    id: string;
    title: string;
    category: string;
    mandatory: number;
    status: string;
    sourceUrl?: string | null;
    verifiedAt?: string | null;
    version: number;
  }>;
  checks?: Array<{ requirementId: string; status: string; note?: string | null }>;
  documents?: Array<{
    id: string;
    filename: string;
    category: string;
    kind: string;
    size: number;
    ocrStatus: string;
    uploadedAt: string;
  }>;
  validity?: {
    status: string;
    monthsRemaining: number | null;
    requiredMonths: number;
    message: string;
    ruleSource: string;
    ruleConfigured: boolean;
  } | null;
  providerNote?: string;
}

export interface ProviderTestResult {
  ok: boolean;
  message: string;
  detail?: unknown;
}

export interface ChatProvider {
  readonly id: string;
  readonly kind: ProviderKind;
  readonly name: string;
  readonly model: string;
  chat(request: ProviderChatRequest): Promise<ProviderChatResult>;
  test(): Promise<ProviderTestResult>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public status?: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export async function fetchJson(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<any> {
  const { timeoutMs = 45_000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...rest, signal: controller.signal });
    const text = await res.text();
    let parsed: any = undefined;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = text;
    }
    if (!res.ok) {
      const detail =
        (parsed && (parsed.error?.message || parsed.error || parsed.message)) || `HTTP ${res.status}`;
      throw new ProviderError(String(detail), res.status, parsed);
    }
    return parsed;
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    if ((err as any)?.name === 'AbortError') {
      throw new ProviderError('Provider request timed out');
    }
    throw new ProviderError(`Provider request failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}
