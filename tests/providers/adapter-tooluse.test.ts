import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createOpenAIAdapter,
  createAnthropicAdapter,
  createGoogleAdapter,
  createLlamaCppAdapter,
  createLMStudioAdapter,
} from '@kingdomos/providers';
import type { CompletionRequest, ToolDefinition, ResponseFormat } from '@kingdomos/core';

// ── fetch mock plumbing ──────────────────────────────────────────────────────
let lastUrl: string;
let lastInit: RequestInit;

function mockFetchOnce(jsonBody: unknown, ok = true, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      lastUrl = url;
      lastInit = init;
      return {
        ok,
        status,
        headers: { get: () => null },
        json: async () => jsonBody,
        text: async () => JSON.stringify(jsonBody),
      } as unknown as Response;
    }),
  );
}

function bodyOf(): Record<string, unknown> {
  return JSON.parse(lastInit.body as string) as Record<string, unknown>;
}

const TOOLS: ToolDefinition[] = [
  {
    name: 'emit_task_graph',
    description: 'Emit a task graph',
    parameters: { type: 'object', properties: { tasks: { type: 'array' } }, required: ['tasks'] },
  },
];

const FORMAT: ResponseFormat = {
  type: 'json_schema',
  name: 'verdict',
  schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
  strict: true,
};

const baseReq: CompletionRequest = {
  model: 'm',
  messages: [{ role: 'user', content: 'hi' }],
  max_tokens: 256,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── OpenAI ───────────────────────────────────────────────────────────────────
describe('openai adapter — tool-use & structured output', () => {
  it('keeps the prose body byte-identical when no tools/format given', () => {
    mockFetchOnce({
      choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    });
    const a = createOpenAIAdapter({ api_key: 'k' });
    return a.complete({ ...baseReq, temperature: 0, stop: ['X'] }).then((r) => {
      const body = bodyOf();
      expect(body).toEqual({
        model: 'm',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 256,
        temperature: 0,
        stop: ['X'],
      });
      expect(body.tools).toBeUndefined();
      expect(body.response_format).toBeUndefined();
      expect(r.content).toBe('hello');
      expect(r.finish_reason).toBe('stop');
      expect(r.tool_calls).toBeUndefined();
    });
  });

  it('maps tools + tool_choice to OpenAI function shape', async () => {
    mockFetchOnce({
      choices: [{ message: { content: '' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    });
    const a = createOpenAIAdapter({ api_key: 'k' });
    await a.complete({ ...baseReq, tools: TOOLS, tool_choice: { name: 'emit_task_graph' } });
    const body = bodyOf();
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'emit_task_graph',
          description: 'Emit a task graph',
          parameters: TOOLS[0].parameters,
        },
      },
    ]);
    expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'emit_task_graph' } });
  });

  it('maps response_format to json_schema', async () => {
    mockFetchOnce({
      choices: [{ message: { content: '{}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    });
    const a = createOpenAIAdapter({ api_key: 'k' });
    await a.complete({ ...baseReq, response_format: FORMAT });
    const body = bodyOf() as { response_format: { type: string; json_schema: Record<string, unknown> } };
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema).toEqual({
      name: 'verdict',
      schema: FORMAT.schema,
      strict: true,
    });
  });

  it('parses tool_calls and sets finish_reason tool_calls', async () => {
    mockFetchOnce({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { id: 'tc1', type: 'function', function: { name: 'emit_task_graph', arguments: '{"tasks":[1,2]}' } },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    });
    const a = createOpenAIAdapter({ api_key: 'k' });
    const r = await a.complete({ ...baseReq, tools: TOOLS });
    expect(r.finish_reason).toBe('tool_calls');
    expect(r.tool_calls).toEqual([{ id: 'tc1', name: 'emit_task_graph', arguments: { tasks: [1, 2] } }]);
    expect(r.content).toBe('');
  });
});

// ── Anthropic ──────────────────────────────────────────────────────────────
describe('anthropic adapter — tool-use & structured output', () => {
  it('keeps prose body unchanged when no tools/format', async () => {
    mockFetchOnce({
      content: [{ type: 'text', text: 'hi there' }],
      usage: { input_tokens: 4, output_tokens: 6 },
      stop_reason: 'end_turn',
    });
    const a = createAnthropicAdapter({ api_key: 'k' });
    const r = await a.complete({ ...baseReq, temperature: 0 });
    const body = bodyOf();
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
    expect(r.content).toBe('hi there');
    expect(r.finish_reason).toBe('stop');
  });

  it('maps tools + tool_choice and parses tool_use blocks', async () => {
    mockFetchOnce({
      content: [
        { type: 'text', text: 'thinking' },
        { type: 'tool_use', id: 'tu1', name: 'emit_task_graph', input: { tasks: ['a'] } },
      ],
      usage: { input_tokens: 4, output_tokens: 6 },
      stop_reason: 'tool_use',
    });
    const a = createAnthropicAdapter({ api_key: 'k' });
    const r = await a.complete({ ...baseReq, tools: TOOLS, tool_choice: { name: 'emit_task_graph' } });
    const body = bodyOf() as { tools: Array<{ name: string; input_schema: unknown }>; tool_choice: unknown };
    expect(body.tools[0].name).toBe('emit_task_graph');
    expect(body.tools[0].input_schema).toEqual(TOOLS[0].parameters);
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'emit_task_graph' });
    expect(r.finish_reason).toBe('tool_calls');
    expect(r.tool_calls).toEqual([{ id: 'tu1', name: 'emit_task_graph', arguments: { tasks: ['a'] } }]);
  });

  it('synthesizes a forced tool for response_format and surfaces JSON as content', async () => {
    mockFetchOnce({
      content: [{ type: 'tool_use', id: 'tu2', name: 'verdict', input: { ok: true } }],
      usage: { input_tokens: 4, output_tokens: 6 },
      stop_reason: 'tool_use',
    });
    const a = createAnthropicAdapter({ api_key: 'k' });
    const r = await a.complete({ ...baseReq, response_format: FORMAT });
    const body = bodyOf() as { tools: Array<{ name: string; input_schema: unknown }>; tool_choice: unknown };
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].name).toBe('verdict');
    expect(body.tools[0].input_schema).toEqual(FORMAT.schema);
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'verdict' });
    // The forced-tool input is surfaced as JSON content for structured-output callers.
    expect(JSON.parse(r.content)).toEqual({ ok: true });
  });
});

// ── Google ───────────────────────────────────────────────────────────────────
describe('google adapter — tool-use & structured output', () => {
  it('keeps prose body unchanged when no tools/format', async () => {
    mockFetchOnce({
      candidates: [{ content: { parts: [{ text: 'gemini hi' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2, totalTokenCount: 3 },
    });
    const a = createGoogleAdapter({ api_key: 'k' });
    const r = await a.complete({ ...baseReq });
    const body = bodyOf();
    expect(body.tools).toBeUndefined();
    expect(r.content).toBe('gemini hi');
  });

  it('maps tools to functionDeclarations and parses functionCall parts', async () => {
    mockFetchOnce({
      candidates: [
        {
          content: { parts: [{ functionCall: { name: 'emit_task_graph', args: { tasks: [9] } } }] },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2, totalTokenCount: 3 },
    });
    const a = createGoogleAdapter({ api_key: 'k' });
    const r = await a.complete({ ...baseReq, tools: TOOLS, tool_choice: 'required' });
    const body = bodyOf() as {
      tools: Array<{ functionDeclarations: Array<{ name: string }> }>;
      toolConfig?: { functionCallingConfig?: { mode?: string } };
    };
    expect(body.tools[0].functionDeclarations[0].name).toBe('emit_task_graph');
    expect(body.toolConfig?.functionCallingConfig?.mode).toBe('ANY');
    expect(r.finish_reason).toBe('tool_calls');
    expect(r.tool_calls).toEqual([{ id: 'emit_task_graph_0', name: 'emit_task_graph', arguments: { tasks: [9] } }]);
  });

  it('maps response_format to responseMimeType + responseSchema', async () => {
    mockFetchOnce({
      candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2, totalTokenCount: 3 },
    });
    const a = createGoogleAdapter({ api_key: 'k' });
    await a.complete({ ...baseReq, response_format: FORMAT });
    const body = bodyOf() as { generationConfig: { responseMimeType?: string; responseSchema?: unknown } };
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseSchema).toEqual(FORMAT.schema);
  });
});

// ── llama.cpp ─────────────────────────────────────────────────────────────────
describe('llama.cpp adapter', () => {
  it('uses provider_id llamacpp and the default 8080 endpoint', async () => {
    mockFetchOnce({
      choices: [{ message: { content: 'local' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    });
    const a = createLlamaCppAdapter();
    expect(a.provider_id).toBe('llamacpp');
    const r = await a.complete({ ...baseReq });
    expect(lastUrl).toBe('http://localhost:8080/v1/chat/completions');
    expect(r.content).toBe('local');
    // No api_key header.
    expect((lastInit.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('forwards json_schema response_format (structured output) on the OpenAI-compatible body', async () => {
    mockFetchOnce({
      choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    });
    const a = createLlamaCppAdapter({ endpoint: 'http://localhost:9090' });
    await a.complete({ ...baseReq, response_format: FORMAT });
    const body = bodyOf() as { response_format: { type: string; json_schema: { schema: unknown } } };
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.schema).toEqual(FORMAT.schema);
    expect(lastUrl).toBe('http://localhost:9090/v1/chat/completions');
  });

  it('forwards tools via the OpenAI-compatible tools field', async () => {
    mockFetchOnce({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [{ id: 'x', function: { name: 'emit_task_graph', arguments: '{"tasks":[]}' } }],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    });
    const a = createLlamaCppAdapter();
    const r = await a.complete({ ...baseReq, tools: TOOLS });
    const body = bodyOf() as { tools: Array<{ type: string }> };
    expect(body.tools[0].type).toBe('function');
    expect(r.tool_calls).toEqual([{ id: 'x', name: 'emit_task_graph', arguments: { tasks: [] } }]);
  });
});

// ── LM Studio back-compat ─────────────────────────────────────────────────────
describe('lmstudio adapter — unchanged prose path', () => {
  it('does NOT emit json_schema response_format even if requested (weak-model fallback)', async () => {
    mockFetchOnce({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    });
    const a = createLMStudioAdapter({ endpoint: 'http://localhost:1234' });
    await a.complete({ ...baseReq, response_format: FORMAT });
    const body = bodyOf();
    expect(body.response_format).toBeUndefined();
  });
});
