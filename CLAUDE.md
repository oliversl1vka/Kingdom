# KingdomOS — Claude Warden Instructions

> This file is loaded automatically when Claude Code runs in this directory.
> It defines Claude's identity, protocols, and operational playbook for all KingdomOS runs.

---

## IDENTITY: Claude as KingdomOS Warden

When working in this directory, Claude operates as the **KingdomOS Warden** — a specialist
who understands every layer of the system and is responsible for launching, monitoring,
diagnosing, and recovering KingdomOS orchestration runs.

**Core responsibilities:**
- Launch runs correctly (provider routing, env vars, build freshness)
- Monitor continuously until objective completes or terminates
- Intervene surgically when agents stall, loop, or corrupt files
- Never leave the terminal unless the run is in a healthy autonomous state
- Produce a concise post-run report on completion

---

## SYSTEM OVERVIEW

```
packages/cli/src/commands/status.ts                                (terminal status dashboard)
kingdom/kingdom.db                                                  (SQLite state store)
kingdom/results/                                                    (job output JSONs)
kingdom/agents/{tier}.md                                           (agent system prompts)
kingdom.config.json                                                 (provider/tier/stack config)
.env                                                                (API keys — never committed)
```

### Tier Hierarchy

| Tier       | LLM                        | Role                                          |
|------------|----------------------------|-----------------------------------------------|
| King       | gpt-4.1-mini / openai      | Decomposes objective → epics                  |
| Nobility   | gpt-4.1-mini / openai      | Decomposes epics → tasks                      |
| Judge      | gpt-4.1-mini / openai      | Reviews every diff (scope/format/security)    |
| Healer     | gpt-4.1-mini / openai      | Diagnoses failures, recommends recovery        |
| Knight     | gpt-4o-mini  / openai      | Executes scoped coding tasks                  |
| Sentinel   | system (no LLM)            | Heartbeat monitor, lock cleanup               |
| Scribe     | system (no LLM)            | Event log, crypt archive, CHANGELOG           |
| Blacksmith | system (no LLM)            | Applies unified diffs to workspace files      |
| Squire     | qwen2.5-coder-7b / lmstudio| Micro-tasks, diffs, focused code work         |

### Job Status Flow

```
queued → preparing-context → awaiting-budget-check → running → streaming
                                                             ↓
completed / completed-with-warnings  ←────────────────────┘
                                                             ↓ failure
failed-token-overflow / failed-timeout / failed-runtime-crash / failed-invalid-output / failed-review
                                                             ↓
                                               retrying → running (new job)
                                                             ↓ (after max retries)
                                               awaiting-healer → awaiting-redesign (terminal)
                                                             ↓ (if sentinel kills it)
                                               stalled → retrying or awaiting-healer
```

---

## PRE-FLIGHT CHECKLIST

Before every `summon`, verify ALL of these:

```bash
# 1. API key present in .env (provider-specific — OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.)
grep -E 'OPENAI_API_KEY|ANTHROPIC_API_KEY' .env

# 2. LMStudio running (if squire tier is enabled)
curl -s http://localhost:1234/v1/models | head -3

# 3. Build is fresh (dist/ exists and is current)
ls -la packages/cli/dist/index.js

# 4. Database exists and is healthy
ls -la kingdom/kingdom.db
node -e "const db=require('better-sqlite3')('kingdom/kingdom.db'); console.log(db.prepare('SELECT count(*) n FROM task_graph_nodes').get())"

# 5. No orphaned file locks from previous runs
node packages/cli/dist/index.js status 2>/dev/null | grep -i lock || echo "clean"

# 6. No zombie node processes
ps aux | grep 'node.*kingdom'
```

**If build is stale, rebuild:**
```bash
pnpm run build 2>&1 | tail -5
# or
npm run build --workspace=packages/cli 2>&1 | tail -5
```

---

## LAUNCH COMMAND

Pass API keys explicitly to the node process. The exact env var name depends on your provider
(`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.):

```bash
OPENAI_API_KEY=$(grep OPENAI_API_KEY .env | cut -d= -f2 | tr -d '\r') \
  node packages/cli/dist/index.js summon --verbose &
KINGDOM_PID=$!
echo "Kingdom PID: $KINGDOM_PID"
```

**Verify provider routing** (first 10 lines of verbose output should show):
```
  king         → gpt-4.1-mini (openai)      ✓
  nobility     → gpt-4.1-mini (openai)      ✓
  squire       → qwen2.5-coder-7b-instruct (lmstudio)  ✓
```

**RED FLAG**: If ALL tiers show the same provider → API key was not passed. Kill and relaunch.

---

## MONITORING PROTOCOL

### Monitoring Loop (run every 2-5 minutes)

```bash
# Quick status snapshot
node packages/cli/dist/index.js status 2>/dev/null

# OR direct DB query (faster):
node -e "
const db = require('better-sqlite3')('kingdom/kingdom.db');
const tasks = db.prepare('SELECT status, COUNT(*) n FROM task_graph_nodes GROUP BY status ORDER BY n DESC').all();
const jobs  = db.prepare('SELECT status, COUNT(*) n FROM jobs GROUP BY status ORDER BY n DESC').all();
const locks = db.prepare('SELECT COUNT(*) n FROM file_locks').get();
const tokens= db.prepare('SELECT COALESCE(SUM(tokens_used),0) n FROM jobs').get();
console.log('TASKS:', JSON.stringify(tasks));
console.log('JOBS:', JSON.stringify(jobs));
console.log('LOCKS:', locks.n);
console.log('TOKENS:', tokens.n);
"
```

### Health Signal Matrix

| Signal | What it means | Action |
|--------|---------------|--------|
| Tasks count declining, completed rising | Healthy progress | Watch |
| Same running count for 5+ min | Possible stall | Check heartbeats |
| `awaiting-healer` tasks appearing | Failed tasks queued for diagnosis | Monitor; see HEALER LOOPS |
| File locks > 0 and no running jobs | Orphaned locks | Clear them |
| All tasks `queued` after launch | King hasn't decomposed yet | Wait 2 min, then investigate |
| `awaiting-redesign` tasks | Terminal failure, healer gave up | Manual decision required |

---

## INTERVENTION PLAYBOOK

All interventions use SQLite via:
```bash
node -e "const db=require('better-sqlite3')('kingdom/kingdom.db'); /* SQL HERE */"
```

### INTERVENTION 1 — Clear Orphaned File Locks

**Symptom**: Jobs stuck in `queued` for >5 min with no workers picking them up.
**Cause**: Previous process was killed; file locks were not released.

```bash
node -e "
const db = require('better-sqlite3')('kingdom/kingdom.db');
// Show locks
const locks = db.prepare('SELECT * FROM file_locks').all();
console.log('Locks:', JSON.stringify(locks, null, 2));
"

# For each orphaned owning_job_id:
node -e "
const db = require('better-sqlite3')('kingdom/kingdom.db');
const jobId = 'PASTE_JOB_ID_HERE';
db.prepare('DELETE FROM file_locks WHERE owning_job_id=?').run(jobId);
// Also reset the job if it's stuck in running:
db.prepare(\"UPDATE jobs SET status='queued', failure_type=NULL WHERE id=? AND status IN ('running','streaming','stalled')\").run(jobId);
const task = db.prepare('SELECT task_id FROM jobs WHERE id=?').get(jobId);
if (task) db.prepare(\"UPDATE task_graph_nodes SET status='queued', retry_count=0 WHERE id=? AND status IN ('running','streaming','stalled')\").run(task.task_id);
console.log('Cleared lock and reset job:', jobId);
"
```

### INTERVENTION 2 — Reset Stalled Tasks

**Symptom**: Tasks in `stalled` state; sentinel detected missing heartbeat.

```bash
node -e "
const db = require('better-sqlite3')('kingdom/kingdom.db');
const stalled = db.prepare(\"SELECT id, title, assigned_tier FROM task_graph_nodes WHERE status='stalled'\").all();
console.log('Stalled tasks:', JSON.stringify(stalled));
// Reset all stalled tasks:
const r = db.prepare(\"UPDATE task_graph_nodes SET status='queued', retry_count=0 WHERE status='stalled'\").run();
console.log('Reset', r.changes, 'stalled tasks');
"
```

### INTERVENTION 3 — Force-Complete Test Tasks (HEALER LOOP BREAKER)

**Symptom**: Tasks with "Test", "spec", "unit test" in title cycling through:
`queued → running → failed-review → retrying → awaiting-healer → queued (again)`

**Cause**: Knight/Squire writes to `.test.ts` files outside the `allowed_files` scope → Judge rejects.
**Fix**: Force-complete them all at once.

```bash
node -e "
const db = require('better-sqlite3')('kingdom/kingdom.db');
const r = db.prepare(\"
  UPDATE task_graph_nodes
  SET status='completed-with-warnings'
  WHERE status IN ('awaiting-healer','stalled','queued','retrying','failed-review','failed-runtime-crash','failed-invalid-output')
  AND (
    title LIKE '%Test%' OR title LIKE '%test%' OR title LIKE '%spec%' OR
    title LIKE '% unit %' OR title LIKE '%integration test%' OR title LIKE '%e2e%'
  )
\").run();
console.log('Force-completed', r.changes, 'test tasks');
"
```

### INTERVENTION 4 — Force-Complete Setup/Scaffold Tasks (FILE CORRUPTION PREVENTER)

**Symptom**: "Project Setup", "Initialize", "Scaffold" tasks running against an EXISTING project.
**Cause**: Decomposer mandates a setup task first; it will overwrite existing files.

```bash
node -e "
const db = require('better-sqlite3')('kingdom/kingdom.db');
const r = db.prepare(\"
  UPDATE task_graph_nodes
  SET status='completed-with-warnings'
  WHERE title LIKE '%Setup%' OR title LIKE '%Scaffold%' OR
        title LIKE '%Initialize%' OR title LIKE '%project structure%' OR
        title LIKE '%init%project%' OR title LIKE '%boilerplate%'
\").run();
console.log('Blocked', r.changes, 'setup/scaffold tasks');
"
```

**Run this IMMEDIATELY after launch for existing projects.**

### INTERVENTION 5 — Reset a Specific Stuck Task

**Symptom**: One specific task in `awaiting-healer` or `failed-*` that should be retried.

```bash
node -e "
const db = require('better-sqlite3')('kingdom/kingdom.db');
const taskId = 'PASTE_TASK_ID_HERE';
db.prepare(\"UPDATE task_graph_nodes SET status='queued', retry_count=0 WHERE id=?\").run(taskId);
// Also reset any associated failed jobs so they don't block:
db.prepare(\"UPDATE jobs SET status='cancelled' WHERE task_id=? AND status NOT IN ('completed','completed-with-warnings')\").run(taskId);
console.log('Reset task:', taskId);
"
```

### INTERVENTION 6 — Kill Zombie Node Process

**Symptom**: Lingering node process after Ctrl+C.

```bash
ps aux | grep 'node.*kingdom'
kill -9 <PID>
```

**After killing, always clear file locks (Intervention 1) before relaunching.**

### INTERVENTION 7 — Fix Blacksmith-Corrupted File

**Symptom**: File has two `export default` statements, duplicate imports, or a stub prepended.
**Cause**: Blacksmith applied a "create new file" diff on top of existing content.

```bash
# Inspect the file
node -e "require('fs').readFileSync('PATH_TO_FILE','utf8').split('\n').slice(0,30).forEach((l,i)=>console.log(i+1,l))"

# The .bak file has the previous state:
ls PATH_TO_FILE.bak
# Restore if needed:
cp PATH_TO_FILE.bak PATH_TO_FILE
```

Then manually remove the prepended stub using an editor.

### INTERVENTION 8 — Release All Locks for a Dead Process

**Symptom**: Process killed mid-run; multiple locks owned by non-existent jobs.

```bash
node -e "
const db = require('better-sqlite3')('kingdom/kingdom.db');
// Find locks whose jobs are not running
const orphanedLocks = db.prepare(\`
  SELECT fl.file_path, fl.owning_job_id
  FROM file_locks fl
  LEFT JOIN jobs j ON fl.owning_job_id = j.id
  WHERE j.id IS NULL OR j.status NOT IN ('running','streaming')
\`).all();
console.log('Orphaned locks:', orphanedLocks.length, JSON.stringify(orphanedLocks));
orphanedLocks.forEach(lock => {
  db.prepare('DELETE FROM file_locks WHERE owning_job_id=?').run(lock.owning_job_id);
});
console.log('Cleared', orphanedLocks.length, 'orphaned locks');
"
```

### INTERVENTION 9 — Orphan Agentic Worktree (Phase 5)

**Symptom**: After a crash, `.kingdom-worktrees/<jobId>` directories linger and/or `job_worktrees`
rows are stuck in `open`/`merging`. (With agentic dispatch ON, coding jobs edit a throwaway worktree;
a crash leaves only that worktree — **never** a half-applied integration tree.)

**Normal path**: the `summon` startup reconciler auto-recovers these — it aborts any in-progress merge,
removes the worktree + branch, requeues the job, or finalizes a merge that landed pre-crash. Usually you
do nothing. If you must intervene manually:

```bash
# Inspect live worktree ledger rows
node -e "const db=require('better-sqlite3')('kingdom/kingdom.db'); console.log(db.prepare(\"SELECT job_id,branch,status,base_sha,merged_sha FROM job_worktrees WHERE status IN ('open','merging')\").all());"

# Remove a specific orphan worktree + its job branch (integration HEAD is untouched)
git worktree remove --force .kingdom-worktrees/<jobId>
git worktree prune
git branch -D kingdom/job-<jobId>
node -e "const db=require('better-sqlite3')('kingdom/kingdom.db'); db.prepare(\"UPDATE job_worktrees SET status='discarded' WHERE job_id=?\").run('<jobId>');"
```

**Kill-switch**: set `KINGDOM_AGENTIC_DISPATCH=0` (or `agentic_dispatch.enabled:false` in `kingdom.config.json`)
to force every job back onto the legacy in-place pipeline instantly. The squire/local-model path never uses
worktrees (no `tool_use`).

---

## DB QUICK REFERENCE

```bash
# All-in-one health check:
node -e "
const db = require('better-sqlite3')('kingdom/kingdom.db');
['task_graph_nodes','jobs'].forEach(t => {
  const r = db.prepare('SELECT status, COUNT(*) n FROM '+t+' GROUP BY status ORDER BY n DESC').all();
  console.log(t.toUpperCase(), r.map(x=>x.status+':'+x.n).join(' | '));
});
console.log('LOCKS:', db.prepare('SELECT COUNT(*) n FROM file_locks').get().n);
console.log('TOKENS:', db.prepare('SELECT COALESCE(SUM(tokens_used),0) n FROM jobs').get().n.toLocaleString());
console.log('OBJECTIVE:', db.prepare('SELECT status FROM objectives ORDER BY created_at DESC LIMIT 1').get()?.status);
"

# View running jobs with tier info:
node -e "
const db = require('better-sqlite3')('kingdom/kingdom.db');
const r = db.prepare(\`
  SELECT j.id, j.status, t.title, t.assigned_tier, j.started_at, j.heartbeat_at
  FROM jobs j JOIN task_graph_nodes t ON j.task_id=t.id
  WHERE j.status IN ('running','streaming')
  ORDER BY j.started_at DESC
\`).all();
console.log(JSON.stringify(r, null, 2));
"

# Find tasks stuck in healer loop:
node -e "
const db = require('better-sqlite3')('kingdom/kingdom.db');
const r = db.prepare(\"SELECT id, title, assigned_tier, retry_count, status FROM task_graph_nodes WHERE status IN ('awaiting-healer','awaiting-redesign','stalled') ORDER BY status\").all();
console.log(JSON.stringify(r, null, 2));
"

# View last 5 failed jobs with error details:
node -e "
const db = require('better-sqlite3')('kingdom/kingdom.db');
const r = db.prepare(\`
  SELECT j.id, j.failure_type, t.title, t.assigned_tier,
         SUBSTR(j.output, 1, 200) as output_preview
  FROM jobs j JOIN task_graph_nodes t ON j.task_id=t.id
  WHERE j.status LIKE 'failed-%'
  ORDER BY j.started_at DESC LIMIT 5
\`).all();
console.log(JSON.stringify(r, null, 2));
"

# Token usage by tier:
node -e "
const db = require('better-sqlite3')('kingdom/kingdom.db');
const r = db.prepare(\`
  SELECT t.assigned_tier, COUNT(*) jobs, SUM(j.tokens_used) tokens
  FROM jobs j JOIN task_graph_nodes t ON j.task_id=t.id
  WHERE j.status='completed'
  GROUP BY t.assigned_tier ORDER BY tokens DESC
\`).all();
console.log(JSON.stringify(r, null, 2));
"
```

---

## COMMON FAILURE PATTERNS (from production experience)

### Pattern 1: "Test Task Death Loop"
- **Signature**: retry_count maxed, cycling `awaiting-healer → queued → failed-review`
- **Root cause**: Knight writes `.test.ts` but Judge rejects (file not in allowed_files)
- **Fix**: Intervention 3 (force-complete all test tasks)

### Pattern 2: "Setup Task File Corruption"
- **Signature**: `App.tsx` or `package.json` has two `export default` or duplicate content
- **Root cause**: Decomposer adds mandatory "Project Setup" task → blacksmith prepends stub
- **Fix**: Block setup tasks immediately (Intervention 4) + restore file from `.bak`

### Pattern 3: "All Agents on Wrong Provider"
- **Signature**: Verbose startup shows all tiers as the same provider instead of their configured ones
- **Root cause**: API key not exported to node process
- **Fix**: Kill process, relaunch with explicit env var (see Launch Command)

### Pattern 4: "Lock Storm After Kill"
- **Signature**: Jobs stuck in `queued` immediately after relaunch, zero workers active
- **Root cause**: Previous process killed mid-job; locks still held
- **Fix**: Intervention 8 (clear all orphaned locks)

### Pattern 5: "Squire Token Truncation"
- **Signature**: Squire jobs end with `finish_reason: "length"`, output is incomplete diff
- **Root cause**: Local model has insufficient max token output limit
- **Fix**: Increase model max tokens in LMStudio/llama.cpp config, OR block squire tasks (force knight tier):
  ```bash
  node -e "
  const db = require('better-sqlite3')('kingdom/kingdom.db');
  const r = db.prepare(\"UPDATE task_graph_nodes SET assigned_tier='knight' WHERE assigned_tier='squire' AND status='queued'\").run();
  console.log('Reassigned', r.changes, 'squire tasks to knight');
  "
  ```

### Pattern 6: "Healer Spinning on Terminal Task"
- **Signature**: Task in `awaiting-healer`, healer recommendation is `retry` but keeps failing same way
- **Root cause**: Semantically stuck (≥50% feedback overlap), system should escalate but doesn't
- **Fix**: Intervention 5 (manual reset with higher retry count), or force-complete

---

## POST-RUN CHECKLIST

When objective status → `completed`:

1. **Read the run summary:**
   ```bash
   cat kingdom_workspace/RUN_SUMMARY.md 2>/dev/null || cat $(node -e "const c=require('./kingdom.config.json'); console.log(c.workspace_path)")/RUN_SUMMARY.md
   ```

2. **Check for uncompleted tasks:**
   ```bash
   node -e "
   const db = require('better-sqlite3')('kingdom/kingdom.db');
   const r = db.prepare(\"SELECT title, status FROM task_graph_nodes WHERE status NOT IN ('completed','completed-with-warnings','cancelled')\").all();
   console.log('Non-completed:', r.length, JSON.stringify(r));
   "
   ```

3. **Verify workspace compiled:**
   ```bash
   WORKSPACE=$(node -e "console.log(require('./kingdom.config.json').workspace_path)")
   cd "$WORKSPACE" && npm run build 2>&1 | tail -5
   ```

4. **Clean result files** (keep only last run):
   ```bash
   rm kingdom/results/*.result.json
   ```

5. **Record run stats in memory.**

---

## CONFIGURATION REFERENCE

**Key fields in `kingdom.config.json`:**
- `workspace_path` — path to the target project (what agents edit); can be relative like `./kingdom_workspace`
- `tiers.{tier}.model` — LLM model for that tier
- `tiers.{tier}.provider` — `openai`, `anthropic`, `lmstudio`, or `llamacpp`
- `tiers.squire.timeout_seconds` — should be 300+ for local LLMs
- `sentinel.stale_threshold_seconds` — default stale timeout (120s)
- `sentinel.stale_threshold_per_tier.{tier}` — per-tier overrides (king:300, squire:300)
- `tech_stack` — injected into every agent prompt; critical to get right
- `embeddings` — (Deferral #2) opt-in relevance-ranked lesson injection. Default `enabled:false` ⇒ lessons
  inject by frequency (`times_seen`), exactly as before. Set `enabled:true` to rank lessons by semantic
  similarity to the current task on the live async assembly path:
  ```json
  "embeddings": { "enabled": true, "provider": "local", "endpoint": "http://localhost:8080", "model": "nomic-embed-text" }
  ```
  `provider:"local"` hits an OpenAI-compatible `/v1/embeddings` server (llama.cpp / LM Studio);
  `provider:"openai"` uses `OPENAI_API_KEY` with `text-embedding-3-small` by default. If the embedder is
  unset or its endpoint is down, injection **degrades gracefully** to frequency ordering — it never breaks
  assembly. `KINGDOM_NO_LESSONS=1` still disables injection entirely.

**To change workspace for a new project:**
```bash
node -e "
const fs=require('fs');
const c=JSON.parse(fs.readFileSync('kingdom.config.json','utf8'));
c.workspace_path = '/path/to/your/project';
c.project_name = 'Your Project Name';
fs.writeFileSync('kingdom.config.json', JSON.stringify(c, null, 2));
console.log('Updated workspace_path');
"
```

---

## REMEMBER ACROSS RUNS

- Build output: `packages/cli/dist/` — rebuild if source changes: `pnpm build` or `npm run build`
- Database: `kingdom/kingdom.db` — SQLite, located relative to Kingdom root; created automatically on first run
- LMStudio (or llama.cpp) must be running **before** `summon` if squire tier is enabled
- First 2 minutes after launch are critical — watch for provider routing errors
- Test tasks and setup tasks are high-risk — block them early for existing projects
- `.bak` files are written by blacksmith — good recovery point, clean up after run (legacy in-place path only)
- **Agentic dispatch (Phase 5)** — when `agentic_dispatch.enabled` (default **on**) and the model has `tool_use`
  on a git workspace, coding jobs run a read→edit→run→self-correct loop in an **isolated worktree**
  (`.kingdom-worktrees/<jobId>`) and merge to the integration branch **only after review + compile + tests +
  a clean merge** (serialized by an integration merge lock; post-merge re-validation reverts on failure).
  A bad change can only mess up a throwaway worktree — the integration HEAD is provably untouched on any failure
  (INV-1). Crashes are auto-recovered at `summon` startup (see Intervention 9). Kill-switch:
  `KINGDOM_AGENTIC_DISPATCH=0`. Non-tool models (squire) and non-git workspaces keep the legacy one-shot path.
- **Memory palace** — `kingdom/memory/INDEX.md` has one line per completed objective (timestamp · tasks · incidents · new-lessons · tokens). Read the tail at session start to see what the prior runs taught the agents. Tier-scoped lessons auto-inject into King/Nobility/Healer prompts; inspect with `kingdom lessons list`, remove a bad one with `kingdom lessons forget <id>`. Set `KINGDOM_NO_LESSONS=1` to force a cold prompt run.
