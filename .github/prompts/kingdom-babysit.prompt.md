---
description: Babysit an active KingdomOS run from health assessment through completion or stable handoff, with patience for slow local GPU-backed Squire work.
agent: kingdom-warden
---

## Workflow

Run a full KingdomOS babysit session for the current run.

### Step 1: Assess Current State

Start with `node packages/cli/dist/index.js doctor --json`, then deepen with DB queries as needed.

Classify the current run into one of these states:

- not started
- just launched
- running healthy
- running with issues
- stalled or dead
- completed

Report the state clearly with counts.

### Step 2: Triage Active Issues

Check and report `OK` or `ISSUE` for:

1. provider routing
2. orphaned file locks
3. test task loops
4. setup/scaffold tasks on an existing project
5. stalled, healer, or redesign tasks
6. zombie process risk
7. diff failure rate
8. last-subtask bottlenecks where only a low-value blocker prevents parent completion

### Step 3: Apply Safe Automatic Fixes

Without asking for confirmation, apply the safe fixes when the evidence is clear:

- clear orphaned file locks
- force-complete looping test tasks
- suppress setup/scaffold tasks on existing projects
- reset legitimately stalled tasks

Report every fix applied.

### Step 4: Monitor Loop

If the run is active, continue monitoring with a cadence of roughly 3 to 5 minutes for up to 60 minutes unless the task completes earlier.

At each check:

- report task completion progress
- report token usage and rough cost
- flag new issues
- apply safe interventions as needed
- watch for file contention before proposing any workspace edits

Important:

- local GPU-backed Squire jobs can be slow; do not overreact to slow but healthy progress
- do not start unrelated code edits while there are still active or nearly-finished run tasks that should simply be allowed to finish
- if the run is idle for 10+ minutes with no progress or fresh heartbeats, investigate immediately

### Step 5: Post-Run Verification

When the objective completes:

1. report duration, completion stats, tokens, and rough cost
2. verify the workspace build
3. list tasks still not in a terminal completed state
4. report file changes if relevant
5. recommend the next steps, separating ignorable test debt from real functional follow-up