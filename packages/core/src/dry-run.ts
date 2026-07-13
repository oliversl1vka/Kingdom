import type Database from 'better-sqlite3';

export interface DryRunResult {
  actions: Array<{ type: string; description: string; args: Record<string, unknown> }>;
  skipped: boolean;
}

export function withDryRun<T>(
  isDryRun: boolean,
  description: string,
  fn: () => T
): T | DryRunResult {
  if (isDryRun) {
    console.log(`[DRY-RUN] ${description}`);
    return {
      actions: [{ type: 'skipped', description, args: {} }],
      skipped: true,
    };
  }
  return fn();
}

export async function withDryRunAsync<T>(
  isDryRun: boolean,
  description: string,
  fn: () => Promise<T>
): Promise<T | DryRunResult> {
  if (isDryRun) {
    console.log(`[DRY-RUN] ${description}`);
    return {
      actions: [{ type: 'skipped', description, args: {} }],
      skipped: true,
    };
  }
  return fn();
}

/**
 * Wrap a DB transaction: in dry-run mode, begin/execute/rollback.
 * In normal mode, begin/execute/commit.
 */
export function withDryRunTransaction<T>(
  db: Database.Database,
  isDryRun: boolean,
  fn: () => T
): T | null {
  if (isDryRun) {
    db.exec('BEGIN');
    try {
      const result = fn();
      console.log('[DRY-RUN] Rolling back transaction');
      db.exec('ROLLBACK');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  return db.transaction(fn)();
}
