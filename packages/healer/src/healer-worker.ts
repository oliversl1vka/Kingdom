import type { ModelResolver, ProviderAdapter, ModelCapabilities } from '@kingdomos/core';
import type Database from 'better-sqlite3';
import { Diagnostician } from './diagnostician.js';
import { ActionExecutor, type ActionExecutorOptions } from './action-executor.js';
import type { AgenticHealerContext } from './agentic-healer.js';
import { IncidentReporter } from './incident-reporter.js';

// At most this many incidents are diagnosed per poll cycle to prevent token
// explosion when many tasks fail simultaneously.
const MAX_INCIDENTS_PER_CYCLE = 3;

export interface HealerWorkerOptions {
  pollIntervalMs?: number;
  verbose?: boolean;
  /**
   * Model used for diagnosis. Accepts either a concrete model id or a
   * `ModelResolver` closure that consults a capability-based registry.
   * Defaults to the healer tier model.
   */
  model?: string | ModelResolver;
  /**
   * PHASE3 (P3.3): resolve a model's capabilities. When the healer model has
   * tool_use, the Diagnostician runs the execution-grounded agentic loop.
   */
  capabilitiesResolver?: (model: string) => ModelCapabilities | null;
  /** PHASE3 (P3.3): workspace + whitelisted commands for the agentic tool loop. */
  agenticContext?: AgenticHealerContext;
  /** PHASE3 (P3.3): hooks enabling the verify-before-resolve `repair` action. */
  repair?: ActionExecutorOptions;
}

/**
 * HealerWorker closes the loop that was previously missing: incidents get
 * created by the dispatcher, but nobody consumed them. This worker polls for
 * undiagnosed incidents, calls the Diagnostician LLM, and executes the
 * resulting recommendation via ActionExecutor.
 *
 * It is deliberately rate-limited per cycle (MAX_INCIDENTS_PER_CYCLE) to
 * avoid a burst of expensive LLM calls when many tasks fail at once.
 */
export class HealerWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private diagnostician: Diagnostician;
  private executor: ActionExecutor;
  private reporter: IncidentReporter;
  private model: string | ModelResolver;
  private verbose: boolean;

  constructor(
    private db: Database.Database,
    provider: ProviderAdapter,
    options: HealerWorkerOptions = {}
  ) {
    this.model = options.model ?? 'gpt-4.1-mini';
    this.verbose = options.verbose ?? false;
    // Diagnostician accepts string|resolver directly — pass through untouched.
    // PHASE3 (P3.3): forward the capabilities resolver + agentic context so the
    // diagnostician can run the execution-grounded loop on tool-capable models.
    this.diagnostician = new Diagnostician(db, provider, this.model, {
      capabilitiesResolver: options.capabilitiesResolver,
      agenticContext: options.agenticContext,
      verbose: this.verbose,
    });
    // PHASE3 (P3.3): forward repair hooks so the `repair` action can apply +
    // verify a healer-produced diff before resolving the incident.
    this.executor = new ActionExecutor(db, options.repair ?? {});
    this.reporter = new IncidentReporter(db);
  }

  start(): void {
    const interval = 15_000; // check every 15 seconds
    this.timer = setInterval(() => { this.tick(); }, interval);
    if (this.verbose) {
      console.log('[HealerWorker] Started — polling for undiagnosed incidents every 15s');
    }
  }

  /**
   * The model id the embedded Diagnostician will use on its next call.
   * Convenience passthrough so callers don't have to reach through `.diagnostician`.
   */
  getEffectiveModel(): string {
    return this.diagnostician.getEffectiveModel();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    if (this.running) return; // don't stack if a previous cycle is still async
    this.running = true;
    this.processIncidents()
      .catch(err => {
        if (this.verbose) console.error('[HealerWorker] Tick error:', (err as Error).message);
      })
      .finally(() => { this.running = false; });
  }

  private async processIncidents(): Promise<void> {
    const undiagnosed = this.reporter.getUndiagnosed().slice(0, MAX_INCIDENTS_PER_CYCLE);
    if (undiagnosed.length === 0) return;

    if (this.verbose) {
      console.log(`[HealerWorker] 🏥 Processing ${undiagnosed.length} undiagnosed incident(s)`);
    }

    for (const incident of undiagnosed) {
      // Guard: skip if the task is no longer in a healable state.
      // Another code path may have already resolved it.
      const taskRow = this.db
        .prepare('SELECT status FROM task_graph_nodes WHERE id = ?')
        .get(incident.task_id) as { status: string } | undefined;

      if (!taskRow || !['awaiting-healer', 'stalled', 'failed-runtime-crash', 'failed-invalid-output', 'failed-review'].includes(taskRow.status)) {
        this.reporter.resolve(incident.id, 'Task already resolved by another path — skipped');
        continue;
      }

      try {
        if (this.verbose) {
          console.log(`[HealerWorker] 🔬 Diagnosing incident ${incident.id} (task: ${incident.task_id.slice(-8)}, type: ${incident.failure_type})`);
        }

        const diagnosis = await this.diagnostician.diagnose(incident);

        if (this.verbose) {
          console.log(`[HealerWorker] 💊 Diagnosis: ${diagnosis.probable_cause} (confidence: ${(diagnosis.confidence * 100).toFixed(0)}%) → action: ${diagnosis.recommendation.action}`);
        }

        this.executor.execute(incident.id, incident.task_id, diagnosis.recommendation);

      } catch (err) {
        // Non-fatal — the incident stays undiagnosed and will be retried next cycle.
        if (this.verbose) {
          console.error(`[HealerWorker] ⚠️ Failed to diagnose incident ${incident.id}: ${(err as Error).message}`);
        }
      }
    }
  }
}
