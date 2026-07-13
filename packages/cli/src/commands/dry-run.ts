import { Command } from 'commander';
import { theme } from '../theme.js';

export function registerDryRunCommand(program: Command): void {
  program
    .command('dry-run')
    .description('Preview objective decomposition using a real LLM, then roll back — no jobs are executed')
    .argument('<objective>', 'The objective to decompose and preview')
    .option('--json', 'Machine-readable output')
    .option('--timeout <ms>', 'Max time to wait for decomposition (ms)', '120000')
    .action(async (objective: string, options: { json?: boolean; timeout?: string }) => {
      const timeoutMs = parseInt(options.timeout ?? '120000', 10);

      const { getDatabase, getConfig, ObjectiveRepository, TaskRepository, OrchestrationLoop } = await import('@kingdomos/core');
      const { createOpenAIAdapter, createLMStudioAdapter, createLlamaCppAdapter } = await import('@kingdomos/providers');
      const { ModelRegistry, makeModelResolver } = await import('@kingdomos/token-engine');
      type TierConfig = import('@kingdomos/core').TierConfig;
      type TaskKind = import('@kingdomos/core').TaskKind;
      type TierClass = import('@kingdomos/core').TierClass;

      const db = getDatabase();
      const config = getConfig();

      // Resolve providers
      const openaiKey = process.env.OPENAI_API_KEY;
      const openaiProvider = openaiKey
        ? createOpenAIAdapter({ api_key: openaiKey, endpoint: config.providers?.openai?.endpoint })
        : null;
      const lmstudioProvider = config.providers?.lmstudio?.enabled
        ? createLMStudioAdapter({ endpoint: config.providers.lmstudio.endpoint ?? 'http://localhost:1234' })
        : null;
      const llamacppProvider = config.providers?.llamacpp?.enabled
        ? createLlamaCppAdapter({ endpoint: config.providers.llamacpp.endpoint ?? 'http://localhost:8080' })
        : null;

      const orchProvider = openaiProvider ?? llamacppProvider ?? lmstudioProvider;
      if (!orchProvider) {
        theme.error('No LLM provider available. Set OPENAI_API_KEY or enable llama.cpp/LMStudio in config.');
        process.exit(1);
      }

      const modelRegistry = new ModelRegistry(db);

      function mapTaskKind(tier: string): TaskKind {
        switch (tier) {
          case 'king':
          case 'nobility':
            return 'decomposition';
          case 'judge':
            return 'review';
          case 'healer':
            return 'healing';
          case 'scribe':
          case 'sentinel':
            return 'summarization';
          default:
            return 'implementation';
        }
      }

      function mapTierClass(tier: string): TierClass {
        if (tier === 'king' || tier === 'nobility' || tier === 'judge') return 'premium';
        if (tier === 'squire' || tier === 'scribe' || tier === 'sentinel' || tier === 'blacksmith') return 'cheap';
        return 'balanced';
      }

      function getTierConfig(tier: string): TierConfig {
        const configured = (config.tiers as Record<string, TierConfig>)?.[tier];
        if (configured) return configured;
        return {
          model: '',
          max_retries: 3,
          timeout_seconds: 30,
          profile: { task_kind: mapTaskKind(tier), cost_preference: mapTierClass(tier) },
        };
      }

      function getModelForTier(tier: string): string {
        return makeModelResolver(getTierConfig(tier), modelRegistry, mapTaskKind(tier))();
      }

      if (!options.json) {
        theme.info(`[Dry Run] Decomposing: "${objective.slice(0, 80)}"`);
        theme.info('  Running King + Nobility decomposition — all DB changes will be rolled back.');
      }

      // Run decomposition inside a transaction that we roll back at the end.
      // This lets the full LLM decomposition run normally while guaranteeing
      // no persistent state is written to the DB.
      let tasks: Array<{ id: string; level: string; title: string; assigned_tier: string; token_budget_estimate: number; status: string }> = [];
      let objectiveId = '';

      db.exec('BEGIN');
      try {
        // Create objective
        const objRepo = new ObjectiveRepository(db);
        const obj = objRepo.create({
          project_id: 'default',
          description: objective,
          priority: 5,
          acceptance_criteria: [],
        });
        objectiveId = obj.id;

        // Run orchestration loop long enough for King + Nobility to finish
        const loop = new OrchestrationLoop(db, orchProvider, {
          pollIntervalMs: 2000,
          defaultModel: getModelForTier('king'),
          decomposerModel: getModelForTier('king'),
          verbose: false,
          techStack: config.tech_stack,
        });

        // Poll until all leaf tasks are created (no epic/task level tasks still queued)
        // or until timeout
        await new Promise<void>((resolve) => {
          loop.start();
          const deadline = Date.now() + timeoutMs;

          const checker = setInterval(() => {
            const stillDecomposing = db
              .prepare(`SELECT COUNT(*) as n FROM task_graph_nodes WHERE objective_id = ? AND level IN ('epic', 'task') AND status = 'queued'`)
              .get(objectiveId) as { n: number };
            const anyCreated = db
              .prepare(`SELECT COUNT(*) as n FROM task_graph_nodes WHERE objective_id = ?`)
              .get(objectiveId) as { n: number };

            // Done when there are tasks AND no more epic/task level tasks need decomposing
            if (anyCreated.n > 0 && stillDecomposing.n === 0) {
              clearInterval(checker);
              loop.stop();
              resolve();
              return;
            }
            if (Date.now() > deadline) {
              clearInterval(checker);
              loop.stop();
              resolve();
            }
          }, 2000);
        });

        // Collect results before rollback
        const taskRepo = new TaskRepository(db);
        const allTasks = db
          .prepare(`SELECT id, level, title, assigned_tier, token_budget_estimate, status FROM task_graph_nodes WHERE objective_id = ? ORDER BY level, created_at`)
          .all(objectiveId) as typeof tasks;
        tasks = allTasks;

      } finally {
        // Always roll back — this is a preview, nothing should persist
        try { db.exec('ROLLBACK'); } catch { /* already rolled back or never started */ }
      }

      // Compute summary stats
      const byLevel = tasks.reduce<Record<string, number>>((acc, t) => {
        acc[t.level] = (acc[t.level] ?? 0) + 1;
        return acc;
      }, {});
      const byTier = tasks.reduce<Record<string, number>>((acc, t) => {
        acc[t.assigned_tier] = (acc[t.assigned_tier] ?? 0) + 1;
        return acc;
      }, {});
      const totalTokenEstimate = tasks.reduce((s, t) => s + (t.token_budget_estimate ?? 0), 0);
      // Rough cost: gpt-4.1-mini at $0.40/$1.60 per 1M, gpt-4o-mini at $0.15/$0.60 per 1M
      // Use blended $0.80/1M as a conservative estimate
      const estimatedCostUsd = (totalTokenEstimate / 1_000_000) * 0.80;

      if (options.json) {
        console.log(JSON.stringify({
          objective,
          dry_run: true,
          task_count: tasks.length,
          by_level: byLevel,
          by_tier: byTier,
          total_token_estimate: totalTokenEstimate,
          estimated_cost_usd: estimatedCostUsd.toFixed(4),
          tasks: tasks.map(t => ({ level: t.level, tier: t.assigned_tier, title: t.title, tokens: t.token_budget_estimate })),
        }, null, 2));
        return;
      }

      console.log('');
      console.log('  Task Breakdown:');
      for (const [level, count] of Object.entries(byLevel)) {
        console.log(`    ${level.padEnd(10)} ${count}`);
      }
      console.log('');
      console.log('  By Tier:');
      for (const [tier, count] of Object.entries(byTier)) {
        console.log(`    ${tier.padEnd(12)} ${count} tasks`);
      }
      console.log('');
      console.log(`  Total tasks:       ${tasks.length}`);
      console.log(`  Token estimate:    ${totalTokenEstimate.toLocaleString()}`);
      console.log(`  Estimated cost:    ~$${estimatedCostUsd.toFixed(2)} (blended $0.80/1M)`);
      console.log('');
      theme.success('Dry run complete. No changes were written to the database.');
    });
}
