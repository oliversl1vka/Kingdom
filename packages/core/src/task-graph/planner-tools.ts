// PHASE2 (P2.3 / P2.4): repo-grounded tool-using planner support.
//
// Read-only repo tools the planner agent may call to ground its decomposition,
// plus the JSON schema for the structured `emit_task_graph` output. Core stays
// hermetic: the actual repo reads go through an injected `RepoReader` so tests
// run without touching disk.

import type { JSONSchema, ToolDefinition, ModelCapabilities } from '../types.js';

/** Read-only repo access seam for the planner. Injected by summon; faked in tests. */
export interface RepoReader {
  /** List workspace-relative files, optionally under a subdirectory. */
  listFiles(dir?: string): string[];
  /** Read a workspace-relative file (full content). */
  readFile(path: string): string | null;
  /** Search file contents; returns "path:line: text" lines. */
  grep(pattern: string, opts?: { glob?: string }): string[];
}

/** Lookup a model's capabilities. Injected so core avoids the token-engine dep cycle. */
export type CapabilityLookup = (modelId: string) => ModelCapabilities | null;

export interface PlannerOptions {
  /** Capability lookup. When the planner model has tool_use, the agent session runs. */
  capabilities?: CapabilityLookup;
  /** Repo reader for the read-only planner tools. Required for the agent session. */
  repoReader?: RepoReader;
  /** Max read-only tool round-trips before forcing emit. Default 6. */
  maxIterations?: number;
  verbose?: boolean;
}

/** Read-only tools exposed during the planner's grounding phase. */
export const PLANNER_READ_TOOLS: ToolDefinition[] = [
  {
    name: 'list_files',
    description: 'List workspace-relative files, optionally under a subdirectory, to understand the project layout.',
    parameters: {
      type: 'object',
      properties: { dir: { type: 'string', description: 'Optional subdirectory.' } },
    },
  },
  {
    name: 'read_file',
    description: 'Read a workspace-relative file to ground the plan in real code.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Workspace-relative path.' } },
      required: ['path'],
    },
  },
  {
    name: 'grep',
    description: 'Search file contents for a pattern. Returns matching "path:line: text" entries.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Search pattern (regex).' },
        glob: { type: 'string', description: 'Optional glob filter, e.g. "**/*.ts".' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'get_task_graph',
    description: 'Return the current parent task and its existing siblings so the plan does not duplicate work.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'emit_task_graph',
    description: 'Emit the final decomposition as the task graph. Call this exactly once when grounding is complete.',
    parameters: emitTaskGraphSchema(),
  },
];

/** JSON schema for the structured decomposition output (P2.4 + P2.3 emit). */
export function emitTaskGraphSchema(): JSONSchema {
  return {
    type: 'object',
    properties: {
      subtasks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            type: { type: 'string', enum: ['code', 'test', 'review', 'research', 'design'] },
            acceptance_criteria: { type: 'array', items: { type: 'string' } },
            context_refs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  file: { type: 'string' },
                  startLine: { type: 'number' },
                  endLine: { type: 'number' },
                },
                required: ['file', 'startLine', 'endLine'],
              },
            },
            depends_on_indices: { type: 'array', items: { type: 'number' } },
            token_budget_estimate: { type: 'number' },
          },
          required: ['title', 'description', 'type', 'acceptance_criteria', 'context_refs', 'depends_on_indices', 'token_budget_estimate'],
        },
      },
    },
    required: ['subtasks'],
  };
}
