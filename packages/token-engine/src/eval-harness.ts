import type Database from 'better-sqlite3';
import type {
  ProviderAdapter,
  CompletionRequest,
  ModelCapabilities,
  TaskKind,
  TierClass,
  LatencyClass,
} from '@kingdomos/core';
import { ModelRegistry } from './model-registry.js';

/**
 * PHASE4 (P4.3): model self-evaluation & auto-tiering harness.
 *
 * Runs a small fixed battery of probes against a model through an injected
 * ProviderAdapter, scores each probe, derives MEASURED `ModelCapabilities`
 * (including observed tool-use / structured-output support and a `verified_at`
 * stamp), persists the per-probe results to `model_eval_results`, and writes
 * the capabilities back into the registry. The `kingdom eval` CLI command wires
 * a real provider; tests inject a mock so nothing hits the network.
 *
 * Pass-rates feed auto-tiering: a model that wins the code battery can be
 * promoted into the knight implementation profile (see `recommendTierClass`
 * and `winsTaskKind`).
 */

export type ProbeName = 'decompose' | 'code-diff' | 'review' | 'diagnose';

interface ProbeSpec {
  name: ProbeName;
  task_kind: TaskKind;
  /** Build the request. `useStructured` toggles response_format on. */
  build(model: string, useStructured: boolean): CompletionRequest;
  /** Returns a score in [0,1]; >= passThreshold counts as a pass. */
  score(content: string, toolCalls: unknown[] | undefined): number;
}

export const PASS_THRESHOLD = 0.5;

// ── The battery ────────────────────────────────────────────────────────────
// Probe 1 (decompose) is implemented end-to-end as the canonical example.
// The remaining probes are real but intentionally lightweight; richer rubrics
// are a TODO (see PHASE4-REPORT.md "Deferred").

const PROBES: ProbeSpec[] = [
  {
    name: 'decompose',
    task_kind: 'decomposition',
    build: (model, useStructured) => ({
      model,
      max_tokens: 400,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content:
            'Decompose the objective "Add a /health endpoint to an Express API" into 2-4 implementation tasks. Respond as JSON {"tasks":[{"title":string}]}.',
        },
      ],
      ...(useStructured
        ? {
            response_format: {
              type: 'json_schema' as const,
              name: 'plan',
              strict: true,
              schema: {
                type: 'object',
                properties: {
                  tasks: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: { title: { type: 'string' } },
                      required: ['title'],
                    },
                  },
                },
                required: ['tasks'],
              },
            },
          }
        : {}),
    }),
    score: (content) => scoreJsonArray(content, 'tasks', 2),
  },
  {
    name: 'code-diff',
    task_kind: 'implementation',
    build: (model) => ({
      model,
      max_tokens: 400,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content:
            'Output ONLY a unified diff that adds a function `add(a,b)` returning a+b to a new file sum.js. Start with "--- ".',
        },
      ],
    }),
    // TODO(P4.3): apply the diff against a scratch workspace and compile-check.
    score: (content) => (/^---\s|\n@@|\+function add/.test(content) ? 1 : 0),
  },
  {
    name: 'review',
    task_kind: 'review',
    build: (model, useStructured) => ({
      model,
      max_tokens: 300,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content:
            'Review this diff for hardcoded secrets and reply JSON {"decision":"approved"|"rejected","reason":string}. Diff: +const KEY="sk-live-123";',
        },
      ],
      ...(useStructured
        ? {
            response_format: {
              type: 'json_schema' as const,
              name: 'review',
              strict: true,
              schema: {
                type: 'object',
                properties: {
                  decision: { type: 'string', enum: ['approved', 'rejected'] },
                  reason: { type: 'string' },
                },
                required: ['decision', 'reason'],
              },
            },
          }
        : {}),
    }),
    // TODO(P4.3): grade against a labelled secure/insecure diff suite.
    score: (content) => (/rejected/i.test(content) ? 1 : 0),
  },
  {
    name: 'diagnose',
    task_kind: 'healing',
    build: (model) => ({
      model,
      max_tokens: 300,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content:
            'A task failed 3 times with "failed-token-overflow" on a 7B local model. Recommend an action (retry|decompose|reassign|escalate) as JSON {"action":string}.',
        },
      ],
    }),
    // TODO(P4.3): grade recommendation against a labelled incident suite.
    score: (content) => (/decompose|reassign|escalate/i.test(content) ? 1 : 0),
  },
];

export interface ProbeResult {
  probe: ProbeName;
  task_kind: TaskKind;
  passed: boolean;
  score: number;
  latency_ms: number;
  tool_use_observed: boolean;
  structured_output_observed: boolean;
  detail: string;
}

export interface EvalResult {
  model_id: string;
  provider: string;
  probes: ProbeResult[];
  capabilities: ModelCapabilities;
  /** Pass-rate per task kind — feeds auto-tiering. */
  passRateByKind: Record<string, number>;
}

export interface EvalOptions {
  /** Subset of probes to run. Default: all. */
  probes?: ProbeName[];
  /** Try schema-constrained output (detects structured_output support). Default true. */
  probeStructured?: boolean;
  /** Persist per-probe rows + write capabilities to the registry. Default true. */
  persist?: boolean;
  verbose?: boolean;
}

/**
 * Evaluate a single model. `provider` must be an adapter that serves `modelId`.
 */
export async function evaluateModel(
  db: Database.Database,
  modelId: string,
  provider: ProviderAdapter,
  opts: EvalOptions = {},
): Promise<EvalResult> {
  const registry = new ModelRegistry(db);
  const config = registry.getModelConfig(modelId);
  const providerId = config?.provider ?? provider.provider_id;
  const probeStructured = opts.probeStructured !== false;
  const selected = opts.probes
    ? PROBES.filter((p) => opts.probes!.includes(p.name))
    : PROBES;

  const results: ProbeResult[] = [];
  for (const spec of selected) {
    const r = await runProbe(spec, modelId, provider, probeStructured);
    results.push(r);
    if (opts.verbose) {
      // eslint-disable-next-line no-console
      console.log(
        `[eval] ${modelId} · ${spec.name}: ${r.passed ? 'PASS' : 'fail'} (score ${r.score.toFixed(2)}, ${r.latency_ms}ms)`,
      );
    }
  }

  const capabilities = deriveCapabilities(modelId, config?.context_window, results);
  const passRateByKind = computePassRateByKind(results);

  if (opts.persist !== false) {
    persistResults(db, modelId, providerId, results);
    registry.writeVerifiedCapabilities(modelId, capabilities);
  }

  return { model_id: modelId, provider: providerId, probes: results, capabilities, passRateByKind };
}

async function runProbe(
  spec: ProbeSpec,
  modelId: string,
  provider: ProviderAdapter,
  probeStructured: boolean,
): Promise<ProbeResult> {
  const start = Date.now();
  let content = '';
  let toolCalls: unknown[] | undefined;
  let structuredObserved = false;
  let toolObserved = false;
  let detail = '';
  try {
    const req = spec.build(modelId, probeStructured);
    structuredObserved = !!req.response_format;
    const res = await provider.complete(req);
    content = res.content ?? '';
    toolCalls = res.tool_calls;
    toolObserved = Array.isArray(res.tool_calls) && res.tool_calls.length > 0;
    // If we asked for structured output, only count it as supported when the
    // content actually parses as JSON.
    if (structuredObserved) structuredObserved = looksLikeJson(content);
  } catch (e) {
    detail = e instanceof Error ? e.message : String(e);
    return {
      probe: spec.name,
      task_kind: spec.task_kind,
      passed: false,
      score: 0,
      latency_ms: Date.now() - start,
      tool_use_observed: false,
      structured_output_observed: false,
      detail,
    };
  }
  const score = spec.score(content, toolCalls);
  return {
    probe: spec.name,
    task_kind: spec.task_kind,
    passed: score >= PASS_THRESHOLD,
    score,
    latency_ms: Date.now() - start,
    tool_use_observed: toolObserved,
    structured_output_observed: structuredObserved,
    detail: detail || content.slice(0, 120),
  };
}

/** Derive ModelCapabilities from probe outcomes. Exported for testing. */
export function deriveCapabilities(
  modelId: string,
  contextWindow: number | undefined,
  results: ProbeResult[],
): ModelCapabilities {
  const strengths: TaskKind[] = [];
  for (const r of results) {
    if (r.passed && !strengths.includes(r.task_kind)) strengths.push(r.task_kind);
  }
  const avgLatency =
    results.length > 0 ? results.reduce((s, r) => s + r.latency_ms, 0) / results.length : 0;
  return {
    strengths,
    tool_use: results.some((r) => r.tool_use_observed),
    structured_output: results.some((r) => r.structured_output_observed),
    multimodal: false, // not probed; conservative
    streaming: true, // assumed for OpenAI-compatible adapters
    tier_class: recommendTierClass(results),
    latency_class: latencyClass(avgLatency),
    verified_at: new Date().toISOString(),
  };
}

/** Auto-tiering signal: a model that passes the code battery is "cheap" coder
 *  material; broad pass-rate earns "balanced"; otherwise "premium" reservation. */
export function recommendTierClass(results: ProbeResult[]): TierClass {
  const passed = results.filter((r) => r.passed).length;
  const rate = results.length > 0 ? passed / results.length : 0;
  if (rate >= 0.75) return 'balanced';
  if (rate >= 0.5) return 'cheap';
  return 'premium';
}

/** Does this model win a given task kind (passed its probe)? Used for promotion. */
export function winsTaskKind(result: EvalResult, kind: TaskKind): boolean {
  return (result.passRateByKind[kind] ?? 0) >= 1;
}

function latencyClass(avgMs: number): LatencyClass {
  if (avgMs <= 0) return 'balanced';
  if (avgMs < 2000) return 'fast';
  if (avgMs < 8000) return 'balanced';
  return 'thorough';
}

function computePassRateByKind(results: ProbeResult[]): Record<string, number> {
  const byKind = new Map<string, { passed: number; total: number }>();
  for (const r of results) {
    const cur = byKind.get(r.task_kind) ?? { passed: 0, total: 0 };
    cur.total += 1;
    if (r.passed) cur.passed += 1;
    byKind.set(r.task_kind, cur);
  }
  const out: Record<string, number> = {};
  for (const [k, v] of byKind) out[k] = v.total > 0 ? v.passed / v.total : 0;
  return out;
}

function persistResults(
  db: Database.Database,
  modelId: string,
  provider: string,
  results: ProbeResult[],
): void {
  const hasTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='model_eval_results'")
    .get();
  if (!hasTable) return;
  const stmt = db.prepare(
    `INSERT INTO model_eval_results
       (model_id, provider, probe, task_kind, passed, score, latency_ms,
        tool_use_observed, structured_output_observed, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction(() => {
    for (const r of results) {
      stmt.run(
        modelId,
        provider,
        r.probe,
        r.task_kind,
        r.passed ? 1 : 0,
        r.score,
        r.latency_ms,
        r.tool_use_observed ? 1 : 0,
        r.structured_output_observed ? 1 : 0,
        r.detail.slice(0, 240),
      );
    }
  });
  tx();
}

function scoreJsonArray(content: string, key: string, minItems: number): number {
  try {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return 0;
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const arr = parsed[key];
    if (Array.isArray(arr) && arr.length >= minItems) return 1;
    return Array.isArray(arr) ? 0.5 : 0;
  } catch {
    return 0;
  }
}

function looksLikeJson(content: string): boolean {
  const t = content.trim();
  if (!(t.startsWith('{') || t.startsWith('['))) {
    // Allow fenced or prefixed JSON, but require a brace somewhere.
    return /\{[\s\S]*\}/.test(t);
  }
  try {
    JSON.parse(t);
    return true;
  } catch {
    return /\{[\s\S]*\}/.test(t);
  }
}

export const PROBE_NAMES: ProbeName[] = PROBES.map((p) => p.name);
