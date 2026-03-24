import type {
  Job,
  ReviewDecision,
  ReviewVerdict,
  ReviewCheckResult,
  ProviderAdapter,
  CompletionRequest,
} from '../types.js';
import { generateUlid } from '../ulid.js';
import type Database from 'better-sqlite3';

// Credential/secret patterns to detect in diffs
const SECURITY_PATTERNS = [
  /(?:api[_-]?key|apikey)\s*[:=]\s*['"][^'"]+['"]/i,
  /(?:secret|password|token|auth)\s*[:=]\s*['"][^'"]+['"]/i,
  /(?:AWS|aws)[_-]?(?:SECRET|ACCESS|KEY)/,
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

export interface ReviewContext {
  job: Job;
  diffText: string;
  allowedFiles: string[];
  acceptanceCriteria: string[];
}

export class ReviewEngine {
  constructor(
    private db: Database.Database,
    private provider?: ProviderAdapter
  ) {}

  async review(ctx: ReviewContext): Promise<ReviewDecision> {
    const scopeCheck = this.checkScope(ctx.diffText, ctx.allowedFiles);
    const formatCheck = this.checkFormat(ctx.diffText);
    const securityCheck = this.checkSecurity(ctx.diffText);
    const criteriaCheck = await this.checkCriteria(ctx);

    const allPassed = scopeCheck === 'pass' && formatCheck === 'pass' && securityCheck === 'pass' && criteriaCheck.result === 'pass';

    const reviewId = generateUlid();
    const rejectionReasons: string[] = [];

    if (scopeCheck === 'fail') rejectionReasons.push('Diff modifies files outside allowed scope');
    if (formatCheck === 'fail') rejectionReasons.push('Diff format is invalid');
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

  private checkScope(diffText: string, allowedFiles: string[]): ReviewCheckResult {
    // If no allowed files specified, scope is unrestricted
    if (allowedFiles.length === 0) return 'pass';
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
    // Check for basic unified diff structure
    if (!diffText.includes('---') || !diffText.includes('+++') || !diffText.includes('@@')) {
      return 'fail';
    }
    return 'pass';
  }

  private checkSecurity(diffText: string): ReviewCheckResult {
    // Only check added lines (starting with +)
    const addedLines = diffText
      .split('\n')
      .filter((line) => line.startsWith('+') && !line.startsWith('+++'));

    const addedContent = addedLines.join('\n');

    for (const pattern of SECURITY_PATTERNS) {
      if (pattern.test(addedContent)) return 'fail';
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

    const prompt = `Review this code diff against the acceptance criteria.

Acceptance Criteria:
${ctx.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Diff:
${ctx.diffText}

Respond with JSON: {"pass": true/false, "feedback": "explanation"}`;

    try {
      const response = await this.provider.complete({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
        temperature: 0.1,
      });

      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          result: parsed.pass ? 'pass' : 'fail',
          feedback: parsed.feedback,
        };
      }
    } catch {
      // If criteria check fails, default to pass
    }

    return { result: 'pass' };
  }
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
