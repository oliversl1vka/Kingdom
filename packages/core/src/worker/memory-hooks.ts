export interface MemoryWriter {
  append(agentName: string, fileName: string, content: string): void;
}

export interface MemoryHookContext {
  agentName: string;
  jobId: string;
  taskId: string;
}

export function onJobCompletion(
  memoryManager: MemoryWriter,
  ctx: MemoryHookContext,
  output: string,
  learnings?: string
): void {
  const entry = [
    `## Job ${ctx.jobId} - Completed`,
    `- Task: ${ctx.taskId}`,
    `- Date: ${new Date().toISOString()}`,
    learnings ? `- Learnings: ${learnings}` : '',
    `- Output summary: ${output.slice(0, 200)}`,
    '',
  ]
    .filter(Boolean)
    .join('\n');

  memoryManager.append(ctx.agentName, 'journal.md', entry);
}

export function onReviewRejection(
  memoryManager: MemoryWriter,
  ctx: MemoryHookContext,
  reason: string,
  feedback: string
): void {
  const entry = [
    `## Job ${ctx.jobId} - Review Rejected`,
    `- Task: ${ctx.taskId}`,
    `- Date: ${new Date().toISOString()}`,
    `- Reason: ${reason}`,
    `- Feedback: ${feedback}`,
    '',
  ].join('\n');

  memoryManager.append(ctx.agentName, 'journal.md', entry);
}

export function onHealerDiagnosis(
  memoryManager: MemoryWriter,
  ctx: MemoryHookContext,
  rootCause: string,
  recommendation: string
): void {
  const entry = [
    `## Job ${ctx.jobId} - Healer Diagnosis`,
    `- Task: ${ctx.taskId}`,
    `- Date: ${new Date().toISOString()}`,
    `- Root Cause: ${rootCause}`,
    `- Recommendation: ${recommendation}`,
    '',
  ].join('\n');

  memoryManager.append(ctx.agentName, 'journal.md', entry);
}
