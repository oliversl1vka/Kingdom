import type {
  ProviderAdapter,
  CompletionRequest,
  CompletionResponse,
  ProviderHealthStatus,
  ToolCall,
} from '@kingdomos/core';
import { ProviderError } from './errors.js';
import { createAbortSignal } from './abort.js';

export interface AnthropicConfig {
  api_key: string;
  endpoint?: string;
  timeout_ms?: number;
}

const DEFAULT_ENDPOINT = 'https://api.anthropic.com';
const DEFAULT_TIMEOUT = 30_000;
const API_VERSION = '2023-06-01';

function mapAnthropicToolChoice(choice: NonNullable<CompletionRequest['tool_choice']>): unknown {
  if (typeof choice === 'object') return { type: 'tool', name: choice.name };
  switch (choice) {
    case 'required':
      return { type: 'any' };
    case 'none':
      return { type: 'none' };
    case 'auto':
    default:
      return { type: 'auto' };
  }
}

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

      // Native tool-use. Anthropic uses `input_schema` (vs OpenAI `parameters`).
      const anthropicTools: Array<{ name: string; description: string; input_schema: unknown }> = [];
      if (request.tools && request.tools.length > 0) {
        for (const t of request.tools) {
          anthropicTools.push({ name: t.name, description: t.description, input_schema: t.parameters });
        }
      }

      // Anthropic has no native json_schema response_format. Emulate structured
      // output by synthesizing a single tool whose input schema IS the requested
      // schema, and forcing the model to call it. The tool result is surfaced as
      // JSON `content` so structured-output callers get the same shape as OpenAI.
      const forcedFormatToolName = request.response_format
        ? request.response_format.name ?? 'structured_response'
        : null;
      if (forcedFormatToolName && request.response_format) {
        anthropicTools.push({
          name: forcedFormatToolName,
          description: 'Return the response as a structured object matching the schema.',
          input_schema: request.response_format.schema,
        });
      }

      if (anthropicTools.length > 0) {
        body.tools = anthropicTools;
        if (forcedFormatToolName) {
          body.tool_choice = { type: 'tool', name: forcedFormatToolName };
        } else if (request.tool_choice !== undefined) {
          body.tool_choice = mapAnthropicToolChoice(request.tool_choice);
        }
      }

      const abort = createAbortSignal(request.timeout_ms ?? timeout_ms, request.signal);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': api_key,
            'anthropic-version': API_VERSION,
          },
          body: JSON.stringify(body),
          signal: abort.signal,
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
          content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
          usage: { input_tokens: number; output_tokens: number };
          stop_reason: string;
        };

        const textContent = data.content.find((c) => c.type === 'text');
        const toolUseBlocks = data.content.filter((c) => c.type === 'tool_use');
        const prompt_tokens = data.usage.input_tokens;
        const completion_tokens = data.usage.output_tokens;

        const tool_calls: ToolCall[] = toolUseBlocks.map((b, i) => ({
          id: b.id ?? `tool_${i}`,
          name: b.name ?? '',
          arguments: b.input ?? {},
        }));

        // When response_format was emulated via a forced tool, surface its input
        // as JSON content so structured-output callers parse it like OpenAI/Gemini.
        let content = textContent?.text ?? '';
        if (forcedFormatToolName) {
          const forced = toolUseBlocks.find((b) => b.name === forcedFormatToolName);
          if (forced) content = JSON.stringify(forced.input ?? {});
        }

        const hasToolCalls = tool_calls.length > 0;
        const finish_reason: CompletionResponse['finish_reason'] =
          hasToolCalls && !forcedFormatToolName
            ? 'tool_calls'
            : data.stop_reason === 'end_turn' || data.stop_reason === 'tool_use'
              ? 'stop'
              : (data.stop_reason as CompletionResponse['finish_reason']);

        return {
          content,
          prompt_tokens,
          completion_tokens,
          total_tokens: prompt_tokens + completion_tokens,
          finish_reason,
          ...(hasToolCalls && !forcedFormatToolName && { tool_calls }),
        };
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        throw new ProviderError(`Anthropic request failed: ${message}`, 'anthropic', 0, true);
      } finally {
        abort.dispose();
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
