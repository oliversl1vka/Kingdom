import type {
  ProviderAdapter,
  CompletionRequest,
  CompletionResponse,
  ProviderHealthStatus,
  Message,
} from '@kingdomos/core';
import { ProviderError } from './errors.js';

export interface LMStudioConfig {
  endpoint: string;
  timeout_ms?: number;
}

const DEFAULT_TIMEOUT = 120_000; // 120s for local models per contract

export function createLMStudioAdapter(config: LMStudioConfig): ProviderAdapter {
  const { endpoint, timeout_ms = DEFAULT_TIMEOUT } = config;

  return {
    provider_id: 'lmstudio',

    async complete(request: CompletionRequest): Promise<CompletionResponse> {
      const url = `${endpoint}/v1/chat/completions`;
      const messages: Array<{ role: string; content: string }> = [];

      if (request.system) {
        messages.push({ role: 'system', content: request.system });
      }
      messages.push(...request.messages);

      const body = {
        model: request.model,
        messages,
        max_tokens: request.max_tokens,
        temperature: request.temperature ?? 0.7,
        ...(request.stop && { stop: request.stop }),
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
            `LM Studio returned ${response.status}: ${text}`,
            'lmstudio',
            response.status,
            response.status === 429 || response.status >= 500
          );
        }

        const data = (await response.json()) as {
          choices: Array<{ message: { content: string }; finish_reason: string }>;
          usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
        };

        const choice = data.choices[0];
        return {
          content: choice.message.content,
          prompt_tokens: data.usage.prompt_tokens,
          completion_tokens: data.usage.completion_tokens,
          total_tokens: data.usage.total_tokens,
          finish_reason: choice.finish_reason as CompletionResponse['finish_reason'],
        };
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
        clearTimeout(timeoutId);
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
