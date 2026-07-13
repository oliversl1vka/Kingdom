import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Absolute path to the worker entry point, resolved from this source file's location. */
const workerEntry = join(__dirname, 'worker-entry.ts');

export interface SpawnedWorker {
  pid: number;
  process: ChildProcess;
  jobId: string;
}

const activeWorkers = new Map<string, SpawnedWorker>();

export function spawnWorker(
  packetPath: string,
  jobId: string,
  nodeExecutable: string = process.execPath
): SpawnedWorker {
  const args = [
    '--import', 'tsx',
    '--',
    workerEntry,
    packetPath,
  ];

  const child = spawn(nodeExecutable, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    env: { ...process.env },
  });

  // Drain stdout/stderr so the child never blocks on a full pipe buffer (~64 KB).
  child.stdout?.resume();
  child.stderr?.resume();

  const worker: SpawnedWorker = {
    pid: child.pid!,
    process: child,
    jobId,
  };

  activeWorkers.set(jobId, worker);

  child.on('exit', () => {
    activeWorkers.delete(jobId);
  });

  return worker;
}

export function killWorker(jobId: string, signal: NodeJS.Signals = 'SIGTERM'): boolean {
  const worker = activeWorkers.get(jobId);
  if (!worker) return false;

  try {
    worker.process.kill(signal);
    return true;
  } catch {
    return false;
  }
}

export function hardKillWorker(jobId: string): boolean {
  return killWorker(jobId, 'SIGKILL');
}

/**
 * Phase 1 (P1.3): Kill a worker process directly by PID (from the job's lease).
 * This is what makes cancellation real across the process boundary — the
 * in-memory activeWorkers map only knows about workers THIS process spawned, but
 * the lease PID is durable in the DB and survives a dispatcher restart. Returns
 * true if a signal was delivered (process existed), false if the PID was already
 * gone or could not be signalled.
 */
export function killWorkerByPid(pid: number, signal: NodeJS.Signals = 'SIGTERM'): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    // ESRCH (no such process) or EPERM — treat as "not killed".
    return false;
  }
}

/** Returns true if a process with the given PID is currently alive. */
export function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function getActiveWorkers(): SpawnedWorker[] {
  return Array.from(activeWorkers.values());
}

export function getWorkerCount(): number {
  return activeWorkers.size;
}
