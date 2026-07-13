import { Command } from 'commander';
import { theme } from '../theme.js';

/**
 * PHASE4 (P4.3): `kingdom eval` — run the model self-eval battery against one
 * or all registered models and write MEASURED ModelCapabilities + verified_at
 * back into the registry. Routing then becomes evidence-based.
 *
 *   kingdom eval                 # eval every model that has a usable provider
 *   kingdom eval --model gpt-4o-mini
 *   kingdom eval --probes decompose,review
 *   kingdom eval --dry-run       # run probes but do not persist
 */
export function registerEvalCommand(program: Command): void {
  program
    .command('eval')
    .description('Probe registered models and write measured capabilities (Phase 4 P4.3)')
    .option('--model <id>', 'Evaluate a single model id')
    .option('--probes <list>', 'Comma-separated probes: decompose,code-diff,review,diagnose')
    .option('--dry-run', 'Run probes but do not persist results / capabilities')
    .option('--json', 'Machine-readable output')
    .action(
      async (options: {
        model?: string;
        probes?: string;
        dryRun?: boolean;
        json?: boolean;
      }) => {
        const { getDatabase, getConfig } = await import('@kingdomos/core');
        const { ModelRegistry, evaluateModel, PROBE_NAMES } = await import('@kingdomos/token-engine');
        const { createOpenAIAdapter, createLMStudioAdapter, createLlamaCppAdapter } = await import(
          '@kingdomos/providers'
        );

        const db = getDatabase();
        const config = getConfig();
        const registry = new ModelRegistry(db);

        // Build the adapters we can actually use, keyed by provider id.
        const openaiKey = process.env.OPENAI_API_KEY;
        const adapters: Record<string, ReturnType<typeof createOpenAIAdapter> | null> = {
          openai: openaiKey
            ? createOpenAIAdapter({ api_key: openaiKey, endpoint: config.providers?.openai?.endpoint })
            : null,
          llamacpp: config.providers?.llamacpp?.enabled
            ? createLlamaCppAdapter({
                endpoint: config.providers.llamacpp.endpoint ?? 'http://localhost:8080',
              })
            : null,
          lmstudio: config.providers?.lmstudio?.enabled
            ? createLMStudioAdapter({
                endpoint: config.providers.lmstudio.endpoint ?? 'http://localhost:1234',
              })
            : null,
        };

        const probes = options.probes
          ? (options.probes.split(',').map((p) => p.trim()) as typeof PROBE_NAMES)
          : undefined;

        const models = options.model
          ? [registry.getModelConfig(options.model)].filter((m): m is NonNullable<typeof m> => !!m)
          : registry.getAllModels();

        if (models.length === 0) {
          theme.error(options.model ? `Model "${options.model}" not in registry` : 'No models registered');
          process.exit(1);
        }

        const results = [];
        for (const m of models) {
          const adapter = adapters[m.provider as keyof typeof adapters];
          if (!adapter) {
            if (!options.json) theme.warning(`Skipping ${m.model_id} — provider "${m.provider}" not available`);
            continue;
          }
          if (!options.json) theme.info(`Evaluating ${m.model_id} (${m.provider})…`);
          try {
            const r = await evaluateModel(db, m.model_id, adapter, {
              probes,
              persist: !options.dryRun,
              verbose: !options.json,
            });
            results.push(r);
            if (!options.json) {
              const passed = r.probes.filter((p) => p.passed).length;
              theme.success(
                `${m.model_id}: ${passed}/${r.probes.length} probes passed · tool_use=${r.capabilities.tool_use} · structured=${r.capabilities.structured_output} · tier=${r.capabilities.tier_class}`,
              );
            }
          } catch (e) {
            if (!options.json) theme.error(`${m.model_id} eval failed: ${e instanceof Error ? e.message : e}`);
          }
        }

        if (options.json) {
          console.log(JSON.stringify(results, null, 2));
        } else if (options.dryRun) {
          theme.info('Dry run — no capabilities written.');
        } else {
          theme.success(`Wrote verified capabilities for ${results.length} model(s).`);
        }
      },
    );
}
