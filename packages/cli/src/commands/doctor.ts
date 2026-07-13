import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { theme } from '../theme.js';

interface HealthIssue {
  severity: 'warn' | 'error';
  message: string;
}

interface Report {
  health: 'ok' | 'error' | 'warn';
  issues: Array<{ severity: 'warn' | 'error'; message: string }>;
  objectives: {
    total: number;
    draft: number;
    active: number;
    completed: number;
    failed: number;
  };
  tasks: {
    total: number;
    queued: number;
    running: number;
    retrying: number;
    stalled: number;
    awaiting_healer: number;
    completed: number;
    failed: number;
    stuck: Array<{ id: string; title: string; assigned_tier: string; retry_count: number }>;
  };
  jobs: {
    total: number;
    running: number;
    queued: number;
    completed: number;
    failed: number;
    success_rate_pct: number | null;
    total_tokens: number;
  };
  reviews: {
    total: number;
    approved: number;
    rejected: number;
    format_failures: number;
    scope_failures: number;
    security_failures: number;
  };
  locks: {
    active: number;
    expired: number;
    held: Array<{ file_path: string; owning_job_id: string; locked_at: string }>;
  };
  incidents: {
    total: number;
    open: number;
    high: number;
    critical: number;
  };
  environment: {
    openaiKeySet: boolean;
    lmstudioReachable: boolean;
    llamacppReachable: boolean;
    cliBuilt: boolean;
    dbExists: boolean;
  };
  models: {
    configured: number;
    missing_registry: string[];
  };
  memory: {
    lessons_total: number;
    lessons_by_tier: Record<string, number>;
  };
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Diagnose system health — objectives, tasks, jobs, locks, incidents, token usage')
    .option('--json', 'Machine-readable output')
    .action(async (options: { json?: boolean }) => {
      const { getDatabase, getConfig, LessonsRepository } = await import('@kingdomos/core');
      const { ModelRegistry } = await import('@kingdomos/token-engine');
      const db = getDatabase();
      const issues: HealthIssue[] = [];

      // ── Objectives ─────────────────────────────────────────────────────────
      const objStats = db
        .prepare(
          `SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'draft'     THEN 1 ELSE 0 END) as draft,
            SUM(CASE WHEN status = 'planning'  THEN 1 ELSE 0 END) as planning,
            SUM(CASE WHEN status = 'active'    THEN 1 ELSE 0 END) as active,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN status = 'completed-with-warnings' THEN 1 ELSE 0 END) as completed_with_warnings,
            SUM(CASE WHEN status = 'failed'    THEN 1 ELSE 0 END) as failed,
            SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled
           FROM objectives`
        )
        .get() as Record<string, number>;

      if ((objStats.failed ?? 0) > 0) {
        issues.push({ severity: 'error', message: `${objStats.failed} objective(s) in failed state` });
      }

      // ── Task health ─────────────────────────────────────────────────────────
      const taskStats = db
        .prepare(
          `SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'queued'          THEN 1 ELSE 0 END) as queued,
            SUM(CASE WHEN status = 'running'         THEN 1 ELSE 0 END) as running,
            SUM(CASE WHEN status = 'retrying'        THEN 1 ELSE 0 END) as retrying,
            SUM(CASE WHEN status = 'stalled'         THEN 1 ELSE 0 END) as stalled,
            SUM(CASE WHEN status = 'awaiting-healer' THEN 1 ELSE 0 END) as awaiting_healer,
            SUM(CASE WHEN status = 'needs-human'     THEN 1 ELSE 0 END) as needs_human,
            SUM(CASE WHEN status = 'completed'       THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN status LIKE 'failed-%'     THEN 1 ELSE 0 END) as failed
           FROM task_graph_nodes`
        )
        .get() as Record<string, number>;

      if ((taskStats.awaiting_healer ?? 0) > 0) {
        issues.push({ severity: 'error', message: `${taskStats.awaiting_healer} task(s) stuck awaiting-healer — manual intervention needed` });
      }
      if ((taskStats.needs_human ?? 0) > 0) {
        issues.push({ severity: 'error', message: `${taskStats.needs_human} task(s) need human intervention` });
      }
      if ((taskStats.stalled ?? 0) > 0) {
        issues.push({ severity: 'warn', message: `${taskStats.stalled} task(s) currently stalled (missed heartbeats)` });
      }

      // ── Tasks awaiting healer (details) ─────────────────────────────────────
      const stuckTasks = db
        .prepare(
          `SELECT id, title, assigned_tier, retry_count FROM task_graph_nodes
           WHERE status IN ('awaiting-healer','needs-human')
           ORDER BY updated_at DESC LIMIT 10`
        )
        .all() as Array<{ id: string; title: string; assigned_tier: string; retry_count: number }>;

      // ── Job health ──────────────────────────────────────────────────────────
      const jobStats = db
        .prepare(
          `SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'running'        THEN 1 ELSE 0 END) as running,
            SUM(CASE WHEN status = 'queued'         THEN 1 ELSE 0 END) as queued,
            SUM(CASE WHEN status = 'stalled'        THEN 1 ELSE 0 END) as stalled,
            SUM(CASE WHEN status = 'completed'      THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN status LIKE 'failed-%'    THEN 1 ELSE 0 END) as failed,
            COALESCE(SUM(tokens_used), 0)           as total_tokens,
            COALESCE(SUM(CASE WHEN status = 'completed' THEN tokens_used ELSE 0 END), 0) as success_tokens
           FROM jobs`
        )
        .get() as Record<string, number>;

      const totalAttempts = (jobStats.completed ?? 0) + (jobStats.failed ?? 0);
      const successRate = totalAttempts > 0 ? Math.round(((jobStats.completed ?? 0) / totalAttempts) * 100) : null;

      if (successRate !== null && successRate < 50) {
        issues.push({ severity: 'warn', message: `Low job success rate: ${successRate}% (${jobStats.completed} completed / ${totalAttempts} attempted)` });
      }

      // ── Review health ───────────────────────────────────────────────────────
      const reviewStats = db
        .prepare(
          `SELECT
            COUNT(*) as total,
            SUM(CASE WHEN decision = 'approved'  THEN 1 ELSE 0 END) as approved,
            SUM(CASE WHEN decision = 'rejected'  THEN 1 ELSE 0 END) as rejected,
            SUM(CASE WHEN format_check = 'fail'  THEN 1 ELSE 0 END) as format_failures,
            SUM(CASE WHEN scope_check  = 'fail'  THEN 1 ELSE 0 END) as scope_failures,
            SUM(CASE WHEN security_check = 'fail' THEN 1 ELSE 0 END) as security_failures
           FROM review_decisions`
        )
        .get() as Record<string, number>;

      if ((reviewStats.security_failures ?? 0) > 0) {
        issues.push({ severity: 'error', message: `${reviewStats.security_failures} security violation(s) caught by Judge` });
      }

      // ── Active file locks ───────────────────────────────────────────────────
      const lockStats = db
        .prepare(
          `SELECT
            COUNT(*) as total,
            SUM(CASE WHEN locked_at < datetime('now', '-' || max_duration_seconds || ' seconds') THEN 1 ELSE 0 END) as expired
           FROM file_locks`
        )
        .get() as Record<string, number>;

      if ((lockStats.expired ?? 0) > 0) {
        issues.push({ severity: 'warn', message: `${lockStats.expired} expired file lock(s) not yet cleaned up` });
      }

      const activeLocks = db
        .prepare(
          `SELECT file_path, owning_job_id, locked_at FROM file_locks
           WHERE locked_at >= datetime('now', '-' || max_duration_seconds || ' seconds')
           ORDER BY locked_at DESC LIMIT 10`
        )
        .all() as Array<{ file_path: string; owning_job_id: string; locked_at: string }>;

      // ── Open incidents ──────────────────────────────────────────────────────
      const incidentStats = db
        .prepare(
          `SELECT
            COUNT(*) as total,
            SUM(CASE WHEN resolved_at IS NULL  THEN 1 ELSE 0 END) as open,
            SUM(CASE WHEN severity = 'high'    THEN 1 ELSE 0 END) as high,
            SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) as critical
           FROM incidents`
        )
        .get() as Record<string, number>;

      if ((incidentStats.critical ?? 0) > 0) {
        issues.push({ severity: 'error', message: `${incidentStats.critical} critical incident(s) open` });
      }
      if ((incidentStats.high ?? 0) > 0) {
        issues.push({ severity: 'warn', message: `${incidentStats.high} high-severity incident(s) open` });
      }

      // ── Assemble report ─────────────────────────────────────────────────────
      const openaiKeySet = typeof process.env.OPENAI_API_KEY === 'string' && process.env.OPENAI_API_KEY.length > 0;
      const lmstudioReachable = await (async () => {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 2000);
          const response = await globalThis.fetch('http://localhost:1234/v1/models', { signal: controller.signal });
          clearTimeout(timeoutId);
          return response.status >= 200 && response.status < 300;
        } catch {
          return false;
        }
      })();
      const llamacppReachable = await (async () => {
        try {
          const config = getConfig();
          const endpoint = config.providers?.llamacpp?.endpoint ?? 'http://localhost:8080';
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 2000);
          const response = await globalThis.fetch(`${endpoint}/health`, { signal: controller.signal });
          clearTimeout(timeoutId);
          return response.status >= 200 && response.status < 300;
        } catch {
          return false;
        }
      })();
      const cliBuilt = existsSync('packages/cli/dist/index.js');
      const dbExists = existsSync('kingdom/kingdom.db');
      const modelRegistry = (() => {
        try {
          const config = getConfig();
          const configuredModels = Array.from(new Set(
            Object.values(config.tiers ?? {})
              .map((tier) => tier?.model)
              .filter((model): model is string => typeof model === 'string' && model.trim().length > 0),
          ));
          const registry = new ModelRegistry(db);
          const missing = configuredModels.filter((model) => !registry.getModelConfig(model));
          if (missing.length > 0) {
            issues.push({
              severity: 'warn',
              message: `Configured model(s) missing from registry: ${missing.join(', ')} — budget checks will use conservative defaults`,
            });
          }
          return { configured: configuredModels.length, missing_registry: missing };
        } catch {
          return { configured: 0, missing_registry: [] };
        }
      })();

      const report: Report = {
        health: issues.length === 0 ? 'ok' : issues.some(i => i.severity === 'error') ? 'error' : 'warn',
        issues,
        objectives: {
          total: objStats.total ?? 0,
          draft: objStats.draft ?? 0,
          active: objStats.active ?? 0,
          completed: objStats.completed ?? 0,
          failed: objStats.failed ?? 0,
        },
        tasks: {
          total: taskStats.total ?? 0,
          queued: taskStats.queued ?? 0,
          running: taskStats.running ?? 0,
          retrying: taskStats.retrying ?? 0,
          stalled: taskStats.stalled ?? 0,
          awaiting_healer: taskStats.awaiting_healer ?? 0,
          completed: taskStats.completed ?? 0,
          failed: taskStats.failed ?? 0,
          stuck: stuckTasks,
        },
        jobs: {
          total: jobStats.total ?? 0,
          running: jobStats.running ?? 0,
          queued: jobStats.queued ?? 0,
          completed: jobStats.completed ?? 0,
          failed: jobStats.failed ?? 0,
          success_rate_pct: successRate,
          total_tokens: jobStats.total_tokens ?? 0,
        },
        reviews: {
          total: reviewStats.total ?? 0,
          approved: reviewStats.approved ?? 0,
          rejected: reviewStats.rejected ?? 0,
          format_failures: reviewStats.format_failures ?? 0,
          scope_failures: reviewStats.scope_failures ?? 0,
          security_failures: reviewStats.security_failures ?? 0,
        },
        locks: {
          active: (lockStats.total ?? 0) - (lockStats.expired ?? 0),
          expired: lockStats.expired ?? 0,
          held: activeLocks,
        },
        incidents: {
          total: incidentStats.total ?? 0,
          open: incidentStats.open ?? 0,
          high: incidentStats.high ?? 0,
          critical: incidentStats.critical ?? 0,
        },
        environment: {
          openaiKeySet,
          lmstudioReachable,
          llamacppReachable,
          cliBuilt,
          dbExists,
        },
        models: modelRegistry,
        memory: (() => {
          // Best-effort — table may not exist yet on a pre-migration DB.
          try {
            const repo = new LessonsRepository(db);
            return {
              lessons_total: repo.totalActive(),
              lessons_by_tier: repo.countsByTier(),
            };
          } catch {
            return { lessons_total: 0, lessons_by_tier: {} };
          }
        })(),
      };

      if (options?.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      // Human-readable output
      const statusIcon = report.health === 'ok' ? '✅' : report.health === 'error' ? '❌' : '⚠️ ';
      theme.info(`Kingdom Doctor  ${statusIcon} ${report.health.toUpperCase()}`);
      console.log('');

      if (issues.length > 0) {
        console.log('  Issues:');
        for (const issue of issues) {
          const icon = issue.severity === 'error' ? '  ❌' : '  ⚠️ ';
          console.log(`${icon}  ${issue.message}`);
        }
        console.log('');
      }

      console.log('  Objectives');
      console.log(`    Total: ${report.objectives.total}  Active: ${report.objectives.active}  Completed: ${report.objectives.completed}  Failed: ${report.objectives.failed}`);

      console.log('  Tasks');
      console.log(`    Total: ${report.tasks.total}  Queued: ${report.tasks.queued}  Running: ${report.tasks.running}  Retrying: ${report.tasks.retrying}`);
      console.log(`    Completed: ${report.tasks.completed}  Failed: ${report.tasks.failed}  Stalled: ${report.tasks.stalled}  Stuck: ${report.tasks.awaiting_healer}`);
      if (stuckTasks.length > 0) {
        console.log('    Stuck tasks:');
        for (const t of stuckTasks) {
          console.log(`      • [${t.assigned_tier}] ${t.title.slice(0, 70)} (retries: ${t.retry_count})`);
        }
      }

      console.log('  Jobs');
      const rateStr = report.jobs.success_rate_pct !== null ? `${report.jobs.success_rate_pct}%` : 'n/a';
      console.log(`    Total: ${report.jobs.total}  Running: ${report.jobs.running}  Queued: ${report.jobs.queued}  Completed: ${report.jobs.completed}  Failed: ${report.jobs.failed}`);
      console.log(`    Success rate: ${rateStr}  Tokens used: ${report.jobs.total_tokens.toLocaleString()}`);

      console.log('  Reviews');
      const reviewTotal = report.reviews.total;
      const approvalRate = reviewTotal > 0 ? Math.round((report.reviews.approved / reviewTotal) * 100) : null;
      console.log(`    Total: ${reviewTotal}  Approved: ${report.reviews.approved}  Rejected: ${report.reviews.rejected}  Approval rate: ${approvalRate !== null ? approvalRate + '%' : 'n/a'}`);
      if (report.reviews.format_failures > 0) console.log(`    Format failures: ${report.reviews.format_failures}`);
      if (report.reviews.scope_failures > 0)  console.log(`    Scope failures:  ${report.reviews.scope_failures}`);

      console.log('  File Locks');
      console.log(`    Active: ${report.locks.active}  Expired: ${report.locks.expired}`);
      if (activeLocks.length > 0) {
        for (const lock of activeLocks) {
          console.log(`      • ${lock.file_path}  (job: ${lock.owning_job_id.slice(-8)})`);
        }
      }

      console.log('  Incidents');
      console.log(`    Total: ${report.incidents.total}  Open: ${report.incidents.open}  High: ${report.incidents.high}  Critical: ${report.incidents.critical}`);

      console.log('  Models');
      console.log(`    Configured: ${report.models.configured}  Missing registry: ${report.models.missing_registry.length}`);
      if (report.models.missing_registry.length > 0) {
        console.log(`    Missing: ${report.models.missing_registry.join(', ')}`);
      }

      console.log('  Memory');
      const tierSummary = Object.entries(report.memory.lessons_by_tier)
        .map(([t, n]) => `${t}:${n}`)
        .join('  ') || '(none)';
      console.log(`    Active lessons: ${report.memory.lessons_total}  By tier: ${tierSummary}`);
    });
}
