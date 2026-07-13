/**
 * PHASE5 §12.7 — Healer repair-in-worktree parity (M5).
 *
 * A real worktreeRepair closure (built like summon) backed by a temp git repo +
 * WorktreeManager + blacksmith applyDiff:
 *  - a patch that passes verify → merged; integration advances.
 *  - a patch that fails verify → discarded; integration HEAD unchanged (INV-1).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { TaskRepository, type TaskGraphNode } from '@kingdomos/core';
import { ActionExecutor, IncidentReporter, type WorktreeRepairResult } from '@kingdomos/healer';
import { WorktreeManager, applyDiff } from '@kingdomos/blacksmith';
import { createTempGitRepo, type TempGitRepo } from '../helpers/temp-git-repo.js';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');

function createDb(repoDir: string): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => /^\d+.*\.sql$/.test(x)).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf-8'));
  }
  const now = new Date().toISOString();
  db.prepare('INSERT INTO projects (id, name, repository_path, created_at, updated_at) VALUES (?,?,?,?,?)').run('proj', 'P', repoDir, now, now);
  db.prepare('INSERT INTO objectives (id, project_id, description, priority, status, acceptance_criteria, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)').run('obj', 'proj', 'Heal', 5, 'active', '[]', now, now);
  return db;
}

function awaitingHealerTask(taskRepo: TaskRepository): TaskGraphNode {
  const task = taskRepo.create({
    objective_id: 'obj', level: 'task', title: 'Fix it', description: 'broken',
    type: 'code', assigned_tier: 'knight', reviewer_tier: 'judge', acceptance_criteria: ['works'], context_refs: [],
  });
  taskRepo.updateStatus(task.id, 'preparing-context');
  taskRepo.updateStatus(task.id, 'awaiting-budget-check');
  taskRepo.updateStatus(task.id, 'running');
  taskRepo.updateStatus(task.id, 'failed-review');
  taskRepo.updateStatus(task.id, 'awaiting-healer');
  return taskRepo.getById(task.id)!;
}

// A diff that turns app.ts's `export const x = 1;` into `export const x = 2;`.
const REPAIR_DIFF = '--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-export const x = 1;\n+export const x = 2;\n';

/** Build a worktreeRepair closure exactly like summon does. */
function makeWorktreeRepair(mgr: WorktreeManager, validationCommand: string) {
  return (diff: string, repairId: string): WorktreeRepairResult => {
    const session = mgr.openSession(repairId, { linkNodeModules: false });
    try {
      const apply = applyDiff(diff, session.path);
      if (!apply.success || apply.appliedFiles.length === 0) {
        return { applied: false, verified: false, merged: false, output: apply.errors.join('; '), appliedFiles: [] };
      }
      const r = session.run(validationCommand, { timeoutMs: 30_000 });
      if (r.code !== 0) {
        return { applied: true, verified: false, merged: false, output: [r.stdout, r.stderr].join('\n'), appliedFiles: apply.appliedFiles };
      }
      if (!session.commit(`healer repair ${repairId}`)) {
        return { applied: true, verified: true, merged: false, output: 'nothing to commit', appliedFiles: apply.appliedFiles };
      }
      const merge = session.mergeBack();
      return { applied: true, verified: true, merged: merge.success, output: merge.feedback.join('\n'), appliedFiles: apply.appliedFiles };
    } finally {
      session.discard();
    }
  };
}

describe('PHASE5 — healer repair-in-worktree (§12.7)', () => {
  let db: Database.Database;
  let repo: TempGitRepo;
  let mgr: WorktreeManager;
  let taskRepo: TaskRepository;
  let reporter: IncidentReporter;

  beforeEach(() => {
    repo = createTempGitRepo({ seedFile: { path: 'app.ts', content: 'export const x = 1;\n' } });
    db = createDb(repo.dir);
    mgr = new WorktreeManager(repo.dir, { authorName: 'T', authorEmail: 't@t' });
    taskRepo = new TaskRepository(db);
    reporter = new IncidentReporter(db);
  });
  afterEach(() => { db.close(); repo.cleanup(); });

  it('repair that passes verify → merged; integration advances; task completed-with-warnings', () => {
    const task = awaitingHealerTask(taskRepo);
    const incidentId = reporter.createIncident({ task_id: task.id, severity: 'high', failure_type: 'review-rejection', symptoms: {}, context_summary: 'x', failure_history: [] }).id;
    const H0 = mgr.integrationHead();

    const executor = new ActionExecutor(db, { worktreeRepair: makeWorktreeRepair(mgr, 'node -e "process.exit(0)"') });
    executor.execute(incidentId, task.id, { action: 'repair', diff: REPAIR_DIFF, rationale: 'fix x' });

    expect(mgr.integrationHead()).not.toBe(H0); // landed
    expect(readFileSync(join(repo.dir, 'app.ts'), 'utf-8')).toContain('export const x = 2;');
    expect(taskRepo.getById(task.id)?.status).toBe('completed-with-warnings');
    expect(existsSync(join(repo.dir, 'app.ts.bak'))).toBe(false); // no .bak on integration
    const incident = db.prepare('SELECT action_taken FROM incidents WHERE id = ?').get(incidentId) as { action_taken: string };
    expect(incident.action_taken).toMatch(/VERIFIED green/);
  });

  it('repair that fails verify → discarded; integration HEAD unchanged; task needs-human (INV-1)', () => {
    const task = awaitingHealerTask(taskRepo);
    const incidentId = reporter.createIncident({ task_id: task.id, severity: 'high', failure_type: 'review-rejection', symptoms: {}, context_summary: 'x', failure_history: [] }).id;
    const H0 = mgr.integrationHead();

    const executor = new ActionExecutor(db, { worktreeRepair: makeWorktreeRepair(mgr, 'node -e "process.exit(1)"') });
    executor.execute(incidentId, task.id, { action: 'repair', diff: REPAIR_DIFF, rationale: 'fix x' });

    expect(mgr.integrationHead()).toBe(H0); // INV-1: integration untouched
    expect(readFileSync(join(repo.dir, 'app.ts'), 'utf-8')).toContain('export const x = 1;'); // unchanged
    expect(taskRepo.getById(task.id)?.status).toBe('needs-human');
    const incident = db.prepare('SELECT action_taken FROM incidents WHERE id = ?').get(incidentId) as { action_taken: string };
    expect(incident.action_taken).toMatch(/verification FAILED/i);
  });
});
