// PHASE2 (P2.2): run-time context index lifecycle.
//
// Keeps the context index fresh across an orchestration run. Performs a full
// (incremental) index at run start, then incremental re-indexes after each
// successful apply. All operations are best-effort: a failure degrades the run to
// the raw-slice path rather than aborting it.

import { loadContextEngine, type ContextEngine } from './context-client.js';

export interface ContextIndexLifecycleOptions {
  /** Workspace root to index. */
  projectPath: string;
  /** Path to the orchestration DB (kingdom.db) — its directory hosts context.db. */
  orchestrationDbPath?: string;
  /** Explicit context index DB path. Defaults alongside kingdom.db. */
  contextDbPath?: string;
  verbose?: boolean;
  /** Engine override (tests). */
  engine?: ContextEngine | null;
}

export class ContextIndexLifecycle {
  private started = false;

  constructor(private opts: ContextIndexLifecycleOptions) {}

  private async engine(): Promise<ContextEngine | null> {
    if (this.opts.engine !== undefined) return this.opts.engine;
    return loadContextEngine();
  }

  private dbPath(engine: ContextEngine): string {
    if (this.opts.contextDbPath) return this.opts.contextDbPath;
    if (this.opts.orchestrationDbPath) {
      // Resolve context.db alongside kingdom.db.
      const dir = this.opts.orchestrationDbPath.replace(/[/\\][^/\\]*$/, '');
      return engine.defaultContextDbPath(dir.replace(/[/\\]kingdom$/, '') || process.cwd());
    }
    return engine.defaultContextDbPath(process.cwd());
  }

  /** Full incremental index at run start. Returns true on success. */
  async indexAtStart(): Promise<boolean> {
    const engine = await this.engine();
    if (!engine) return false;
    try {
      const res = engine.indexContextProject({
        rootPath: this.opts.projectPath,
        dbPath: this.dbPath(engine),
        orchestrationDbPath: this.opts.orchestrationDbPath,
        incremental: true,
      });
      this.started = res.status !== 'failed';
      if (this.opts.verbose) {
        console.log(`[Context] indexed ${res.filesIndexed} file(s), skipped ${res.filesSkipped} (${res.status})`);
      }
      return this.started;
    } catch (err) {
      if (this.opts.verbose) console.error(`[Context] start index failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /**
   * Incremental re-index after a successful apply. Cheap: the indexer skips
   * unchanged files by sha/mtime, so only the touched files are reprocessed.
   */
  async reindexAfterApply(): Promise<boolean> {
    const engine = await this.engine();
    if (!engine) return false;
    try {
      const res = engine.indexContextProject({
        rootPath: this.opts.projectPath,
        dbPath: this.dbPath(engine),
        orchestrationDbPath: this.opts.orchestrationDbPath,
        incremental: true,
      });
      if (this.opts.verbose && res.filesIndexed > 0) {
        console.log(`[Context] re-indexed ${res.filesIndexed} changed file(s) after apply`);
      }
      return res.status !== 'failed';
    } catch (err) {
      if (this.opts.verbose) console.error(`[Context] reindex failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  hasIndexed(): boolean {
    return this.started;
  }
}
