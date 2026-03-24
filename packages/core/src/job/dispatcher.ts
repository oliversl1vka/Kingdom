import type Database from 'better-sqlite3';
import type { Job, TaskGraphNode, JobPacket } from '../types.js';
import { JobRepository } from '../repositories/job-repo.js';
import { TaskRepository } from '../repositories/task-repo.js';
import { JobPacketAssembler, type PacketAssemblyOptions } from '../job/packet-assembler.js';
import { spawnWorker, getWorkerCount } from '../worker/spawner.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateUlid } from '../ulid.js';

export interface DispatcherConfig {
  maxConcurrentWorkers: number;
  pollIntervalMs: number;
  assemblyOptions: PacketAssemblyOptions;
  defaultModel: string;
  supervisorId: string;
}

export class JobDispatcher {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private jobRepo: JobRepository;
  private taskRepo: TaskRepository;
  private assembler: JobPacketAssembler;

  constructor(private db: Database.Database, private config: DispatcherConfig) {
    this.jobRepo = new JobRepository(db);
    this.taskRepo = new TaskRepository(db);
    this.assembler = new JobPacketAssembler(db, this.taskRepo, config.assemblyOptions);
  }

  start(): void {
    this.pollTimer = setInterval(() => {
      this.dispatchPending();
    }, this.config.pollIntervalMs);

    // Also dispatch immediately
    this.dispatchPending();
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private dispatchPending(): void {
    const currentWorkers = getWorkerCount();
    const available = this.config.maxConcurrentWorkers - currentWorkers;

    if (available <= 0) return;

    // Get queued jobs
    const queuedJobs = this.jobRepo.getByStatus('queued');
    const toDispatch = queuedJobs.slice(0, available);

    for (const job of toDispatch) {
      this.dispatchJob(job);
    }
  }

  private dispatchJob(job: Job): void {
    const task = this.taskRepo.getById(job.task_id);
    if (!task) return;

    // Assemble the job packet
    const packet = this.assembler.assemble(task, job.model, this.config.supervisorId);

    // Write packet to temp file
    const packetPath = join(tmpdir(), `kingdom-packet-${generateUlid()}.json`);
    writeFileSync(packetPath, JSON.stringify(packet, null, 2), 'utf-8');

    // Spawn worker
    spawnWorker(packetPath, job.id);

    // Update job status
    this.jobRepo.updateStatus(job.id, 'running');
  }
}
