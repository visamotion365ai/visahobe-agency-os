import {
  fetchJson,
  ProviderError,
  type ChatProvider,
  type ProviderChatRequest,
  type ProviderChatResult,
  type ProviderTestResult,
} from '../types.js';

export interface GeminiConfig {
  id: string;
  name: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

/** Google Gemini REST adapter (BYOK — optional). */
export class GeminiProvider implements ChatProvider {
  readonly kind = 'gemini' as const;

  constructor(private config: GeminiConfig) {}

  get id() {
    return this.config.id;
  }
  get name() {
    return this.config.name;
  }
  get model() {
    return this.config.model;
  }

  private base() {
    return this.config.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
  }

  async chat(request: ProviderChatRequest): Promise<ProviderChatResult> {
    const contents = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: request.temperature ?? 0.2,
        maxOutputTokens: request.maxTokens ?? 2048,
      },
    };
    if (request.system) body.systemInstruction = { parts: [{ text: request.system }] };
    if (request.tools?.length) {
      body.tools = [
        {
          functionDeclarations: request.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ];
    }
    const url = `${this.base()}/models/${encodeURIComponent(this.config.model)}:generateContent?key=${encodeURIComponent(
      this.config.apiKey,
    )}`;
    const json = await fetchJson(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs: 90_000,
    });
    const candidate = json?.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const text = parts
      .filter((p: any) => typeof p.text === 'string')
      .map((p: any) => p.text)
      .join('\n');
    const toolCalls = parts
      .filter((p: any) => p.functionCall)
      .map((p: any, index: number) => ({
        id: `call_${index}`,
        name: p.functionCall.name,
        arguments: (p.functionCall.args ?? {}) as Record<string, unknown>,
      }));
    return {
      content: text,
      toolCalls,
      usage: {
        promptTokens: json?.usageMetadata?.promptTokenCount,
        completionTokens: json?.usageMetadata?.candidatesTokenCount,
      },
      model: this.config.model,
    };
  }

  async test(): Promise<ProviderTestResult> {
    try {
      const url = `${this.base()}/models/${encodeURIComponent(this.config.model)}:generateContent?key=${encodeURIComponent(
        this.config.apiKey,
      )}`;
      const json = await fetchJson(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ping' }] }] }),
        timeoutMs: 30_000,
      });
      return { ok: true, message: `Connected — ${this.config.model}` };
    } catch (err) {
      return {
        ok: false,
        message: (err as Error).message,
        detail: err instanceof ProviderError ? err.body : undefined,
      };
    }
  }
}
