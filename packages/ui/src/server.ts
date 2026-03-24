import Fastify from 'fastify';
import { join } from 'node:path';
import { existsSync, mkdirSync, readdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';

export interface ServerOptions {
  port: number;
  kingdomDir: string;
}

const MASTER_PASSWORD = process.env.KINGDOM_MASTER_PASSWORD ?? 'kingdom-dev-key';

export async function createServer(options: ServerOptions) {
  const { port, kingdomDir } = options;
  const basePath = join(kingdomDir, '..');
  const fastify = Fastify({ logger: false });

  // Track running dispatcher
  let activeDispatcher: { stop: () => void } | null = null;

  // Lazy import core to access DB — returns null if kingdom not yet initialized
  const dbPath = join(kingdomDir, 'kingdom.db');
  const getDb = async () => {
    if (!existsSync(dbPath)) return null;
    const { getDatabaseForPath } = await import('@kingdomos/core');
    return getDatabaseForPath(dbPath);
  };

  // API endpoints — all return empty data gracefully when no kingdom exists
  fastify.get('/api/projects', async () => {
    const db = await getDb();
    if (!db) return [];
    return db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
  });

  fastify.get('/api/tasks', async () => {
    const db = await getDb();
    if (!db) return [];
    return db.prepare(`
      SELECT t.*, j.status as job_status, j.model
      FROM task_graph_nodes t
      LEFT JOIN jobs j ON j.task_id = t.id
      ORDER BY t.created_at DESC
      LIMIT 100
    `).all();
  });

  fastify.get('/api/agents', async () => {
    const db = await getDb();
    if (!db) return [];

    // Only show actively running/streaming jobs as "working" agents
    // Plus one "idle" representative per tier that has queued work
    const running = db.prepare(`
      SELECT j.id, j.task_id, j.worker_id, j.status as job_status,
             t.title as task_title, t.assigned_tier
      FROM jobs j
      JOIN task_graph_nodes t ON j.task_id = t.id
      WHERE j.status IN ('running', 'streaming')
      ORDER BY j.started_at DESC
      LIMIT 20
    `).all() as Array<{
      id: string; task_id: string; worker_id: string | null;
      job_status: string; task_title: string; assigned_tier: string;
    }>;

    // Get tiers with queued jobs (show one idle agent per tier)
    const queuedTiers = db.prepare(`
      SELECT DISTINCT t.assigned_tier, COUNT(*) as cnt
      FROM jobs j JOIN task_graph_nodes t ON j.task_id = t.id
      WHERE j.status = 'queued'
      GROUP BY t.assigned_tier
    `).all() as Array<{ assigned_tier: string; cnt: number }>;

    // Get tiers with recently completed jobs (show one idle agent per tier)
    const completedTiers = db.prepare(`
      SELECT DISTINCT t.assigned_tier
      FROM jobs j JOIN task_graph_nodes t ON j.task_id = t.id
      WHERE j.status = 'completed'
      GROUP BY t.assigned_tier
    `).all() as Array<{ assigned_tier: string }>;

    const tierNames: Record<string, string[]> = {
      king: ['The Crown', 'King Arthur', 'High King'],
      nobility: ['Lord Regent', 'Duke Edmund', 'Baroness Elara'],
      knight: ['Sir Galahad', 'Sir Lancelot', 'Dame Brienne', 'Sir Percival'],
      squire: ['Page Turner', 'Young Cedric', 'Apprentice Wren'],
      healer: ['Brother Aldric', 'Sister Miriel', 'Sage Thornwood'],
      sentinel: ['Night Watch', 'Eagle Eye', 'Shadow Guard'],
      scribe: ['Chronicler', 'Master Quill', 'Archive Keeper'],
      judge: ['Lord Justice', 'Arbiter Creed', 'High Magistrate'],
      blacksmith: ['Iron Forge', 'Steel Hammer', 'Master Smith'],
    };
    const tierCounters: Record<string, number> = {};
    const agents: Array<{ id: string; name: string; tier: string; state: string; currentJob: string }> = [];

    // Add working agents (running/streaming)
    for (const j of running) {
      const tier = j.assigned_tier || 'knight';
      tierCounters[tier] = (tierCounters[tier] ?? 0);
      const names = tierNames[tier] ?? ['Agent'];
      const name = names[tierCounters[tier] % names.length];
      tierCounters[tier]++;
      agents.push({ id: j.id, name, tier, state: 'working', currentJob: j.task_title });
    }

    // Add one idle agent per tier that has queued work
    const seenTiers = new Set(running.map(j => j.assigned_tier));
    for (const qt of queuedTiers) {
      if (!seenTiers.has(qt.assigned_tier)) {
        const tier = qt.assigned_tier;
        const names = tierNames[tier] ?? ['Agent'];
        agents.push({ id: `idle-${tier}`, name: names[0], tier, state: 'idle', currentJob: `${qt.cnt} jobs queued` });
        seenTiers.add(tier);
      }
    }

    // Add one idle agent per tier that has completed work (if not already shown)
    for (const ct of completedTiers) {
      if (!seenTiers.has(ct.assigned_tier)) {
        const tier = ct.assigned_tier;
        const names = tierNames[tier] ?? ['Agent'];
        agents.push({ id: `done-${tier}`, name: names[0], tier, state: 'idle', currentJob: 'Duties complete' });
        seenTiers.add(tier);
      }
    }

    return agents;
  });

  fastify.get('/api/treasury', async () => {
    const db = await getDb();
    if (!db) return [];
    return db.prepare(
      `SELECT j.id as job_id, t.title as task_title,
              COALESCE(j.tokens_used, 0) as used_tokens,
              j.token_estimate as budget_tokens
       FROM jobs j
       JOIN task_graph_nodes t ON j.task_id = t.id
       WHERE j.status IN ('running', 'streaming')
       LIMIT 20`
    ).all();
  });

  fastify.get('/api/crypt', async () => {
    const db = await getDb();
    if (!db) return [];
    return db.prepare('SELECT * FROM crypt_entries ORDER BY completed_at DESC LIMIT 50').all();
  });

  // ─── Configuration ───────────────────────────────────────────────

  fastify.get('/api/config', async () => {
    const { getConfig, configExists } = await import('@kingdomos/core');
    if (!configExists(basePath)) return null;
    return getConfig(basePath);
  });

  fastify.put('/api/config', async (req) => {
    const { setConfig } = await import('@kingdomos/core');
    const config = req.body as Record<string, unknown>;
    setConfig(config as unknown as import('@kingdomos/core').KingdomConfig, basePath);
    return { ok: true };
  });

  // ─── Credentials ─────────────────────────────────────────────────

  fastify.post('/api/credentials', async (req) => {
    const { provider, api_key } = req.body as { provider: string; api_key: string };
    if (!provider || !api_key) return { error: 'provider and api_key required' };
    mkdirSync(kingdomDir, { recursive: true });
    const { setProviderCredential } = await import('@kingdomos/core');
    setProviderCredential(kingdomDir, provider, api_key, MASTER_PASSWORD);
    return { ok: true };
  });

  // ─── Models ──────────────────────────────────────────────────────

  fastify.get<{ Params: { provider: string } }>('/api/models/:provider', async (req) => {
    const { provider } = req.params;
    const { getProviderCredential } = await import('@kingdomos/core');
    const apiKey = getProviderCredential(kingdomDir, provider, MASTER_PASSWORD);

    if (!apiKey) {
      return { models: [], error: `No API key stored for ${provider}. Save one first.` };
    }

    if (provider === 'openai') {
      const resp = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!resp.ok) return { models: [], error: `OpenAI API error: ${resp.status}` };
      const data = (await resp.json()) as { data: Array<{ id: string; owned_by: string }> };
      const models = data.data
        .map((m) => ({ id: m.id, name: m.id, owned_by: m.owned_by }))
        .sort((a, b) => a.id.localeCompare(b.id));
      return { models };
    }

    if (provider === 'anthropic') {
      // Anthropic doesn't have a list-models endpoint — return known models
      return {
        models: [
          { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
          { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
          { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
        ],
      };
    }

    return { models: [], error: `Model listing not implemented for ${provider}` };
  });

  // ─── Kingdom Init ────────────────────────────────────────────────

  fastify.post('/api/init', async (req) => {
    const { project_name, workspace_path } = req.body as { project_name: string; workspace_path?: string };
    if (!project_name) return { error: 'project_name required' };

    const { createDefaultConfig, setConfig: setCfg, getDatabaseForPath, configExists } = await import('@kingdomos/core');

    if (configExists(basePath)) {
      // If workspace_path provided, update existing config
      if (workspace_path) {
        const { getConfig: getCfg } = await import('@kingdomos/core');
        const cfg = getCfg(basePath);
        cfg.workspace_path = workspace_path;
        setCfg(cfg, basePath);
      }
      return { ok: true, message: 'Kingdom already initialized.' };
    }

    // Create directories
    const dirs = [kingdomDir, join(kingdomDir, 'agents'), join(kingdomDir, 'memory'), join(kingdomDir, 'memory', 'shared')];
    for (const dir of dirs) mkdirSync(dir, { recursive: true });

    // Create config with workspace_path
    const config = createDefaultConfig(project_name);
    if (workspace_path) config.workspace_path = workspace_path;
    setCfg(config, basePath);

    // Initialize DB
    const dbPath = join(kingdomDir, 'kingdom.db');
    const db = getDatabaseForPath(dbPath);

    // Update project repository_path to workspace_path if provided
    if (workspace_path) {
      const { ProjectRepository } = await import('@kingdomos/core');
      const projectRepo = new ProjectRepository(db);
      let projects = projectRepo.getAll();
      if (projects.length === 0) {
        projectRepo.create({ name: project_name, repository_path: workspace_path });
      }
    }

    db.close();

    // Copy templates
    try {
      const templatesDir = join(basePath, 'packages', 'agents', 'templates');
      if (existsSync(templatesDir)) {
        for (const f of readdirSync(templatesDir).filter((f) => f.endsWith('.md'))) {
          copyFileSync(join(templatesDir, f), join(kingdomDir, 'agents', f));
        }
      }
    } catch { /* templates not available */ }

    return { ok: true, message: `Kingdom '${project_name}' established.`, workspace_path: workspace_path ?? basePath };
  });

  // ─── Decree ──────────────────────────────────────────────────────

  interface DecreeTask {
    title: string;
    description: string;
    type?: 'code' | 'test' | 'review' | 'research' | 'design';
    assigned_tier?: string;
    acceptance_criteria?: string[];
    context_refs?: Array<{ file: string; startLine: number; endLine: number }>;
  }

  fastify.post('/api/decree', async (req) => {
    const { objective, priority, tasks } = req.body as {
      objective: string;
      priority?: number;
      tasks?: DecreeTask[];
    };
    if (!objective) return { error: 'objective required' };

    const db = await getDb();
    if (!db) return { error: 'Kingdom not initialized. Run Init first.' };
    const { ProjectRepository, ObjectiveRepository, TaskRepository, JobRepository } = await import('@kingdomos/core');

    // Find or create default project
    const projectRepo = new ProjectRepository(db);
    let projects = projectRepo.getAll();
    if (projects.length === 0) {
      projectRepo.create({ name: 'default', repository_path: basePath });
      projects = projectRepo.getAll();
    }
    const project = projects[0];

    const objRepo = new ObjectiveRepository(db);
    const obj = objRepo.create({
      project_id: project.id,
      description: objective,
      priority: priority ?? 5,
      acceptance_criteria: [],
    });

    // If tasks provided, create a full task graph with jobs
    let taskCount = 0;
    if (tasks && tasks.length > 0) {
      const taskRepo = new TaskRepository(db);
      const jobRepo = new JobRepository(db);
      const { getConfig: getCfg } = await import('@kingdomos/core');
      let model = 'gpt-4.1';
      try {
        const cfg = getCfg(basePath);
        model = cfg.tiers?.knight?.model ?? 'gpt-4.1';
      } catch { /* use default */ }

      // Create root epic task
      const rootTask = taskRepo.create({
        objective_id: obj.id,
        level: 'epic',
        title: objective,
        description: `Root task for objective: ${objective}`,
        priority: priority ?? 5,
        type: 'design',
        assigned_tier: 'king',
        reviewer_tier: 'king',
        acceptance_criteria: ['All subtasks completed successfully'],
      });

      // Create subtasks and jobs
      for (const t of tasks) {
        const tier = (t.assigned_tier ?? 'knight') as import('@kingdomos/core').AgentTier;
        const reviewerMap: Record<string, string> = {
          king: 'king', nobility: 'king', knight: 'nobility',
          squire: 'knight', healer: 'king', sentinel: 'king',
          scribe: 'knight', judge: 'nobility', blacksmith: 'knight',
        };
        const child = taskRepo.create({
          parent_id: rootTask.id,
          objective_id: obj.id,
          level: 'task',
          title: t.title,
          description: t.description,
          priority: priority ?? 5,
          type: (t.type ?? 'code') as import('@kingdomos/core').TaskType,
          assigned_tier: tier,
          reviewer_tier: (reviewerMap[tier] ?? 'nobility') as import('@kingdomos/core').AgentTier,
          acceptance_criteria: t.acceptance_criteria ?? [t.title + ' implemented and verified'],
          context_refs: t.context_refs,
        });

        // Create a job for each task
        jobRepo.create({
          task_id: child.id,
          model,
          token_estimate: 4000,
          delegating_supervisor_id: 'king',
        });

        taskCount++;
      }
    }

    return { ok: true, objective_id: obj.id, tasks_created: taskCount };
  });

  // ─── Summon ──────────────────────────────────────────────────────

  let dispatcherTimer: ReturnType<typeof setInterval> | null = null;
  let dispatcherRunning = false;
  const activeJobIds = new Set<string>();
  const activeFiles = new Set<string>();  // File-level lock: prevents concurrent edits to same file
  const MAX_CONCURRENT = 4;

  fastify.post('/api/summon', async () => {
    if (dispatcherTimer) return { ok: true, message: 'Already running.' };

    const db = await getDb();
    if (!db) return { error: 'Kingdom not initialized. Run Init first.' };

    // Get API key — prefer env var, fall back to credential store
    const { getProviderCredential, getConfig: getCfg, TaskRepository, JobRepository } = await import('@kingdomos/core');
    const apiKey = process.env.OPENAI_API_KEY || getProviderCredential(kingdomDir, 'openai', MASTER_PASSWORD);
    if (!apiKey || !apiKey.startsWith('sk-')) return { error: 'No valid OpenAI API key. Set OPENAI_API_KEY env var or save via /api/credentials.' };
    const config = getCfg(basePath);
    const defaultModel = config.tiers?.knight?.model ?? 'gpt-4.1';

    // Resolve workspace path for file context
    const workspacePath = config.workspace_path ?? basePath;

    // Agent template resolver
    const agentTemplatesDir = join(kingdomDir, 'agents');
    const resultsDir = join(kingdomDir, 'results');
    mkdirSync(resultsDir, { recursive: true });

    // Initialize real pipeline components
    const { createOpenAIAdapter } = await import('@kingdomos/providers');
    const { JobPacketAssembler, ReviewEngine, HeartbeatWriter } = await import('@kingdomos/core');
    const { applyDiff } = await import('@kingdomos/blacksmith');
    const { CryptWriter, Logger } = await import('@kingdomos/scribe');

    const taskRepo = new TaskRepository(db);
    const jobRepo = new JobRepository(db);
    const provider = createOpenAIAdapter({ api_key: apiKey, timeout_ms: 300_000 });
    const reviewEngine = new ReviewEngine(db);
    const cryptWriter = new CryptWriter(db);
    const logger = new Logger({ db, console: true });

    const assembler = new JobPacketAssembler(db, taskRepo, {
      projectPath: workspacePath,
      agentTemplatesDir,
      outputDir: resultsDir,
    });

    // Strip markdown code fences that LLMs love to wrap around diffs
    const stripMarkdownFences = (text: string): string => {
      // Remove ```diff ... ``` or ``` ... ``` wrapping
      const fencePattern = /^```(?:diff|patch|unified-diff)?\s*\n([\s\S]*?)\n```\s*$/;
      const match = text.trim().match(fencePattern);
      if (match) return match[1];
      // Also handle multiple fenced blocks (one per file)
      const multiPattern = /```(?:diff|patch|unified-diff)?\s*\n([\s\S]*?)\n```/g;
      let result = '';
      let found = false;
      let m;
      while ((m = multiPattern.exec(text)) !== null) {
        result += m[1] + '\n';
        found = true;
      }
      return found ? result.trim() : text;
    };

    // Normalize LLM diff format quirks before review and application
    const normalizeLLMDiff = (text: string): string => {
      const lines = text.split('\n');
      const out: string[] = [];
      for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        // Strip GNU-style timestamps from --- and +++ lines
        // e.g. "--- packages/foo.ts  2024-06-01 00:00:00..." → "--- a/packages/foo.ts"
        if (line.startsWith('--- ') || line.startsWith('+++ ')) {
          const prefix = line.slice(0, 4); // "--- " or "+++ "
          let path = line.slice(4);
          // Remove trailing timestamp (tab or 2+ spaces followed by date-like pattern)
          path = path.replace(/(?:\t|\s{2,})\d{4}-\d{2}-\d{2}.*$/, '').trim();
          // Ensure a/ or b/ prefix
          if (!path.startsWith('a/') && !path.startsWith('b/') && !path.startsWith('/dev/null')) {
            path = (prefix === '--- ' ? 'a/' : 'b/') + path;
          }
          out.push(prefix + path);
          // If this is a --- line and the next line is NOT a +++ line, insert one
          if (prefix === '--- ' && i + 1 < lines.length && !lines[i + 1].startsWith('+++ ')) {
            const newPath = path.replace(/^a\//, 'b/');
            out.push('+++ ' + newPath);
          }
        } else {
          out.push(line);
        }
      }
      return out.join('\n');
    };

    dispatcherRunning = true;
    activeDispatcher = { stop: () => { dispatcherRunning = false; } };

    const dispatchNext = async () => {
      if (!dispatcherRunning) return;
      const available = MAX_CONCURRENT - activeJobIds.size;
      if (available <= 0) return;

      const queued = db.prepare(`
        SELECT j.id as job_id, j.task_id, j.model, j.token_estimate, j.delegating_supervisor_id,
               t.title, t.description, t.assigned_tier, t.acceptance_criteria,
               t.context_refs, t.type, t.level, t.max_retries, t.retry_count
        FROM jobs j JOIN task_graph_nodes t ON j.task_id = t.id
        WHERE j.status = 'queued'
        ORDER BY j.created_at ASC LIMIT ?
      `).all(available) as Array<{
        job_id: string; task_id: string; model: string; token_estimate: number;
        delegating_supervisor_id: string; title: string; description: string;
        assigned_tier: string; acceptance_criteria: string; context_refs: string;
        type: string; level: string; max_retries: number; retry_count: number;
      }>;

      for (const row of queued) {
        if (activeJobIds.has(row.job_id)) continue;

        // File-level serialization: skip jobs whose target files are being worked on
        const isCodeTask = row.type === 'code' || row.type === 'test';
        let targetFiles: string[] = [];
        if (isCodeTask) {
          try {
            const refs = JSON.parse(row.context_refs || '[]');
            targetFiles = [...new Set((refs as Array<{ file: string }>).map(r => r.file))];
          } catch { /* */ }
        }
        const blocked = targetFiles.some(f => activeFiles.has(f));
        if (blocked) {
          console.log(`[KINGDOM] Job ${row.job_id.slice(-6)} waiting — target file locked by another job`);
          continue; // Skip this job, will retry next cycle
        }

        activeJobIds.add(row.job_id);
        // Lock target files for this job
        for (const f of targetFiles) activeFiles.add(f);

        // Fire and forget — process in background
        processJobPipeline(row, targetFiles).catch(() => {});
      }
    };

    const processJobPipeline = async (row: {
      job_id: string; task_id: string; model: string; token_estimate: number;
      delegating_supervisor_id: string; title: string; description: string;
      assigned_tier: string; acceptance_criteria: string; context_refs: string;
      type: string; level: string; max_retries: number; retry_count: number;
    }, lockedFiles: string[] = []) => {
      const workerId = `worker-${row.job_id.slice(-8)}`;
      const heartbeat = new HeartbeatWriter(db, row.job_id, workerId);

      try {
        // ── Stage 1: Prepare Context ──
        // Get real Job and Task objects
        const job = jobRepo.getById(row.job_id)!;
        const task = taskRepo.getById(row.task_id)!;
        const isRetry = task.status === 'retrying';

        // Transition task through the lifecycle
        if (isRetry) {
          // Retry: retrying → running (skip intermediate states)
          try { taskRepo.updateStatus(row.task_id, 'running'); } catch { /* */ }
          logger.log({ agent_id: row.assigned_tier, event_type: 'task_transition', job_id: row.job_id, task_id: row.task_id, details: { from: 'retrying', to: 'running' } });
        } else {
          // Normal: queued → preparing-context → awaiting-budget-check → running
          try { taskRepo.updateStatus(row.task_id, 'preparing-context'); } catch { /* */ }
          logger.log({ agent_id: row.assigned_tier, event_type: 'task_transition', job_id: row.job_id, task_id: row.task_id, details: { from: 'queued', to: 'preparing-context' } });

          try { taskRepo.updateStatus(row.task_id, 'awaiting-budget-check'); } catch { /* */ }
          logger.log({ agent_id: row.assigned_tier, event_type: 'task_transition', job_id: row.job_id, task_id: row.task_id, details: { from: 'preparing-context', to: 'awaiting-budget-check' } });

          try { taskRepo.updateStatus(row.task_id, 'running'); } catch { /* */ }
          logger.log({ agent_id: row.assigned_tier, event_type: 'task_transition', job_id: row.job_id, task_id: row.task_id, details: { from: 'awaiting-budget-check', to: 'running' } });
        }

        // Assemble packet with real file context from workspace
        const packet = assembler.assembleForJob(job, task);
        const model = row.model || defaultModel;
        packet.model_id = model;
        // Ensure enough output tokens for complete diffs (default 4096 is too low)
        if (packet.max_tokens < 16384) packet.max_tokens = 16384;

        // ── Stage 2: Execute LLM Call ──
        jobRepo.setStarted(row.job_id, workerId);
        heartbeat.start();
        heartbeat.update('healthy', 'Sending request to model...', 0);

        // Check cancellation
        const freshJob = jobRepo.getById(row.job_id);
        if (freshJob?.cancel_requested) {
          jobRepo.updateStatus(row.job_id, 'cancelled');
          taskRepo.updateStatus(row.task_id, 'cancelled');
          return;
        }

        // Call model via provider adapter
        const response = await provider.complete({
          model,
          messages: packet.messages,
          max_tokens: packet.max_tokens,
          temperature: 0.3,
        });

        heartbeat.update('finishing', 'Processing result...', response.total_tokens);

        // Log model invocation
        logger.modelInvocation(row.job_id, row.assigned_tier, {
          model,
          prompt_tokens: response.prompt_tokens,
          completion_tokens: response.completion_tokens,
          total_tokens: response.total_tokens,
          finish_reason: response.finish_reason,
        });

        // Write result file
        const resultPath = join(resultsDir, `${row.job_id}.result.json`);
        writeFileSync(resultPath, JSON.stringify({
          job_id: row.job_id, success: true, content: response.content,
          tokens_used: response.total_tokens, finish_reason: response.finish_reason,
        }, null, 2), 'utf-8');

        // Strip markdown fences from LLM output for code tasks
        const rawContent = response.content;
        let cleanContent = stripMarkdownFences(rawContent);
        // Normalize LLM diff format quirks (timestamps, missing +++ lines, etc.)
        cleanContent = normalizeLLMDiff(cleanContent);
        if (cleanContent !== rawContent) {
          console.log(`[KINGDOM] Normalized diff output for job ${row.job_id.slice(-6)}`);
        }

        // ── Stage 3: Review ──
        let criteria: string[] = [];
        try { criteria = JSON.parse(row.acceptance_criteria); } catch { criteria = [row.title]; }

        // Only run diff-based review for code/test tasks
        const isCodeTask = task.type === 'code' || task.type === 'test';
        let reviewDecision;

        if (isCodeTask) {
          reviewDecision = await reviewEngine.review({
            job: job,
            diffText: cleanContent,
            allowedFiles: task.context_refs.map((r: { file: string }) => r.file),
            acceptanceCriteria: criteria,
          });
        } else {
          // For research/design/review tasks, auto-approve (no diff to check)
          const { generateUlid } = await import('@kingdomos/core');
          reviewDecision = {
            id: generateUlid(),
            job_id: row.job_id,
            reviewer_agent_id: 'judge',
            decision: 'approved' as const,
            rejection_reasons: null,
            scope_check: 'pass' as const,
            format_check: 'pass' as const,
            security_check: 'pass' as const,
            criteria_check: 'pass' as const,
            feedback: null,
            created_at: new Date().toISOString(),
          };
          // Persist the auto-approval
          db.prepare(
            `INSERT INTO review_decisions (id, job_id, reviewer_agent_id, decision, rejection_reasons, scope_check, format_check, security_check, criteria_check, feedback, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(reviewDecision.id, reviewDecision.job_id, reviewDecision.reviewer_agent_id, reviewDecision.decision, null, reviewDecision.scope_check, reviewDecision.format_check, reviewDecision.security_check, reviewDecision.criteria_check, reviewDecision.feedback, reviewDecision.created_at);
        }

        logger.reviewDecision(row.job_id, row.task_id, reviewDecision.decision);

        if (reviewDecision.decision === 'approved') {
          // ── Stage 5: Apply Diff (if code task) ──
          let diffApplied = false;
          if (task.type === 'code' || task.type === 'test') {
            try {
              const applyResult = applyDiff(cleanContent, workspacePath);
              diffApplied = applyResult.success;
              if (applyResult.appliedFiles.length > 0) {
                console.log(`[KINGDOM] Applied diff to: ${applyResult.appliedFiles.join(', ')}`);
              }
              if (applyResult.failedFiles.length > 0) {
                console.log(`[KINGDOM] Failed to apply: ${applyResult.failedFiles.join(', ')} — ${applyResult.errors.join('; ')}`);
              }
            } catch (e) {
              console.log(`[KINGDOM] Diff application skipped: ${e instanceof Error ? e.message : String(e)}`);
            }
          }

          // ── Stage 6: Complete ──
          jobRepo.setCompleted(row.job_id, resultPath, response.total_tokens);
          const completionStatus = diffApplied ? 'completed' : 'completed-with-warnings';
          try { taskRepo.updateStatus(row.task_id, completionStatus); } catch { /* */ }
          logger.log({ agent_id: row.assigned_tier, event_type: 'task_transition', job_id: row.job_id, task_id: row.task_id, details: { from: 'running', to: completionStatus, diff_applied: diffApplied } });

          // ── Stage 7: Crypt Entry ──
          cryptWriter.writeFromTask(
            row.task_id,
            row.title,
            `Completed with ${response.total_tokens} tokens. Review: approved. Diff applied: ${diffApplied}.`,
            true
          );

          console.log(`[KINGDOM] ✓ Job ${row.job_id.slice(-6)} completed: ${row.title.slice(0, 50)} (${response.total_tokens} tokens)`);
        } else {
          // ── Review Rejected → Retry or Escalate ──
          console.log(`[KINGDOM] ✗ Job ${row.job_id.slice(-6)} rejected: ${reviewDecision.rejection_reasons?.join(', ')}`);

          const { RetryManager } = await import('@kingdomos/core');
          const retryMgr = new RetryManager(db);
          const retryResult = retryMgr.handleRejection(reviewDecision);

          logger.log({ agent_id: row.assigned_tier, event_type: retryResult.action === 'retry' ? 'retry' : 'incident', job_id: row.job_id, task_id: row.task_id, details: { action: retryResult.action, reasons: reviewDecision.rejection_reasons } });

          if (retryResult.action === 'escalate') {
            // Write crypt entry for failed task
            cryptWriter.writeFromTask(
              row.task_id,
              row.title,
              `Failed after max retries. Review rejected: ${reviewDecision.rejection_reasons?.join(', ')}`,
              false
            );
          }
        }
      } catch (err) {
        // ── Execution Failure ──
        const msg = err instanceof Error ? err.message : String(err);
        let failType: 'runtime-crash' | 'timeout' | 'token-overflow' = 'runtime-crash';
        if (msg.includes('timeout') || msg.includes('abort')) failType = 'timeout';
        else if (msg.includes('token') || msg.includes('context_length')) failType = 'token-overflow';

        try { jobRepo.setFailed(row.job_id, failType); } catch { /* job may already be in terminal state */ }
        try { taskRepo.updateStatus(row.task_id, `failed-${failType}` as any); } catch { /* task may already be transitioned */ }

        logger.log({ agent_id: row.assigned_tier, event_type: 'incident', job_id: row.job_id, task_id: row.task_id, details: { failure_type: failType, error: msg.slice(0, 200) } });

        // Write crypt entry for failure
        try {
          cryptWriter.writeFromTask(row.task_id, row.title, `Failed: ${failType} — ${msg.slice(0, 200)}`, false);
        } catch { /* */ }

        console.error(`[KINGDOM] ✗ Job ${row.job_id.slice(-6)} failed: ${msg.slice(0, 100)}`);
      } finally {
        heartbeat.stop();
        activeJobIds.delete(row.job_id);
        // Release file locks so next job targeting these files can proceed
        for (const f of lockedFiles) activeFiles.delete(f);
      }
    };

    // Poll every 3 seconds
    dispatcherTimer = setInterval(dispatchNext, 3000);
    dispatchNext(); // Start immediately

    return { ok: true, message: 'Kingdom summoned. Full pipeline dispatcher running.' };
  });

  // ─── Dismiss ─────────────────────────────────────────────────────

  fastify.post('/api/dismiss', async () => {
    if (dispatcherTimer) {
      clearInterval(dispatcherTimer);
      dispatcherTimer = null;
    }
    dispatcherRunning = false;
    activeDispatcher = null;
    return { ok: true, message: 'Dispatcher stopped.' };
  });

  // ─── Job Logs ────────────────────────────────────────────────────

  fastify.get('/api/job-logs', async () => {
    const db = await getDb();
    if (!db) return [];
    return db.prepare(`
      SELECT j.id, j.status, j.model, j.started_at, j.result_path,
             j.tokens_used, j.failure_type,
             t.title, t.assigned_tier
      FROM jobs j JOIN task_graph_nodes t ON j.task_id = t.id
      ORDER BY j.started_at DESC NULLS LAST
      LIMIT 50
    `).all();
  });

  // ─── Status ──────────────────────────────────────────────────────

  fastify.get('/api/status', async () => {
    const { configExists: cfgExists } = await import('@kingdomos/core');
    const initialized = cfgExists(basePath);

    if (!initialized) {
      return { initialized: false, running: false, activeJobs: 0, queuedJobs: 0, completedJobs: 0, failedJobs: 0 };
    }

    try {
      const db = await getDb();
      if (!db) return { initialized: true, running: false, activeJobs: 0, queuedJobs: 0, completedJobs: 0, failedJobs: 0 };
      const counts = db.prepare(
        `SELECT
           SUM(CASE WHEN status IN ('running','streaming') THEN 1 ELSE 0 END) as active,
           SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
           SUM(CASE WHEN status LIKE 'failed%' OR status = 'cancelled' THEN 1 ELSE 0 END) as failed
         FROM jobs`
      ).get() as { active: number; queued: number; completed: number; failed: number } | undefined;

      return {
        initialized: true,
        running: dispatcherRunning,
        activeJobs: counts?.active ?? 0,
        queuedJobs: counts?.queued ?? 0,
        completedJobs: counts?.completed ?? 0,
        failedJobs: counts?.failed ?? 0,
      };
    } catch {
      return { initialized: true, running: dispatcherRunning, activeJobs: 0, queuedJobs: 0, completedJobs: 0, failedJobs: 0 };
    }
  });

  // Serve static assets from dist/ if built
  const distDir = join(import.meta.dirname, '..', 'dist');
  if (existsSync(distDir)) {
    await fastify.register(import('@fastify/static'), {
      root: distDir,
      prefix: '/',
    });
  }

  await fastify.listen({ port, host: '127.0.0.1' });
  return fastify;
}
