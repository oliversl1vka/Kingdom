// Shared request/response shaping for OpenAI-compatible `/v1/chat/completions`
// endpoints (OpenAI, LM Studio, llama.cpp's llama-server). Keeping this in one
// place guarantees the tool-use / structured-output mapping stays byte-identical
// across the three adapters and, critically, that the prose-only path is
// untouched when none of the new fields are present.

import type {
  CompletionRequest,
  CompletionResponse,
  ToolCall,
} from '@kingdomos/core';

/** Raw OpenAI-style tool_call as it appears on the wire. */
interface RawToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface RawChoiceMessage {
  content: string | null;
  tool_calls?: RawToolCall[];
}

export interface OpenAICompatChoice {
  message: RawChoiceMessage;
  finish_reason: string;
}

export interface OpenAICompatResponse {
  choices: OpenAICompatChoice[];
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

/**
 * Build the OpenAI-compatible request body. When no tools/response_format are
 * supplied the returned object is exactly what the adapters built before this
 * change — guaranteeing zero behavior drift on the prose path.
 *
 * `supportsJsonSchemaResponseFormat` lets callers (OpenAI, llama.cpp) opt into
 * the `{type:'json_schema'}` response_format. All three current consumers
 * support it, but the flag keeps the helper honest.
 */
export function buildOpenAICompatBody(
  request: CompletionRequest,
  opts: { supportsJsonSchemaResponseFormat?: boolean } = {},
): Record<string, unknown> {
  const messages: Array<{ role: string; content: string }> = [];
  if (request.system) {
    messages.push({ role: 'system', content: request.system });
  }
  messages.push(...request.messages);

  const body: Record<string, unknown> = {
    model: request.model,
    messages,
    max_tokens: request.max_tokens,
    temperature: request.temperature ?? 0.7,
    ...(request.stop && { stop: request.stop }),
  };

  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
    if (request.tool_choice !== undefined) {
      body.tool_choice = mapToolChoice(request.tool_choice);
    }
  }

  if (request.response_format && opts.supportsJsonSchemaResponseFormat !== false) {
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: request.response_format.name ?? 'response',
        schema: request.response_format.schema,
        ...(request.response_format.strict !== undefined && {
          strict: request.response_format.strict,
        }),
      },
    };
  }

  return body;
}

function mapToolChoice(choice: NonNullable<CompletionRequest['tool_choice']>): unknown {
  if (typeof choice === 'string') return choice; // 'auto' | 'none' | 'required'
  return { type: 'function', function: { name: choice.name } };
}

/** Parse an OpenAI-compatible response into our CompletionResponse. */
export function parseOpenAICompatResponse(
  data: OpenAICompatResponse,
): CompletionResponse {
  const choice = data.choices[0];
  const rawCalls = choice.message.tool_calls ?? [];
  const tool_calls: ToolCall[] = rawCalls.map((c, i) => ({
    id: c.id ?? `call_${i}`,
    name: c.function?.name ?? '',
    arguments: safeParseArgs(c.function?.arguments),
  }));

  const hasToolCalls = tool_calls.length > 0;
  const finish_reason = hasToolCalls
    ? 'tool_calls'
    : (choice.finish_reason as CompletionResponse['finish_reason']);

  return {
    content: choice.message.content ?? '',
    prompt_tokens: data.usage.prompt_tokens,
    completion_tokens: data.usage.completion_tokens,
    total_tokens: data.usage.total_tokens,
    finish_reason,
    ...(hasToolCalls && { tool_calls }),
  };
}

function safeParseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
