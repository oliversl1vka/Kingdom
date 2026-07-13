import { Command } from 'commander';
import { cpus } from 'node:os';
import { normalize, resolve } from 'node:path';
import type { ProviderAdapter, TierConfig } from '@kingdomos/core';
import { theme } from '../theme.js';

const SUMMON_AGENT_TIERS = ['king', 'nobility', 'judge', 'healer', 'knight', 'sentinel', 'scribe', 'blacksmith', 'squire'] as const;

type TierProviderConfig = Pick<TierConfig, 'provider'>;
export type SummonProviderMap = Record<string, ProviderAdapter | null | undefined>;

export interface SummonWorkspacePreflightOptions {
  cwd?: string;
  explicitConfigPath?: string;
  allowWorkspaceMismatch?: boolean;
}

export interface SummonWorkspacePreflightResult {
  ok: boolean;
  currentPath: string;
  workspacePath: string;
  warning?: string;
  error?: string;
}

export function validateSummonWorkspacePath(
  configuredWorkspacePath: string | undefined,
  options: SummonWorkspacePreflightOptions = {},
): SummonWorkspacePreflightResult {
  const currentPath = normalize(resolve(options.cwd ?? process.cwd()));
  const workspacePath = normalize(resolve(currentPath, configuredWorkspacePath ?? currentPath));

  if (samePath(currentPath, workspacePath)) {
    return { ok: true, currentPath, workspacePath };
  }

  const baseMessage = `Configured workspace_path "${workspacePath}" differs from current repo "${currentPath}".`;
  if (options.allowWorkspaceMismatch || options.explicitConfigPath?.trim()) {
    const reason = options.allowWorkspaceMismatch ? '--allow-workspace-mismatch' : '--config/KINGDOM_CONFIG_PATH';
    return {
      ok: true,
      currentPath,
      workspacePath,
      warning: `${baseMessage} Proceeding because ${reason} was provided.`,
    };
  }

  return {
    ok: false,
    currentPath,
    workspacePath,
    error: `${baseMessage} Re-run with --allow-workspace-mismatch after verifying the target, or pass an explicit --config path for intentional self-dogfood runs.`,
  };
}

export function resolveTierProvider(
  tier: string,
  tiers: Record<string, TierProviderConfig | undefined> | undefined,
  providerMap: SummonProviderMap,
  fallbackProvider: ProviderAdapter | null | undefined,
): ProviderAdapter | null {
  const providerName = tiers?.[tier]?.provider?.trim();
  if (!providerName) return fallbackProvider ?? null;

  if (!Object.prototype.hasOwnProperty.call(providerMap, providerName)) {
    throw new Error(`Tier "${tier}" explicitly requires unknown provider "${providerName}".`);
  }

  const provider = providerMap[providerName];
  if (!provider) {
    throw new Error(`Tier "${tier}" explicitly requires provider "${providerName}", but it is not configured or enabled.`);
  }

  return provider;
}

export async function validateExplicitTierProviders(
  tiers: Record<string, TierProviderConfig | undefined> | undefined,
  providerMap: SummonProviderMap,
  tierNames: readonly string[] = Object.keys(tiers ?? {}),
): Promise<void> {
  const errors: string[] = [];
  const requiredProviders = new Map<string, { provider: ProviderAdapter; tiers: string[] }>();

  for (const tier of tierNames) {
    const providerName = tiers?.[tier]?.provider?.trim();
    if (!providerName) continue;

    if (!Object.prototype.hasOwnProperty.call(providerMap, providerName)) {
      errors.push(`Tier "${tier}" explicitly requires unknown provider "${providerName}".`);
      continue;
    }

    const provider = providerMap[providerName];
    if (!provider) {
      errors.push(`Tier "${tier}" explicitly requires provider "${providerName}", but it is not configured or enabled.`);
      continue;
    }

    const entry = requiredProviders.get(providerName) ?? { provider, tiers: [] };
    entry.tiers.push(tier);
    requiredProviders.set(providerName, entry);
  }

  for (const [providerName, requirement] of requiredProviders) {
    try {
      const health = await requirement.provider.healthCheck();
      if (!['healthy', 'degraded'].includes(health.status)) {
        const details = health.error ?? health.last_error ?? 'no additional detail';
        errors.push(
          `Provider "${providerName}" required by tier(s) ${requirement.tiers.join(', ')} is ${health.status}: ${details}.`,
        );
      }
    } catch (err) {
      errors.push(
        `Provider "${providerName}" required by tier(s) ${requirement.tiers.join(', ')} failed health check: ${(err as Error).message}`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(`Explicit tier provider preflight failed:\n- ${errors.join('\n- ')}`);
  }
}

export function registerSummonCommand(program: Command): void {
  program
    .command('summon')
    .description('Start the agent orchestration system')
    .option('--workers <n>', 'Max concurrent workers', String(cpus().length))
    .option('--no-ui', 'Headless mode, terminal output only')
    .option('--verbose', 'Verbose logging to stdout')
    .option('--allow-workspace-mismatch', 'Proceed even when configured workspace_path differs from the current repo')
    .action(async (options: { workers: string; ui: boolean; verbose?: boolean; allowWorkspaceMismatch?: boolean }) => {
      const workerCount = parseInt(options.workers, 10);
      theme.banner();

      const { getDatabase, getConfig, JobDispatcher, OrchestrationLoop, reconcile, IntegrationGate } = await import('@kingdomos/core');
      const { createOpenAIAdapter, createLMStudioAdapter, createLlamaCppAdapter,
        // DEFERRAL2: embedding backends for relevance-ranked lesson injection.
        createOpenAIEmbeddingProvider, createLocalEmbeddingProvider } = await import('@kingdomos/providers');
      const { ScribeAgent } = await import('@kingdomos/scribe');
      const { applyDiff, applyEdit, WorktreeManager, isGitRepo } = await import('@kingdomos/blacksmith');
      const { IncidentReporter, HealerWorker } = await import('@kingdomos/healer');
      const { startSentinel, stopSentinel, getSentinelState } = await import('@kingdomos/sentinel');
      const { ModelRegistry, makeModelResolver, resolveModel } = await import('@kingdomos/token-engine');
      type TaskKind = import('@kingdomos/core').TaskKind;
      type TierClass = import('@kingdomos/core').TierClass;
      type ObjectiveTerminalStatus = import('@kingdomos/core').ObjectiveTerminalStatus;
      type ObjectiveCompletionSummary = import('@kingdomos/core').ObjectiveCompletionSummary;

      const db = getDatabase();
      const config = getConfig();
      const verbose = !!options.verbose;

      // ──────────────────────────────────────────────────────
      // Phase 1 (P1.4): Crash-recovery reconciler — run ONCE at startup BEFORE
      // dispatch. Rolls back jobs orphaned by a prior crash (dead worker PID /
      // expired lease), re-queues their tasks, and releases their leaked file
      // locks. Folds the CLAUDE.md SQL-recipe runbook into code.
      // PHASE5: also recover per-job isolated worktrees left by a crash (abort an
      // in-progress merge, drop the throwaway worktree, requeue the job, or finalize
      // a merge that landed before the crash). Only when agentic dispatch is on + git.
      const recoveryProjectPath = config.workspace_path ?? process.cwd();
      const recoveryAgenticCfg = (config as unknown as { agentic_dispatch?: import('@kingdomos/core').AgenticDispatchConfig }).agentic_dispatch;
      const recoveryWtMgr = (recoveryAgenticCfg?.enabled === true && process.env.KINGDOM_AGENTIC_DISPATCH !== '0' && isGitRepo(recoveryProjectPath))
        ? new WorktreeManager(recoveryProjectPath, { authorName: 'KingdomOS', authorEmail: 'kingdom@localhost', verbose })
        : null;
      const recovery = reconcile(db, {
        verbose,
        logger: (m) => theme.info(m),
        projectPath: recoveryWtMgr ? recoveryProjectPath : undefined,
        removeWorktree: recoveryWtMgr ? (p, b) => recoveryWtMgr.removeWorktree(p, b) : undefined,
      });
      if (recovery.orphanedJobs > 0 || recovery.releasedLocks > 0 || recovery.worktreesDiscarded > 0 || recovery.worktreesFinalized > 0) {
        theme.warning(
          `🩹 Crash recovery: rolled back ${recovery.orphanedJobs} orphaned job(s), ` +
          `re-queued ${recovery.rolledBackTasks} task(s), released ${recovery.releasedLocks} stale lock(s)` +
          (recovery.worktreesDiscarded > 0 || recovery.worktreesFinalized > 0
            ? `, discarded ${recovery.worktreesDiscarded} orphan worktree(s), finalized ${recovery.worktreesFinalized} merged worktree(s)`
            : '') + '.',
        );
      }

      const workspacePreflight = validateSummonWorkspacePath(config.workspace_path, {
        allowWorkspaceMismatch: options.allowWorkspaceMismatch,
        explicitConfigPath: process.env.KINGDOM_CONFIG_PATH,
      });
      if (!workspacePreflight.ok) {
        theme.error(workspacePreflight.error ?? 'Configured workspace path does not match the current repo.');
        process.exit(1);
      }
      if (workspacePreflight.warning) theme.warning(workspacePreflight.warning);

      // ──────────────────────────────────────────────────────
      // 1. Set up providers
      // ──────────────────────────────────────────────────────
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

      if (!openaiProvider && !lmstudioProvider && !llamacppProvider) {
        theme.error('No provider available. Configure OpenAI, llama.cpp, or LM Studio.');
        process.exit(1);
      }

      // Map provider names to adapters
      const providerMap: SummonProviderMap = {
        openai: openaiProvider,
        lmstudio: lmstudioProvider,
        llamacpp: llamacppProvider,
      };

      try {
        await validateExplicitTierProviders(config.tiers as Record<string, TierProviderConfig | undefined>, providerMap, SUMMON_AGENT_TIERS);
      } catch (err) {
        theme.error((err as Error).message);
        process.exit(1);
      }

      // Resolve provider for each tier based on config
      function getProviderForTier(tier: string) {
        return resolveTierProvider(
          tier,
          config.tiers as Record<string, TierProviderConfig | undefined>,
          providerMap,
          openaiProvider ?? llamacppProvider ?? lmstudioProvider,
        );
      }

      function getModelForTier(tier: string): string {
        return getModelResolverForTier(tier)();
      }

      // Capability-based fallback: when a tier isn't configured, describe what we
      // need (task kind + cost tier) and let the registry pick. This keeps the CLI
      // working even when operators haven't pinned a model for every tier.
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
        // Synthesize a tier config so resolveModel has something to work with.
        // Empty `model` forces the registry to rely on the profile.
        return {
          model: '',
          max_retries: 3,
          timeout_seconds: 30,
          profile: { task_kind: mapTaskKind(tier), cost_preference: mapTierClass(tier) },
        };
      }

      function getModelResolverForTier(tier: string): () => string {
        return makeModelResolver(getTierConfig(tier), modelRegistry, mapTaskKind(tier));
      }

      // Orchestration provider (King/Nobility) — always higher tier
      const orchestrationProvider = getProviderForTier('king');
      if (!orchestrationProvider) {
        theme.error('No provider for King tier.');
        process.exit(1);
      }

      if (verbose) {
        theme.info('─── Agent Configuration ───');
        for (const tier of SUMMON_AGENT_TIERS) {
          const p = getProviderForTier(tier);
          const m = getModelForTier(tier);
          theme.info(`  ${tier.padEnd(12)} → ${m} (${p?.provider_id ?? 'none'})`);
        }
        if (config.tech_stack) {
          theme.info('─── Technology Stack ───');
          theme.info(`  Language:     ${config.tech_stack.language}`);
          if (config.tech_stack.framework)      theme.info(`  Framework:    ${config.tech_stack.framework}`);
          if (config.tech_stack.build_tool)     theme.info(`  Build tool:   ${config.tech_stack.build_tool}`);
          if (config.tech_stack.test_framework) theme.info(`  Test framework: ${config.tech_stack.test_framework}`);
          if (config.tech_stack.package_manager) theme.info(`  Package mgr:  ${config.tech_stack.package_manager}`);
        }
      }

      // ──────────────────────────────────────────────────────
      // 2. Scribe — structured event logging, crypt archival, changelog
      // ──────────────────────────────────────────────────────
      const projectPath = config.workspace_path ?? process.cwd();

      // ──────────────────────────────────────────────────────
      // PHASE2 (P2.2): context engine seam — index lifecycle + ref grounding.
      // ──────────────────────────────────────────────────────
      const { ContextResolver, ContextIndexLifecycle } = await import('@kingdomos/core');
      const contextIndexLifecycle = new ContextIndexLifecycle({
        projectPath,
        orchestrationDbPath: 'kingdom/kingdom.db',
        verbose,
      });
      const contextResolver = new ContextResolver({ projectPath });
      // A context-engine-backed hydrator: validate/repair the decomposer's refs
      // against the symbol index before a job is created (drops hallucinated paths,
      // clamps ranges). Degrades to the original refs when the index is unhealthy.
      const contextHydrator = {
        async hydrateTaskContext(task: import('@kingdomos/core').TaskGraphNode) {
          const res = await contextResolver.validateRefs(task.context_refs);
          return res.indexHealthy ? res.validatedRefs : task.context_refs;
        },
      };

      // PHASE2 (P2.3): repo-grounded planner — read-only repo tools + capability lookup.
      const { readdirSync, readFileSync: readFileSyncFs, existsSync: existsSyncFs, statSync: statSyncFs } = await import('node:fs');
      const { join: joinPath, relative: relativePath } = await import('node:path');
      const repoReader: import('@kingdomos/core').RepoReader = {
        listFiles(dir?: string) {
          const base = dir ? joinPath(projectPath, dir) : projectPath;
          const out: string[] = [];
          const skip = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.turbo']);
          const walk = (d: string, depth: number) => {
            if (out.length >= 500 || depth > 6) return;
            let entries: string[]; try { entries = readdirSync(d); } catch { return; }
            for (const name of entries) {
              if (skip.has(name)) continue;
              const full = joinPath(d, name);
              let isDir = false; try { isDir = statSyncFs(full).isDirectory(); } catch { continue; }
              if (isDir) walk(full, depth + 1);
              else out.push(relativePath(projectPath, full).replace(/\\/g, '/'));
            }
          };
          if (existsSyncFs(base)) walk(base, 0);
          return out;
        },
        readFile(p: string) {
          const full = joinPath(projectPath, p);
          if (!existsSyncFs(full)) return null;
          try { return readFileSyncFs(full, 'utf-8'); } catch { return null; }
        },
        grep(pattern: string) {
          const out: string[] = [];
          let re: RegExp; try { re = new RegExp(pattern, 'i'); } catch { return out; }
          for (const file of this.listFiles()) {
            if (out.length >= 100) break;
            const content = this.readFile(file); if (!content) continue;
            content.split('\n').forEach((line, i) => {
              if (out.length < 100 && re.test(line)) out.push(`${file}:${i + 1}: ${line.trim().slice(0, 160)}`);
            });
          }
          return out;
        },
      };
      const plannerOptions: import('@kingdomos/core').PlannerOptions = {
        capabilities: (modelId: string) => modelRegistry.getModelCapabilities(modelId),
        repoReader,
        verbose,
      };

      const scribeAgent = new ScribeAgent({ db, projectPath, verbose });
      if (verbose) theme.info('📜 [scribe] ScribeAgent initialized — events, crypt entries, and changelogs active');
      const handledObjectiveTerminals = new Set<string>();

      const handleObjectiveTerminal = async (
        objectiveId: string,
        description: string,
        finalStatus: ObjectiveTerminalStatus,
        summary?: ObjectiveCompletionSummary,
      ) => {
        const terminalKey = `${objectiveId}:${finalStatus}`;
        if (handledObjectiveTerminals.has(terminalKey)) return;
        handledObjectiveTerminals.add(terminalKey);

        if (verbose) {
          theme.info(`📜 [scribe] Generating terminal summary for objective: ${description.slice(0, 60)}... (${finalStatus})`);
        }
        const stats = scribeAgent.collectStats(db, objectiveId);
        scribeAgent.generateRunSummary(description, stats);
        scribeAgent.recordObjectiveTerminal(objectiveId, description, finalStatus);
        theme.success(`📜 [scribe] Run summary and changelog written to ${projectPath}`);

        try {
          const { existsSync } = await import('node:fs');
          const { join } = await import('node:path');
          const { distill, mirrorLessonsToDisk, appendRunIndex } = await import('@kingdomos/scribe');

          const workspaceIsNonEmpty =
            existsSync(join(projectPath, 'package.json')) ||
            existsSync(join(projectPath, 'pyproject.toml')) ||
            existsSync(join(projectPath, 'Cargo.toml')) ||
            existsSync(join(projectPath, 'go.mod'));

          const kingdomDir = process.cwd();
          const result = distill(db, objectiveId, { workspaceIsNonEmpty, verbose });
          mirrorLessonsToDisk(db, kingdomDir);

          const tokRow = db
            .prepare(
              `SELECT COALESCE(SUM(tokens_used), 0) AS n
                 FROM jobs
                WHERE task_id IN (SELECT id FROM task_graph_nodes WHERE objective_id = ?)`,
            )
            .get(objectiveId) as { n: number };
          const incRow = db
            .prepare(
              `SELECT COUNT(*) AS n FROM incidents
                WHERE task_id IN (SELECT id FROM task_graph_nodes WHERE objective_id = ?)`,
            )
            .get(objectiveId) as { n: number };

          appendRunIndex(kingdomDir, {
            objective: `${description} [${finalStatus}]`,
            totalTasks: summary?.total ?? stats.totalTasks,
            healerIncidents: incRow.n,
            newLessonCount: result.lessonIds.length,
            firedRules: result.firedRules,
            totalTokens: tokRow.n,
          });

          if (verbose) {
            theme.info(
              `🧠 [memory] distilled ${result.lessonIds.length} lessons (rules: ${result.firedRules.join(',') || '-'})`,
            );
          }
        } catch (err) {
          if (verbose) theme.error(`[memory] terminal distill failed: ${(err as Error).message}`);
        }
      };

      // ──────────────────────────────────────────────────────
      // 3. Healer — incident reporting
      // ──────────────────────────────────────────────────────
      const incidentReporter = new IncidentReporter(db);

      // ──────────────────────────────────────────────────────
      // 4. Sentinel — heartbeat monitoring & lock cleanup
      // ──────────────────────────────────────────────────────
      const sentinelCfg = (config as any).sentinel as { stale_threshold_seconds?: number; stale_threshold_per_tier?: Record<string, number> } | undefined;
      const sentinelOptions = {
        staleThresholdSeconds: sentinelCfg?.stale_threshold_seconds ?? 90,
        staleThresholdPerTier: sentinelCfg?.stale_threshold_per_tier,
      };
      startSentinel(db, 5000, sentinelOptions, (incident) => {
        incidentReporter.createIncident({
          ...incident,
          severity: incident.severity as import('@kingdomos/core').Severity,
          failure_history: incident.failure_history as import('@kingdomos/core').FailureHistoryEntry[],
        });
      });
      if (verbose) {
        const thresholdMsg = sentinelCfg?.stale_threshold_per_tier
          ? `${sentinelOptions.staleThresholdSeconds}s default, per-tier overrides: ${JSON.stringify(sentinelCfg.stale_threshold_per_tier)}`
          : `${sentinelOptions.staleThresholdSeconds}s stale threshold`;
        theme.info(`🛡️  [sentinel] Heartbeat monitor active (5s poll, ${thresholdMsg})`);
      }

      // ──────────────────────────────────────────────────────
      // 5. Orchestration loop (King/Nobility decomposition)
      // ──────────────────────────────────────────────────────
      const orchestration = new OrchestrationLoop(db, orchestrationProvider, {
        pollIntervalMs: 5000,
        defaultModel: getModelForTier('king'),
        verbose,
        techStack: config.tech_stack,
        tierModelResolver: getModelForTier,
        // PHASE2 (P2.2): ground decomposer refs + keep the index fresh at run start.
        contextHydrator,
        contextIndexLifecycle,
        // PHASE2 (P2.3/P2.4): repo-grounded tool-using planner + structured emit.
        plannerOptions,
        onObjectiveTerminal: (objectiveId, description, finalStatus, summary) => {
          void handleObjectiveTerminal(objectiveId, description, finalStatus, summary);
        },
        onIncident: (incident) => {
          incidentReporter.createIncident(incident);
        },
      });
      orchestration.start();

      // ──────────────────────────────────────────────────────
      // DEFERRAL2: relevance-ranked lesson injection. Build an embedding backend
      // from the optional `embeddings` config block. When disabled/absent (the
      // safe default) the embedder is undefined and lesson injection falls back
      // to today's frequency ordering. KINGDOM_NO_LESSONS=1 disables injection
      // entirely (handled inside the injector).
      // ──────────────────────────────────────────────────────
      type EmbeddingsConfig = {
        enabled?: boolean;
        provider?: 'local' | 'openai';
        endpoint?: string;
        model?: string;
        api_key_name?: string;
      };
      const embeddingsCfg = (config as unknown as { embeddings?: EmbeddingsConfig }).embeddings;
      let embedder: import('@kingdomos/core').EmbeddingProvider | undefined;
      if (embeddingsCfg?.enabled) {
        try {
          if (embeddingsCfg.provider === 'openai') {
            if (!openaiKey) {
              theme.warning('🧠 embeddings.provider=openai but OPENAI_API_KEY is unset — lessons will use frequency ordering.');
            } else {
              embedder = createOpenAIEmbeddingProvider({ api_key: openaiKey, model: embeddingsCfg.model, endpoint: embeddingsCfg.endpoint });
            }
          } else {
            // Default + 'local' → OpenAI-compatible local embedding server.
            embedder = createLocalEmbeddingProvider({ endpoint: embeddingsCfg.endpoint, model: embeddingsCfg.model });
          }
          if (embedder && verbose) {
            theme.info(`🧠 Relevance lesson injection ON — embedder: ${embedder.model} (${embeddingsCfg.provider ?? 'local'})`);
          }
        } catch (err) {
          // Never fail summon over embeddings — degrade to frequency ordering.
          theme.warning(`🧠 Embedding provider init failed (${(err as Error).message}); lessons fall back to frequency ordering.`);
          embedder = undefined;
        }
      }
      // Resolve a model's safe input budget for the dynamic lesson cap. Unknown
      // models → undefined → base cap (getSafeInputBudget throws when unknown).
      const modelContextResolver = (modelId: string): number | undefined => {
        try {
          return modelRegistry.getSafeInputBudget(modelId);
        } catch {
          return undefined;
        }
      };

      // ──────────────────────────────────────────────────────
      // 6. Job Dispatcher — with ALL agents wired
      // ──────────────────────────────────────────────────────
      // PHASE5: agentic dispatch wiring. When agentic_dispatch.enabled and the
      // workspace is a git repo, construct an isolated-worktree manager + a merge
      // gate. Tool-capable models then run a read→edit→run→self-correct loop in a
      // throwaway worktree, merged back only after review + gates pass. Disabled /
      // non-git / non-tool-model jobs all fall back to the legacy one-shot path.
      const agenticDispatchCfg = (config as unknown as { agentic_dispatch?: import('@kingdomos/core').AgenticDispatchConfig }).agentic_dispatch;
      const agenticEnabled = agenticDispatchCfg?.enabled === true
        && process.env.KINGDOM_AGENTIC_DISPATCH !== '0'
        && isGitRepo(projectPath);
      const worktreeManager = agenticEnabled
        ? new WorktreeManager(projectPath, {
            worktreeRoot: agenticDispatchCfg?.worktree_root
              ? joinPath(projectPath, agenticDispatchCfg.worktree_root)
              : undefined,
            linkNodeModules: agenticDispatchCfg?.link_node_modules ?? true,
            authorName: 'KingdomOS',
            authorEmail: 'kingdom@localhost',
            verbose,
          })
        : undefined;
      const integrationGate = new IntegrationGate();
      if (verbose && worktreeManager) {
        theme.info('🌳 [agentic-dispatch] Enabled — tool-capable coding jobs run in isolated worktrees');
      }

      const dispatcher = new JobDispatcher(db, {
        maxConcurrentWorkers: workerCount,
        pollIntervalMs: 2000,
        assemblyOptions: {
          projectPath: config.workspace_path ?? process.cwd(),
          agentTemplatesDir: 'kingdom/agents',
          outputDir: 'kingdom/results',
          techStack: config.tech_stack,
          memory: (config as unknown as { memory?: import('@kingdomos/core').MemoryConfig }).memory,
          kingdomDir: process.cwd(),
          timeoutSecondsResolver: (tier: string) => config.tiers?.[tier]?.timeout_seconds ?? 120,
          // PHASE2 (P2.2): grounded packet assembly (ref repair + retrieval). The
          // dispatcher must call assembleForJobAsync to activate this — see
          // PHASE2-REPORT INTEGRATION NOTES for the deferred one-line swap.
          contextResolver,
          // DEFERRAL2: relevance-ranked lesson injection inputs. embedder absent
          // ⇒ frequency ordering; resolver feeds the dynamic byte cap.
          embedder,
          modelContextResolver,
        },
        defaultModel: getModelForTier('knight'),
        supervisorId: 'sentinel',
        verbose,
        validationCommand: (config as unknown as Record<string, unknown>).validation_command as string | undefined,
        behavioralProbes: (config as unknown as Record<string, unknown>).behavioral_probes as string[] | undefined,
        escalationPath: (config as unknown as Record<string, unknown>).escalation_path as Record<string, string> | undefined,
        // PHASE5: agentic dispatch injection (all no-ops when worktreeManager is undefined).
        agenticDispatch: agenticDispatchCfg,
        worktreeManager,
        applyEdit: (edit, workspace) => applyEdit(edit, workspace),
        capabilitiesResolver: (modelId: string) => modelRegistry.getModelCapabilities(modelId),
        integrationGate,
      });

      // Set tier-specific providers and models
      for (const tier of SUMMON_AGENT_TIERS) {
        const p = getProviderForTier(tier);
        if (p) dispatcher.setTierProvider(tier, p);
        dispatcher.setTierModel(tier, getModelForTier(tier));
        dispatcher.setTierTimeout(tier, config.tiers?.[tier]?.timeout_seconds ?? 120);
      }
      dispatcher.setProvider((openaiProvider ?? llamacppProvider ?? lmstudioProvider)!);

      // Wire Judge review engine
      const judgeProvider = getProviderForTier('judge');
      if (judgeProvider) {
        dispatcher.setJudgeProvider(judgeProvider, getModelForTier('judge'));
        if (verbose) theme.info('⚖️  [judge] Review engine active — code/test diffs will be reviewed');
      }

      // Wire Scribe logging + crypt + file tracking
      dispatcher.setScribe((event) => {
        scribeAgent.logEvent(event);
      });
      dispatcher.setScribeCrypt((taskId, title, success, details) => {
        scribeAgent.recordTaskCompletion(taskId, title, success, details);
      });
      dispatcher.setScribeFileChange((action, filePaths, taskTitle) => {
        scribeAgent.trackFileChange(action, filePaths, taskTitle);
      });

      // Wire Blacksmith diff application
      dispatcher.setBlacksmith((diffText, projectPath) => {
        const result = applyDiff(diffText, projectPath);
        // PHASE2 (P2.2): keep the context index fresh after a successful apply so
        // subsequent packet assembly grounds against the new code. Best-effort,
        // fire-and-forget — never blocks or fails the apply.
        if (result.success && result.appliedFiles.length > 0) {
          void contextIndexLifecycle.reindexAfterApply().catch(() => { /* best-effort */ });
        }
        return result;
      });
      if (verbose) theme.info('🔨 [blacksmith] Diff applicator active — approved diffs will be applied to project files');

      // Wire Healer incident reporting
      dispatcher.setHealer((incident) => {
        incidentReporter.createIncident({
          task_id: incident.task_id,
          job_id: incident.job_id,
          severity: incident.severity as any,
          failure_type: incident.failure_type,
          symptoms: incident.symptoms,
          context_summary: incident.context_summary,
          failure_history: [],
        });
      });
      if (verbose) theme.info('🏥 [healer] Incident reporter active — failures will be diagnosed');

      // ──────────────────────────────────────────────────────
      // 3b. Healer Worker — autonomous incident diagnosis loop
      // ──────────────────────────────────────────────────────
      // PHASE3 (P3.3): activate the execution-grounded agentic healer + the
      // verify-before-resolve `repair` action. Both are capability/availability
      // gated:
      //   • The Diagnostician only enters the agentic tool loop when the resolved
      //     healer model reports `tool_use` (capabilitiesResolver). Non-tool models
      //     keep the one-shot classifier path — unchanged.
      //   • The `repair` action only applies/verifies a diff when applyDiff +
      //     verify + workspacePath are all wired; otherwise ActionExecutor escalates.
      const healerProvider = getProviderForTier('healer');
      const validationCommand = (config as unknown as Record<string, unknown>).validation_command as string | undefined;
      const behavioralProbes = (config as unknown as Record<string, unknown>).behavioral_probes as string[] | undefined;
      // Mirror the dispatcher's post-apply gate: run the global validation command
      // (build) followed by each behavioural probe in the workspace. Green only when
      // every step exits zero. Captures combined stdout/stderr for the incident note.
      const { execSync: execSyncFn } = await import('node:child_process');
      const repairVerifier = (): { passed: boolean; output: string } => {
        const steps = [validationCommand, ...(behavioralProbes ?? [])].filter(Boolean) as string[];
        if (steps.length === 0) return { passed: true, output: '(no validation/probe configured)' };
        for (const step of steps) {
          try {
            execSyncFn(step, { cwd: projectPath, timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] });
          } catch (err) {
            const e = err as { stdout?: Buffer; stderr?: Buffer; message?: string };
            const out = [`$ ${step}`, e.stdout?.toString('utf-8') ?? '', e.stderr?.toString('utf-8') ?? '']
              .join('\n').trim().slice(0, 800) || (e.message ?? 'verification failed');
            return { passed: false, output: out };
          }
        }
        return { passed: true, output: '(all validation/probe steps passed)' };
      };
      // Restore `.bak` snapshots blacksmith writes; delete net-new files. Mirrors
      // the dispatcher's rollbackAppliedFiles so a failed healer repair leaves no
      // half-applied change behind.
      const { writeFileSync: writeFileSyncFn, unlinkSync: unlinkSyncFn } = await import('node:fs');
      const repairRollback = (appliedFiles: string[]): void => {
        for (const file of appliedFiles) {
          const full = joinPath(projectPath, file);
          const bak = `${full}.bak`;
          try {
            if (existsSyncFs(bak)) writeFileSyncFn(full, readFileSyncFs(bak, 'utf-8'), 'utf-8');
            else if (existsSyncFs(full)) unlinkSyncFn(full);
          } catch { /* best-effort */ }
        }
      };
      // PHASE5 (§5.8): isolated-worktree healer repair. When agentic dispatch is on
      // and the workspace is a git repo, apply+verify+merge the healer's patch in a
      // throwaway worktree — same INV-1 relocation as agentic dispatch. Falls back
      // to the in-place applyDiff+.bak path when worktreeManager is undefined.
      const worktreeRepair = worktreeManager
        ? (diff: string, repairId: string) => {
            const session = worktreeManager.openSession(repairId, { linkNodeModules: agenticDispatchCfg?.link_node_modules ?? true });
            try {
              const apply = applyDiff(diff, session.path);
              if (!apply.success || apply.appliedFiles.length === 0) {
                return { applied: false, verified: false, merged: false, output: apply.errors.slice(0, 3).join('; '), appliedFiles: [] as string[] };
              }
              const steps = [validationCommand, ...(behavioralProbes ?? [])].filter(Boolean) as string[];
              for (const step of steps) {
                const r = session.run(step, { timeoutMs: 30_000 });
                if (r.code !== 0) {
                  return { applied: true, verified: false, merged: false, output: [`$ ${step}`, r.stdout, r.stderr].join('\n').trim().slice(0, 800), appliedFiles: apply.appliedFiles };
                }
              }
              if (!session.commit(`healer repair ${repairId}`)) {
                return { applied: true, verified: true, merged: false, output: 'nothing to commit', appliedFiles: apply.appliedFiles };
              }
              const merge = session.mergeBack();
              return { applied: true, verified: true, merged: merge.success, output: merge.success ? '' : merge.feedback.join('\n').slice(0, 800), appliedFiles: apply.appliedFiles };
            } finally {
              session.discard();
            }
          }
        : undefined;

      const healerWorker = healerProvider
        ? new HealerWorker(db, healerProvider, {
            model: getModelResolverForTier('healer'),
            verbose,
            // Gate: only tool-capable healer models run the agentic loop.
            capabilitiesResolver: (modelId: string) => modelRegistry.getModelCapabilities(modelId),
            agenticContext: {
              workspacePath: projectPath,
              validationCommand,
            },
            repair: {
              workspacePath: projectPath,
              applyDiff: (diffText: string, path: string) => applyDiff(diffText, path),
              verify: repairVerifier,
              rollback: repairRollback,
              // PHASE5: takes precedence on git workspaces; in-place hooks above are the fallback.
              worktreeRepair,
              verbose,
            },
          })
        : null;
      healerWorker?.start();
      if (verbose && healerWorker) theme.info('🏥 [healer] Diagnostic worker active — undiagnosed incidents will be auto-resolved');

      dispatcher.start();

      theme.success(`Kingdom awakened. All 9 agents standing ready. ${workerCount} workers deployed.`);
      if (verbose) {
        theme.info('─── Active Agents ───');
        theme.info('  👑 King        — Objective decomposition');
        theme.info('  🏰 Nobility    — Task decomposition');
        theme.info('  🗡️  Knight      — Code execution');
        theme.info('  🐿️  Squire      — Micro-task execution');
        theme.info('  ⚖️  Judge       — Code review (scope/format/security/criteria)');
        theme.info('  🔨 Blacksmith  — Diff application to project files');
        theme.info('  📜 Scribe      — Event logging, crypt archival, changelog & run summaries');
        theme.info('  🛡️  Sentinel    — Heartbeat monitoring & lock cleanup');
        theme.info('  🏥 Healer      — Incident reporting & recovery');
      }

      // ──────────────────────────────────────────────────────
      // 7. Telegram Commander — optional remote control
      // ──────────────────────────────────────────────────────
      // Declare shutdown early so Telegram callbacks can reference it.
      // The actual implementation is assigned below after all agents are set up.
      let shutdown: () => void;

      const telegramCfg = (config as any).telegram as { bot_token?: string; allowed_chat_ids?: number[] } | undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let telegramCommander: any = null;

      if (telegramCfg?.bot_token) {
        // Dynamic import — telegram-commander is an optional dependency.
        // If the package is not installed, Telegram integration is silently skipped.
        let TelegramCommander: any;
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ({ TelegramCommander } = await import('@kingdomos/telegram-commander' as any));
        } catch {
          theme.error('Telegram config found but @kingdomos/telegram-commander is not installed. Run: pnpm install');
          // Continue without Telegram
        }

        if (TelegramCommander) {

        let paused = false;

        telegramCommander = new TelegramCommander(
          {
            bot_token: telegramCfg.bot_token,
            allowed_chat_ids: telegramCfg.allowed_chat_ids,
            verbose,
          },
          {
            onRun: async (objective: string) => {
              const { ObjectiveRepository } = await import('@kingdomos/core');
              const objRepo = new ObjectiveRepository(db);
              const obj = objRepo.create({
                project_id: 'default',
                description: objective,
                priority: 5,
                acceptance_criteria: [],
              });
              return `👑 Objective created: \`${obj.id}\`\nThe Kingdom is processing your decree.`;
            },
            onStatus: async () => {
              const running = db.prepare(`SELECT COUNT(*) as n FROM jobs WHERE status = 'running'`).get() as { n: number };
              const queued  = db.prepare(`SELECT COUNT(*) as n FROM jobs WHERE status = 'queued'`).get() as { n: number };
              const completed = db.prepare(`SELECT COUNT(*) as n FROM jobs WHERE status = 'completed'`).get() as { n: number };
              const stuck = db.prepare(`SELECT COUNT(*) as n FROM task_graph_nodes WHERE status = 'awaiting-healer'`).get() as { n: number };
              return `*Kingdom Status*\n🟢 Running: ${running.n}  🟡 Queued: ${queued.n}  ✅ Completed: ${completed.n}  🚫 Stuck: ${stuck.n}\nDispatch: ${paused ? 'PAUSED' : 'active'}`;
            },
            onPause: async () => {
              paused = true;
              dispatcher.stop();
              return '⏸️ Job dispatch paused. Use /resume to continue.';
            },
            onResume: async () => {
              paused = false;
              dispatcher.start();
              return '▶️ Job dispatch resumed.';
            },
            onStop: async () => {
              shutdown();
              return '🛑 Kingdom is shutting down.';
            },
            onReport: async () => {
              const stats = db.prepare(`
                SELECT
                  (SELECT COUNT(*) FROM objectives WHERE status = 'completed') as obj_done,
                  (SELECT COUNT(*) FROM objectives WHERE status = 'completed-with-warnings') as obj_warn,
                  (SELECT COUNT(*) FROM objectives WHERE status = 'active') as obj_active,
                  (SELECT COUNT(*) FROM jobs WHERE status = 'completed') as jobs_done,
                  (SELECT COUNT(*) FROM jobs WHERE status LIKE 'failed-%') as jobs_failed,
                  (SELECT COALESCE(SUM(tokens_used),0) FROM jobs) as total_tokens
              `).get() as Record<string, number>;
              return `*KingdomOS Report*\nObjectives: ${stats.obj_done} done, ${stats.obj_warn} partial, ${stats.obj_active} active\nJobs: ${stats.jobs_done} completed, ${stats.jobs_failed} failed\nTokens: ${stats.total_tokens.toLocaleString()}`;
            },
          }
        );

        // Wire milestone callback for push notifications
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const milestoneHandler = (event: any) => {
          telegramCommander?.notifyMilestone(event).catch(() => {});
        };
        dispatcher.setMilestoneCallback(milestoneHandler);
        (orchestration as any)['config'].onMilestone = milestoneHandler;

        telegramCommander.start();
        if (verbose) theme.info('📱 [telegram] Telegram Commander active — remote control enabled');
        } // end else (TelegramCommander loaded)
      } // end if (telegramCfg?.bot_token)

      // Handle graceful shutdown
      shutdown = () => {
        theme.info('Farewell signal received. Dismissing agents...');
        orchestration.stop();
        dispatcher.stop();
        healerWorker?.stop();
        telegramCommander?.stop();
        stopSentinel(db);
        if (verbose) {
          const sentinelState = getSentinelState(db);
          theme.info(`[sentinel] Final state: ${sentinelState.polls} polls, ${sentinelState.staleDetected} stale detected, ${sentinelState.locksReleased} locks released`);
        }
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    });
}

function samePath(left: string, right: string): boolean {
  const normalizeForCompare = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
  return normalizeForCompare(left) === normalizeForCompare(right);
}
