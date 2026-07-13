import type { FailureType, JobPacket, CompletionResponse, ProviderAdapter, Message, ToolDefinition, ModelCapabilities } from '../types.js';
import { HeartbeatWriter } from './heartbeat-writer.js';
import type Database from 'better-sqlite3';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { runSandboxedCommand, type CommandPolicy } from './command-sandbox.js';

export interface WorkerResult {
  job_id: string;
  success: boolean;
  content: string;
  tokens_used: number;
  finish_reason: string;
  error?: string;
  /** PHASE2 (P2.1): files the agentic loop actually applied via apply_edit. */
  applied_files?: string[];
  /** PHASE2 (P2.1): true when the agentic tool loop ran (vs the one-shot path). */
  agentic?: boolean;
}

/**
 * PHASE2 (P2.1): structured-edit callback. Mirrors blacksmith's `applyEdit` so
 * core never statically depends on @kingdomos/blacksmith — summon wires the real
 * applicator; tests inject a fake.
 */
export type ApplyEditFn = (
  edit: { path: string; old_string: string; new_string: string },
  workspace: string,
) => { success: boolean; appliedFile?: string; error?: string; created?: boolean };

export interface AgenticOptions {
  /** Capabilities of the packet's model. When `tool_use` is true the loop runs. */
  capabilities?: ModelCapabilities | null;
  /** Workspace root — sandbox cwd and apply_edit base. */
  workspace: string;
  /** Structured-edit applicator (blacksmith). Required for apply_edit. */
  applyEdit: ApplyEditFn;
  /** Max agentic iterations (tool round-trips). Default 8. */
  maxIterations?: number;
  /** Token budget for the whole loop. Default = packet.max_tokens * (maxIterations + 1). */
  tokenBudget?: number;
  /** Command sandbox policy (validation_command, timeout). */
  commandPolicy?: CommandPolicy;
  verbose?: boolean;
}

/**
 * PHASE5 (§5.2): drive options for the exported {@link runAgenticLoop} — adds
 * cancellation (AbortSignal) and a heartbeat callback so the dispatcher can own
 * the job lifecycle while reusing the loop. `executeWorker` constructs these
 * internally from its HeartbeatWriter (back-compat).
 */
export interface AgenticDriveOptions extends AgenticOptions {
  /** Abort the loop between iterations and propagate to provider.complete. */
  signal?: AbortSignal;
  /** Progress callback: (status, detail, cumulativeTokens). */
  onHeartbeat?: (status: string, detail: string, tokens: number) => void;
}

export function classifyWorkerFailure(error: unknown): FailureType {
  const structured = classifyStructuredProviderFailure(error);
  if (structured) return structured;

  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (/timeout|timed out|abort|aborted|aborterror/.test(lower)) return 'timeout';
  if (/context[_ -]?length|context window|context limit|max(?:imum)? context|too many tokens|\btokens?\b/.test(lower)) {
    return 'token-overflow';
  }
  return 'runtime-crash';
}

// PHASE2 (P2.1): tools exposed to a tool-using Knight.
const AGENTIC_TOOLS: ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Read a workspace-relative file (optionally a line range) to ground your edits in the real code.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path.' },
        start_line: { type: 'number', description: 'Optional 1-based start line.' },
        end_line: { type: 'number', description: 'Optional 1-based end line.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'apply_edit',
    description: 'Apply a precise edit by replacing an exact unique snippet with new text. Use an empty old_string to create a new file.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path.' },
        old_string: { type: 'string', description: 'Exact text to replace (must be unique). Empty ⇒ create file.' },
        new_string: { type: 'string', description: 'Replacement text.' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'run_command',
    description: 'Run a whitelisted read-only inspection command or the configured validation command, sandboxed to the workspace.',
    parameters: {
      type: 'object',
      properties: { command: { type: 'string', description: 'The shell command to run.' } },
      required: ['command'],
    },
  },
  {
    name: 'finish',
    description: 'Signal that the task is complete. Provide a short summary of what changed.',
    parameters: {
      type: 'object',
      properties: { summary: { type: 'string', description: 'Summary of the work done.' } },
      required: ['summary'],
    },
  },
];

export async function executeWorker(
  db: Database.Database,
  provider: ProviderAdapter,
  packetPath: string,
  workerId: string,
  agentic?: AgenticOptions,
): Promise<WorkerResult> {
  const raw = readFileSync(packetPath, 'utf-8');
  const packet: JobPacket = JSON.parse(raw);

  const heartbeat = new HeartbeatWriter(db, packet.job_id, workerId);
  heartbeat.start();

  try {
    // Mark job as running
    const now = new Date();
    const timeoutAt = new Date(now.getTime() + packet.timeout_seconds * 1000).toISOString();
    db.prepare('UPDATE jobs SET worker_id = ?, started_at = ?, timeout_at = ?, status = ? WHERE id = ?')
      .run(workerId, now.toISOString(), timeoutAt, 'running', packet.job_id);

    // Check for cancellation before starting
    const job = db.prepare('SELECT cancel_requested FROM jobs WHERE id = ?').get(packet.job_id) as { cancel_requested: number } | undefined;
    if (job?.cancel_requested) {
      db.prepare("UPDATE jobs SET status = 'cancelled' WHERE id = ?").run(packet.job_id);
      return { job_id: packet.job_id, success: false, content: '', tokens_used: 0, finish_reason: 'cancelled', error: 'Job was cancelled before execution' };
    }

    heartbeat.update('healthy', 'Sending request to model...', 0);

    // PHASE2 (P2.1): tool-using models run the bounded agentic loop; everyone
    // else keeps the exact one-shot prose path below.
    const useAgentic = !!agentic && agentic.capabilities?.tool_use === true;
    let result: WorkerResult;

    if (useAgentic) {
      // Back-compat: bridge the loop's heartbeat callback to this worker's writer.
      result = await runAgenticLoop(provider, packet, {
        ...agentic!,
        onHeartbeat: (status, detail, tokens) => heartbeat.update(status as Parameters<typeof heartbeat.update>[0], detail, tokens),
      });
    } else {
      // ── Legacy one-shot path (unchanged) ──
      const response: CompletionResponse = await provider.complete({
        model: packet.model_id,
        messages: packet.messages,
        max_tokens: packet.max_tokens,
        temperature: 0.3,
        timeout_ms: packet.timeout_seconds * 1000,
      });

      heartbeat.update('finishing', 'Writing result...', response.completion_tokens);

      result = {
        job_id: packet.job_id,
        success: true,
        content: response.content,
        tokens_used: response.total_tokens,
        finish_reason: response.finish_reason,
      };
    }

    mkdirSync(dirname(packet.result_path), { recursive: true });
    writeFileSync(packet.result_path, JSON.stringify(result, null, 2), 'utf-8');

    // Update job status based on the actual outcome.
    let finalStatus: string;
    if (!result.success) {
      finalStatus = result.finish_reason === 'cancelled' ? 'cancelled' : 'failed-runtime-crash';
    } else {
      finalStatus = 'completed';
    }
    db.prepare('UPDATE jobs SET status = ?, result_path = ?, tokens_used = ? WHERE id = ?')
      .run(finalStatus, packet.result_path, result.tokens_used, packet.job_id);

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    const failureType = classifyWorkerFailure(error);

    db.prepare('UPDATE jobs SET status = ?, failure_type = ? WHERE id = ?')
      .run(`failed-${failureType}`, failureType, packet.job_id);

    return {
      job_id: packet.job_id,
      success: false,
      content: '',
      tokens_used: 0,
      finish_reason: 'error',
      error: message,
    };
  } finally {
    heartbeat.stop();
  }
}

/**
 * PHASE2 (P2.1): bounded read/act/verify loop. The model is given native tools and
 * loops until it calls `finish` or hits the iteration / token cap. Tool results are
 * fed back as `user` messages (works across every adapter — no `role:'tool'` needed).
 *
 * PHASE5 (§5.2): exported and driven via {@link AgenticDriveOptions} (signal +
 * heartbeat). This function does NOT touch jobs.status or write a result file —
 * the caller (worker or dispatcher) owns lifecycle. Honours `signal` between
 * iterations and propagates it into every `provider.complete`.
 */
export async function runAgenticLoop(
  provider: ProviderAdapter,
  packet: JobPacket,
  agentic: AgenticDriveOptions,
): Promise<WorkerResult> {
  const maxIterations = agentic.maxIterations ?? 8;
  const perCallTokens = packet.max_tokens;
  const tokenBudget = agentic.tokenBudget ?? perCallTokens * (maxIterations + 1);
  const beat = agentic.onHeartbeat ?? (() => {});

  // Pre-aborted ⇒ return immediately without calling the provider.
  if (agentic.signal?.aborted) {
    return {
      job_id: packet.job_id, success: false, content: '', tokens_used: 0,
      finish_reason: 'cancelled', applied_files: [], agentic: true,
    };
  }

  const messages: Message[] = [...packet.messages];
  messages.push({
    role: 'system',
    content:
      'You are operating as an autonomous coding agent with tools. Inspect the code with read_file/run_command, ' +
      'make precise changes with apply_edit (one edit per call, old_string must be unique), and call finish when done. ' +
      'Do NOT emit a unified diff — use apply_edit. You have a limited number of tool calls; be efficient.',
  });

  const appliedFiles = new Set<string>();
  let totalTokens = 0;
  let lastContent = '';
  let finishSummary = '';
  let finished = false;
  let cancelled = false;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (totalTokens >= tokenBudget) break;
    // PHASE5: cancellation checkpoint at the top of each iteration.
    if (agentic.signal?.aborted) { cancelled = true; break; }

    beat('healthy', `Agentic iteration ${iteration + 1}/${maxIterations}...`, totalTokens);

    const response = await provider.complete({
      model: packet.model_id,
      messages,
      max_tokens: perCallTokens,
      temperature: 0.3,
      timeout_ms: packet.timeout_seconds * 1000,
      tools: AGENTIC_TOOLS,
      tool_choice: 'auto',
      signal: agentic.signal,
    });

    totalTokens += response.total_tokens;
    if (response.content) lastContent = response.content;

    const calls = response.tool_calls ?? [];
    if (calls.length === 0) {
      // No tool call — treat the prose as the final answer and stop.
      finishSummary = response.content;
      break;
    }

    // Record the assistant's tool intent so the next turn has continuity.
    const intent = calls.map((c) => `${c.name}(${JSON.stringify(c.arguments).slice(0, 200)})`).join(', ');
    messages.push({ role: 'assistant', content: `Calling tools: ${intent}` });

    const toolResults: string[] = [];
    for (const call of calls) {
      if (call.name === 'finish') {
        finished = true;
        finishSummary = String(call.arguments.summary ?? lastContent ?? 'done');
        break;
      }
      toolResults.push(`[${call.name}] ${executeTool(call.name, call.arguments, packet, agentic, appliedFiles)}`);
    }

    if (finished) break;
    messages.push({ role: 'user', content: `Tool results:\n${toolResults.join('\n')}` });
  }

  beat('finishing', 'Writing result...', totalTokens);

  // PHASE5: a cancellation observed mid-loop is a failure outcome, not success.
  if (cancelled) {
    return {
      job_id: packet.job_id, success: false, content: finishSummary || lastContent || '',
      tokens_used: totalTokens, finish_reason: 'cancelled', applied_files: [...appliedFiles], agentic: true,
    };
  }

  const summary = finishSummary || lastContent || `Applied ${appliedFiles.size} edit(s).`;
  return {
    job_id: packet.job_id,
    success: true,
    content: summary,
    tokens_used: totalTokens,
    finish_reason: finished ? 'stop' : 'length',
    applied_files: [...appliedFiles],
    agentic: true,
  };
}

function executeTool(
  name: string,
  args: Record<string, unknown>,
  packet: JobPacket,
  agentic: AgenticOptions,
  appliedFiles: Set<string>,
): string {
  const workspace = agentic.workspace;
  try {
    switch (name) {
      case 'read_file': {
        const rel = sanitizeRel(String(args.path ?? ''));
        if (!rel) return 'error: invalid path';
        const full = join(workspace, rel);
        if (!existsSync(full)) return `error: file not found: ${rel}`;
        const lines = readFileSync(full, 'utf-8').replace(/\r\n/g, '\n').split('\n');
        const start = Number(args.start_line) > 0 ? Number(args.start_line) - 1 : 0;
        const end = Number(args.end_line) > 0 ? Number(args.end_line) : lines.length;
        const slice = lines.slice(start, Math.min(end, lines.length));
        return `${rel} (lines ${start + 1}-${start + slice.length}):\n${slice.join('\n').slice(0, 6000)}`;
      }
      case 'apply_edit': {
        // Scope guard: only allow edits inside allowed_files when a plan exists.
        const rel = sanitizeRel(String(args.path ?? ''));
        if (!rel) return 'error: invalid path';
        if (packet.allowed_files.length > 0 && !packet.allowed_files.includes(rel) && packet.scope_mode === 'planned-files') {
          return `error: "${rel}" is outside the allowed file set (${packet.allowed_files.join(', ')})`;
        }
        const res = agentic.applyEdit(
          { path: rel, old_string: String(args.old_string ?? ''), new_string: String(args.new_string ?? '') },
          workspace,
        );
        if (res.success) {
          if (res.appliedFile) appliedFiles.add(res.appliedFile);
          return `ok: ${res.created ? 'created' : 'edited'} ${res.appliedFile}`;
        }
        return `error: ${res.error}`;
      }
      case 'run_command': {
        if (!agentic.commandPolicy) return 'error: command execution disabled';
        const res = runSandboxedCommand(String(args.command ?? ''), workspace, agentic.commandPolicy);
        if (!res.allowed) return `rejected: ${res.rejectedReason}`;
        return `exit ${res.exitCode}:\n${res.stdout}`;
      }
      default:
        return `error: unknown tool ${name}`;
    }
  } catch (err) {
    return `error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function sanitizeRel(path: string): string | null {
  const rel = path.replace(/\\/g, '/').replace(/^\.\//, '').trim();
  if (!rel || rel.startsWith('/') || /^[A-Za-z]:\//.test(rel) || rel.split('/').some((p) => p === '..')) return null;
  return rel;
}

function classifyStructuredProviderFailure(error: unknown): FailureType | null {
  if (!error || typeof error !== 'object') return null;
  const record = error as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.toLowerCase() : '';
  const code = typeof record.code === 'string' ? record.code.toLowerCase() : '';
  const statusCode = typeof record.statusCode === 'number'
    ? record.statusCode
    : typeof record.status === 'number'
      ? record.status
      : undefined;

  if (name === 'aborterror' || code === 'abort_err' || code === 'etimedout' || code === 'timeout') {
    return 'timeout';
  }
  if (statusCode === 408 || statusCode === 504) return 'timeout';
  if (statusCode === 413) return 'token-overflow';
  if (statusCode === 400) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(record.message ?? '').toLowerCase();
    if (/context[_ -]?length|context window|context limit|token|tokens/.test(message)) return 'token-overflow';
  }
  if (statusCode === 401 || statusCode === 403 || statusCode === 429 || (statusCode !== undefined && statusCode >= 500)) {
    return 'runtime-crash';
  }

  return null;
}
