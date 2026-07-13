---
description: Generate a post-run report for a completed or failed KingdomOS objective, including outcome, economics, issues, and follow-up guidance.
agent: kingdom-warden
---

## Workflow

Produce a run report for the most relevant completed, failed, or stuck KingdomOS objective.

### Step 1: Gather Sources

1. Read `kingdom.config.json`.
2. Use `node packages/cli/dist/index.js doctor --json` for the top-level health summary.
3. Query `kingdom/kingdom.db` for objective, task, job, token, and failure details.
4. Read `RUN_SUMMARY.md` and `CHANGELOG.md` when they exist.

### Step 2: Report

Include:

- objective title, description, and final status
- duration from creation to latest meaningful completion
- task completion counts and completion rate
- completed-with-warnings or likely force-completed tasks
- failed or stuck task count
- total tokens and rough cost
- per-tier activity and economics when available
- Judge, Healer, and Blacksmith activity when available
- interventions or incidents that occurred during the run
- files changed in the target workspace when evidence exists
- whether the workspace builds successfully now
- concrete follow-up recommendations

### Step 3: Judgment

Make a clear call on whether the run delivered:

- a usable result
- a partial result with cleanup required
- a failed result requiring another targeted run or manual repair

Keep the report practical. Separate low-priority leftover test work from functional gaps that actually block shipping.