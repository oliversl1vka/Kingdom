import type {
  ProviderAdapter,
  CompletionRequest,
  CompletionResponse,
  ProviderHealthStatus,
} from '@kingdomos/core';
import { ProviderError } from './errors.js';
import { createAbortSignal } from './abort.js';
import {
  buildOpenAICompatBody,
  parseOpenAICompatResponse,
  type OpenAICompatResponse,
} from './openai-compat.js';

export interface LMStudioConfig {
  endpoint: string;
  timeout_ms?: number;
}

const DEFAULT_TIMEOUT = 300_000; // 300s for local models — queued requests need headroom

export function createLMStudioAdapter(config: LMStudioConfig): ProviderAdapter {
  const { endpoint, timeout_ms = DEFAULT_TIMEOUT } = config;

  return {
    provider_id: 'lmstudio',

    async complete(request: CompletionRequest): Promise<CompletionResponse> {
      const url = `${endpoint}/v1/chat/completions`;
      // LM Studio is OpenAI-compatible. We do NOT advertise json_schema
      // response_format here: most LM Studio backends (and the weak local
      // models the squire tier runs) lack reliable structured-output / tool
      // support, so we keep the legacy prose path and let any tool/format
      // fields pass through only as plain OpenAI-compatible fields.
      const body = buildOpenAICompatBody(request, { supportsJsonSchemaResponseFormat: false });

      const abort = createAbortSignal(request.timeout_ms ?? timeout_ms, request.signal);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: abort.signal,
        });

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new ProviderError(
            `LM Studio returned ${response.status}: ${text}`,
            'lmstudio',
            response.status,
            response.status === 429 || response.status >= 500
          );
        }

        const data = (await response.json()) as OpenAICompatResponse;
        return parseOpenAICompatResponse(data);
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        throw new ProviderError(
          `LM Studio request failed: ${message}`,
          'lmstudio',
          0,
          true
        );
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

        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        const latency_ms = Date.now() - start;

        if (!response.ok) {
          return { status: 'degraded', latency_ms, error: `HTTP ${response.status}` };
        }

        return { status: 'healthy', latency_ms };
      } catch (error) {
        return {
          status: 'unavailable',
          latency_ms: Date.now() - start,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
