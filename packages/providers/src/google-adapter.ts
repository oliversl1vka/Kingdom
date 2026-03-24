import type {
  ProviderAdapter,
  CompletionRequest,
  CompletionResponse,
  ProviderHealthStatus,
} from '@kingdomos/core';
import { ProviderError } from './errors.js';

export interface GoogleConfig {
  api_key: string;
  endpoint?: string;
  timeout_ms?: number;
}

const DEFAULT_ENDPOINT = 'https://generativelanguage.googleapis.com';
const DEFAULT_TIMEOUT = 30_000;

export function createGoogleAdapter(config: GoogleConfig): ProviderAdapter {
  const { api_key, endpoint = DEFAULT_ENDPOINT, timeout_ms = DEFAULT_TIMEOUT } = config;

  return {
    provider_id: 'google',

    async complete(request: CompletionRequest): Promise<CompletionResponse> {
      const model = request.model;
      const url = `${endpoint}/v1beta/models/${model}:generateContent?key=${api_key}`;

      const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

      if (request.system) {
        contents.push({ role: 'user', parts: [{ text: request.system }] });
        contents.push({ role: 'model', parts: [{ text: 'Understood.' }] });
      }

      for (const msg of request.messages) {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }],
        });
      }

      const body = {
        contents,
        generationConfig: {
          maxOutputTokens: request.max_tokens,
          temperature: request.temperature ?? 0.7,
          ...(request.stop && { stopSequences: request.stop }),
        },
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout_ms);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new ProviderError(
            `Google returned ${response.status}: ${text}`,
            'google',
            response.status,
            response.status === 429 || response.status >= 500
          );
        }

        const data = (await response.json()) as {
          candidates: Array<{
            content: { parts: Array<{ text: string }> };
            finishReason: string;
          }>;
          usageMetadata?: {
            promptTokenCount: number;
            candidatesTokenCount: number;
            totalTokenCount: number;
          };
        };

        const candidate = data.candidates[0];
        const content = candidate.content.parts.map((p) => p.text).join('');
        const usage = data.usageMetadata;

        return {
          content,
          prompt_tokens: usage?.promptTokenCount ?? 0,
          completion_tokens: usage?.candidatesTokenCount ?? 0,
          total_tokens: usage?.totalTokenCount ?? 0,
          finish_reason: candidate.finishReason === 'STOP' ? 'stop' : 'length',
        };
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        throw new ProviderError(`Google request failed: ${message}`, 'google', 0, true);
      } finally {
        clearTimeout(timeoutId);
      }
    },

    async healthCheck(): Promise<ProviderHealthStatus> {
      const url = `${endpoint}/v1beta/models?key=${api_key}`;
      const start = Date.now();

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        const latency_ms = Date.now() - start;

        if (response.ok) {
          return { status: 'healthy', latency_ms };
        }
        return {
          status: response.status === 429 ? 'cooldown' : 'unavailable',
          latency_ms,
          last_error: `HTTP ${response.status}`,
        };
      } catch (error) {
        return {
          status: 'unavailable',
          latency_ms: Date.now() - start,
          last_error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
