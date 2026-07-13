/**
 * PHASE5 test harness: a deterministic tool-using ProviderAdapter whose
 * `complete()` returns a scripted queue of turns. Each turn is either a set of
 * tool_calls (read_file / apply_edit / run_command / finish) or plain prose. No
 * network, no real model.
 */
import type {
  ProviderAdapter,
  CompletionRequest,
  CompletionResponse,
  ProviderHealthStatus,
  ToolCall,
} from '@kingdomos/core';

export interface ScriptedTurn {
  /** Tool calls to emit this turn. Omit/empty ⇒ prose-only turn. */
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
  /** Assistant prose content for this turn. */
  content?: string;
  /** Tokens this turn reports (default 10). */
  tokens?: number;
}

export class FakeAgenticProvider implements ProviderAdapter {
  readonly provider_id = 'fake-agentic';
  private turns: ScriptedTurn[];
  /** Every request this provider received — for assertions (e.g. signal propagation). */
  readonly requests: CompletionRequest[] = [];
  private idx = 0;

  constructor(turns: ScriptedTurn[]) {
    this.turns = turns;
  }

  /** Number of times complete() was invoked. */
  get callCount(): number {
    return this.requests.length;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push(request);
    const turn = this.turns[this.idx] ?? { content: '', tokens: 0 };
    if (this.idx < this.turns.length) this.idx += 1;

    const tokens = turn.tokens ?? 10;
    const toolCalls: ToolCall[] = (turn.toolCalls ?? []).map((c, i) => ({
      id: `call-${this.idx}-${i}`,
      name: c.name,
      arguments: c.arguments,
    }));

    return {
      content: turn.content ?? '',
      prompt_tokens: tokens,
      completion_tokens: tokens,
      total_tokens: tokens,
      finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  async healthCheck(): Promise<ProviderHealthStatus> {
    return { status: 'healthy' };
  }
}
