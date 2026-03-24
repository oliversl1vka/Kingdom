import type {
  ProviderAdapter,
  CompletionRequest,
  CompletionResponse,
  ProviderHealthStatus,
} from '@kingdomos/core';
import { ProviderError } from './errors.js';

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
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${api_key}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
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
        throw new ProviderError(`OpenAI request failed: ${message}`, 'openai', 0, true);
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
