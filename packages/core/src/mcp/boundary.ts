import type { MCPClient } from './client.js';

const ALLOWED_MCP_METHODS = new Set([
  'github.issues.create',
  'github.issues.list',
  'github.issues.get',
  'github.pulls.create',
  'github.pulls.list',
  'github.pulls.get',
  'github.repos.get',
  'github.repos.list',
]);

export interface BoundaryViolation {
  method: string;
  timestamp: string;
  reason: string;
}

const violations: BoundaryViolation[] = [];

export function isAllowedMethod(method: string): boolean {
  return ALLOWED_MCP_METHODS.has(method);
}

export function enforceBoundary(method: string): void {
  if (!isAllowedMethod(method)) {
    const violation: BoundaryViolation = {
      method,
      timestamp: new Date().toISOString(),
      reason: `MCP method "${method}" is not in the allowed list`,
    };
    violations.push(violation);
    throw new Error(violation.reason);
  }
}

export function getViolations(): BoundaryViolation[] {
  return [...violations];
}

export function clearViolations(): void {
  violations.length = 0;
}

/**
 * Create a boundary-enforced MCP client wrapper.
 */
export function createBoundaryEnforcedClient(client: MCPClient) {
  return {
    async call<T = unknown>(method: string, params: Record<string, unknown>) {
      enforceBoundary(method);
      return client.call<T>(method, params);
    },
    isConnected: () => client.isConnected(),
    connect: () => client.connect(),
    disconnect: () => client.disconnect(),
  };
}
