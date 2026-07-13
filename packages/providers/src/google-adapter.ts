import type {
  ProviderAdapter,
  CompletionRequest,
  CompletionResponse,
  ProviderHealthStatus,
  ToolCall,
} from '@kingdomos/core';
import { ProviderError } from './errors.js';
import { createAbortSignal } from './abort.js';

export interface GoogleConfig {
  api_key: string;
  endpoint?: string;
  timeout_ms?: number;
}

const DEFAULT_ENDPOINT = 'https://generativelanguage.googleapis.com';
const DEFAULT_TIMEOUT = 30_000;

function mapGoogleToolConfig(choice: CompletionRequest['tool_choice']): unknown {
  if (choice === undefined) return null;
  if (typeof choice === 'object') {
    return { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [choice.name] } };
  }
  switch (choice) {
    case 'required':
      return { functionCallingConfig: { mode: 'ANY' } };
    case 'none':
      return { functionCallingConfig: { mode: 'NONE' } };
    case 'auto':
    default:
      return { functionCallingConfig: { mode: 'AUTO' } };
  }
}

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

      const generationConfig: Record<string, unknown> = {
        maxOutputTokens: request.max_tokens,
        temperature: request.temperature ?? 0.7,
        ...(request.stop && { stopSequences: request.stop }),
      };

      // Structured output → Gemini's responseMimeType + responseSchema.
      if (request.response_format) {
        generationConfig.responseMimeType = 'application/json';
        generationConfig.responseSchema = request.response_format.schema;
      }

      const body: Record<string, unknown> = { contents, generationConfig };

      // Native tool-use → Gemini functionDeclarations.
      if (request.tools && request.tools.length > 0) {
        body.tools = [
          {
            functionDeclarations: request.tools.map((t) => ({
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            })),
          },
        ];
        const toolConfig = mapGoogleToolConfig(request.tool_choice);
        if (toolConfig) body.toolConfig = toolConfig;
      }

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
            `Google returned ${response.status}: ${text}`,
            'google',
            response.status,
            response.status === 429 || response.status >= 500
          );
        }

        const data = (await response.json()) as {
          candidates: Array<{
            content: { parts: Array<{ text?: string; functionCall?: { name: string; args?: Record<string, unknown> } }> };
            finishReason: string;
          }>;
          usageMetadata?: {
            promptTokenCount: number;
            candidatesTokenCount: number;
            totalTokenCount: number;
          };
        };

        const candidate = data.candidates[0];
        const parts = candidate.content.parts;
        const content = parts.map((p) => p.text ?? '').join('');
        const usage = data.usageMetadata;

        const tool_calls: ToolCall[] = parts
          .filter((p) => p.functionCall)
          .map((p, i) => ({
            id: `${p.functionCall!.name}_${i}`,
            name: p.functionCall!.name,
            arguments: p.functionCall!.args ?? {},
          }));
        const hasToolCalls = tool_calls.length > 0;

        return {
          content,
          prompt_tokens: usage?.promptTokenCount ?? 0,
          completion_tokens: usage?.candidatesTokenCount ?? 0,
          total_tokens: usage?.totalTokenCount ?? 0,
          finish_reason: hasToolCalls ? 'tool_calls' : candidate.finishReason === 'STOP' ? 'stop' : 'length',
          ...(hasToolCalls && { tool_calls }),
        };
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        throw new ProviderError(`Google request failed: ${message}`, 'google', 0, true);
      } finally {
        abort.dispose();
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
