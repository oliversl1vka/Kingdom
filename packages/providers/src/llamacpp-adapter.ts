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

export interface LlamaCppConfig {
  /** llama-server base URL. Defaults to http://localhost:8080. */
  endpoint?: string;
  timeout_ms?: number;
}

const DEFAULT_ENDPOINT = 'http://localhost:8080';
const DEFAULT_TIMEOUT = 300_000; // 300s — local models need headroom.

/**
 * Adapter for llama.cpp's `llama-server`, the new local default (replacing
 * LM Studio). llama-server exposes an OpenAI-compatible
 * `/v1/chat/completions` endpoint (no api_key), so request/response shaping
 * is shared with the OpenAI adapter.
 *
 * Structured output: llama-server natively accepts
 * `response_format:{type:'json_schema',json_schema:{schema}}` (and a lower-level
 * `grammar` field). We forward the json_schema response_format — llama.cpp's
 * strongest forward-compatible feature for reliable structured output — via the
 * shared OpenAI-compatible body builder.
 *
 * Tools: forwarded via the OpenAI-compatible `tools` field.
 *
 * healthCheck hits llama-server's `/health` and falls back to `/v1/models`.
 */
export function createLlamaCppAdapter(config: LlamaCppConfig = {}): ProviderAdapter {
  const { endpoint = DEFAULT_ENDPOINT, timeout_ms = DEFAULT_TIMEOUT } = config;

  return {
    provider_id: 'llamacpp',

    async complete(request: CompletionRequest): Promise<CompletionResponse> {
      const url = `${endpoint}/v1/chat/completions`;
      // llama-server supports OpenAI-compatible tools AND json_schema
      // response_format — prefer the latter for structured output.
      const body = buildOpenAICompatBody(request, { supportsJsonSchemaResponseFormat: true });

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
            `llama.cpp returned ${response.status}: ${text}`,
            'llamacpp',
            response.status,
            response.status === 429 || response.status >= 500,
          );
        }

        const data = (await response.json()) as OpenAICompatResponse;
        return parseOpenAICompatResponse(data);
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        throw new ProviderError(`llama.cpp request failed: ${message}`, 'llamacpp', 0, true);
      } finally {
        abort.dispose();
      }
    },

    async healthCheck(): Promise<ProviderHealthStatus> {
      const start = Date.now();

      const probe = async (path: string): Promise<Response> => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        try {
          return await fetch(`${endpoint}${path}`, { signal: controller.signal });
        } finally {
          clearTimeout(timeoutId);
        }
      };

      try {
        // llama-server exposes /health; fall back to /v1/models if absent.
        let response: Response;
        try {
          response = await probe('/health');
          if (response.status === 404) {
            response = await probe('/v1/models');
          }
        } catch {
          response = await probe('/v1/models');
        }

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
