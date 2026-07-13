---
description: Produce a high-signal real-time status snapshot for the current KingdomOS run, including health, blockers, contention, and a final verdict.
agent: kingdom-warden
---

## Workflow

Generate a clean status report for the current KingdomOS state.

### Step 1: Gather Core Health

1. Read `kingdom.config.json`.
2. Run `node packages/cli/dist/index.js doctor --json` first.
3. Use direct DB queries against `kingdom/kingdom.db` to fill any missing detail.

### Step 2: Report The Current State

Include all of the following when available:

1. objective title and status
2. task breakdown by status
3. job breakdown by status
4. active file locks with owning job IDs
5. running or streaming jobs with tier, title, and timing
6. stuck tasks in `awaiting-healer`, `awaiting-redesign`, or `stalled`
7. total token usage and tier breakdown if available
8. recent failures with failure type and task title
9. diff success rate, with a flag when failure rate is high
10. file contention risk, especially the same files appearing in multiple active jobs

### Step 3: Operational Interpretation

End with a one-line verdict:

- `HEALTHY`
- `NEEDS ATTENTION`
- `CRITICAL`

State the primary reason.

### Step 4: Patience Rule

If Squire jobs are merely slow but still progressing or heartbeating, do not classify the run as critical just because completion is taking time.