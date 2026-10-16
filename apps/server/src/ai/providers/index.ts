import { env } from '../../env.js';
import type { ProviderRecord } from '../../domain/providers.js';
import { AnthropicProvider } from './anthropic.js';
import { GeminiProvider } from './gemini.js';
import { OpenAiCompatibleProvider } from './openaiCompatible.js';
import type { ChatProvider } from '../types.js';

export function createProviderRuntime(record: ProviderRecord & { apiKey?: string }): ChatProvider {
  const baseUrl = record.baseUrl || defaultBaseUrl(record.kind);
  switch (record.kind) {
    case 'anthropic':
      return new AnthropicProvider({
        id: record.id,
        name: record.name,
        apiKey: record.apiKey ?? '',
        model: record.model,
      });
    case 'gemini':
      return new GeminiProvider({
        id: record.id,
        name: record.name,
        apiKey: record.apiKey ?? '',
        model: record.model,
      });
    case 'ollama':
    case 'openai':
    case 'deepseek':
    case 'custom':
    case 'builtin':
    default:
      return new OpenAiCompatibleProvider({
        id: record.id,
        name: record.name,
        baseUrl: baseUrl || 'http://127.0.0.1:11434/v1',
        model: record.model,
        apiKey: record.apiKey,
      });
  }
}

export function defaultBaseUrl(kind: string): string {
  switch (kind) {
    case 'openai':
      return 'https://api.openai.com/v1';
    case 'deepseek':
      return 'https://api.deepseek.com/v1';
    case 'ollama':
      return `${env.OLLAMA_BASE_URL.replace(/\/$/, '')}/v1`;
    case 'custom':
      return '';
    default:
      return '';
  }
}
