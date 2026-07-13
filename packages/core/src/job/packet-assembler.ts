import type { JobPacket, TaskGraphNode, Job, Message, OutputFormat, TechStack, MemoryConfig, ContextRef } from '../types.js';
import type { TaskRepository } from '../repositories/task-repo.js';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type Database from 'better-sqlite3';
// PHASE4 (P4.1/P4.2): sync lesson injection (records injection→job mapping).
// DEFERRAL2: async relevance-ranked injection used on the live assembly path.
import { buildLessonsBlockSync, buildLessonsBlock, type EmbeddingProvider } from '../memory/lesson-injector.js';
import { ContextResolver, type ContextSearchHit } from '../context/context-client.js';

// PHASE2 (P2.2): pre-resolved, index-grounded context the assembler folds into the
// prompt. Computed by `assembleForJobAsync`; absent ⇒ legacy raw-slice path.
export interface GroundedContext {
  /** Refs after validation/clamping against the symbol index (replaces task.context_refs). */
  validatedRefs: ContextRef[];
  /** High-ranked retrieved chunks appended below the raw slices. */
  retrieved: ContextSearchHit[];
  /** Whether the index was healthy; false ⇒ raw slices used unchanged + a warning. */
  indexHealthy: boolean;
  warnings: string[];
}

export interface PacketAssemblyOptions {
  projectPath: string;
  agentTemplatesDir: string;
  outputDir: string;
  /** Technology stack constraints injected into every task prompt. */
  techStack?: TechStack;
  /** Memory / lesson-injection config. Optional — defaults are sane. */
  memory?: MemoryConfig;
  /**
   * Root directory for operator-authored `kingdom/memory/{tier}/lessons.md`
   * files. Defaults to `process.cwd()` (the Kingdom repo root). The DB is
   * always the authoritative source; this is just the escape hatch.
   */
  kingdomDir?: string;
  /** Resolve configured request timeout by tier. Defaults to 120s. */
  timeoutSecondsResolver?: (tier: string) => number;
  /**
   * PHASE2 (P2.2): when set, code/test packets are grounded against the context
   * index — refs validated/repaired and high-ranked chunks retrieved — via
   * `assembleForJobAsync`. Absent (or engine unavailable) ⇒ legacy raw slices.
   */
  contextResolver?: ContextResolver;
  /**
   * DEFERRAL2: embedding backend for relevance-ranked lesson injection on the
   * async assembly path. Absent ⇒ lessons fall back to frequency ordering
   * (graceful degrade); the injector also degrades if the embedder throws.
   */
  embedder?: EmbeddingProvider;
  /**
   * DEFERRAL2: resolve a model's safe input budget (tokens) so the lesson byte
   * cap can grow for large-context models. Returns undefined when the model is
   * unknown ⇒ base cap.
   */
  modelContextResolver?: (modelId: string) => number | undefined;
}

export type ScopeMode = 'planned-files' | 'greenfield' | 'missing-planned-files';

export interface ScopePlan {
  allowedFiles: string[];
  mode: ScopeMode;
}

const SENSITIVE_PATH_PREFIXES = [
  '.git/',
  'node_modules/',
  'kingdom/results/',
  'kingdom/memory/',
  'archive/',
];

const SENSITIVE_PATHS = new Set(['.env', 'kingdom/kingdom.db', 'kingdom/context.db']);

export function normalizePlannedFilePath(rawPath: string): string | null {
  if (/^(---|\+\+\+|@@)/.test(rawPath.trim())) return null;
  const backtickMatch = rawPath.match(/`([^`]+)`/);
  let candidate = (backtickMatch?.[1] ?? rawPath)
    .trim()
    .replace(/^[-*+]\s*/, '')
    .replace(/^\d+[.)]\s*/, '')
    .replace(/^\[[ xX]\]\s*/, '')
    .trim();

  candidate = candidate.split(/\s+-\s+|\s+#|\s+\(/)[0]?.trim() ?? '';
  candidate = candidate.replace(/^[ab]\//, '').replace(/\\/g, '/').replace(/^\.\//, '');
  candidate = candidate.replace(/^['"]|['"]$/g, '').trim();

  if (!candidate || candidate === 'none' || candidate === 'n/a') return null;
  if (!candidate.includes('/') && !candidate.includes('.')) return null;
  if (candidate.startsWith('/') || candidate.startsWith('~') || /^[A-Za-z]:\//.test(candidate)) return null;

  const parts = candidate.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) return null;

  const normalized = parts.join('/');
  if (!normalized || SENSITIVE_PATHS.has(normalized)) return null;
  if (SENSITIVE_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return null;
  if (normalized.endsWith('.bak') || normalized.endsWith('.log')) return null;

  return normalized;
}

export function derivePlannedFiles(task: TaskGraphNode): string[] {
  const files = new Set<string>();
  for (const ref of task.context_refs) {
    const normalized = normalizePlannedFilePath(ref.file);
    if (normalized) files.add(normalized);
  }

  const filesSection = extractFilesToTouchSection(task.description ?? '');
  for (const line of filesSection.split('\n')) {
    const normalized = normalizePlannedFilePath(line);
    if (normalized) files.add(normalized);
  }

  return [...files];
}

function isExplicitGreenfieldTask(task: TaskGraphNode): boolean {
  const haystack = `${task.title}\n${task.description ?? ''}`.toLowerCase();
  return /\b(project setup and scaffolding|greenfield|from scratch|new project|scaffold|bootstrap|initialize new|create new (?:app|application|project|repo|codebase))\b/.test(haystack);
}

export function buildScopePlan(task: TaskGraphNode): ScopePlan {
  const allowedFiles = derivePlannedFiles(task);
  if (allowedFiles.length > 0) return { allowedFiles, mode: 'planned-files' };
  if (isExplicitGreenfieldTask(task)) return { allowedFiles: [], mode: 'greenfield' };
  return { allowedFiles: [], mode: 'missing-planned-files' };
}

function extractFilesToTouchSection(description: string): string {
  const match = description.match(/##\s*Files to touch\s*\n([\s\S]*?)(?=\n##\s+|$)/i);
  return match?.[1] ?? '';
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
  assembleForJob(
    job: Job,
    task: TaskGraphNode,
    grounded?: GroundedContext,
    // DEFERRAL2: internal seam — the async path precomputes a relevance-ranked
    // lessons block and passes it here so it isn't recomputed (frequency) below.
    internal?: { lessonsBlock?: string },
  ): JobPacket {
    if (task.level !== 'job' && task.level !== 'subtask' && task.level !== 'task') {
      throw new Error(`Cannot create job packet for task level: ${task.level}`);
    }

    // Build the messages
    const identityPath = this.resolveIdentityPath(task.assigned_tier);
    const messages = this.buildMessages(task, identityPath, grounded, job.id, internal?.lessonsBlock);

    // Determine output format
    const outputFormat = this.resolveOutputFormat(task.type);
    const scopePlan = buildScopePlan(task);

    // Determine result path
    const resultPath = join(this.options.outputDir, `${job.id}.result.json`);

    return {
      job_id: job.id,
      task_id: task.id,
      agent_identity_path: identityPath,
      model_id: job.model,
      messages,
      allowed_files: scopePlan.allowedFiles,
      scope_mode: scopePlan.mode,
      output_format: outputFormat,
      acceptance_criteria: task.acceptance_criteria,
      max_tokens: Math.max(task.token_budget_estimate || 0, outputFormat === 'unified-diff' ? 4096 : 1024),
      timeout_seconds: this.options.timeoutSecondsResolver?.(task.assigned_tier) ?? 120,
      result_path: resultPath,
    };
  }

  /**
   * PHASE2 (P2.2): index-grounded packet assembly. Resolves the context layer
   * (ref validation/repair + retrieval) then delegates to `assembleForJob`. When
   * no `contextResolver` is configured — or the index is unhealthy — this is
   * identical to `assembleForJob` (raw slices).
   */
  async assembleForJobAsync(job: Job, task: TaskGraphNode): Promise<JobPacket> {
    const grounded = await this.resolveGroundedContext(task);
    // DEFERRAL2: relevance-ranked lesson injection on the live path. Compute the
    // block here (async, embedder-aware) and hand it to the sync assembler so it
    // isn't recomputed by frequency. With no embedder configured — or if the
    // embedder throws — buildLessonsBlock degrades to today's frequency order.
    const lessonsBlock = await this.buildAsyncLessonsBlock(job, task);
    return this.assembleForJob(job, task, grounded, { lessonsBlock });
  }

  /**
   * DEFERRAL2: build the relevance-ranked lessons block for the live assembly
   * path. Threads the current task text, an optional embedder, and the model's
   * safe input budget (for the dynamic cap). Records the injection→job mapping
   * exactly once (inside buildLessonsBlock). Never throws — degrades to the
   * frequency-ordered block when relevance inputs are absent.
   */
  private async buildAsyncLessonsBlock(job: Job, task: TaskGraphNode): Promise<string> {
    const taskText = [task.title, ...task.acceptance_criteria, task.description]
      .filter(Boolean)
      .join('\n');
    const modelContextTokens = this.options.modelContextResolver?.(job.model);
    return buildLessonsBlock({
      db: this.db,
      kingdomDir: this.options.kingdomDir ?? process.cwd(),
      tier: task.assigned_tier,
      config: this.options.memory,
      taskText,
      embedder: this.options.embedder,
      failureType: job.failure_type ?? undefined,
      modelContextTokens,
      jobId: job.id && job.id !== 'legacy' ? job.id : undefined,
    });
  }

  /**
   * Run the context layer for a code/test task. Returns undefined when grounding
   * is not applicable so the caller falls back to raw slices unchanged.
   */
  async resolveGroundedContext(task: TaskGraphNode): Promise<GroundedContext | undefined> {
    const resolver = this.options.contextResolver;
    if (!resolver) return undefined;
    const outputFormat = this.resolveOutputFormat(task.type);
    if (outputFormat !== 'unified-diff') return undefined;

    const refResult = await resolver.validateRefs(task.context_refs);
    if (!refResult.indexHealthy) {
      // Degrade: keep the decomposer's raw refs and warn.
      return {
        validatedRefs: task.context_refs,
        retrieved: [],
        indexHealthy: false,
        warnings: refResult.warnings,
      };
    }

    const query = `${task.title}\n${task.description ?? ''}`.slice(0, 400);
    const retrieval = await resolver.retrieve(query);

    // Drop retrieved hits that duplicate a file already covered by validated refs.
    const refFiles = new Set(refResult.validatedRefs.map((r) => r.file));
    const retrieved = retrieval.hits.filter((h) => !refFiles.has(h.file));

    return {
      validatedRefs: refResult.validatedRefs,
      retrieved,
      indexHealthy: true,
      warnings: [...refResult.warnings, ...retrieval.warnings],
    };
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

  private buildMessages(
    task: TaskGraphNode,
    identityPath: string,
    grounded?: GroundedContext,
    jobId?: string,
    // DEFERRAL2: when provided (async relevance path), this block is injected
    // verbatim instead of recomputing the sync frequency-ordered block. The
    // injection→job mapping is recorded by whoever produced the block.
    precomputedLessonsBlock?: string,
  ): Message[] {
    const messages: Message[] = [];
    // PHASE2 (P2.2): when grounded against a healthy index, prefer the validated
    // (repaired) refs over the decomposer's raw refs.
    const effectiveRefs = grounded?.indexHealthy ? grounded.validatedRefs : task.context_refs;

    // System message from agent identity
    if (existsSync(identityPath)) {
      const identity = readFileSync(identityPath, 'utf-8');
      messages.push({ role: 'system', content: identity });
    }

    // Lesson injection — appended to the system message (or a new one if
    // no identity was present) so it stays clearly separated from task data
    // and inherits the system role. Scoped by tier via config; hard byte-cap
    // enforced inside `buildLessonsBlock`.
    // PHASE4 (P4.1/P4.2): sync legacy-compatible path used here (assemble() is
    // synchronous and widely called). Records the injection→job mapping for
    // outcome tracking when a jobId is available. The async, relevance-ranked
    // `buildLessonsBlock` is available for callers that supply an embedder.
    const lessonsBlock = precomputedLessonsBlock !== undefined
      ? precomputedLessonsBlock
      : buildLessonsBlockSync({
          db: this.db,
          kingdomDir: this.options.kingdomDir ?? process.cwd(),
          tier: task.assigned_tier,
          config: this.options.memory,
          jobId: jobId && jobId !== 'legacy' ? jobId : undefined,
        });
    if (lessonsBlock.length > 0) {
      const lessonsMsg: Message = { role: 'system', content: lessonsBlock };
      if (messages.length > 0 && messages[0].role === 'system') {
        messages[0] = {
          role: 'system',
          content: `${messages[0].content}\n\n${lessonsBlock}`,
        };
      } else {
        messages.push(lessonsMsg);
      }
    }

    // User message with task details
    let userContent = `# Task: ${task.title}\n\n`;

    // Inject tech stack constraints at the very top of the user message
    const ts = this.options.techStack;
    if (ts) {
      userContent += `## Technology Stack (MANDATORY)\n`;
      userContent += `You MUST use ONLY the following technologies. Do NOT use any other language, framework, or library.\n`;
      userContent += `- Language: ${ts.language}\n`;
      if (ts.framework) userContent += `- Framework: ${ts.framework}\n`;
      if (ts.build_tool) userContent += `- Build tool: ${ts.build_tool}\n`;
      if (ts.test_framework) userContent += `- Test framework: ${ts.test_framework}\n`;
      if (ts.package_manager) userContent += `- Package manager: ${ts.package_manager}\n`;
      if (ts.extras?.length) userContent += `- Additional: ${ts.extras.join(', ')}\n`;
      userContent += `\n`;
    }

    if (task.description) {
      userContent += `## Description\n${task.description}\n\n`;
    }

    userContent += `## Acceptance Criteria\n`;
    for (const criterion of task.acceptance_criteria) {
      userContent += `- ${criterion}\n`;
    }

    // Include context from referenced files.
    // Group refs by file and merge all line ranges, then extract only the
    // relevant slice ± CONTEXT_PADDING lines to avoid token waste.
    // Out-of-range refs are clamped to actual file bounds.
    if (effectiveRefs.length > 0) {
      const CONTEXT_PADDING = 20;

      // Merge all line ranges per file
      const fileRanges = new Map<string, { minLine: number; maxLine: number }>();
      for (const ref of effectiveRefs) {
        const existing = fileRanges.get(ref.file);
        if (!existing) {
          fileRanges.set(ref.file, { minLine: ref.startLine, maxLine: ref.endLine });
        } else {
          if (ref.startLine > 0) {
            existing.minLine = existing.minLine > 0 ? Math.min(existing.minLine, ref.startLine) : ref.startLine;
          }
          if (ref.endLine > 0) {
            existing.maxLine = Math.max(existing.maxLine, ref.endLine);
          }
        }
      }

      userContent += `\n## Context\n`;
      for (const [file, range] of fileRanges) {
        const filePath = join(this.options.projectPath, file);
        if (!existsSync(filePath)) continue;

        const content = readFileSync(filePath, 'utf-8');
        const allLines = content.split('\n');
        const totalLines = allLines.length;

        let slicedContent: string;
        let rangeDesc: string;

        const hasValidRange = range.minLine > 0 && range.maxLine > 0;

        if (hasValidRange) {
          // Clamp to actual file bounds (fixes Issue 26: out-of-range context_refs)
          const clampedEnd = Math.min(range.maxLine, totalLines);
          const start = Math.max(0, range.minLine - 1 - CONTEXT_PADDING);
          const end = Math.min(totalLines, clampedEnd + CONTEXT_PADDING);
          slicedContent = allLines.slice(start, end).join('\n');
          rangeDesc = `lines ${start + 1}-${end} of ${totalLines}`;
        } else {
          // No line range specified — include the full file
          slicedContent = content;
          rangeDesc = `lines 1-${totalLines}`;
        }

        userContent += `\n### ${file} (${rangeDesc})\n\`\`\`\n${slicedContent}\n\`\`\`\n`;
      }
    }

    // PHASE2 (P2.2): append high-ranked retrieved chunks from the symbol index.
    if (grounded?.indexHealthy && grounded.retrieved.length > 0) {
      userContent += `\n## Retrieved Context (from code index — relevant to this task)\n`;
      for (const hit of grounded.retrieved) {
        const body = (hit.snippet ?? '').trim();
        userContent += `\n### ${hit.file} (lines ${hit.startLine}-${hit.endLine}) — ${hit.title}\n`;
        if (body) userContent += `\`\`\`\n${body}\n\`\`\`\n`;
      }
    }

    // PHASE2 (P2.2): freshness/health gate — warn the agent when grounding was
    // degraded so it treats the raw slices with appropriate caution.
    if (grounded && !grounded.indexHealthy) {
      userContent += `\n## Context Notice\nThe code index was stale or unavailable; the context above is raw file slices that may be out of date. Verify paths/line numbers before editing.\n`;
    }

    // For squire-tier code/test tasks, inject a compact workspace file tree so the
    // agent knows which files actually exist and avoids hallucinating paths.
    if (task.assigned_tier === 'squire' && (task.type === 'code' || task.type === 'test')) {
      const tree = buildFileTree(this.options.projectPath, task.context_refs.map(r => r.file));
      if (tree) {
        userContent += `\n## Workspace File Tree\nThese files exist in the project. Only reference paths from this list.\n\`\`\`\n${tree}\n\`\`\`\n`;
      }
    }

    // Add explicit output format instructions for code tasks
    const outputFormat = this.resolveOutputFormat(task.type);
    if (outputFormat === 'unified-diff') {
      const scopePlan = buildScopePlan(task);
      userContent += `\n## Allowed Files\n`;
      if (scopePlan.allowedFiles.length > 0) {
        userContent += `You may modify or create ONLY these files:\n`;
        for (const file of scopePlan.allowedFiles) userContent += `- ${file}\n`;
      } else if (scopePlan.mode === 'greenfield') {
        userContent += `This is an explicit greenfield/scaffolding task. Keep the diff limited to the project skeleton described above.\n`;
      } else {
        userContent += `No explicit planned file set was provided. Do not invent unrelated paths; emit a minimal diff only if the Files to touch section clearly identifies the target files.\n`;
      }

      userContent += `\n## Output Requirements\n`;
      userContent += `You MUST output ONLY a valid unified diff. Do NOT wrap the diff in markdown code fences (\`\`\`). `;
      userContent += `The output must start with \`--- a/\` or \`diff --git\` and contain only valid unified diff hunks. `;
      userContent += `Use paths relative to the project root (e.g., \`packages/cli/src/commands/status.ts\`).\n`;
      userContent += `Every hunk MUST have a proper header with line numbers: \`@@ -startLine,count +startLine,count @@\`. `;
      userContent += `Count the lines you see above to compute accurate line numbers. Do NOT output \`@@ ... @@\` or omit line numbers.\n`;
    }

    messages.push({ role: 'user', content: userContent });

    return messages;
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

/**
 * Build a compact file tree for the workspace, focused around the files a task
 * will touch. Shows context_refs files plus siblings in the same directories.
 * Caps at MAX_TREE_ENTRIES to avoid bloating the prompt.
 */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.turbo', 'kingdom/results']);
const MAX_TREE_ENTRIES = 60;

function buildFileTree(projectPath: string, focusFiles: string[]): string {
  // Collect the directories containing focus files
  const focusDirs = new Set<string>();
  for (const f of focusFiles) {
    const parts = f.split('/');
    // Include every ancestor directory
    for (let i = 1; i <= parts.length; i++) {
      focusDirs.add(parts.slice(0, i).join('/'));
    }
  }

  const entries: string[] = [];

  function walk(dir: string, relDir: string, depth: number): void {
    if (entries.length >= MAX_TREE_ENTRIES) return;
    if (depth > 6) return;

    let children: string[];
    try {
      children = readdirSync(dir).sort();
    } catch {
      return;
    }

    for (const name of children) {
      if (entries.length >= MAX_TREE_ENTRIES) return;
      const fullPath = join(dir, name);
      const relPath = relDir ? `${relDir}/${name}` : name;

      let isDir = false;
      try {
        isDir = statSync(fullPath).isDirectory();
      } catch {
        continue;
      }

      if (isDir) {
        if (SKIP_DIRS.has(name) || SKIP_DIRS.has(relPath)) continue;
        // Only recurse into directories that contain (or are) focus file ancestors
        const isRelevant = [...focusDirs].some(d => d === relPath || d.startsWith(relPath + '/'));
        if (!isRelevant && depth > 2) continue;
        entries.push(`${'  '.repeat(depth)}${name}/`);
        walk(fullPath, relPath, depth + 1);
      } else {
        entries.push(`${'  '.repeat(depth)}${name}`);
      }
    }
  }

  if (!existsSync(projectPath)) return '';
  walk(projectPath, '', 0);

  return entries.join('\n');
}
