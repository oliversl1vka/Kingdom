# Clean-Room KingdomOS Run

Restart from zero — kill everything, wipe state, launch fresh, watch live.

## 1. Kill everything

```bash
cd /Users/oliver/projects/Kingdom

# Kill any lingering summon process
pkill -f "node.*summon" 2>/dev/null; sleep 1

# Kill any orphaned node processes
ps aux | grep 'node.*kingdom' | grep -v grep | awk '{print $2}' | xargs kill -9 2>/dev/null
```

## 2. Wipe state

```bash
# Reset the database to factory state (keeps schema, drops data)
node scripts/reset-kingdom.mjs

# Clean up leftover agentic worktrees
rm -rf kingdom_workspace/.kingdom-worktrees/* 2>/dev/null
git worktree prune 2>/dev/null

# Clean up leftover job branches
git branch | grep 'kingdom/job-' | xargs git branch -D 2>/dev/null

# Remove old result files
rm -f kingdom/results/*.result.json 2>/dev/null

# Ensure test workspace exists
mkdir -p kingdom_workspace
echo '{"name":"test-project","version":"1.0.0","private":true}' > kingdom_workspace/package.json
```

## 3. Verify pre-flight

```bash
# API key present
grep -q OPENAI_API_KEY .env && echo "✓ API key" || echo "✗ MISSING API KEY"

# Build fresh
npx tsc --build 2>&1 | tail -1

# Tests
npx vitest run 2>&1 | grep -E "PASS|FAIL"

# DB exists and is empty
node -e "const db=require('better-sqlite3')('kingdom/kingdom.db'); console.log('tasks:',db.prepare('SELECT COUNT(*) c FROM task_graph_nodes').get().c,'jobs:',db.prepare('SELECT COUNT(*) c FROM jobs').get().c)"

# All providers OpenAI (no local models needed)
node -e "const j=JSON.parse(require('fs').readFileSync('kingdom.config.json','utf8')); Object.entries(j.tiers).forEach(([t,v])=>console.log(t,'→',v.provider,v.model))"

# Insert a test project so decree works
node -e "
const db=require('better-sqlite3')('kingdom/kingdom.db');
const {generateUlid}=require('./packages/core/dist/ulid.js');
if(db.prepare('SELECT COUNT(*) c FROM projects WHERE active=1').get().c===0){
  db.prepare('INSERT INTO projects(id,name,description,repository_path,active,created_at,updated_at) VALUES(?,?,?,?,1,?,?)')
    .run(generateUlid(),'Test Project','Dashboard demo project','./kingdom_workspace',new Date().toISOString(),new Date().toISOString());
  console.log('✓ Project inserted');
} else { console.log('✓ Project exists'); }
"
```

## 4. Issue a modest test decree

```bash
OPENAI_API_KEY=$(grep OPENAI_API_KEY .env | cut -d= -f2 | tr -d '\r') \
  node packages/cli/dist/index.js decree --priority 5 \
  "Create a hello.ts file that exports a greet(name: string): string function returning 'Hello, {name}!'"
```

Expected output: `The decree hath been issued: ...`

## 5. Launch summon (Terminal 1)

```bash
cd /Users/oliver/projects/Kingdom
OPENAI_API_KEY=$(grep OPENAI_API_KEY .env | cut -d= -f2 | tr -d '\r') \
  node packages/cli/dist/index.js summon --verbose
```

Let this run. You'll see:
```
  king         → gpt-4.1-mini (openai)      ✓
  nobility     → gpt-4.1-mini (openai)      ✓
  squire       → gpt-4o-mini (openai)       ✓
  ...
✓ Kingdom awakened. All 9 agents standing ready. 8 workers deployed.
```

## 6. Watch live dashboard (Terminal 2)

```bash
cd /Users/oliver/projects/Kingdom
OPENAI_API_KEY=$(grep OPENAI_API_KEY .env | cut -d= -f2 | tr -d '\r') \
  node packages/cli/dist/index.js dashboard
```

### What you'll see

The XL 3-column layout refreshes every few seconds:

```
KINGDOMOS  XL                              uptime 00:02:15    tokens 14,201
───────────────────────────────────────────────────────────────
┌──────────────────────┐ ┌─────────────────────────────────┐ ┌──────────────────────┐
│ AGENTS               │ │     braille portrait (65×46)    │ │ DETAILS              │
│                      │ │     shaded per-cell luminance   │ │                      │
│ ▌KING     DECOMPOSING│ │         ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿    │ │ Status   RUNNING     │
│   decompose 100%     │ │         ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿    │ │ Progress ██████ 45%  │
│                      │ │                                 │ │ tasks   3/7          │
│ ▌NOBILITY PLANNING   │ │                                 │ │ elapsed 47s          │
│   planning    66%    │ │                                 │ │ Stuck   0 at-risk    │
│                      │ │                                 │ │ Verdict ▲ NEEDS ATT… │
│ ▌JUDGE    REVIEWING  │ │                                 │ │                      │
│   reviewing  65%     │ │                                 │ │                      │
│                      │ │                                 │ │                      │
│ ▌KNIGHT   FORGING    │ │                                 │ │                      │
│   forging    72%     │ │                                 │ │                      │
│                      │ │                                 │ │                      │
│ ▌SQUIRE   FORGING    │ │                                 │ │                      │
│   forging    45%     │ │                                 │ │                      │
│                      │ │                                 │ │                      │
│ ▌BLACKSMITH APPLYING │ │                                 │ │                      │
│   applying   88%     │ │                                 │ │                      │
│                      │ │                                 │ │                      │
│ ▌SCRIBE   ARCHIVING  │ │                                 │ │                      │
│   archiving  95%     │ │                                 │ │                      │
│                      │ │                                 │ │                      │
│ ▌SENTINEL WATCHING   │ │                                 │ │                      │
│   watching  100%     │ │                                 │ │                      │
│                      │ │                                 │ │                      │
│ ▌HEALER   DIAGNOSING │ │                                 │ │                      │
│   diagnosing 40%     │ │                                 │ │                      │
└──────────────────────┘ └─────────────────────────────────┘ └──────────────────────┘
```

**Left column**: 9 agents with state, progress bar, and completion %. States cycle through:
- `IDLE` → `QUEUED` → `DECOMPOSING/PLANNING/FORGING/MICRO-FORGING/APPLYING/REVIEWING/ARCHIVING/WATCHING/DIAGNOSING` → `DONE`

**Center column**: Shaded braille portrait of the currently-selected tier. Press `j`/`k` to cycle between tiers. The portrait changes to match — each tier has a distinct oil-painting-style character rendered in braille glyphs with per-cell luminance shading.

**Right column (DETAILS)**: Shows the selected tier's role, model, provider, task counts (done/total), elapsed time on current job, stuck-at-risk count, and verdict:
- `ok` — everything healthy
- `▲ NEEDS ATTENTION` — stuck tasks or stale heartbeat
- `CRITICAL` — tasks in awaiting-redesign or needs-human

**Global header**: Uptime counter, total tokens consumed, diff acceptance rate, overall health.

## 7. What happens in a healthy run

1. **King** decomposes the decree into epics (1 task, ~30s)
2. **Nobility** breaks each epic into implementable tasks (2-4 tasks, ~60s)
3. **Knight** or **Squire** picks up coding tasks one at a time:
   - Opens an isolated git worktree
   - Reads existing files, writes changes
   - Self-reviews, runs build/typecheck
   - Merges back to integration branch
4. **Judge** reviews every diff (scope check, format, security)
5. **Blacksmith** applies approved diffs to workspace files
6. **Scribe** logs everything to the crypt archive
7. **Sentinel** monitors heartbeats, cleans up stale locks
8. **Healer** diagnoses failures, recommends retry or escalation

The whole decree (a single hello.ts file) should complete in **2-5 minutes** on gpt-4o-mini.

## 8. If things go wrong

### Task stuck in `awaiting-redesign` or `awaiting-healer`
The healer gave up — manual intervention needed:
```bash
node -e "
const db=require('better-sqlite3')('kingdom/kingdom.db');
db.prepare(\"UPDATE task_graph_nodes SET status='completed-with-warnings' WHERE status IN ('awaiting-redesign','awaiting-healer','stalled','needs-human')\").run();
console.log('Force-completed terminal tasks');
"
```

### Orphaned file locks blocking dispatch
```bash
node -e "
const db=require('better-sqlite3')('kingdom/kingdom.db');
db.prepare('DELETE FROM file_locks').run();
console.log('Cleared all file locks');
"
```

### Stale agentic worktrees
```bash
rm -rf kingdom_workspace/.kingdom-worktrees/*
git worktree prune
git branch | grep 'kingdom/job-' | xargs git branch -D 2>/dev/null
```

### Provider routing wrong
If all tiers show the same provider, the API key wasn't passed:
```bash
# Kill, relaunch with explicit env var
OPENAI_API_KEY=$(grep OPENAI_API_KEY .env | cut -d= -f2 | tr -d '\r') \
  node packages/cli/dist/index.js summon --verbose
```

### Need to restart from scratch
Go back to step 1.

## 9. After the run

```bash
# Check what was produced
cat kingdom_workspace/hello.ts

# See run summary
node -e "
const db=require('better-sqlite3')('kingdom/kingdom.db');
const tiers=['king','nobility','judge','knight','squire','blacksmith','scribe','sentinel','healer'];
for(const t of tiers){
  const c=db.prepare(\"SELECT status,COUNT(*) n FROM task_graph_nodes WHERE assigned_tier=? AND status NOT IN ('superseded','cancelled') GROUP BY status\").all(t);
  const done=(c.find(r=>r.status==='completed')?.n??0)+(c.find(r=>r.status==='completed-with-warnings')?.n??0);
  const total=c.reduce((s,r)=>s+r.n,0);
  console.log(t, done+'/'+total, c.map(r=>r.status+':'+r.n).join(' '));
}
const tokens=db.prepare('SELECT COALESCE(SUM(tokens_used),0) n FROM jobs').get();
console.log('Total tokens:', tokens.n.toLocaleString());
"
```

## Current config (all OpenAI, no local models)

```
king       → openai  gpt-4.1-mini
nobility   → openai  gpt-4.1-mini
judge      → openai  gpt-4.1-mini
healer     → openai  gpt-4.1-mini
knight     → openai  gpt-4o-mini
sentinel   → openai  gpt-4o-mini
scribe     → openai  gpt-4o-mini
blacksmith → openai  gpt-4o-mini
squire     → openai  gpt-4o-mini
```

llamacpp and lmstudio providers are disabled. No local models run.
