import type { TaskStatus, JobStatus } from '../types.js';

/**
 * Job lifecycle state machine per data-model.md TaskGraphNode Status Lifecycle.
 * Enforces valid transitions and rejects invalid ones.
 */

const VALID_JOB_TRANSITIONS: Record<string, string[]> = {
  'queued': ['preparing-context', 'awaiting-healer', 'cancelled'],
  'preparing-context': ['awaiting-budget-check', 'cancelled'],
  'awaiting-budget-check': ['budget-rejected', 'running', 'cancelled'],
  'budget-rejected': ['queued', 'cancelled'],
  'running': ['streaming', 'stalled', 'cancel-requested', 'completed', 'completed-with-warnings', 'failed-token-overflow', 'failed-timeout', 'failed-runtime-crash', 'failed-invalid-output', 'failed-review'],
  'streaming': ['stalled', 'cancel-requested', 'completed', 'completed-with-warnings', 'failed-token-overflow', 'failed-timeout', 'failed-runtime-crash', 'failed-invalid-output'],
  'stalled': ['running', 'cancelled', 'failed-timeout', 'superseded', 'needs-human'],
  'cancel-requested': ['cancelled'],
  'cancelled': [],
  'completed': [],
  'completed-with-warnings': [],
  'failed-token-overflow': ['retrying', 'awaiting-healer', 'superseded', 'needs-human'],
  'failed-timeout': ['retrying', 'awaiting-healer', 'superseded', 'needs-human'],
  'failed-runtime-crash': ['retrying', 'awaiting-healer', 'superseded', 'needs-human'],
  'failed-invalid-output': ['retrying', 'awaiting-healer', 'superseded', 'needs-human'],
  'failed-review': ['retrying', 'awaiting-healer', 'superseded', 'needs-human'],
  'retrying': ['running'],
  'awaiting-healer': ['awaiting-redesign', 'retrying', 'superseded', 'needs-human'],
  'awaiting-redesign': [],
  'superseded': [],
  'needs-human': [],
};

export function isValidTransition(currentStatus: string, newStatus: string): boolean {
  const allowed = VALID_JOB_TRANSITIONS[currentStatus];
  if (!allowed) return false;
  return allowed.includes(newStatus);
}

export function getValidTransitions(currentStatus: string): string[] {
  return VALID_JOB_TRANSITIONS[currentStatus] ?? [];
}

export function isTerminalStatus(status: string): boolean {
  const terminal = ['cancelled', 'completed', 'completed-with-warnings', 'awaiting-redesign', 'superseded', 'needs-human'];
  return terminal.includes(status);
}

export function isFailedStatus(status: string): boolean {
  return status.startsWith('failed-');
}

export function isActiveStatus(status: string): boolean {
  return ['running', 'streaming', 'preparing-context', 'awaiting-budget-check'].includes(status);
}

export function assertTransition(currentStatus: string, newStatus: string): void {
  if (!isValidTransition(currentStatus, newStatus)) {
    throw new Error(
      `Invalid status transition: ${currentStatus} → ${newStatus}. ` +
      `Allowed transitions: ${getValidTransitions(currentStatus).join(', ') || 'none (terminal state)'}`
    );
  }
}
