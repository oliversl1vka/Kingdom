import type {
  ProviderAdapter,
  CompletionRequest,
  CompletionResponse,
  ProviderHealthStatus,
} from '@kingdomos/core';
import { ProviderError } from './errors.js';

export interface AnthropicConfig {
  api_key: string;
  endpoint?: string;
  timeout_ms?: number;
}

const DEFAULT_ENDPOINT = 'https://api.anthropic.com';
const DEFAULT_TIMEOUT = 30_000;
const API_VERSION = '2023-06-01';

export function createAnthropicAdapter(config: AnthropicConfig): ProviderAdapter {
  const { api_key, endpoint = DEFAULT_ENDPOINT, timeout_ms = DEFAULT_TIMEOUT } = config;

  return {
    provider_id: 'anthropic',

    async complete(request: CompletionRequest): Promise<CompletionResponse> {
      const url = `${endpoint}/v1/messages`;
      const messages: Array<{ role: string; content: string }> = request.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const body: Record<string, unknown> = {
        model: request.model,
        messages,
        max_tokens: request.max_tokens,
        temperature: request.temperature ?? 0.7,
        ...(request.system && { system: request.system }),
        ...(request.stop && { stop_sequences: request.stop }),
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout_ms);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': api_key,
            'anthropic-version': API_VERSION,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new ProviderError(
            `Anthropic returned ${response.status}: ${text}`,
            'anthropic',
            response.status,
            response.status === 429 || response.status >= 500
          );
        }

        const data = (await response.json()) as {
          content: Array<{ type: string; text: string }>;
          usage: { input_tokens: number; output_tokens: number };
          stop_reason: string;
        };

        const textContent = data.content.find((c) => c.type === 'text');
        const prompt_tokens = data.usage.input_tokens;
        const completion_tokens = data.usage.output_tokens;

        return {
          content: textContent?.text ?? '',
          prompt_tokens,
          completion_tokens,
          total_tokens: prompt_tokens + completion_tokens,
          finish_reason: data.stop_reason === 'end_turn' ? 'stop' : (data.stop_reason as CompletionResponse['finish_reason']),
        };
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        throw new ProviderError(`Anthropic request failed: ${message}`, 'anthropic', 0, true);
      } finally {
        clearTimeout(timeoutId);
      }
    },

    async healthCheck(): Promise<ProviderHealthStatus> {
      // Anthropic doesn't have a models endpoint; use a minimal messages call
      const start = Date.now();
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(`${endpoint}/v1/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': api_key,
            'anthropic-version': API_VERSION,
          },
          body: JSON.stringify({
            model: 'claude-3-haiku-20240307',
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 1,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const latency_ms = Date.now() - start;

        if (response.ok || response.status === 200) {
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
