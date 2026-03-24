import { spawn, type ChildProcess } from 'node:child_process';
import { platform } from 'node:os';

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
    'packages/core/src/worker/worker-entry.ts',
    packetPath,
  ];

  const child = spawn(nodeExecutable, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    env: { ...process.env },
  });

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

export function getActiveWorkers(): SpawnedWorker[] {
  return Array.from(activeWorkers.values());
}

export function getWorkerCount(): number {
  return activeWorkers.size;
}
