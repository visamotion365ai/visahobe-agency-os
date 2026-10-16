import { fetchJson, ProviderError, type ChatProvider, type ProviderChatRequest, type ProviderChatResult, type ProviderTestResult } from '../types.js';

export interface OpenAiCompatibleConfig {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
}

/**
 * Works with OpenAI, DeepSeek, Groq, Together, LM Studio, llama.cpp servers,
 * vLLM and Ollama's OpenAI-compatible endpoint.
 */
export class OpenAiCompatibleProvider implements ChatProvider {
  readonly kind = 'openai' as const;

  constructor(private config: OpenAiCompatibleConfig) {}

  get id() {
    return this.config.id;
  }
  get name() {
    return this.config.name;
  }
  get model() {
    return this.config.model;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.config.apiKey) headers.authorization = `Bearer ${this.config.apiKey}`;
    return headers;
  }

  async chat(request: ProviderChatRequest): Promise<ProviderChatResult> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: [
        ...(request.system ? [{ role: 'system', content: request.system }] : []),
        ...request.messages.map((m) => ({
          role: m.role === 'tool' ? 'tool' : m.role,
          content: m.content,
          ...(m.role === 'tool' ? { tool_call_id: m.toolCallId } : {}),
        })),
      ],
      temperature: request.temperature ?? 0.2,
      stream: false,
    };
    if (request.maxTokens) body.max_tokens = request.maxTokens;
    if (request.tools?.length) {
      body.tools = request.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      body.tool_choice = 'auto';
    }
    const json = await fetchJson(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      timeoutMs: this.config.timeoutMs ?? 90_000,
    });
    const choice = json?.choices?.[0];
    const message = choice?.message ?? {};
    const toolCalls = (message.tool_calls ?? []).map((tc: any, index: number) => ({
      id: tc.id ?? `call_${index}`,
      name: tc.function?.name,
      arguments: safeParseArgs(tc.function?.arguments),
    }));
    return {
      content: typeof message.content === 'string' ? message.content : '',
      toolCalls,
      usage: {
        promptTokens: json?.usage?.prompt_tokens,
        completionTokens: json?.usage?.completion_tokens,
      },
      model: json?.model ?? this.config.model,
    };
  }

  async test(): Promise<ProviderTestResult> {
    try {
      const json = await fetchJson(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          model: this.config.model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 5,
          temperature: 0,
          stream: false,
        }),
        timeoutMs: 30_000,
      });
      return { ok: true, message: `Connected — ${json?.model ?? this.config.model}`, detail: json?.usage };
    } catch (err) {
      return { ok: false, message: (err as Error).message, detail: err instanceof ProviderError ? err.body : undefined };
    }
  }
}

export function safeParseArgs(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(raw));
    return typeof parsed === 'object' && parsed ? parsed : {};
  } catch {
    return {};
  }
}
