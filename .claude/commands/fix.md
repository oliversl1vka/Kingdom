Identify and automatically fix all current issues in the KingdomOS run without requiring confirmation for safe operations.

Perform all checks and fixes in this exact order:

## FIX 1 — Orphaned File Locks
Query for locks whose owning job is not in running/streaming status.
Delete all orphaned locks. Report count cleared.

## FIX 2 — Blocked Queue (jobs stuck in queued with zero workers)
Check if jobs have been in `queued` for more than 5 minutes with zero running jobs.
If so, verify locks are clear and reset stalled task_graph_nodes to queued.

## FIX 3 — Test Task Healer Loops
Force-complete all tasks matching: title LIKE '%Test%', '%test%', '%spec%', '%unit %', '%e2e%', '%integration test%'
that are in status: awaiting-healer, stalled, retrying, failed-review, failed-invalid-output, queued (with retry_count > 1)
Report count force-completed.

## FIX 4 — Setup/Scaffold Task Suppression
Check if workspace_path from kingdom.config.json already has source files (package.json exists).
If yes, force-complete all tasks matching: title LIKE '%Setup%', '%Scaffold%', '%Initialize%', '%project structure%', '%boilerplate%', '%init project%'
Report count suppressed.

## FIX 5 — Stalled Task Reset
Reset all tasks in `stalled` status to `queued` with retry_count=0.
Report count reset.

## FIX 6 — Awaiting-Redesign Recovery (MANUAL — ask before doing this)
List any tasks in `awaiting-redesign` (terminal failure state).
Ask the user whether to force-complete or skip them.

## FIX 7 — Workspace Build Verification and .bak Recovery
Run the workspace build command to check if the current state compiles:
```bash
WORKSPACE=$(node -e "console.log(require('./kingdom.config.json').workspace_path)")
cd "$WORKSPACE" && npm run build 2>&1 | tail -20
```
If build fails:
- Identify which files have TypeScript errors
- For each broken file, check if a `.bak` file exists (written by blacksmith before each apply)
- If a `.bak` is clean (compiles without errors), offer to restore it
- Report which files need manual review vs which can be restored automatically
Do NOT automatically overwrite files — show the user the options and ask before restoring.

## FINAL REPORT
Show counts for each fix applied.
Then run the status check to show current state after fixes.
