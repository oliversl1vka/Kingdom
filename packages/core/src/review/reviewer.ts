import type {
  Job,
  ReviewDecision,
  ReviewVerdict,
  ReviewCheckResult,
  ProviderAdapter,
  CompletionRequest,
  ModelResolver,
} from '../types.js';
import { generateUlid } from '../ulid.js';
import type Database from 'better-sqlite3';
import { applyPatch, parsePatch } from 'diff';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { extractJsonObject, type JsonObject } from '../json/extractor.js';

// Credential/secret patterns to detect in diffs
/**
 * Names of well-known env var holders for secrets. These are SAFE to appear as
 * string literals in code (they're the *name* of the variable, not the value).
 * We use this set to avoid false-positive security rejections for code that
 * legitimately references these names (e.g. the doctor command checking that
 * OPENAI_API_KEY is present in .env).
 */
const KNOWN_ENV_VAR_NAMES = new Set([
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'GH_TOKEN',
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
  'GOOGLE_API_KEY', 'GEMINI_API_KEY', 'COHERE_API_KEY', 'MISTRAL_API_KEY',
  'HUGGINGFACE_TOKEN', 'HF_TOKEN', 'SLACK_BOT_TOKEN', 'SLACK_API_TOKEN',
  'DATABASE_URL', 'REDIS_URL', 'MONGODB_URI', 'API_KEY', 'SECRET_KEY',
  'ACCESS_TOKEN', 'REFRESH_TOKEN', 'PRIVATE_KEY', 'CLIENT_SECRET',
]);

/**
 * True if the quoted value in an assignment is just the NAME of an env var
 * (e.g. `"OPENAI_API_KEY"`), not an actual secret value. Env var NAMES are
 * expected to appear in code; env var VALUES are not.
 */
function isJustEnvVarName(value: string): boolean {
  const stripped = value.trim();
  if (KNOWN_ENV_VAR_NAMES.has(stripped)) return true;
  // Heuristic: all-uppercase identifier with underscores and no lowercase/digits
  // that look like entropy. Real secrets have mixed case or base64/hex content.
  if (/^[A-Z][A-Z0-9_]*$/.test(stripped) && stripped.length <= 40) return true;
  return false;
}

const SECURITY_PATTERNS: Array<RegExp | ((addedContent: string) => boolean)> = [
  // api_key / apikey assignments — but only if the value looks like an actual secret.
  // Requires a word boundary before "api" and restricts the quoted value to a single
  // line so we don't accidentally span a string literal like 'OPENAI_API_KEY=' into
  // the next statement (which would swallow several lines and always fail).
  (added: string) => {
    const re = /\b(?:api[_-]?key|apikey)\s*[:=]\s*['"]([^'"\n]+)['"]/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(added)) !== null) {
      if (!isJustEnvVarName(m[1])) return true;
    }
    return false;
  },
  // secret / password / token / auth assignments — same carve-outs
  (added: string) => {
    const re = /\b(?:secret|password|token|auth)\s*[:=]\s*['"]([^'"\n]+)['"]/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(added)) !== null) {
      if (!isJustEnvVarName(m[1])) return true;
    }
    return false;
  },
  /(?:AWS|aws)[_-]?(?:SECRET|ACCESS|KEY)\s*[:=]\s*['"][A-Za-z0-9/+=]{20,}['"]/,
  /-----BEGIN (?:RSA|DSA|EC|OPENSSH|PGP) PRIVATE KEY-----/,
  /(?:sk|pk|rk)[-_][a-zA-Z0-9]{20,}/,
  /ghp_[a-zA-Z0-9]{36}/,
  /xox[bpoas]-[a-zA-Z0-9-]+/,
];

const DESTRUCTIVE_PATTERNS = [
  /rm\s+-rf\s+[/~]/,
  /DROP\s+(?:TABLE|DATABASE|SCHEMA)/i,
  /DELETE\s+FROM\s+\w+\s*(?:;|$)/i,
  /FORMAT\s+[A-Z]:/i,
  /mkfs\./,
  /dd\s+if=.*of=\/dev\//,
];

const MALEVOLENT_PATTERNS = [
  /eval\s*\(\s*(?:req|request|input|user|body|query|params)/i,
  /child_process.*exec\s*\(.*(?:\$|`|req|input|user)/i,
  /new\s+Function\s*\(/,
  /document\.write\s*\(\s*(?:location|document\.cookie)/i,
  /process\.env\s*\[.*(?:req|input|user)/i,
];

interface ParsedCriteriaReview {
  pass: boolean;
  feedback?: string;
}

interface CriteriaEntry {
  n: number;
  pass: boolean;
  evidence?: string;
}

export function parseCriteriaReviewResponse(content: string, acceptanceCriteria: string[]): ParsedCriteriaReview | null {
  const parsed = extractJsonObject<JsonObject>(content, isCriteriaReviewObject);
  if (!parsed) return null;

  const criteria = Array.isArray(parsed.criteria)
    ? parsed.criteria.filter(isCriteriaEntry)
    : [];
  const pass = criteria.length > 0
    ? criteria.every((criterion) => criterion.pass === true)
    : parsed.pass === true;
  const feedback = typeof parsed.feedback === 'string' ? parsed.feedback : undefined;

  if (pass) return { pass, feedback };

  const failed = criteria.filter((criterion) => !criterion.pass);
  return {
    pass,
    feedback: [
      feedback ?? 'One or more acceptance criteria not satisfied.',
      ...failed.map((criterion) => {
        const name = acceptanceCriteria[criterion.n - 1] ?? `criterion ${criterion.n}`;
        return `  x (${criterion.n}) ${name} - ${criterion.evidence ?? 'no evidence of satisfaction in the resulting code'}`;
      }),
    ].join('\n'),
  };
}

export interface ReviewContext {
  job: Job;
  diffText: string;
  allowedFiles: string[];
  acceptanceCriteria: string[];
  /** Model to use for criteria check — should be at least one tier above the worker. */
  reviewerModel?: string;
  /** Skip the LLM-based criteria check (e.g. for squire tier where the reviewer is stronger than the worker). */
  skipCriteriaCheck?: boolean;
  /** Absolute path to the project root — used by the criteria check to read
   *  pre-apply file content and simulate the post-apply state so the Judge can
   *  grade the diff against the *actual* resulting code, not just the diff. */
  projectPath?: string;
  abortSignal?: AbortSignal;
  /** Allow an empty allowedFiles list only for explicit greenfield tasks. */
  allowEmptyScope?: boolean;
  /** Per-call provider timeout for criteria review. */
  timeout_ms?: number;
  /**
   * PHASE3 (P3.2): the task's verification contract, if any. When present the
   * criteria prompt tells the Judge that an *executable* gate (`test_command`)
   * will enforce correctness after apply — so the Judge can lean on that
   * objective signal for behaviour the test covers, rather than guessing. The
   * gate itself runs post-apply in the dispatcher; here it is consumed only as
   * evidence to calibrate the criteria check.
   */
  verificationEvidence?: { test_command: string; probe?: string };
}

/**
 * Injected model resolver. Callers that want capability-based selection pass
 * a closure that consults a `ModelRegistry` (via `resolveModel()` in
 * `@kingdomos/token-engine`) and returns the chosen `model_id`. Kept as a
 * callback here to avoid a `core -> token-engine` import cycle.
 *
 * The resolver is called lazily per review — if the registry is updated
 * mid-run, the next review picks up the new choice.
 */
export type ReviewModelResolver = ModelResolver;

export class ReviewEngine {
  private readonly model: string;
  private readonly resolver?: ReviewModelResolver;

  constructor(
    private db: Database.Database,
    private provider?: ProviderAdapter,
    modelOrResolver?: string | ReviewModelResolver,
  ) {
    if (typeof modelOrResolver === 'function') {
      this.resolver = modelOrResolver;
      // Still keep a concrete fallback for the case where the resolver throws.
      this.model = 'gpt-4.1-mini';
    } else {
      this.model = modelOrResolver ?? 'gpt-4.1-mini';
    }
  }

  /**
   * The model id this reviewer will use on the *next* review() call. Honors
   * the resolver first, falls back to the static id. Public so operators
   * and tests can inspect which model is about to run.
   */
  getEffectiveModel(): string {
    if (this.resolver) {
      try { return this.resolver(); } catch { /* fall through */ }
    }
    return this.model;
  }

  /**
   * Returns the model id for this review. Honors (in order):
   *   1. The injected resolver, if present and doesn't throw.
   *   2. The static `model` passed at construction.
   * `ctx.reviewerModel` is a per-call override handled one layer up.
   */
  private resolveReviewModel(): string {
    return this.getEffectiveModel();
  }

  async review(ctx: ReviewContext): Promise<ReviewDecision> {
    // Strip markdown code fences that LLMs wrap diffs in
    const rawDiff = ctx.diffText
      .replace(/\r\n/g, '\n')
      .replace(/^```(?:diff)?\s*\n/gm, '')
      .replace(/^```\s*$/gm, '')
      .trim();

    // Auto-normalize hunk headers. LLMs (all tiers, both local and frontier)
    // reliably miscount the `@@ -X,A +Y,B @@` line totals, producing diffs with
    // valid bodies but wrong declared counts. Rejecting these is a productivity
    // killer — jsdiff (which blacksmith uses to apply) matches on context, not
    // header counts. So we silently correct the headers here before validating.
    const diffText = normalizeHunkHeaders(rawDiff);

    const scopeCheck = this.checkScope(diffText, ctx.allowedFiles, ctx.allowEmptyScope === true);
    const formatCheck = this.checkFormat(diffText);
    const securityCheck = this.checkSecurity(diffText);
    const criteriaCheck = ctx.skipCriteriaCheck
      ? { result: 'pass' as const, feedback: undefined }
      : await this.checkCriteria(ctx);

    const allPassed = scopeCheck === 'pass' && formatCheck === 'pass' && securityCheck === 'pass' && criteriaCheck.result === 'pass';

    const reviewId = generateUlid();
    const rejectionReasons: string[] = [];

    if (scopeCheck === 'fail') {
      const modifiedFiles = extractFilesFromDiff(diffText);
      const outOfScope = modifiedFiles.filter(f => !ctx.allowedFiles.includes(f));
      const detail = outOfScope.length > 0 ? `: ${outOfScope.slice(0, 3).join(', ')}` : '';
      const reason = ctx.allowedFiles.length === 0 && !ctx.allowEmptyScope
        ? 'Task has no allowed file scope; add an explicit Files to touch section or mark it greenfield'
        : `Diff modifies files outside allowed scope${detail}`;
      rejectionReasons.push(reason);
    }
    if (formatCheck === 'fail') {
      rejectionReasons.push(`Diff format is invalid: ${this.getFormatFailureDetails(diffText)}`);
    }
    if (securityCheck === 'fail') rejectionReasons.push('Security violation detected in diff');
    if (criteriaCheck.result === 'fail') rejectionReasons.push(criteriaCheck.feedback ?? 'Acceptance criteria not met');

    const decision: ReviewDecision = {
      id: reviewId,
      job_id: ctx.job.id,
      reviewer_agent_id: 'judge',
      decision: allPassed ? 'approved' : 'rejected',
      rejection_reasons: rejectionReasons.length > 0 ? rejectionReasons : null,
      scope_check: scopeCheck,
      format_check: formatCheck,
      security_check: securityCheck,
      criteria_check: criteriaCheck.result,
      feedback: criteriaCheck.feedback ?? null,
      created_at: new Date().toISOString(),
    };

    // Persist to database
    this.db
      .prepare(
        `INSERT INTO review_decisions (id, job_id, reviewer_agent_id, decision, rejection_reasons, scope_check, format_check, security_check, criteria_check, feedback, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        decision.id,
        decision.job_id,
        decision.reviewer_agent_id,
        decision.decision,
        JSON.stringify(decision.rejection_reasons),
        decision.scope_check,
        decision.format_check,
        decision.security_check,
        decision.criteria_check,
        decision.feedback,
        decision.created_at
      );

    return decision;
  }

  private getFormatFailureDetails(diffText: string): string {
    if (!diffText.trim()) return 'output is empty — produce a unified diff with actual changes';
    // Unified diff headers must have a trailing space: `--- ` not `---file`
    if (!diffText.match(/^--- /m)) return 'missing `--- a/file` header line (must start with `--- ` including the trailing space)';
    if (!diffText.match(/^\+\+\+ /m)) return 'missing `+++ b/file` header line (must start with `+++ ` including the trailing space)';
    if (!diffText.includes('@@')) return 'missing `@@ -N,N +N,N @@` hunk markers';
    const hasChanges = diffText.split('\n').some(
      l => (l.startsWith('+') && !l.startsWith('+++')) || (l.startsWith('-') && !l.startsWith('---'))
    );
    if (!hasChanges) return 'diff contains no added or removed lines — produce a diff with actual code changes';
    const hunkErrors = validateHunkCounts(diffText);
    if (hunkErrors.length > 0) return hunkErrors.slice(0, 3).join('; ');
    return 'not valid unified diff structure';
  }

  private checkScope(diffText: string, allowedFiles: string[], allowEmptyScope = false): ReviewCheckResult {
    if (allowedFiles.length === 0) return allowEmptyScope ? 'pass' : 'fail';
    // Extract files modified in the diff
    const modifiedFiles = extractFilesFromDiff(diffText);
    for (const file of modifiedFiles) {
      if (!allowedFiles.includes(file)) {
        return 'fail';
      }
    }
    return 'pass';
  }

  private checkFormat(diffText: string): ReviewCheckResult {
    if (!diffText || diffText.trim().length === 0) return 'fail';
    // Require properly-formed file headers (trailing space is part of the unified diff spec)
    if (!diffText.match(/^--- /m) || !diffText.match(/^\+\+\+ /m) || !diffText.includes('@@')) {
      return 'fail';
    }
    // Require at least one actual change line — header-only output is a no-op diff
    const hasChanges = diffText.split('\n').some(
      l => (l.startsWith('+') && !l.startsWith('+++')) || (l.startsWith('-') && !l.startsWith('---'))
    );
    if (!hasChanges) return 'fail';
    // Validate hunk line-count declarations match actual content.
    // Mismatches are the leading cause of apply failures — catch them before blacksmith.
    const hunkErrors = validateHunkCounts(diffText);
    return hunkErrors.length === 0 ? 'pass' : 'fail';
  }

  private checkSecurity(diffText: string): ReviewCheckResult {
    // Only check added lines (starting with +)
    const addedLines = diffText
      .split('\n')
      .filter((line) => line.startsWith('+') && !line.startsWith('+++'));

    const addedContent = addedLines.join('\n');

    for (const pattern of SECURITY_PATTERNS) {
      const hit = typeof pattern === 'function'
        ? pattern(addedContent)
        : pattern.test(addedContent);
      if (hit) return 'fail';
    }
    for (const pattern of DESTRUCTIVE_PATTERNS) {
      if (pattern.test(addedContent)) return 'fail';
    }
    for (const pattern of MALEVOLENT_PATTERNS) {
      if (pattern.test(addedContent)) return 'fail';
    }
    return 'pass';
  }

  private async checkCriteria(
    ctx: ReviewContext
  ): Promise<{ result: ReviewCheckResult; feedback?: string }> {
    if (!this.provider || ctx.acceptanceCriteria.length === 0) {
      return { result: 'pass' };
    }

    const reviewModel = ctx.reviewerModel ?? this.resolveReviewModel();

    // Build a "post-apply preview" for each file the diff touches. The Judge
    // reviews the RESULTING code, not just the diff — this catches problems
    // like unreachable branches ("there's already an `if (options.json)`
    // earlier that returns"), duplicated logic, and unused imports that look
    // fine in diff form but are wrong in context.
    const previews = buildPostApplyPreviews(ctx.diffText, ctx.projectPath);

    const previewSection = previews.length > 0
      ? previews
          .map(p => {
            if (p.error) {
              return `### ${p.path} (could not simulate apply: ${p.error})\nShown as diff only:\n\`\`\`diff\n${ctx.diffText}\n\`\`\``;
            }
            return `### ${p.path} — AFTER the diff is applied\n\`\`\`\n${p.preview}\n\`\`\``;
          })
          .join('\n\n')
      : `(no file previews available — grading against diff only)\n\n\`\`\`diff\n${ctx.diffText}\n\`\`\``;

    // PHASE3 (P3.2): if the task carries an executable verification contract,
    // tell the Judge so it can rely on that objective gate for the behaviour the
    // test covers (the gate runs post-apply and will hard-fail a non-passing diff).
    const verificationBlock = ctx.verificationEvidence?.test_command
      ? `\n\nVerification gate (executed automatically AFTER this review, on the applied code): \`${ctx.verificationEvidence.test_command}\`${ctx.verificationEvidence.probe ? ` and probe \`${ctx.verificationEvidence.probe}\`` : ''}. This command's exit code is an authoritative pass/fail for the behaviour it exercises — for criteria covered by it, judge wiring/structure correctness and do not re-litigate behaviour the test will prove.`
      : '';

    const prompt = `You are a strict senior reviewer. Grade the proposed change against EACH acceptance criterion independently.

You are shown the FULL CONTENTS of each modified file AFTER the diff is applied. Read the resulting code carefully. A criterion passes only if the final code clearly satisfies it. Do NOT give the benefit of the doubt.${verificationBlock}

Common failure modes to catch:
- A new branch is added, but an EARLIER branch in the same function already returns or exits, making the new code unreachable (dead code).
- A helper variable/object is built but never wired into the exposed output (e.g. \`envChecks\` constructed but not added to \`report\`).
- A check is computed but its failure is never pushed to \`issues\`/\`envIssues\`/return value.
- A JSON output is updated but a parallel human-readable code path is left stale (or vice-versa).
- An import is added but the symbol is never referenced (unused import = failure).
- Criteria referencing a specific key/name (e.g. "under report.environment") are satisfied only if that exact structure appears in the resulting code.
- The diff duplicates logic that already exists elsewhere in the file.

Acceptance Criteria:
${ctx.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Resulting files:

${previewSection}

Respond with JSON of shape:
{
  "criteria": [
    { "n": 1, "pass": true|false, "evidence": "<short quote or reason; cite line/function where the criterion is satisfied OR explain why it is not>" },
    ...
  ],
  "pass": true only if EVERY criterion above has pass:true,
  "feedback": "<one-line summary; if pass is false, list exactly which criteria failed and why>"
}

Only output the JSON object. No prose.`;

    try {
      const response = await this.provider.complete({
        model: reviewModel,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1500,
        temperature: 0.1,
        signal: ctx.abortSignal,
        timeout_ms: ctx.timeout_ms,
      });

      const parsed = parseCriteriaReviewResponse(response.content, ctx.acceptanceCriteria);
      if (!parsed) {
        return {
          result: 'fail',
          feedback: 'Criteria check: reviewer returned no parseable JSON. Re-emit the diff so the reviewer can grade it.',
        };
      }

      return { result: parsed.pass ? 'pass' : 'fail', feedback: parsed.feedback };
    } catch (err) {
      if (ctx.abortSignal?.aborted) throw err;
      return {
        result: 'fail',
        feedback: `Criteria check errored: ${err instanceof Error ? err.message : String(err)}. Re-emit the diff.`,
      };
    }
  }
}

function isCriteriaReviewObject(value: JsonObject): value is JsonObject {
  const hasCriteria = Array.isArray(value.criteria) && value.criteria.length > 0 && value.criteria.every(isCriteriaEntry);
  const hasPass = typeof value.pass === 'boolean';
  const hasValidFeedback = value.feedback === undefined || typeof value.feedback === 'string';
  return hasValidFeedback && (hasCriteria || hasPass);
}

function isCriteriaEntry(value: unknown): value is CriteriaEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Number.isInteger(record.n)
    && typeof record.pass === 'boolean'
    && (record.evidence === undefined || typeof record.evidence === 'string');
}

/**
 * For each file the diff modifies, read the current file content from the
 * workspace and compute an in-memory "post-apply preview" — what the file
 * would look like if the diff were applied. Used by the Judge's criteria
 * check so it grades the resulting code (catches unreachable branches,
 * unused imports, duplicated logic) rather than the diff in isolation.
 *
 * Returns `{ path, preview }` on success, `{ path, error }` on failure
 * (e.g. the patch doesn't apply cleanly, file missing, or no projectPath).
 * Previews longer than MAX_PREVIEW_CHARS are truncated with a marker so
 * we stay within reviewer context budget.
 */
function buildPostApplyPreviews(
  diffText: string,
  projectPath: string | undefined,
): Array<{ path: string; preview?: string; error?: string }> {
  if (!projectPath) return [];

  let patches;
  try {
    patches = parsePatch(diffText);
  } catch {
    return [];
  }

  const MAX_PREVIEW_CHARS = 12_000;
  const results: Array<{ path: string; preview?: string; error?: string }> = [];

  for (const patch of patches) {
    const newFile = patch.newFileName || patch.oldFileName || '';
    const relativePath = newFile.replace(/^[ab]\//, '');
    if (!relativePath) continue;

    const filePath = join(projectPath, relativePath);
    let original = '';
    if (existsSync(filePath)) {
      try {
        original = readFileSync(filePath, 'utf-8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      } catch (e) {
        results.push({ path: relativePath, error: `could not read file: ${(e as Error).message}` });
        continue;
      }
    }

    const patched = applyPatch(original, patch, {
      fuzzFactor: 5,
      compareLine: (_lineNumber: number, line: string, _operation: string, patchContent: string) =>
        (line ?? '').trimEnd() === (patchContent ?? '').trimEnd(),
    });

    if (patched === false) {
      results.push({ path: relativePath, error: 'patch did not apply cleanly' });
      continue;
    }

    let preview = patched;
    if (preview.length > MAX_PREVIEW_CHARS) {
      preview = preview.slice(0, MAX_PREVIEW_CHARS) +
        `\n\n... [file truncated at ${MAX_PREVIEW_CHARS} chars for review context budget] ...`;
    }

    // Annotate with line numbers to help the Judge cite specific locations.
    const numbered = preview
      .split('\n')
      .map((l, i) => `${String(i + 1).padStart(4, ' ')}  ${l}`)
      .join('\n');

    results.push({ path: relativePath, preview: numbered });
  }

  return results;
}

/**
 * Parse each `@@ -old_start[,old_count] +new_start[,new_count] @@` hunk header,
 * then count the actual context/removal/addition lines in the hunk body.
 * Returns a list of human-readable error strings for any mismatches found.
 *
 * Why this matters: LLMs frequently emit correct-looking diffs where the declared
 * line counts in the @@ header don't match the actual content. These diffs
 * will silently fail during `patch` / `git apply` even though they look valid.
 * Catching them early lets the retry message name the exact mismatch.
 */
function validateHunkCounts(diffText: string): string[] {
  const errors: string[] = [];
  const lines = diffText.split('\n');

  // Regex: @@ -L[,N] +L[,N] @@
  const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

  let declaredOld = 0;
  let declaredNew = 0;
  let actualOld = 0;
  let actualNew = 0;
  let inHunk = false;
  let hunkHeader = '';

  const flush = () => {
    if (!inHunk) return;
    if (actualOld !== declaredOld || actualNew !== declaredNew) {
      errors.push(
        `Hunk \`${hunkHeader}\` declares ${declaredOld} old / ${declaredNew} new lines` +
        ` but contains ${actualOld} old / ${actualNew} new lines` +
        ` — recalculate the @@ counts to match the actual content`
      );
    }
  };

  for (const line of lines) {
    const m = line.match(HUNK_RE);
    if (m) {
      flush();
      // omitted count means 1 (standard unified diff convention)
      declaredOld = m[2] !== undefined ? parseInt(m[2], 10) : 1;
      declaredNew = m[4] !== undefined ? parseInt(m[4], 10) : 1;
      actualOld = 0;
      actualNew = 0;
      inHunk = true;
      hunkHeader = line.slice(0, 40);
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith('--- ') || line.startsWith('+++ ')) {
      // File header inside a diff block — ends the current hunk
      flush();
      inHunk = false;
      continue;
    }
    if (line.startsWith('-')) { actualOld++; }
    else if (line.startsWith('+')) { actualNew++; }
    else if (line.startsWith(' ') || line === '') {
      // Context line counts toward both sides
      actualOld++;
      actualNew++;
    }
  }
  flush();
  return errors;
}

/**
 * Rewrite every `@@ -X,A +Y,B @@` hunk header so that A and B match the actual
 * count of old / new lines in the hunk body. Preserves the starting line
 * numbers (X, Y) and any text after the closing `@@` (function-context hint).
 *
 * This is an intentionally forgiving step: LLMs at every tier \u2014 qwen, gpt-4o-mini,
 * gpt-4.1-mini, claude \u2014 consistently miscount line totals. The body they produce
 * is usually correct; only the header arithmetic is off. `jsdiff.applyPatch`,
 * which blacksmith uses to apply, already ignores bad counts and matches on
 * context. So rejecting on bad counts burns retries and tokens for nothing.
 *
 * If the input has no hunks (non-diff text), we return it unchanged so other
 * format checks can still run and produce meaningful errors.
 */
function normalizeHunkHeaders(diffText: string): string {
  const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;
  const lines = diffText.split('\n');
  const output: string[] = [];

  // Scan for hunks; when we find one, collect its body to the next hunk / file header / EOF,
  // count old/new lines, then emit the corrected header followed by the body verbatim.
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(HUNK_RE);
    if (!m) {
      output.push(line);
      i++;
      continue;
    }
    const oldStart = parseInt(m[1], 10);
    const newStart = parseInt(m[2], 10);
    const trailer = m[3] ?? '';

    // Find the end of this hunk body: next hunk, next file header, or EOF.
    let j = i + 1;
    let actualOld = 0;
    let actualNew = 0;
    while (j < lines.length) {
      const l = lines[j];
      if (l.match(HUNK_RE)) break;
      if (l.startsWith('--- ') || l.startsWith('+++ ')) break;
      if (l.startsWith('-')) actualOld++;
      else if (l.startsWith('+')) actualNew++;
      else if (l.startsWith(' ') || l === '') { actualOld++; actualNew++; }
      // Any other prefix (e.g. `\ No newline at end of file`) counts as neither.
      j++;
    }

    // Re-emit the header with corrected counts. Always include explicit counts
    // even when they are 1 so downstream validators see the expected format.
    output.push(`@@ -${oldStart},${actualOld} +${newStart},${actualNew} @@${trailer}`);
    // Body passes through unchanged.
    for (let k = i + 1; k < j; k++) output.push(lines[k]);
    i = j;
  }

  return output.join('\n');
}

function extractFilesFromDiff(diffText: string): string[] {
  const files = new Set<string>();
  const lines = diffText.split('\n');
  for (const line of lines) {
    if (line.startsWith('+++ ')) {
      let file = line.slice(4).replace(/^[ab]\//, '').trim();
      // Strip GNU-style timestamps (tab or 2+ spaces followed by date)
      file = file.replace(/(?:\t|\s{2,})\d{4}-\d{2}-\d{2}.*$/, '').trim();
      if (file && file !== '/dev/null') files.add(file);
    }
  }
  return [...files];
}
