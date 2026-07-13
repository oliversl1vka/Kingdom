import { Command } from 'commander';
import { theme } from '../theme.js';

function buildStatusSnapshot(db: import('better-sqlite3').Database): string {
  const objective = db
    .prepare(`SELECT description, status FROM objectives ORDER BY created_at DESC LIMIT 1`)
    .get() as { description: string; status: string } | undefined;

  const taskCounts = db
    .prepare(`SELECT status, COUNT(*) n FROM task_graph_nodes GROUP BY status ORDER BY n DESC`)
    .all() as Array<{ status: string; n: number }>;

  const jobCounts = db
    .prepare(`SELECT status, COUNT(*) n FROM jobs GROUP BY status ORDER BY n DESC`)
    .all() as Array<{ status: string; n: number }>;

  const locks = db
    .prepare(`SELECT COUNT(*) n FROM file_locks`)
    .get() as { n: number };

  const tokens = db
    .prepare(`SELECT COALESCE(SUM(tokens_used),0) n FROM jobs`)
    .get() as { n: number };

  const running = db
    .prepare(`
      SELECT j.id, j.status, t.title, t.assigned_tier, j.started_at
      FROM jobs j JOIN task_graph_nodes t ON j.task_id = t.id
      WHERE j.status IN ('running','streaming')
      ORDER BY j.started_at DESC LIMIT 5
    `)
    .all() as Array<{ id: string; status: string; title: string; assigned_tier: string; started_at: string }>;

  const stuck = db
    .prepare(`SELECT title, status, retry_count FROM task_graph_nodes WHERE status IN ('awaiting-healer','awaiting-redesign','needs-human','stalled') ORDER BY status`)
    .all() as Array<{ title: string; status: string; retry_count: number }>;

  const recentFails = db
    .prepare(`
      SELECT j.failure_type, t.title, t.assigned_tier
      FROM jobs j JOIN task_graph_nodes t ON j.task_id = t.id
      WHERE j.status LIKE 'failed-%'
      ORDER BY j.created_at DESC LIMIT 3
    `)
    .all() as Array<{ failure_type: string; title: string; assigned_tier: string }>;

  const diffStats = db
    .prepare(`
      SELECT
        (SELECT COUNT(*) FROM jobs WHERE status='completed' AND result_path IS NOT NULL) as applied,
        (SELECT COUNT(*) FROM jobs WHERE failure_type='invalid-output') as diff_failed,
        (SELECT COUNT(*) FROM jobs WHERE failure_type='review-rejection') as review_rejected
    `)
    .get() as { applied: number; diff_failed: number; review_rejected: number };

  // Build display
  const total = taskCounts.reduce((s, r) => s + r.n, 0);
  const done = taskCounts.find(r => r.status === 'completed')?.n ?? 0;
  const doneWarn = taskCounts.find(r => r.status === 'completed-with-warnings')?.n ?? 0;
  const queued = taskCounts.find(r => r.status === 'queued')?.n ?? 0;
  const runningCount = taskCounts.find(r => r.status === 'running')?.n ?? 0;
  const healerCount = taskCounts.find(r => r.status === 'awaiting-healer')?.n ?? 0;

  const pct = total > 0 ? Math.round(((done + doneWarn) / total) * 100) : 0;
  const barLen = 30;
  const filled = Math.round((pct / 100) * barLen);
  const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);

  const costEstimate = (tokens.n / 1_000_000) * 0.80;

  const diffTotal = diffStats.applied + diffStats.diff_failed;
  const diffSuccessRate = diffTotal > 0 ? Math.round((diffStats.applied / diffTotal) * 100) : 100;
  const diffFlag = diffSuccessRate < 50 ? ' ⚠️ LOW' : '';

  const lines: string[] = [];
  lines.push(`  Objective : ${objective?.description?.slice(0, 70) ?? 'none'}`);
  lines.push(`  Status    : ${objective?.status ?? 'n/a'}`);
  lines.push('');
  lines.push(`  Progress  : [${bar}] ${pct}%  (${done + doneWarn}/${total} tasks)`);
  lines.push(`  Queued: ${queued}  Running: ${runningCount}  Stuck: ${healerCount}`);
  lines.push('');
  lines.push(`  Tokens    : ${tokens.n.toLocaleString()}  (~$${costEstimate.toFixed(2)} blended)`);
  lines.push(`  Diff rate : ${diffSuccessRate}% success (${diffStats.applied} applied / ${diffStats.diff_failed} failed)${diffFlag}`);
  lines.push(`  Locks     : ${locks.n} active`);
  lines.push('');

  if (running.length > 0) {
    lines.push('  Running jobs:');
    for (const j of running) {
      const elapsed = j.started_at ? Math.round((Date.now() - new Date(j.started_at).getTime()) / 1000) : 0;
      lines.push(`    [${j.assigned_tier.padEnd(8)}] ${j.title.slice(0, 55).padEnd(55)} ${elapsed}s`);
    }
    lines.push('');
  }

  if (stuck.length > 0) {
    lines.push('  Stuck tasks:');
    for (const s of stuck) {
      lines.push(`    ${s.status.padEnd(22)} retry:${s.retry_count}  ${s.title.slice(0, 50)}`);
    }
    lines.push('');
  }

  if (recentFails.length > 0) {
    lines.push('  Recent failures:');
    for (const f of recentFails) {
      lines.push(`    [${f.assigned_tier.padEnd(8)}] ${(f.failure_type ?? 'unknown').padEnd(18)} ${f.title.slice(0, 45)}`);
    }
    lines.push('');
  }

  // Verdict
  let verdict = 'HEALTHY';
  if (healerCount > 0) verdict = `NEEDS ATTENTION — ${healerCount} task(s) awaiting healer`;
  if (stuck.some(s => s.status === 'awaiting-redesign' || s.status === 'needs-human')) verdict = 'CRITICAL — tasks need human intervention';
  if (diffSuccessRate < 50 && diffTotal > 10) verdict = 'NEEDS ATTENTION — diff success rate below 50%';
  lines.push(`  Verdict   : ${verdict}`);

  return lines.join('\n');
}

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Display current system status')
    .option('--json', 'Machine-readable output')
    .option('--watch', 'Live-updating terminal dashboard (refresh every 3s)')
    .option('--jobs', 'Show only active jobs')
    .option('--agents', 'Show only agent statuses')
    .action(async (options: { json?: boolean; watch?: boolean; jobs?: boolean; agents?: boolean }) => {
      const { getDatabase } = await import('@kingdomos/core');
      const db = getDatabase();

      if (options.watch) {
        // Live dashboard mode — clear screen and reprint every 3 seconds
        process.stdout.write('\x1b[?25l'); // hide cursor
        const render = () => {
          process.stdout.write('\x1b[2J\x1b[H'); // clear screen, move to top
          console.log('  KingdomOS — Live Dashboard    (Ctrl+C to exit)\n');
          console.log(`  ${new Date().toLocaleTimeString()}\n`);
          try {
            console.log(buildStatusSnapshot(db));
          } catch (err) {
            console.log(`  Error reading DB: ${(err as Error).message}`);
          }
        };
        render();
        const timer = setInterval(render, 3000);
        process.on('SIGINT', () => {
          clearInterval(timer);
          process.stdout.write('\x1b[?25h'); // restore cursor
          process.exit(0);
        });
        return;
      }

      if (options.json) {
        const jobStats = db
          .prepare(
            `SELECT
              COUNT(CASE WHEN status = 'running' THEN 1 END) as running,
              COUNT(CASE WHEN status = 'queued' THEN 1 END) as queued,
              COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
              COUNT(CASE WHEN status LIKE 'failed-%' THEN 1 END) as failed
            FROM jobs`
          )
          .get() as Record<string, number>;
        const tokenStats = db
          .prepare(`SELECT COALESCE(SUM(tokens_used), 0) as total FROM jobs`)
          .get() as { total: number };
        console.log(JSON.stringify({ jobs: jobStats, tokens: tokenStats.total }, null, 2));
        return;
      }

      theme.info('KingdomOS Status');
      console.log(buildStatusSnapshot(db));
    });
}
