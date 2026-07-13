import type {
  ProviderAdapter,
  CompletionRequest,
  CompletionResponse,
  ProviderHealthStatus,
} from '@kingdomos/core';
import { ProviderError } from './errors.js';
// CompletionResponse is the declared return type of `complete`.
import { createAbortSignal } from './abort.js';
import {
  buildOpenAICompatBody,
  parseOpenAICompatResponse,
  type OpenAICompatResponse,
} from './openai-compat.js';

export interface OpenAIConfig {
  api_key: string;
  endpoint?: string;
  timeout_ms?: number;
}

const DEFAULT_ENDPOINT = 'https://api.openai.com';
const DEFAULT_TIMEOUT = 30_000;

export function createOpenAIAdapter(config: OpenAIConfig): ProviderAdapter {
  const { api_key, endpoint = DEFAULT_ENDPOINT, timeout_ms = DEFAULT_TIMEOUT } = config;

  return {
    provider_id: 'openai',

    async complete(request: CompletionRequest): Promise<CompletionResponse> {
      const url = `${endpoint}/v1/chat/completions`;
      const body = buildOpenAICompatBody(request, { supportsJsonSchemaResponseFormat: true });

      const abort = createAbortSignal(request.timeout_ms ?? timeout_ms, request.signal);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${api_key}`,
          },
          body: JSON.stringify(body),
          signal: abort.signal,
        });

        // Handle rate-limit headers
        const rateLimitRemaining = response.headers.get('x-ratelimit-remaining-requests');

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new ProviderError(
            `OpenAI returned ${response.status}: ${text}`,
            'openai',
            response.status,
            response.status === 429 || response.status >= 500,
            rateLimitRemaining ? parseInt(rateLimitRemaining, 10) : undefined
          );
        }

        const data = (await response.json()) as OpenAICompatResponse;
        return parseOpenAICompatResponse(data);
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        throw new ProviderError(`OpenAI request failed: ${message}`, 'openai', 0, true);
      } finally {
        abort.dispose();
      }
    },

    async healthCheck(): Promise<ProviderHealthStatus> {
      const url = `${endpoint}/v1/models`;
      const start = Date.now();

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(url, {
          headers: { 'Authorization': `Bearer ${api_key}` },
          signal: controller.signal,
        });
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
