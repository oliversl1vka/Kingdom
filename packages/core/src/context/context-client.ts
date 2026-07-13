// PHASE2 (P2.2): thin context-engine seam for core.
//
// Core must not statically depend on @kingdomos/context-engine (it would create a
// build/project-reference relationship and make core tests require the engine).
// Instead this module declares the *structural* slice of the engine API it needs and
// lazy-imports the real package at runtime. Tests inject a fake `ContextEngine` so the
// packet assembler / orchestration loop can be exercised hermetically.

import type { ContextRef } from '../types.js';

/** Subset of `ContextSearchResult` we consume. */
export interface ContextSearchHit {
  file: string;
  startLine: number;
  endLine: number;
  title: string;
  snippet?: string;
  score: number;
  chunkKind: string;
}

export interface ContextSearchOutcome {
  projectId: string;
  results: ContextSearchHit[];
  warnings: string[];
}

export interface ContextStatusOutcome {
  indexed: boolean;
  staleFileCount: number;
  newFileCount: number;
  missingFileCount: number;
  warnings: string[];
}

export interface ContextIndexOutcome {
  status: 'completed' | 'completed-with-warnings' | 'failed';
  filesIndexed: number;
  filesSkipped: number;
  errors: string[];
}

/** Structural interface satisfied by `@kingdomos/context-engine` (or a test fake). */
export interface ContextEngine {
  searchContext(req: {
    rootPath?: string;
    dbPath?: string;
    query: string;
    intent?: string;
    limit?: number;
    path?: string;
    maxTokens?: number;
    includeNeighbors?: boolean;
  }): ContextSearchOutcome;
  getContextStatus(opts: { rootPath?: string; dbPath?: string }): ContextStatusOutcome;
  indexContextProject(opts: {
    rootPath?: string;
    dbPath?: string;
    orchestrationDbPath?: string;
    incremental?: boolean;
    fresh?: boolean;
  }): ContextIndexOutcome;
  defaultContextDbPath(basePath?: string): string;
}

let cached: ContextEngine | null = null;

/**
 * Resolve the real context engine, lazily. Returns null when the optional
 * dependency is not installed (keeps the run alive on the raw-slice path).
 */
export async function loadContextEngine(): Promise<ContextEngine | null> {
  if (cached) return cached;
  try {
    // Indirect specifier so TS treats this as a runtime-only optional dependency
    // (core has no static reference to @kingdomos/context-engine — avoids a build cycle).
    const specifier = '@kingdomos/context-engine';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import(/* @vite-ignore */ specifier);
    cached = {
      searchContext: (req) => mod.searchContext(req) as ContextSearchOutcome,
      getContextStatus: (opts) => mod.getContextStatus(opts) as ContextStatusOutcome,
      indexContextProject: (opts) => mod.indexContextProject(opts) as ContextIndexOutcome,
      defaultContextDbPath: (basePath?: string) => mod.defaultContextDbPath(basePath) as string,
    };
    return cached;
  } catch {
    return null;
  }
}

/** Test hook: inject a fake engine (or null to reset). */
export function __setContextEngineForTests(engine: ContextEngine | null): void {
  cached = engine;
}

export interface ContextResolverOptions {
  /** Workspace root the index was built against. */
  projectPath: string;
  /** Path to the context index DB. Defaults alongside kingdom.db. */
  dbPath?: string;
  /** Max retrieved chunks to append. */
  retrievalLimit?: number;
  /** Token ceiling for retrieved chunks. */
  retrievalMaxTokens?: number;
  /** Engine override (tests). When omitted, the real engine is lazy-loaded. */
  engine?: ContextEngine | null;
}

export interface RefValidationResult {
  /** Refs that survived validation/clamping against the symbol index. */
  validatedRefs: ContextRef[];
  /** Refs that were dropped because the file is not in the index. */
  droppedRefs: ContextRef[];
  /** Whether the index was fresh enough to trust (false ⇒ degrade to raw slices). */
  indexHealthy: boolean;
  warnings: string[];
}

export interface RetrievedContext {
  hits: ContextSearchHit[];
  warnings: string[];
}

/**
 * Validate/repair decomposer-emitted context_refs against the real symbol index and
 * retrieve high-ranked chunks for a task. Degrades gracefully: if the engine is
 * absent or the index is stale/missing, returns the original refs untouched with
 * `indexHealthy: false` so the caller keeps the legacy raw-slice path.
 */
export class ContextResolver {
  constructor(private opts: ContextResolverOptions) {}

  private async engine(): Promise<ContextEngine | null> {
    if (this.opts.engine !== undefined) return this.opts.engine;
    return loadContextEngine();
  }

  private dbPath(engine: ContextEngine): string {
    return this.opts.dbPath ?? engine.defaultContextDbPath(process.cwd());
  }

  /**
   * Returns true when the index exists and is not materially stale. A small amount
   * of staleness (a handful of changed files) still counts as healthy; a missing or
   * never-built index does not.
   */
  async isIndexHealthy(): Promise<{ healthy: boolean; warnings: string[] }> {
    const engine = await this.engine();
    if (!engine) return { healthy: false, warnings: ['context engine unavailable'] };
    try {
      const status = engine.getContextStatus({ rootPath: this.opts.projectPath, dbPath: this.dbPath(engine) });
      const healthy = status.indexed;
      return { healthy, warnings: status.warnings };
    } catch (err) {
      return { healthy: false, warnings: [`context status failed: ${err instanceof Error ? err.message : String(err)}`] };
    }
  }

  /**
   * Validate refs against the index. A ref's file must resolve to at least one
   * indexed chunk; otherwise it is dropped (hallucinated path). Line ranges are
   * clamped to the indexed file's bounds when available.
   */
  async validateRefs(refs: ContextRef[]): Promise<RefValidationResult> {
    const warnings: string[] = [];
    const engine = await this.engine();
    if (!engine) {
      return { validatedRefs: refs, droppedRefs: [], indexHealthy: false, warnings: ['context engine unavailable; refs left unvalidated'] };
    }

    const health = await this.isIndexHealthy();
    if (!health.healthy) {
      return { validatedRefs: refs, droppedRefs: [], indexHealthy: false, warnings: [...warnings, ...health.warnings, 'index unhealthy; refs left unvalidated'] };
    }

    const validated: ContextRef[] = [];
    const dropped: ContextRef[] = [];
    const dbPath = this.dbPath(engine);

    for (const ref of refs) {
      try {
        const hit = engine.searchContext({
          rootPath: this.opts.projectPath,
          dbPath,
          query: ref.file,
          path: ref.file,
          limit: 5,
          includeNeighbors: false,
        });
        const fileHits = hit.results.filter((r) => r.file === ref.file || r.file.endsWith('/' + ref.file) || ref.file.endsWith('/' + r.file));
        if (fileHits.length === 0) {
          dropped.push(ref);
          warnings.push(`dropped hallucinated context_ref: ${ref.file} (not in index)`);
          continue;
        }
        // Clamp line range to the widest indexed bound for the file.
        const maxLine = Math.max(...fileHits.map((r) => r.endLine));
        const clampedEnd = ref.endLine > 0 && maxLine > 0 ? Math.min(ref.endLine, maxLine) : ref.endLine;
        const clampedStart = ref.startLine > 0 && maxLine > 0 ? Math.min(ref.startLine, Math.max(1, maxLine)) : ref.startLine;
        validated.push({ file: ref.file, startLine: clampedStart, endLine: Math.max(clampedStart, clampedEnd) });
      } catch (err) {
        // On a query error, keep the ref untouched rather than dropping it.
        validated.push(ref);
        warnings.push(`ref validation query failed for ${ref.file}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { validatedRefs: validated, droppedRefs: dropped, indexHealthy: true, warnings };
  }

  /** Retrieve high-ranked chunks for a free-text task query. */
  async retrieve(query: string): Promise<RetrievedContext> {
    const engine = await this.engine();
    if (!engine) return { hits: [], warnings: ['context engine unavailable'] };
    const health = await this.isIndexHealthy();
    if (!health.healthy) return { hits: [], warnings: [...health.warnings, 'index unhealthy; skipping retrieval'] };
    try {
      const out = engine.searchContext({
        rootPath: this.opts.projectPath,
        dbPath: this.dbPath(engine),
        query,
        limit: this.opts.retrievalLimit ?? 5,
        maxTokens: this.opts.retrievalMaxTokens ?? 2000,
        includeNeighbors: false,
      });
      return { hits: out.results, warnings: out.warnings };
    } catch (err) {
      return { hits: [], warnings: [`retrieval failed: ${err instanceof Error ? err.message : String(err)}`] };
    }
  }
}
