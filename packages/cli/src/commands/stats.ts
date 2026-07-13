import { Command } from 'commander';
import { theme } from '../theme.js';

export function registerStatsCommand(program: Command): void {
  program
    .command('stats')
    .description('Analytics: per-tier success rates, retry distribution, diff stats, expensive tasks')
    .option('--json', 'Machine-readable output')
    .option('--top <n>', 'Number of top-expensive tasks to show', '5')
    .action(async (options: { json?: boolean; top?: string }) => {
      const topN = parseInt(options.top ?? '5', 10);
      const { getDatabase } = await import('@kingdomos/core');
      const db = getDatabase();

      // Per-tier job counts and success rates
      const tierStats = db.prepare(`
        SELECT
          t.assigned_tier as tier,
          COUNT(j.id) as total_jobs,
          COUNT(CASE WHEN j.status = 'completed' OR j.status = 'completed-with-warnings' THEN 1 END) as succeeded,
          COUNT(CASE WHEN j.status LIKE 'failed-%' THEN 1 END) as failed,
          COALESCE(AVG(CASE WHEN j.tokens_used > 0 THEN j.tokens_used END), 0) as avg_tokens,
          COALESCE(SUM(j.tokens_used), 0) as total_tokens
        FROM jobs j
        JOIN task_graph_nodes t ON j.task_id = t.id
        GROUP BY t.assigned_tier
        ORDER BY total_jobs DESC
      `).all() as Array<{ tier: string; total_jobs: number; succeeded: number; failed: number; avg_tokens: number; total_tokens: number }>;

      // Retry distribution
      const retryDist = db.prepare(`
        SELECT
          retry_count,
          COUNT(*) as tasks
        FROM task_graph_nodes
        WHERE retry_count > 0
        GROUP BY retry_count
        ORDER BY retry_count
      `).all() as Array<{ retry_count: number; tasks: number }>;

      const totalRetried = db.prepare(`
        SELECT COUNT(*) n FROM task_graph_nodes WHERE retry_count > 0
      `).get() as { n: number };

      const totalTasks = db.prepare(`
        SELECT COUNT(*) n FROM task_graph_nodes
      `).get() as { n: number };

      // Diff success rate by tier
      const diffByTier = db.prepare(`
        SELECT
          t.assigned_tier as tier,
          COUNT(CASE WHEN j.result_path IS NOT NULL AND j.status = 'completed' THEN 1 END) as applied,
          COUNT(CASE WHEN j.failure_type = 'invalid-output' THEN 1 END) as diff_failed,
          COUNT(CASE WHEN j.failure_type = 'review-rejection' THEN 1 END) as review_rejected
        FROM jobs j
        JOIN task_graph_nodes t ON j.task_id = t.id
        GROUP BY t.assigned_tier
        ORDER BY applied DESC
      `).all() as Array<{ tier: string; applied: number; diff_failed: number; review_rejected: number }>;

      // Most expensive tasks
      const expensiveTasks = db.prepare(`
        SELECT
          t.title,
          t.assigned_tier as tier,
          t.status,
          COALESCE(SUM(j.tokens_used), 0) as total_tokens
        FROM task_graph_nodes t
        LEFT JOIN jobs j ON j.task_id = t.id
        GROUP BY t.id
        ORDER BY total_tokens DESC
        LIMIT ?
      `).all(topN) as Array<{ title: string; tier: string; status: string; total_tokens: number }>;

      // Test task failure rate
      const testTasks = db.prepare(`
        SELECT
          COUNT(*) as total,
          COUNT(CASE WHEN status IN ('completed','completed-with-warnings') THEN 1 END) as completed,
          COUNT(CASE WHEN status IN ('awaiting-healer','awaiting-redesign','needs-human','stalled') THEN 1 END) as stuck
        FROM task_graph_nodes
        WHERE title LIKE '%Test%' OR title LIKE '%test%' OR title LIKE '%spec%'
           OR title LIKE '%unit%' OR title LIKE '% e2e%'
      `).get() as { total: number; completed: number; stuck: number };

      // Escalation chains
      const escalations = db.prepare(`
        SELECT COUNT(*) n FROM jobs WHERE parent_job_id IS NOT NULL
      `).get() as { n: number };

      if (options.json) {
        console.log(JSON.stringify({
          tier_stats: tierStats,
          retry_distribution: retryDist,
          retry_rate_pct: totalTasks.n > 0 ? Math.round((totalRetried.n / totalTasks.n) * 100) : 0,
          diff_by_tier: diffByTier,
          top_expensive_tasks: expensiveTasks,
          test_tasks: testTasks,
          escalations: escalations.n,
        }, null, 2));
        return;
      }

      theme.info('KingdomOS Analytics');
      console.log('');

      // Tier performance table
      console.log('  Tier Performance:');
      console.log('  ' + '─'.repeat(72));
      console.log(`  ${'Tier'.padEnd(12)} ${'Jobs'.padStart(5)} ${'OK'.padStart(5)} ${'Fail'.padStart(5)} ${'Rate'.padStart(6)} ${'AvgTok'.padStart(8)} ${'TotalTok'.padStart(10)}`);
      console.log('  ' + '─'.repeat(72));
      for (const t of tierStats) {
        const rate = t.total_jobs > 0 ? Math.round((t.succeeded / t.total_jobs) * 100) : 0;
        const rateStr = `${rate}%`;
        const flag = rate < 50 && t.total_jobs >= 3 ? ' ⚠' : '';
        console.log(
          `  ${t.tier.padEnd(12)} ${String(t.total_jobs).padStart(5)} ${String(t.succeeded).padStart(5)} ${String(t.failed).padStart(5)} ${rateStr.padStart(6)}${flag.padEnd(2)} ${Math.round(t.avg_tokens).toLocaleString().padStart(8)} ${t.total_tokens.toLocaleString().padStart(10)}`
        );
      }
      console.log('');

      // Diff stats by tier
      console.log('  Diff Quality by Tier:');
      console.log('  ' + '─'.repeat(56));
      console.log(`  ${'Tier'.padEnd(12)} ${'Applied'.padStart(8)} ${'DiffFail'.padStart(9)} ${'Rejected'.padStart(9)} ${'Rate'.padStart(6)}`);
      console.log('  ' + '─'.repeat(56));
      for (const d of diffByTier) {
        const total = d.applied + d.diff_failed;
        const rate = total > 0 ? Math.round((d.applied / total) * 100) : 100;
        const flag = rate < 50 && total >= 3 ? ' ⚠' : '';
        console.log(
          `  ${d.tier.padEnd(12)} ${String(d.applied).padStart(8)} ${String(d.diff_failed).padStart(9)} ${String(d.review_rejected).padStart(9)} ${(rate + '%').padStart(6)}${flag}`
        );
      }
      console.log('');

      // Retry distribution
      console.log('  Retry Distribution:');
      const retryRate = totalTasks.n > 0 ? Math.round((totalRetried.n / totalTasks.n) * 100) : 0;
      console.log(`  Tasks retried at least once: ${totalRetried.n} / ${totalTasks.n} (${retryRate}%)`);
      if (retryDist.length > 0) {
        for (const r of retryDist) {
          const bar = '█'.repeat(Math.min(r.tasks, 20));
          console.log(`  retry=${r.retry_count}  ${bar} ${r.tasks}`);
        }
      } else {
        console.log('  No retries recorded.');
      }
      console.log(`  Escalation chains: ${escalations.n}`);
      console.log('');

      // Top expensive tasks
      console.log(`  Top ${topN} Most Token-Expensive Tasks:`);
      for (const t of expensiveTasks) {
        if (t.total_tokens === 0) continue;
        const costUsd = (t.total_tokens / 1_000_000) * 0.80;
        console.log(`  [${t.tier.padEnd(10)}] ${t.title.slice(0, 48).padEnd(48)} ${t.total_tokens.toLocaleString().padStart(8)} tok  ~$${costUsd.toFixed(3)}`);
      }
      console.log('');

      // Test task health
      if (testTasks.total > 0) {
        const testSuccessRate = Math.round((testTasks.completed / testTasks.total) * 100);
        const testFlag = testSuccessRate < 50 ? ' ⚠ HIGH FAILURE RATE' : '';
        console.log(`  Test Tasks: ${testTasks.completed}/${testTasks.total} completed (${testSuccessRate}%)${testFlag}  stuck: ${testTasks.stuck}`);
        console.log('');
      }
    });
}
