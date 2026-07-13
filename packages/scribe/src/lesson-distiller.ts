import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LessonsRepository,
  sanitizeLessonTitle,
  sanitizeLessonBody,
  isLikelyInjection,
  type LessonUpsert,
  type Lesson,
  type ProviderAdapter,
  type CompletionRequest,
} from '@kingdomos/core';

/**
 * Rule-based post-run lesson distiller.
 *
 * Runs once per objective, right after Scribe generates the run summary. Each
 * rule is a pure function `(artifacts) => LessonCandidate[]` so it is trivial
 * to unit-test in isolation. Candidates flow through sanitization and the
 * LessonsRepository's dedup path, so calling `distill()` twice on the same
 * objective never inserts duplicate rows — it just bumps `times_seen`.
 *
 * v1 rule set (conservative — each requires ≥2 supporting observations so
 * flaky one-off failures don't pollute the prompt budget):
 *
 *   R1 · test-file-scope-trap             (tier: knight)
 *   R2 · setup-task-on-existing-project   (tier: king)
 *   R3 · squire-token-overflow            (tier: nobility)
 *   R4 · healer-repeats-same-recommendation (tier: healer)
 *   R5 · security-reject-pattern          (tier: knight)
 */

export interface DistillResult {
  /** Lesson IDs (new or upserted) produced for this run. */
  lessonIds: string[];
  /** Rule IDs that fired, for logging / doctor reporting. */
  firedRules: string[];
}

interface RunArtifacts {
  objectiveId: string;
  tasks: TaskRow[];
  reviews: ReviewRow[];
  incidents: IncidentRow[];
  jobs: JobRow[];
  workspaceIsNonEmpty: boolean;
}

interface TaskRow {
  id: string;
  title: string;
  status: string;
  assigned_tier: string;
  retry_count: number;
}

interface ReviewRow {
  id: string;
  job_id: string;
  decision: string;
  scope_check: string;
  format_check: string;
  security_check: string;
  criteria_check: string;
  feedback: string | null;
  rejection_reasons: string | null;
  task_id: string | null;
  task_title: string | null;
}

interface IncidentRow {
  id: string;
  task_id: string;
  failure_type: string;
  failure_history: string;
  healer_recommendation: string | null;
  created_at: string;
}

interface JobRow {
  id: string;
  task_id: string;
  status: string;
  assigned_tier: string | null;
}

export interface DistillOptions {
  /**
   * If provided, treated as "is the workspace already populated at run start?"
   * — drives rule R2 which only fires on existing projects. Default: inferred
   * from `kingdom.config.json.workspace_path` containing a top-level manifest.
   */
  workspaceIsNonEmpty?: boolean;
  /** Verbose logging. Default: false. */
  verbose?: boolean;
}

/** Entry point. Called from ScribeAgent.generateRunSummary's onObjectiveComplete path. */
export function distill(
  db: Database.Database,
  objectiveId: string,
  opts: DistillOptions = {},
): DistillResult {
  const artifacts = loadRunArtifacts(db, objectiveId, opts.workspaceIsNonEmpty ?? true);
  const repo = new LessonsRepository(db);

  const candidates: LessonCandidate[] = [
    ...ruleR1TestFileScopeTrap(artifacts),
    ...ruleR2SetupTaskOnExistingProject(artifacts),
    ...ruleR3SquireTokenOverflow(artifacts),
    ...ruleR4HealerRepeatsSameRecommendation(artifacts),
    ...ruleR5SecurityRejectPattern(artifacts),
  ];

  const lessonIds: string[] = [];
  const firedRules = new Set<string>();

  for (const c of candidates) {
    const upsert: LessonUpsert = {
      tier: c.tier,
      rule_id: c.rule_id,
      signature: c.signature,
      title: sanitizeLessonTitle(c.title),
      body: sanitizeLessonBody(c.body),
      matches_failure_type: c.matches_failure_type ?? null,
      source_task_id: c.source_task_id ?? null,
      source_run_id: objectiveId,
      source_incident_ids: c.source_incident_ids ?? [],
    };
    const id = repo.upsert(upsert);
    lessonIds.push(id);
    firedRules.add(c.rule_id);

    if (opts.verbose) {
      // eslint-disable-next-line no-console
      console.log(`[distiller] ${c.rule_id} → lesson ${id} (${upsert.tier}): ${upsert.title}`);
    }
  }

  return { lessonIds, firedRules: [...firedRules] };
}

// ────────────────────────────────────────────────────────────
// PHASE4 (P4.1): generative (LLM-discovered) distiller pass.
//
// The 5 hardcoded rules only catch known patterns. This pass feeds the
// incidents + review feedback that NONE of R1–R5 matched to an LLM, asks for
// candidate lessons via schema-constrained structured output, then runs every
// candidate through the SAME sanitize + dedup path as the rule lessons, plus a
// prompt-injection gate. Generated lessons are stored with origin='generated'
// and a seed confidence, so the injector withholds them until they earn their
// keep via outcome tracking.
// ────────────────────────────────────────────────────────────

export interface GenerativeDistillResult {
  lessonIds: string[];
  /** Candidates the model proposed (post-parse, pre-gate) — for logging. */
  proposed: number;
  /** Candidates rejected by the injection gate / sanitization. */
  rejected: number;
}

const GENERATED_LESSON_SCHEMA = {
  type: 'object',
  properties: {
    lessons: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tier: {
            type: 'string',
            enum: ['king', 'nobility', 'healer', 'judge', 'knight', 'squire', 'shared'],
          },
          title: { type: 'string' },
          body: { type: 'string' },
          matches_failure_type: { type: 'string' },
        },
        required: ['tier', 'title', 'body'],
        additionalProperties: false,
      },
    },
  },
  required: ['lessons'],
  additionalProperties: false,
} as const;

interface GeneratedCandidate {
  tier: string;
  title: string;
  body: string;
  matches_failure_type?: string;
}

export interface GenerativeDistillOptions extends DistillOptions {
  /** Max candidate lessons to accept from the model. Default 5. */
  maxCandidates?: number;
  /** Model id to use. Default 'gpt-4.1-mini'. */
  model?: string;
}

/**
 * Async generative pass. Safe to call alongside `distill()` — it only proposes
 * lessons for the artifacts the rules left on the floor. Returns early (no-op)
 * when there's nothing unmatched or the provider yields nothing usable. Never
 * throws on a bad model response.
 */
export async function distillGenerated(
  db: Database.Database,
  objectiveId: string,
  provider: ProviderAdapter,
  opts: GenerativeDistillOptions = {},
): Promise<GenerativeDistillResult> {
  const artifacts = loadRunArtifacts(db, objectiveId, opts.workspaceIsNonEmpty ?? true);
  const repo = new LessonsRepository(db);

  // What did the rules already explain? Anything they cite is "covered".
  const ruleCandidates: LessonCandidate[] = [
    ...ruleR1TestFileScopeTrap(artifacts),
    ...ruleR2SetupTaskOnExistingProject(artifacts),
    ...ruleR3SquireTokenOverflow(artifacts),
    ...ruleR4HealerRepeatsSameRecommendation(artifacts),
    ...ruleR5SecurityRejectPattern(artifacts),
  ];
  const coveredIncidentIds = new Set<string>();
  for (const c of ruleCandidates) for (const id of c.source_incident_ids ?? []) coveredIncidentIds.add(id);

  const unmatchedIncidents = artifacts.incidents.filter((i) => !coveredIncidentIds.has(i.id));
  const unmatchedRejections = artifacts.reviews.filter(
    (r) => r.decision === 'rejected' && !coveredIncidentIds.has(r.id),
  );

  if (unmatchedIncidents.length === 0 && unmatchedRejections.length === 0) {
    return { lessonIds: [], proposed: 0, rejected: 0 };
  }

  const prompt = buildGenerativePrompt(unmatchedIncidents, unmatchedRejections);
  const request: CompletionRequest = {
    model: opts.model ?? 'gpt-4.1-mini',
    max_tokens: 900,
    temperature: 0.2,
    messages: [{ role: 'user', content: prompt }],
    response_format: {
      type: 'json_schema',
      schema: GENERATED_LESSON_SCHEMA as unknown as Record<string, unknown>,
      name: 'distilled_lessons',
      strict: true,
    },
  };

  let candidates: GeneratedCandidate[] = [];
  try {
    const res = await provider.complete(request);
    candidates = parseGeneratedCandidates(res.content);
  } catch {
    return { lessonIds: [], proposed: 0, rejected: 0 };
  }

  const max = opts.maxCandidates ?? 5;
  const lessonIds: string[] = [];
  let rejected = 0;

  for (const cand of candidates.slice(0, max)) {
    const rawTitle = String(cand.title ?? '');
    const rawBody = String(cand.body ?? '');
    // PHASE4: injection gate FIRST (reject, don't just strip), then sanitize.
    if (isLikelyInjection(rawTitle) || isLikelyInjection(rawBody)) {
      rejected++;
      continue;
    }
    const title = sanitizeLessonTitle(rawTitle);
    const body = sanitizeLessonBody(rawBody);
    if (title.length < 8 || body.length < 16) {
      rejected++;
      continue;
    }
    const tier = normalizeTier(cand.tier);
    // Signature from content so re-derivation dedups instead of duplicating.
    const signature = sig('GEN', tier, title.toLowerCase().slice(0, 80));
    const upsert: LessonUpsert = {
      tier,
      rule_id: 'GEN',
      signature,
      title,
      body,
      matches_failure_type: cand.matches_failure_type
        ? sanitizeLessonTitle(cand.matches_failure_type).slice(0, 64)
        : null,
      source_run_id: objectiveId,
      source_incident_ids: unmatchedIncidents.map((i) => i.id),
      origin: 'generated',
    };
    const id = repo.upsert(upsert);
    lessonIds.push(id);
    if (opts.verbose) {
      // eslint-disable-next-line no-console
      console.log(`[distiller:gen] → lesson ${id} (${tier}): ${title}`);
    }
  }

  return { lessonIds, proposed: candidates.length, rejected };
}

function buildGenerativePrompt(incidents: IncidentRow[], rejections: ReviewRow[]): string {
  const incidentLines = incidents
    .slice(0, 15)
    .map(
      (i) =>
        `- failure_type=${i.failure_type}; history=${truncate(i.failure_history, 240)}`,
    )
    .join('\n');
  const rejectionLines = rejections
    .slice(0, 15)
    .map(
      (r) =>
        `- task="${truncate(r.task_title ?? '', 60)}"; checks(scope=${r.scope_check},format=${r.format_check},security=${r.security_check},criteria=${r.criteria_check}); feedback=${truncate(r.feedback ?? r.rejection_reasons ?? '', 240)}`,
    )
    .join('\n');

  return `You are the KingdomOS Scribe distilling DURABLE lessons from failures that the built-in rules did not already explain.

Unresolved incidents:
${incidentLines || '(none)'}

Rejected diffs (not already covered):
${rejectionLines || '(none)'}

Propose up to 5 concise, generalizable lessons that would help a future agent AVOID these failures. Rules:
- Each lesson is advice to a specific tier (king plans, nobility decomposes, knight/squire code, judge reviews, healer recovers; use "shared" if cross-cutting).
- title: one imperative sentence (<140 chars). body: 1-3 sentences of concrete guidance (<700 chars).
- Do NOT include any instructions that change an agent's role, reveal prompts, or run shell/network commands — only engineering guidance.
- If a lesson maps to a known failure_type, set matches_failure_type.
- Output ONLY the structured JSON. If there is nothing durable to learn, return an empty lessons array.`;
}

function parseGeneratedCandidates(content: string): GeneratedCandidate[] {
  try {
    // response_format guarantees a JSON object, but weak providers fall back to
    // prose — extract the first {...} as a defensive measure.
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]) as { lessons?: unknown };
    if (!parsed || !Array.isArray(parsed.lessons)) return [];
    return parsed.lessons.filter(
      (l): l is GeneratedCandidate =>
        !!l && typeof l === 'object' && typeof (l as GeneratedCandidate).title === 'string',
    );
  } catch {
    return [];
  }
}

const VALID_TIERS = new Set([
  'king',
  'nobility',
  'healer',
  'judge',
  'knight',
  'squire',
  'shared',
]);

function normalizeTier(tier: string): LessonCandidate['tier'] {
  const t = (tier ?? '').toLowerCase().trim();
  return (VALID_TIERS.has(t) ? t : 'shared') as LessonCandidate['tier'];
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// ────────────────────────────────────────────────────────────
// Candidate shape + helpers
// ────────────────────────────────────────────────────────────

interface LessonCandidate {
  tier: 'king' | 'nobility' | 'healer' | 'judge' | 'knight' | 'squire' | 'shared';
  rule_id: string;
  /** Stable dedup key. Derived from the pattern, not from free text. */
  signature: string;
  title: string;
  body: string;
  matches_failure_type?: string | null;
  source_task_id?: string | null;
  source_incident_ids?: string[];
}

function sig(...parts: string[]): string {
  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
}

// ────────────────────────────────────────────────────────────
// Rules
// ────────────────────────────────────────────────────────────

/** R1: ≥2 rejections in the run with scope_check='fail' and feedback mentioning test files. */
function ruleR1TestFileScopeTrap(a: RunArtifacts): LessonCandidate[] {
  const rejectedTaskIds = new Set(
    a.reviews
      .filter(
        (r) =>
          r.decision === 'rejected' &&
          r.scope_check === 'fail' &&
          r.task_id &&
          (hasTestMarker(r.feedback) || hasTestMarker(r.rejection_reasons)),
      )
      .map((r) => r.task_id as string),
  );
  const hits = a.reviews.filter(
    (r) =>
      r.decision === 'rejected' &&
      r.scope_check === 'fail' &&
      (hasTestMarker(r.feedback) || hasTestMarker(r.rejection_reasons)),
  );
  const retryingHit = a.tasks.some((t) => t.retry_count > 0 && rejectedTaskIds.has(t.id));
  if (hits.length < 2 && !retryingHit) return [];
  return [
    {
      tier: 'knight',
      rule_id: 'R1',
      signature: sig('R1', 'test-file-scope-trap'),
      title: 'Test files must be in allowed_files or diffs will be rejected',
      body:
        'Judge rejected 2+ diffs in a prior run because the worker wrote to `.test.ts` / `.spec.*` paths that were not listed in the task `allowed_files`. Before writing any test file, confirm it is already in `allowed_files`; otherwise modify only the files explicitly scoped to you and leave test changes to a task that covers them.',
      source_incident_ids: hits.map((h) => h.id),
    },
  ];
}

function hasTestMarker(s: string | null): boolean {
  if (!s) return false;
  return /\.test\.|\.spec\.|test files?|spec files?/i.test(s);
}

/** R2: setup/scaffold/init task in a non-empty workspace that ended badly. */
function ruleR2SetupTaskOnExistingProject(a: RunArtifacts): LessonCandidate[] {
  if (!a.workspaceIsNonEmpty) return [];
  const SETUP_RE = /(setup|scaffold|initiali[sz]e|boilerplate|project structure|init\s+project)/i;
  const BAD_STATUSES = new Set([
    'completed-with-warnings',
    'awaiting-healer',
    'failed-token-overflow',
    'failed-timeout',
    'failed-runtime-crash',
    'failed-invalid-output',
    'failed-review',
  ]);
  const rejectedSetupTaskIds = new Set(
    a.reviews
      .filter((r) => r.decision === 'rejected' && r.task_id && SETUP_RE.test(r.task_title ?? ''))
      .map((r) => r.task_id as string),
  );
  const hits = a.tasks.filter(
    (t) =>
      SETUP_RE.test(t.title) &&
      (
        BAD_STATUSES.has(t.status) ||
        (t.retry_count > 0 && rejectedSetupTaskIds.has(t.id))
      ),
  );
  if (hits.length === 0) return [];
  return [
    {
      tier: 'king',
      rule_id: 'R2',
      signature: sig('R2', 'setup-task-on-existing-project'),
      title: 'Do not emit setup/scaffold tasks when the workspace already has code',
      body:
        'A prior run emitted one or more "Project Setup / Scaffold / Initialize" tasks against an already-populated workspace. Those tasks tend to overwrite existing files (package.json, App.tsx) or fail Judge review. When decomposing: check the workspace for an existing manifest (`package.json`, `pyproject.toml`, `Cargo.toml`, etc.). If one exists, skip setup tasks entirely and start from feature-level work.',
      source_task_id: hits[0]?.id ?? null,
    },
  ];
}

/** R3: ≥2 jobs with status failed-token-overflow on the squire tier. */
function ruleR3SquireTokenOverflow(a: RunArtifacts): LessonCandidate[] {
  const hits = a.jobs.filter(
    (j) => j.status === 'failed-token-overflow' && j.assigned_tier === 'squire',
  );
  if (hits.length < 2) return [];
  return [
    {
      tier: 'nobility',
      rule_id: 'R3',
      signature: sig('R3', 'squire-token-overflow'),
      title: 'Large tasks routed to squire are overflowing its output budget',
      body:
        'Two or more squire jobs in a prior run hit `failed-token-overflow`. The local squire model has a small output window; tasks requiring >~1500 tokens of diff output should either be decomposed into smaller subtasks or reassigned to knight. When decomposing, favour single-file / single-function scopes for squire.',
      matches_failure_type: 'token-overflow',
    },
  ];
}

/** R4: an incident with ≥3 retries where recommendations repeated semantically (Jaccard ≥ 0.5). */
function ruleR4HealerRepeatsSameRecommendation(a: RunArtifacts): LessonCandidate[] {
  const out: LessonCandidate[] = [];
  for (const inc of a.incidents) {
    let history: Array<{ reason?: string }> = [];
    try {
      const parsed = JSON.parse(inc.failure_history ?? '[]');
      if (Array.isArray(parsed)) history = parsed;
    } catch {
      // ignore
    }
    if (history.length < 3) continue;

    const reasons = history
      .map((h) => (typeof h.reason === 'string' ? h.reason : ''))
      .filter((s) => s.length > 0);
    if (reasons.length < 2) continue;

    // Pairwise Jaccard on tokenized reasons — flag if any pair ≥ 0.5.
    const repeat = hasSemanticRepeat(reasons, 0.5);
    if (!repeat) continue;

    out.push({
      tier: 'healer',
      rule_id: 'R4',
      signature: sig('R4', inc.failure_type),
      title: `Repeated ${inc.failure_type} failures — escalate earlier instead of retrying`,
      body: `An incident of type "${inc.failure_type}" cycled through 3+ attempts with highly similar failure reasons. When the same failure signature repeats, a retry is unlikely to help — recommend \`escalate\` or \`decompose\` on the second repeat rather than a third \`retry\`.`,
      matches_failure_type: inc.failure_type,
      source_incident_ids: [inc.id],
    });
  }
  return out;
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function hasSemanticRepeat(reasons: string[], threshold: number): boolean {
  const toks = reasons.map(tokenize);
  for (let i = 0; i < toks.length; i++) {
    for (let j = i + 1; j < toks.length; j++) {
      if (jaccard(toks[i], toks[j]) >= threshold) return true;
    }
  }
  return false;
}

/** R5: ≥2 rejections in the run with security_check='fail'. */
function ruleR5SecurityRejectPattern(a: RunArtifacts): LessonCandidate[] {
  const hits = a.reviews.filter(
    (r) => r.decision === 'rejected' && r.security_check === 'fail',
  );
  if (hits.length < 2) return [];

  const family = classifySecurityFamily(hits.map((h) => `${h.feedback ?? ''} ${h.rejection_reasons ?? ''}`).join(' '));
  return [
    {
      tier: 'knight',
      rule_id: 'R5',
      signature: sig('R5', family),
      title: `Judge rejected multiple diffs for ${family} patterns`,
      body: `Two or more diffs in a prior run were rejected by the Judge's security check for "${family}" patterns. Never hardcode credentials, never emit destructive shell commands (\`rm -rf /\`, \`DROP TABLE\`), and never call \`eval()\` / \`child_process.exec()\` on untrusted input. Use env vars for secrets and parameterized queries for SQL.`,
      source_incident_ids: hits.map((h) => h.id),
    },
  ];
}

function classifySecurityFamily(text: string): string {
  const t = text.toLowerCase();
  if (/api[-_ ]?key|secret|token|password|credential/.test(t)) return 'hardcoded-credential';
  if (/rm\s+-rf|drop\s+table|format\s+c:/.test(t)) return 'destructive-command';
  if (/\beval\b|child_process|exec\b|spawn\b/.test(t)) return 'unsafe-exec';
  return 'security';
}

// ────────────────────────────────────────────────────────────
// Artifact loading
// ────────────────────────────────────────────────────────────

function loadRunArtifacts(
  db: Database.Database,
  objectiveId: string,
  workspaceIsNonEmpty: boolean,
): RunArtifacts {
  const tasks = db
    .prepare(
      `SELECT id, title, status, assigned_tier, retry_count
         FROM task_graph_nodes
        WHERE objective_id = ?`,
    )
    .all(objectiveId) as TaskRow[];

  const taskIds = tasks.map((t) => t.id);
  const idPlaceholders = taskIds.length > 0 ? taskIds.map(() => '?').join(',') : "''";

  const reviews =
    taskIds.length === 0
      ? []
      : (db
          .prepare(
            `SELECT r.id, r.job_id, r.decision, r.scope_check, r.format_check,
                    r.security_check, r.criteria_check, r.feedback, r.rejection_reasons,
                    j.task_id AS task_id, t.title AS task_title
               FROM review_decisions r
               JOIN jobs j ON j.id = r.job_id
               LEFT JOIN task_graph_nodes t ON t.id = j.task_id
              WHERE j.task_id IN (${idPlaceholders})`,
          )
          .all(...taskIds) as ReviewRow[]);

  const incidents =
    taskIds.length === 0
      ? []
      : (db
          .prepare(
            `SELECT id, task_id, failure_type, failure_history, healer_recommendation, created_at
               FROM incidents
              WHERE task_id IN (${idPlaceholders})`,
          )
          .all(...taskIds) as IncidentRow[]);

  const jobs =
    taskIds.length === 0
      ? []
      : (db
          .prepare(
            `SELECT j.id, j.task_id, j.status, t.assigned_tier
               FROM jobs j
               JOIN task_graph_nodes t ON t.id = j.task_id
              WHERE j.task_id IN (${idPlaceholders})`,
          )
          .all(...taskIds) as JobRow[]);

  return {
    objectiveId,
    tasks,
    reviews,
    incidents,
    jobs,
    workspaceIsNonEmpty,
  };
}

// Re-export internals for unit tests.
export const __internals = {
  loadRunArtifacts,
  tokenize,
  jaccard,
  hasSemanticRepeat,
  classifySecurityFamily,
};

// ────────────────────────────────────────────────────────────
// Markdown mirror — DB is authoritative, these files are derived.
// Operators can eyeball `kingdom/memory/{tier}/lessons.md` but edits there
// are not read by prompt assembly (that reads shared + manual-only sections;
// the DB rows drive the block). Use `kingdom lessons forget <id>` to remove
// a bad lesson rather than editing the mirror.
// ────────────────────────────────────────────────────────────

export function mirrorLessonsToDisk(db: Database.Database, kingdomDir: string): void {
  const repo = new LessonsRepository(db);
  const all = repo.listAllActive();
  const byTier = new Map<string, Lesson[]>();
  for (const l of all) {
    if (!byTier.has(l.tier)) byTier.set(l.tier, []);
    byTier.get(l.tier)!.push(l);
  }
  for (const [tier, lessons] of byTier) {
    const dir = join(kingdomDir, 'memory', tier);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'lessons.md'),
      renderLessonsMarkdown(tier, lessons),
      'utf-8',
    );
  }
}

function renderLessonsMarkdown(tier: string, lessons: Lesson[]): string {
  const lines: string[] = [];
  lines.push(`# Lessons — ${tier}`);
  lines.push('');
  lines.push('> Auto-generated by the KingdomOS lesson distiller.');
  lines.push('> Edits here are NOT read by prompt assembly — the DB is authoritative.');
  lines.push('> To remove a bad lesson: `kingdom lessons forget <id>`');
  lines.push('');
  for (const l of lessons) {
    lines.push(`## ${l.title}`);
    lines.push('');
    lines.push(
      `- **id**: \`${l.id}\`  ·  **rule**: \`${l.rule_id}\`  ·  **seen**: ${l.times_seen}×  ·  **last**: ${l.last_seen_at}`,
    );
    if (l.matches_failure_type) lines.push(`- **matches_failure_type**: \`${l.matches_failure_type}\``);
    lines.push('');
    lines.push(l.body);
    lines.push('');
    lines.push('---');
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Append a single-line summary of a completed run to `kingdom/memory/INDEX.md`.
 * The line doubles as a scan-friendly index the Warden (the operator) can
 * load at session start — see Kingdom CLAUDE.md "REMEMBER ACROSS RUNS".
 */
export function appendRunIndex(
  kingdomDir: string,
  line: RunIndexLine,
): void {
  const dir = join(kingdomDir, 'memory');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, 'INDEX.md');
  const ts = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const objective = (line.objective ?? '').slice(0, 60).replace(/\s+/g, ' ');
  const lessonSuffix =
    line.newLessonCount > 0
      ? `+${line.newLessonCount} lessons (${line.firedRules.join(',') || '-'})`
      : 'no new lessons';
  const rendered = `${ts} | obj="${objective}" | ${line.totalTasks} tasks | ${line.healerIncidents} incidents | ${lessonSuffix} | ${line.totalTokens.toLocaleString()} tokens\n`;

  let header = '';
  if (!existsSync(path)) {
    header =
      '# KingdomOS Run Index\n' +
      '\n' +
      'One line per completed objective. Newest first is easier for humans; newest last is easier for tail-friendly scripts. We pick tail-friendly.\n' +
      '\n';
  }

  // Append (never rewrite) — cheap, tail-friendly, and survives crashes.
  appendFileSync(path, header + rendered, 'utf-8');
}

export interface RunIndexLine {
  objective: string;
  totalTasks: number;
  healerIncidents: number;
  newLessonCount: number;
  firedRules: string[];
  totalTokens: number;
}