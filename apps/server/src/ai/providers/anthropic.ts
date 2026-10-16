import {
  fetchJson,
  ProviderError,
  type ChatProvider,
  type ProviderChatRequest,
  type ProviderChatResult,
  type ProviderTestResult,
} from '../types.js';

export interface AnthropicConfig {
  id: string;
  name: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

/** Anthropic Messages API adapter (BYOK — optional, never required). */
export class AnthropicProvider implements ChatProvider {
  readonly kind = 'anthropic' as const;

  constructor(private config: AnthropicConfig) {}

  get id() {
    return this.config.id;
  }
  get name() {
    return this.config.name;
  }
  get model() {
    return this.config.model;
  }

  private headers() {
    return {
      'content-type': 'application/json',
      'x-api-key': this.config.apiKey,
      'anthropic-version': '2023-06-01',
    };
  }

  async chat(request: ProviderChatRequest): Promise<ProviderChatResult> {
    const system = request.system ?? '';
    const messages = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: request.maxTokens ?? 2048,
      temperature: request.temperature ?? 0.2,
      messages,
    };
    if (system) body.system = system;
    if (request.tools?.length) {
      body.tools = request.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }
    const json = await fetchJson(`${this.config.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      timeoutMs: 90_000,
    });
    const textBlocks = (json?.content ?? []).filter((b: any) => b.type === 'text');
    const toolUses = (json?.content ?? []).filter((b: any) => b.type === 'tool_use');
    return {
      content: textBlocks.map((b: any) => b.text).join('\n').trim(),
      toolCalls: toolUses.map((u: any) => ({
        id: u.id,
        name: u.name,
        arguments: (u.input ?? {}) as Record<string, unknown>,
      })),
      usage: { promptTokens: json?.usage?.input_tokens, completionTokens: json?.usage?.output_tokens },
      model: json?.model,
    };
  }

  async test(): Promise<ProviderTestResult> {
    try {
      const json = await fetchJson(`${this.config.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: 8,
          messages: [{ role: 'user', content: 'ping' }],
        }),
        timeoutMs: 30_000,
      });
      return { ok: true, message: `Connected — ${json?.model ?? this.config.model}` };
    } catch (err) {
      return {
        ok: false,
        message: (err as Error).message,
        detail: err instanceof ProviderError ? err.body : undefined,
      };
    }
  }
}
