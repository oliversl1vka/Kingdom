Run a full KingdomOS babysit session for the current run. This is the primary command for supervising an orchestration run from start to finish.

Perform the following steps in order:

## STEP 1 — ASSESS CURRENT STATE

Run the all-in-one health check DB query from CLAUDE.md. Determine which of these states we are in:
- **Not started**: No recent run in DB
- **Just launched**: King decomposing, few tasks queued
- **Running healthy**: Tasks actively completing
- **Running with issues**: Stalls, healer loops, lock contention, diff failures
- **Stalled/dead**: No heartbeats, process may be gone
- **Completed**: Objective marked completed

Report the state clearly with counts.

## STEP 2 — TRIAGE ALL ACTIVE ISSUES

Check for each of these and report status (OK / ISSUE):
1. Provider routing: All tiers routing to correct provider?
2. Orphaned file locks: Any locks whose owning jobs are not running?
3. Test task loops: Any test tasks in awaiting-healer or retrying repeatedly?
4. Setup tasks: Any setup/scaffold tasks running against existing project?
5. Stalled tasks: Any tasks stuck in `stalled` or `awaiting-healer`?
6. Zombie process: Is the node process actually alive?
7. Diff success rate: Run this query — if failure rate > 50%, flag it:
   ```
   node -e "
   const db = require('better-sqlite3')('kingdom/kingdom.db');
   const r = db.prepare(\"SELECT failure_type, COUNT(*) n FROM jobs WHERE failure_type IS NOT NULL GROUP BY failure_type\").all();
   const applied = db.prepare(\"SELECT COUNT(*) n FROM jobs WHERE status='completed'\").get();
   console.log('Completed:', applied.n, 'Failures by type:', JSON.stringify(r));
   "
   ```
8. Last-subtask bottleneck: Check for parent tasks where all-but-one subtask is complete but the last one is cycling in retrying/awaiting-healer. These are the tasks that will block the parent's completion signal. Force-complete the stuck subtask if it's a test, benchmark, or UI-only subtask.

## STEP 3 — APPLY SAFE AUTOMATIC FIXES

Without asking for confirmation, apply these fixes if issues found:
- Clear orphaned file locks (Intervention 8 from CLAUDE.md)
- Force-complete looping test tasks (Intervention 3)
- Force-complete setup/scaffold tasks if workspace already has code (Intervention 4)
- Reset legitimately stalled tasks (Intervention 2)

Report each fix applied.

## STEP 4 — MONITOR LOOP

If run is active: check status every 3 minutes for up to 60 minutes.
At each check:
- Report task completion progress (X/Y completed)
- Report token usage and rough cost estimate (gpt-4.1-mini: $0.40/$1.60 per 1M, gpt-4o-mini: $0.15/$0.60 per 1M)
- Flag any new issues
- Apply interventions as needed
- If diff failure rate is rising: check whether the same files are being targeted by multiple concurrent tasks. If so, those tasks are competing — consider serializing them manually (Intervention 5).

If run completes: jump to Step 5.
If run has been idle for 10+ minutes with no progress: investigate and report.

## STEP 5 — POST-RUN VERIFICATION

When objective status → `completed`:

1. **Stats**: Run duration, task completion rate, total tokens, estimated cost.

2. **Workspace build verification** (critical — do NOT skip):
   ```bash
   WORKSPACE=$(node -e "console.log(require('./kingdom.config.json').workspace_path)")
   cd "$WORKSPACE" && npm run build 2>&1 | tail -10
   ```
   If build fails: identify which files are broken. Check if `.bak` files can restore them.
   Report which tasks to re-run or manually fix.

3. **Stuck tasks**: List any tasks not in completed/completed-with-warnings/cancelled. Flag which are test tasks (low priority) vs functional tasks (need attention).

4. **Files changed**: Count of modified files in workspace.

5. **Recommendation**: Next steps — which incomplete tasks are safe to ignore (tests/benchmarks), which need a targeted follow-up run or manual fix.
