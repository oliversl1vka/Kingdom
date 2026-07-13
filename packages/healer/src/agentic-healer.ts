import type {
  IncidentReport,
  HealerDiagnosis,
  HealerRecommendation,
  ProviderAdapter,
  ToolDefinition,
  Message,
} from '@kingdomos/core';
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, normalize, isAbsolute, sep } from 'node:path';

/**
 * PHASE3 (P3.3) — Agentic, execution-grounded Healer.
 *
 * When the healer model supports native tool-use, the Diagnostician is no longer
 * a one-shot text classifier. It runs a BOUNDED tool-using loop that lets it
 * REPRODUCE and INSPECT the failure before diagnosing:
 *   - read_file(path)            — read a workspace file (sandboxed to the workspace)
 *   - run_command(command)       — run a WHITELISTED command (validation/test cmd,
 *                                  `git diff`, grep) in the workspace
 *   - propose_patch(diff, rationale) — finish the loop with a concrete fix +
 *                                  structured diagnosis
 *   - finish(diagnosis...)       — finish with a non-repair recommendation
 *
 * Security/cost surface (Risk Register): command execution is whitelisted +
 * timeout-bounded + `cwd = workspace` (never the Kingdom repo); the loop is
 * bounded to MAX_ITERATIONS. Non-tool models never reach this path (the
 * Diagnostician keeps the prose-and-parse classifier).
 */

export interface AgenticHealerContext {
  /** Absolute path to the target workspace where commands run. */
  workspacePath: string;
  /** The task's verification/validation command (whitelisted target). */
  testCommand?: string;
  /** The global validation command (whitelisted target). */
  validationCommand?: string;
}

export interface AgenticHealerOptions {
  provider: ProviderAdapter;
  model: string;
  /** Max tool-loop iterations before forcing a diagnosis. Default 6. */
  maxIterations?: number;
  /** Per-command timeout (ms). Default 30s. */
  commandTimeoutMs?: number;
  /** Per-LLM-call timeout (ms). Default 30s. */
  llmTimeoutMs?: number;
  verbose?: boolean;
}

const HEALER_TOOLS: ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Read a UTF-8 text file from the workspace (relative path). Use to inspect the code that failed.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Workspace-relative file path' } },
      required: ['path'],
    },
  },
  {
    name: 'run_command',
    description: 'Run a whitelisted shell command in the workspace to reproduce/diagnose: the task test command, the validation/build command, `git diff`, or `grep`/`rg`. Other commands are rejected.',
    parameters: {
      type: 'object',
      properties: { command: { type: 'string', description: 'Shell command (must match the whitelist)' } },
      required: ['command'],
    },
  },
  {
    name: 'propose_patch',
    description: 'Finish: propose a unified diff that fixes the failure. It will be applied and re-verified; if the gate passes the incident resolves, otherwise it escalates.',
    parameters: {
      type: 'object',
      properties: {
        diff: { type: 'string', description: 'A valid unified diff (--- / +++ / @@ hunks)' },
        rationale: { type: 'string', description: 'One sentence: why this fixes the root cause' },
        probable_cause: { type: 'string' },
        confidence: { type: 'number' },
      },
      required: ['diff', 'rationale', 'probable_cause', 'confidence'],
    },
  },
  {
    name: 'finish',
    description: 'Finish without a patch: recommend retry, reassign, decompose, or escalate.',
    parameters: {
      type: 'object',
      properties: {
        probable_cause: { type: 'string' },
        confidence: { type: 'number' },
        action: { type: 'string', enum: ['retry', 'reassign', 'decompose', 'escalate'] },
        modifications: { type: 'string', description: 'for retry' },
        target_tier: { type: 'string', description: 'for reassign' },
        reason: { type: 'string', description: 'for reassign' },
        message: { type: 'string', description: 'for escalate' },
        new_subtasks: {
          type: 'array',
          description: 'for decompose: list of {title, description} subtasks',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
            },
          },
        },
      },
      required: ['probable_cause', 'confidence', 'action'],
    },
  },
];

/** Whitelist gate for run_command. Returns true if allowed. */
export function isCommandWhitelisted(command: string, ctx: AgenticHealerContext): boolean {
  const c = command.trim();
  if (!c) return false;
  // Reject shell metacharacters that could chain/escape the intended command.
  if (/[;&|`$><]/.test(c) && !/^git diff/.test(c)) return false;
  if (ctx.testCommand && c === ctx.testCommand.trim()) return true;
  if (ctx.validationCommand && c === ctx.validationCommand.trim()) return true;
  if (/^git diff(\s|$)/.test(c)) return true;
  if (/^(grep|rg)\s/.test(c)) return true;
  return false;
}

function safeReadFile(workspacePath: string, relPath: string): string {
  const normalized = normalize(relPath);
  if (isAbsolute(normalized) || normalized.startsWith('..') || normalized.includes(`..${sep}`)) {
    return `ERROR: path "${relPath}" escapes the workspace`;
  }
  const full = join(workspacePath, normalized);
  if (!existsSync(full)) return `ERROR: file not found: ${relPath}`;
  try {
    const content = readFileSync(full, 'utf-8');
    return content.length > 8000 ? content.slice(0, 8000) + '\n... [truncated]' : content;
  } catch (e) {
    return `ERROR: could not read ${relPath}: ${(e as Error).message}`;
  }
}

function runWhitelisted(command: string, ctx: AgenticHealerContext, timeoutMs: number): string {
  if (!isCommandWhitelisted(command, ctx)) {
    return `ERROR: command not whitelisted: ${command}`;
  }
  try {
    const out = execSync(command, {
      cwd: ctx.workspacePath,
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const s = out.toString('utf-8').trim();
    return (s || '(exit 0, no output)').slice(0, 4000);
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; message?: string };
    return [
      `(non-zero exit)`,
      e.stdout?.toString('utf-8') ?? '',
      e.stderr?.toString('utf-8') ?? '',
    ].join('\n').trim().slice(0, 4000) || (e.message ?? 'command failed');
  }
}

/**
 * Run the bounded agentic diagnosis loop. Returns the structured diagnosis the
 * caller persists/executes. The model drives the loop by calling tools; we feed
 * tool results back as user messages (the Message type is text-only by design).
 */
export async function runAgenticDiagnosis(
  incident: IncidentReport,
  ctx: AgenticHealerContext,
  options: AgenticHealerOptions,
  pastLessonsBlock = '',
): Promise<HealerDiagnosis> {
  const maxIterations = options.maxIterations ?? 6;
  const commandTimeoutMs = options.commandTimeoutMs ?? 30_000;
  const llmTimeoutMs = options.llmTimeoutMs ?? 30_000;

  const system = `You are an execution-grounded SRE healer. Diagnose a software failure by REPRODUCING and INSPECTING it with the provided tools, then either propose_patch (a concrete unified diff that fixes the ROOT cause — it will be applied and re-verified) or finish with another action.
Rules:
- Investigate before deciding: read the relevant files and/or re-run the failing command.
- Prefer propose_patch when you can pinpoint a concrete fix; the patch is gated on the SAME validation/test pipeline, so a wrong patch will be rejected.
- Keep diffs minimal and in valid unified-diff format (--- a/path, +++ b/path, @@ hunks).
- If confidence < 0.5, finish with action "escalate".
- You have at most ${maxIterations} tool calls.`;

  const messages: Message[] = [
    {
      role: 'user',
      content: `Incident:
- Task: ${incident.task_id}
- Failure type: ${incident.failure_type}
- Severity: ${incident.severity}
- Symptoms: ${JSON.stringify(incident.symptoms)}
- Context: ${incident.context_summary}
- History: ${JSON.stringify(incident.failure_history)}${pastLessonsBlock}

Whitelisted commands: ${[ctx.testCommand, ctx.validationCommand, 'git diff', 'grep/rg'].filter(Boolean).join(', ')}.
Investigate, then call propose_patch or finish.`,
    },
  ];

  for (let i = 0; i < maxIterations; i++) {
    const forceFinish = i === maxIterations - 1;
    const res = await options.provider.complete({
      model: options.model,
      messages,
      system,
      max_tokens: 1500,
      temperature: 0.1,
      timeout_ms: llmTimeoutMs,
      tools: HEALER_TOOLS,
      tool_choice: forceFinish ? { name: 'finish' } : 'auto',
    });

    const call = res.tool_calls?.[0];
    if (!call) {
      // Model answered in prose without a tool call — try once more, then bail.
      messages.push({ role: 'assistant', content: res.content || '(no content)' });
      messages.push({ role: 'user', content: 'You must call a tool: read_file, run_command, propose_patch, or finish.' });
      continue;
    }

    const args = call.arguments ?? {};
    if (call.name === 'propose_patch') {
      const confidence = clamp01(Number(args.confidence ?? 0.6));
      if (confidence < 0.5) {
        return escalateDiagnosis(incident.id, String(args.probable_cause ?? 'low confidence'), confidence);
      }
      return {
        incident_id: incident.id,
        probable_cause: String(args.probable_cause ?? 'see rationale'),
        confidence,
        recommendation: {
          action: 'repair',
          diff: String(args.diff ?? ''),
          rationale: String(args.rationale ?? ''),
        } as HealerRecommendation,
      };
    }

    if (call.name === 'finish') {
      return finishToDiagnosis(incident.id, args);
    }

    // Tool invocation — execute and feed the observation back.
    let observation = '';
    if (call.name === 'read_file') {
      observation = safeReadFile(ctx.workspacePath, String(args.path ?? ''));
    } else if (call.name === 'run_command') {
      observation = runWhitelisted(String(args.command ?? ''), ctx, commandTimeoutMs);
    } else {
      observation = `ERROR: unknown tool ${call.name}`;
    }
    if (options.verbose) {
      console.log(`[AgenticHealer] ${call.name}(${JSON.stringify(args).slice(0, 80)}) -> ${observation.slice(0, 120)}`);
    }
    messages.push({ role: 'assistant', content: `Called ${call.name} with ${JSON.stringify(args)}` });
    messages.push({ role: 'user', content: `Tool result for ${call.name}:\n${observation}` });
  }

  // Loop exhausted without a terminal tool call.
  return escalateDiagnosis(incident.id, 'Agentic loop exhausted without a conclusive diagnosis', 0.4);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function escalateDiagnosis(incidentId: string, cause: string, confidence: number): HealerDiagnosis {
  return {
    incident_id: incidentId,
    probable_cause: cause,
    confidence: clamp01(confidence),
    recommendation: { action: 'escalate', message: cause },
  };
}

function finishToDiagnosis(incidentId: string, args: Record<string, unknown>): HealerDiagnosis {
  const confidence = clamp01(Number(args.confidence ?? 0));
  const cause = String(args.probable_cause ?? 'Unknown');
  const action = String(args.action ?? 'escalate');

  if (confidence < 0.5 && action !== 'escalate') {
    return escalateDiagnosis(incidentId, `Low confidence (${confidence}): ${cause}`, confidence);
  }

  let recommendation: HealerRecommendation;
  switch (action) {
    case 'retry':
      recommendation = { action: 'retry', modifications: String(args.modifications ?? 'Re-attempt with the diagnosed cause in mind') };
      break;
    case 'reassign':
      recommendation = { action: 'reassign', target_tier: String(args.target_tier ?? 'knight'), reason: String(args.reason ?? cause) };
      break;
    case 'decompose': {
      const raw = args.new_subtasks;
      const subs: Array<{ title: string; description?: string }> = Array.isArray(raw)
        ? raw.filter((s: unknown) => s && typeof (s as Record<string, unknown>).title === 'string')
            .map((s: unknown) => {
              const o = s as Record<string, unknown>;
              return { title: String(o.title), description: String(o.description ?? '') };
            })
        : [];
      recommendation = {
        action: 'decompose',
        new_subtasks: subs.map((s) => ({
          title: s.title,
          description: s.description ?? '',
          type: 'task',
          acceptance_criteria: [] as string[],
          context_refs: [] as Array<{ file: string; startLine: number; endLine: number }>,
        })),
      };
      break;
    }
    default:
      recommendation = { action: 'escalate', message: String(args.message ?? cause) };
  }
  return { incident_id: incidentId, probable_cause: cause, confidence, recommendation };
}
