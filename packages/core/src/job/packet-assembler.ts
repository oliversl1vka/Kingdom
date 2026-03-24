import type { JobPacket, TaskGraphNode, Job, Message, OutputFormat } from '../types.js';
import type { TaskRepository } from '../repositories/task-repo.js';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';

export interface PacketAssemblyOptions {
  projectPath: string;
  agentTemplatesDir: string;
  outputDir: string;
}

export class JobPacketAssembler {
  constructor(
    private db: Database.Database,
    private taskRepo: TaskRepository,
    private options: PacketAssemblyOptions
  ) {}

  /**
   * Assemble a JobPacket for an existing job record.
   * Does NOT create a new job — uses the provided existing job.
   */
  assembleForJob(job: Job, task: TaskGraphNode): JobPacket {
    if (task.level !== 'job' && task.level !== 'subtask' && task.level !== 'task') {
      throw new Error(`Cannot create job packet for task level: ${task.level}`);
    }

    // Build the messages
    const identityPath = this.resolveIdentityPath(task.assigned_tier);
    const messages = this.buildMessages(task, identityPath);

    // Determine output format
    const outputFormat = this.resolveOutputFormat(task.type);

    // Determine result path
    const resultPath = join(this.options.outputDir, `${job.id}.result.json`);

    return {
      job_id: job.id,
      task_id: task.id,
      agent_identity_path: identityPath,
      model_id: job.model,
      messages,
      allowed_files: this.resolveAllowedFiles(task),
      output_format: outputFormat,
      acceptance_criteria: task.acceptance_criteria,
      max_tokens: task.token_budget_estimate || 4096,
      timeout_seconds: 120,
      result_path: resultPath,
    };
  }

  /**
   * @deprecated Use assembleForJob() instead — this method creates duplicate job records.
   */
  assemble(task: TaskGraphNode, modelId: string, supervisorId: string): JobPacket {
    return this.assembleForJob(
      { id: 'legacy', task_id: task.id, model: modelId, status: 'queued', worker_id: null, started_at: null, heartbeat_at: null, timeout_at: null, cancel_requested: false, cancel_reason: null, result_path: null, failure_type: null, token_estimate: task.token_budget_estimate, tokens_used: null, delegating_supervisor_id: supervisorId, created_at: new Date().toISOString() } as Job,
      task
    );
  }

  private resolveIdentityPath(tier: string): string {
    const tierToFile: Record<string, string> = {
      king: 'king.md',
      nobility: 'nobility.md',
      knight: 'knight.md',
      squire: 'squire.md',
      healer: 'healer.md',
      sentinel: 'sentinel.md',
      scribe: 'scribe.md',
      judge: 'judge.md',
      blacksmith: 'blacksmith.md',
    };
    const filename = tierToFile[tier] ?? 'squire.md';
    return join(this.options.agentTemplatesDir, filename);
  }

  private buildMessages(task: TaskGraphNode, identityPath: string): Message[] {
    const messages: Message[] = [];

    // System message from agent identity
    if (existsSync(identityPath)) {
      const identity = readFileSync(identityPath, 'utf-8');
      messages.push({ role: 'system', content: identity });
    }

    // User message with task details
    let userContent = `# Task: ${task.title}\n\n`;

    if (task.description) {
      userContent += `## Description\n${task.description}\n\n`;
    }

    userContent += `## Acceptance Criteria\n`;
    for (const criterion of task.acceptance_criteria) {
      userContent += `- ${criterion}\n`;
    }

    // Include context from referenced files — always read FULL current file
    // from disk to ensure the LLM sees the latest state after previous diffs.
    // Deduplicate by file path so each file is included only once.
    if (task.context_refs.length > 0) {
      userContent += `\n## Context\n`;
      const seenFiles = new Set<string>();
      for (const ref of task.context_refs) {
        if (seenFiles.has(ref.file)) continue;
        seenFiles.add(ref.file);
        const filePath = join(this.options.projectPath, ref.file);
        if (existsSync(filePath)) {
          const content = readFileSync(filePath, 'utf-8');
          const totalLines = content.split('\n').length;
          userContent += `\n### ${ref.file} (lines 1-${totalLines})\n\`\`\`\n${content}\n\`\`\`\n`;
        }
      }
    }

    // Add explicit output format instructions for code tasks
    const outputFormat = this.resolveOutputFormat(task.type);
    if (outputFormat === 'unified-diff') {
      userContent += `\n## Output Requirements\n`;
      userContent += `You MUST output ONLY a valid unified diff. Do NOT wrap the diff in markdown code fences (\`\`\`). `;
      userContent += `The output must start with \`--- a/\` or \`diff --git\` and contain only valid unified diff hunks. `;
      userContent += `Use paths relative to the project root (e.g., \`packages/ui/src/engine/pixel-characters.ts\`).\n`;
      userContent += `Every hunk MUST have a proper header with line numbers: \`@@ -startLine,count +startLine,count @@\`. `;
      userContent += `Count the lines you see above to compute accurate line numbers. Do NOT output \`@@ ... @@\` or omit line numbers.\n`;
    }

    messages.push({ role: 'user', content: userContent });

    return messages;
  }

  private resolveAllowedFiles(task: TaskGraphNode): string[] {
    return task.context_refs.map((ref) => ref.file);
  }

  private resolveOutputFormat(taskType: string): OutputFormat {
    switch (taskType) {
      case 'code':
        return 'unified-diff';
      case 'test':
        return 'unified-diff';
      case 'review':
        return 'json';
      case 'research':
        return 'markdown';
      case 'design':
        return 'markdown';
      default:
        return 'free-text';
    }
  }
}
