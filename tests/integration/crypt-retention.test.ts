import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CryptWriter, RetentionScheduler } from '../../packages/scribe/src/index.js';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'packages', 'core', 'migrations');

function createDb(): Database.Database {
  const db = new Database(':memory:');
  // Load base schema (crypt_entries, heartbeats in 001) + event_log in 004
  db.exec(readFileSync(join(MIGRATIONS_DIR, '001_initial.sql'), 'utf-8'));
  db.exec(readFileSync(join(MIGRATIONS_DIR, '004_event_log.sql'), 'utf-8'));

  // Seed FK chain: projects → objectives → task_graph_nodes → jobs → heartbeats
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO projects (id, name, repository_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run('proj-1', 'Test', '/tmp/test', now, now);
  db.prepare(
    `INSERT INTO objectives (id, project_id, description, priority, status, acceptance_criteria, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('obj-1', 'proj-1', 'Test objective', 5, 'active', '[]', now, now);
  return db;
}


describe('Crypt Retention Tests', () => {
  describe('CryptWriter', () => {
    let db: Database.Database;
    let writer: CryptWriter;

    beforeEach(() => {
      db = createDb();
      writer = new CryptWriter(db);
    });

    it('should create CryptEntry on task completion', () => {
      const taskId = 'task-1';
      const id = writer.writeFromTask(
        taskId,
        'Test Task',
        'Task completed successfully',
        true,
      );

      expect(id).toBeGreaterThan(0);

      const entry = writer.getByTaskId(taskId);
      expect(entry).not.toBeNull();
      expect(entry!.task_id).toBe(taskId);
      expect(entry!.title).toBe('Test Task');
      expect(entry!.summary).toBe('Task completed successfully');
      expect(entry!.success).toBe(1);
      expect(entry!.completed_at).toBeTruthy();
    });

    it('should record failed tasks with success=false', () => {
      const taskId = 'task-failed';
      writer.writeFromTask(taskId, 'Failed Task', 'Task failed with error', false);

      const entry = writer.getByTaskId(taskId);
      expect(entry).not.toBeNull();
      expect(entry!.success).toBe(0);
    });

    it('should return null for non-existent task', () => {
      expect(writer.getByTaskId('nonexistent')).toBeNull();
    });

    it('should return all entries ordered by completed_at DESC', () => {
      writer.writeFromTask('task-a', 'Task A', 'Summary A', true);
      writer.writeFromTask('task-b', 'Task B', 'Summary B', true);
      writer.writeFromTask('task-c', 'Task C', 'Summary C', false);

      const all = writer.getAll();
      expect(all.length).toBe(3);
      // Most recent first
      expect(all[0].title).toBe('Task C');
      expect(all[1].title).toBe('Task B');
      expect(all[2].title).toBe('Task A');
    });

    it('should respect the limit parameter in getAll', () => {
      for (let i = 0; i < 5; i++) {
        writer.writeFromTask(`task-${i}`, `Task ${i}`, `Summary ${i}`, true);
      }

      const limited = writer.getAll(2);
      expect(limited.length).toBe(2);
    });
  });

  describe('RetentionScheduler', () => {
    let db: Database.Database;
    let writer: CryptWriter;
    let scheduler: RetentionScheduler;

    beforeEach(() => {
      db = createDb();
      writer = new CryptWriter(db);
      scheduler = new RetentionScheduler(db, { retentionDays: 1 });
    });

    function insertEventLogOlderThan(daysOld: number, taskId: string | null): void {
      const pastDate = new Date(
        Date.now() - daysOld * 24 * 60 * 60 * 1000 - 3600000,
      ).toISOString();
      db.prepare(
        `INSERT INTO event_log (timestamp, agent_id, event_type, job_id, task_id, details)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(pastDate, 'test-agent', 'task_transition', 'job-1', taskId, '{}');
    }

    function insertHeartbeatOlderThan(daysOld: number): void {
      const pastDate = new Date(
        Date.now() - daysOld * 24 * 60 * 60 * 1000 - 3600000,
      ).toISOString();
      const now = new Date().toISOString();
      // Ensure FK prerequisites exist (idempotent)
      const existingTask = db.prepare('SELECT id FROM task_graph_nodes WHERE id = ?').get('task-hb');
      if (!existingTask) {
        db.prepare(
          `INSERT INTO task_graph_nodes (id, objective_id, level, title, type, assigned_tier, reviewer_tier, acceptance_criteria, context_refs, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run('task-hb', 'obj-1', 'subtask', 'HB Task', 'code', 'knight', 'nobility', '[]', '[]', now, now);
      }
      const existingJob = db.prepare('SELECT id FROM jobs WHERE id = ?').get('job-hb');
      if (!existingJob) {
        db.prepare(
          `INSERT INTO jobs (id, task_id, model, status, token_estimate, delegating_supervisor_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run('job-hb', 'task-hb', 'test', 'completed', 100, 'sup', now);
      }
      db.prepare(
        `INSERT INTO heartbeats (job_id, worker_id, timestamp, status, tokens_generated)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('job-hb', 'worker-1', pastDate, 'healthy', 10);
    }

    it('should purge detailed logs older than retention period', () => {
      // Insert an old log entry for a task that has a crypt entry
      const taskId = 'task-to-archive';
      writer.writeFromTask(taskId, 'Archived Task', 'Done', true);
      insertEventLogOlderThan(3, taskId);

      // Verify it exists before purge
      const before = db.prepare('SELECT COUNT(*) as n FROM event_log').get() as { n: number };
      expect(before.n).toBeGreaterThanOrEqual(1);

      const result = scheduler.purge();

      expect(result.logsDeleted).toBeGreaterThanOrEqual(1);
      const after = db.prepare('SELECT COUNT(*) as n FROM event_log').get() as { n: number };
      expect(after.n).toBe(0);
    });

    it('should only purge logs where CryptEntry exists', () => {
      // Insert an old log entry for a task WITHOUT a crypt entry
      insertEventLogOlderThan(3, 'task-no-crypt');

      const result = scheduler.purge();

      // This log should NOT be purged because there is no crypt entry
      expect(result.logsDeleted).toBe(0);
      const after = db.prepare('SELECT COUNT(*) as n FROM event_log').get() as { n: number };
      expect(after.n).toBe(1);
    });

    it('should never delete CryptEntry on cleanup', () => {
      writer.writeFromTask('task-permanent', 'Permanent Record', 'Completed', true);

      // Insert an old event log for this task
      insertEventLogOlderThan(3, 'task-permanent');

      scheduler.purge();

      // Crypt entry must still exist
      const entry = writer.getByTaskId('task-permanent');
      expect(entry).not.toBeNull();
      expect(entry!.title).toBe('Permanent Record');
    });

    it('should purge old heartbeat records', () => {
      insertHeartbeatOlderThan(5);

      // Verify heartbeats exist before purge
      const before = db.prepare('SELECT COUNT(*) as n FROM heartbeats').get() as { n: number };
      expect(before.n).toBeGreaterThanOrEqual(1);

      const result = scheduler.purge();

      expect(result.heartbeatsDeleted).toBeGreaterThanOrEqual(1);
      const after = db.prepare('SELECT COUNT(*) as n FROM heartbeats').get() as { n: number };
      expect(after.n).toBe(0);
    });

    it('should not purge recent logs within retention period', () => {
      const taskId = 'recent-task';
      writer.writeFromTask(taskId, 'Recent Task', 'Just completed', true);

      // Insert a log entry from right now
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO event_log (timestamp, agent_id, event_type, job_id, task_id, details)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(now, 'test-agent', 'task_transition', 'job-2', taskId, '{}');

      const result = scheduler.purge();

      expect(result.logsDeleted).toBe(0);
    });

    it('should purge logs with null task_id that have no associated crypt entry', () => {
      insertEventLogOlderThan(3, null);

      const result = scheduler.purge();

      // Logs with null task_id are purged regardless
      expect(result.logsDeleted).toBe(1);
    });
  });
});
