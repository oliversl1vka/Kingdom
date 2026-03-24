import type { JobPacket, CompletionResponse, ProviderAdapter } from '../types.js';
import { HeartbeatWriter } from './heartbeat-writer.js';
import type Database from 'better-sqlite3';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

export interface WorkerResult {
  job_id: string;
  success: boolean;
  content: string;
  tokens_used: number;
  finish_reason: string;
  error?: string;
}

export async function executeWorker(
  db: Database.Database,
  provider: ProviderAdapter,
  packetPath: string,
  workerId: string
): Promise<WorkerResult> {
  const raw = readFileSync(packetPath, 'utf-8');
  const packet: JobPacket = JSON.parse(raw);

  const heartbeat = new HeartbeatWriter(db, packet.job_id, workerId);
  heartbeat.start();

  try {
    // Mark job as running
    db.prepare('UPDATE jobs SET worker_id = ?, started_at = ?, status = ? WHERE id = ?')
      .run(workerId, new Date().toISOString(), 'running', packet.job_id);

    // Check for cancellation before starting
    const job = db.prepare('SELECT cancel_requested FROM jobs WHERE id = ?').get(packet.job_id) as { cancel_requested: number } | undefined;
    if (job?.cancel_requested) {
      db.prepare("UPDATE jobs SET status = 'cancelled' WHERE id = ?").run(packet.job_id);
      return { job_id: packet.job_id, success: false, content: '', tokens_used: 0, finish_reason: 'cancelled', error: 'Job was cancelled before execution' };
    }

    heartbeat.update('healthy', 'Sending request to model...', 0);

    // Execute the model call
    const response: CompletionResponse = await provider.complete({
      model: packet.model_id,
      messages: packet.messages,
      max_tokens: packet.max_tokens,
      temperature: 0.3,
    });

    heartbeat.update('finishing', 'Writing result...', response.completion_tokens);

    // Write result to result_path
    const result: WorkerResult = {
      job_id: packet.job_id,
      success: true,
      content: response.content,
      tokens_used: response.total_tokens,
      finish_reason: response.finish_reason,
    };

    mkdirSync(dirname(packet.result_path), { recursive: true });
    writeFileSync(packet.result_path, JSON.stringify(result, null, 2), 'utf-8');

    // Update job as completed
    db.prepare('UPDATE jobs SET status = ?, result_path = ?, tokens_used = ? WHERE id = ?')
      .run('completed', packet.result_path, response.total_tokens, packet.job_id);

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Determine failure type
    let failureType = 'runtime-crash';
    if (message.includes('timeout') || message.includes('abort')) {
      failureType = 'timeout';
    } else if (message.includes('token') || message.includes('context_length')) {
      failureType = 'token-overflow';
    }

    db.prepare('UPDATE jobs SET status = ?, failure_type = ? WHERE id = ?')
      .run(`failed-${failureType}`, failureType, packet.job_id);

    return {
      job_id: packet.job_id,
      success: false,
      content: '',
      tokens_used: 0,
      finish_reason: 'error',
      error: message,
    };
  } finally {
    heartbeat.stop();
  }
}
