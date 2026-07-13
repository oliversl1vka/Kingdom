---
description: Diagnose and automatically fix the safe, high-confidence KingdomOS run issues without introducing unnecessary code edits.
agent: kingdom-warden
---

## Workflow

Fix the current run conservatively. The goal is to restore forward progress, not to create new workspace diffs unless recovery truly requires them.

### Fix 1: Orphaned File Locks

Identify locks whose owning job is not running or streaming. Clear all orphaned locks and report how many were removed.

### Fix 2: Blocked Queue

If jobs are stuck in `queued` with no active workers, verify the queue is not blocked by orphaned locks. Reset clearly stalled tasks if needed.

### Fix 3: Test Task Healer Loops

Force-complete looping low-value tasks whose titles indicate test/spec/e2e work and which are churning through `awaiting-healer`, `retrying`, `failed-review`, or similar states.

### Fix 4: Setup And Scaffold Suppression

If the workspace already contains a real project, force-complete setup/scaffold/init/boilerplate tasks that would risk overwriting existing files.

### Fix 5: Stalled Task Reset

Reset truly stalled tasks back to `queued` when that is the safest way to resume progress.

### Fix 6: Awaiting-Redesign

List tasks in `awaiting-redesign`, but ask the user before deciding whether to force-complete, skip, or redesign them.

### Fix 7: Build Verification And Recovery Options

Check whether the current workspace still builds.

If the build fails:

- identify the broken files
- check whether `.bak` files exist beside them
- offer restoration options where appropriate
- do not overwrite from `.bak` without confirmation

### Final Report

Report:

- each fix applied
- counts for each fix category
- current status after recovery
- whether the run is now healthy, still degraded, or blocked on user input

### Guardrail

If there are already unfinished tests or nearly-complete run tasks queued, prefer letting them finish or force-completing obviously low-value blockers over making new project changes.