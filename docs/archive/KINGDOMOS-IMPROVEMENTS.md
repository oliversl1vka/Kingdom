# KingdomOS - Pain Points and Improvement Plan

> Updated March 28, 2026. Based on repeated production-style runs, recovery work from the Smart Router run, and the fixes now present in the codebase.

---

## Current State

The original backlog identified 26 major pain points. A meaningful first pass has now landed.

Resolved or materially mitigated in the current branch:
- 1. File locking during dispatch
- 2. Fresh file context after lock acquisition
- 3. Spin loop at run completion
- 4. completed -> failed-review crash hardening
- 5. Squire review over-rejection
- 7. Full-file context token waste
- 8. False stall detection threshold
- 10. Retry feedback growth
- 13. Duplicate queued/running job creation
- 15. Hardcoded decomposer model
- 16. Path hallucination feedback loop
- 23. Vague rejection messages
- 26. Out-of-range context refs

Resolved in second pass (Smart Router run retrospective, March 28 2026):
- 20. Post-apply compilation verification (validation_command in config + dispatcher rollback)
- 21. Automatic file backup / restore (blacksmith now always overwrites .bak before each apply)
- 11. Real concurrency backpressure (partial — groom-based lock expansion closes the hotspot-file gap)

Resolved in third pass (March 28 2026 — full backlog close):
- 6. Diff format robustness (hunk count validator in reviewer.ts catches @@ line-count mismatches)
- 9. Retry lineage and supersession tracking (superseded_by forward pointer added, migration 008)
- 11. Concurrency backpressure — scheduler-level: dispatchPending now orders by task priority DESC
- 12. Healer diagnostician execution path (HealerWorker drives Diagnostician + ActionExecutor)
- 14. SQLite write contention (busy_timeout = 5000ms added; WAL already enabled)
- 17. Dry run / preview mode (full LLM decomposition + transaction rollback)
- 18. Pause / resume (kingdom pause / unpause commands via flag file)
- 19. Per-task cost tracking (getTokenSummary on TaskRepository + stats command)
- 22. Built-in observability dashboard (status --watch live terminal dashboard)
- 24. Model performance analytics (kingdom stats command with tier breakdown)
- 25. Configurable escalation paths (escalation_path in config, merged with defaults)

All 26 items from the original backlog are now resolved or materially mitigated.

---

## Applied Fixes

### 1. File locking during dispatch

Status: Fixed.

JobDispatcher now acquires file locks before execution and defers jobs that would touch already-locked files. This directly addresses the main source of conflicting diffs in parallel runs.

Expected effect:
- Fewer overlapping diffs against the same file.
- Higher diff application success rate during parallel runs.

### 2. Fresh file context after locks are acquired

Status: Fixed.

Packet assembly now happens inside job execution instead of before dispatch. That means the file content used in the prompt is read after locking, not from a stale pre-dispatch snapshot.

Expected effect:
- Jobs see the latest file contents.
- Reduced stale-context diff failures.

### 3. Spin loop after all work is done

Status: Fixed.

The orchestration loop now stops automatically once objectives are finished instead of continuing to poll indefinitely after the run is effectively complete.

Residual note:
- This solves the practical infinite-poll problem. A watchdog around no-op polling is still optional hardening, not a blocker.

### 4. completed -> failed-review crash

Status: Mitigated.

The current fix hardens the most common crash path by swallowing the terminal-state race during the final completion transition instead of crashing the process.

Residual risk:
- This is not yet full transactional state-transition protection. If the goal is strict correctness under concurrency, DB-backed transition guards are still worth implementing later.

### 5. Squire review over-rejection

Status: Fixed.

Squire-tier jobs now skip the LLM-based acceptance-criteria review and rely on deterministic checks instead. That removes the strong-reviewer-versus-weak-worker mismatch that was causing excessive escalation.

Expected effect:
- Lower rejection rate for valid low-tier outputs.
- Reduced token burn from unnecessary escalation.

### 7. Full-file context waste

Status: Fixed.

Context assembly now merges line ranges per file and slices to the relevant range with padding instead of blindly injecting full files.

Expected effect:
- Smaller prompts.
- Fewer timeouts.
- Better signal-to-noise in model context.

### 8. False stall detection

Status: Fixed.

The heartbeat stale threshold has been raised from 30 seconds to 90 seconds, which better matches real model response latency.

Expected effect:
- Fewer false stalled-worker incidents.
- Fewer unnecessary retries and escalations.

### 10. Retry feedback bloat

Status: Fixed.

Retry and escalation feedback is now stripped and replaced instead of appended forever, keeping task descriptions bounded.

Expected effect:
- Stable prompt sizes across retries.
- Better retry quality because the latest feedback remains readable.

### 13. Duplicate job creation

Status: Fixed.

Job creation now ignores tasks that already have queued or running jobs, which prevents duplicate execution when the orchestration loop ticks quickly.

### 15. Hardcoded decomposer model

Status: Fixed.

The decomposer now accepts a model from configuration, and orchestration can pass a dedicated decomposerModel instead of forcing gpt-4o.

Expected effect:
- Correct tier/model alignment.
- Easier experimentation and lower decomposition cost.

### 16. Path hallucination handling

Status: Partially fixed.

The current code now returns specific failure feedback when diff application fails entirely, including whether the referenced file exists or the hunks simply do not apply.

What this solves:
- Better retry prompts.
- Much clearer recovery when a model invents file paths.

What remains open:
- Preventive path validation before application is still a useful next step.
- Exposing the workspace tree or allowed path set more aggressively to the model would further reduce hallucinated targets.

### 23. Vague rejection messages

Status: Fixed.

Review rejection messages now explain whether the diff is missing headers, missing hunk markers, or touching files outside scope.

Expected effect:
- Better retry behavior.
- Less wasted escalation caused by generic rejection text.

### 26. Invalid context ref ranges

Status: Fixed.

Context ref ranges are now clamped to real file bounds instead of silently causing full-file fallback behavior.

---

## Remaining Backlog

### 6. Diff format robustness is still brittle

Status: Open.

Format validation is better, but the system still depends on models emitting unified diffs directly. That remains fragile.

Recommended next step:
- Add a strict pre-review diff parser and reject malformed output before deeper review.
- Consider moving to structured edit output or full-file replacement plus programmatic diff generation.

### 9. Retry lineage is not modeled cleanly

Status: Open.

Retries create new jobs, but old jobs are not formally marked superseded. This makes history, analytics, and monitoring harder to reason about.

Recommended next step:
- Add explicit retry lineage fields such as superseded_by or retry_parent_job_id.

### 11. Concurrency backpressure is still shallow

Status: Open.

The dispatcher respects the available worker count when dispatching, but there is still no richer queueing/backpressure model for fairness, starvation handling, or file-hotspot scheduling.

Recommended next step:
- Introduce a real scheduler that accounts for worker slots, file lock contention, and task priority together.

### 12. Healer diagnostician path is still not active

Status: Open.

Incidents can be reported, but there is still no confirmed end-to-end loop that consumes unresolved incidents and runs diagnosis/remediation automatically.

Recommended next step:
- Implement an incident worker or periodic diagnostic loop.

### 14. SQLite remains a bottleneck under heavy concurrency

Status: Open.

WAL helps, but heartbeat writes, job state writes, and review persistence still contend for the same database.

Recommended next step:
- Batch heartbeat writes.
- Separate volatile worker liveness from the main DB.
- Consider PostgreSQL if this moves beyond local or light-team usage.

### 17. No dry-run / preview mode

Status: Open.

There is still no native way to preview decomposition and planned execution before spending tokens.

### 18. No pause / resume

Status: Open.

Runs are still operationally fragile if the process needs to stop intentionally.

### 19. No per-task cost accounting

Status: Open.

Token use is still easier to inspect at run level than at task, file, or retry-chain level.

### 20. No post-apply compilation verification

Status: Open.

Applied diffs can still leave the workspace in a broken state unless the user manually compiles or tests afterward.

Recommended next step:
- Add configurable post-apply validation commands per project.

### 21. No automatic file backup / restore flow

Status: Open.

Recovery is still too dependent on manual backups and ad hoc restoration.

### 22. No built-in dashboard

Status: Open.

Observability still leans too heavily on custom one-off scripts.

Recommended next step:
- Build a terminal dashboard showing objective progress, worker status, retries, token usage, and diff success/failure trends.

### 24. No model performance analytics

Status: Open.

The system still lacks first-class reporting for which tiers, models, or task types are producing value versus waste.

### 25. Escalation path is still hardcoded

Status: Open.

Escalation still follows a fixed path instead of using configurable routing rules.

Recommended next step:
- Move escalation policy into config and allow per-task-type overrides.

---

## Revised Priority Matrix

| # | Issue | Status | Why it still matters | Next action |
|---|---|---|---|---|
| 6 | Diff format robustness | Open | Invalid model output still wastes cycles | Add strict parser or structured edits |
| 20 | Post-apply compilation verification | Open | Prevents silent workspace breakage | Run build/test after apply |
| 11 | Real scheduler/backpressure | Open | Improves fairness and throughput under load | Add queue-aware scheduler |
| 14 | SQLite contention | Open | Limits concurrency scaling | Batch heartbeats or split storage |
| 12 | Healer diagnostician loop | Open | Incidents are not closed automatically | Add incident worker |
| 9 | Retry lineage tracking | Open | History and analytics remain muddy | Add supersession metadata |
| 22 | Built-in dashboard | Open | Removes need for custom ops scripts | Add TUI/CLI monitoring |
| 25 | Configurable escalation | Open | Better routing lowers cost | Move policy to config |
| 17 | Dry-run mode | Open | Saves tokens on bad decompositions | Add preview command |
| 18 | Pause/resume | Open | Needed for long unattended runs | Add resumable run state |
| 19 | Per-task cost tracking | Open | Needed for optimization | Persist task-level token totals |
| 21 | Backup/restore | Open | Easier recovery from bad applies | Add automatic snapshots |
| 24 | Model analytics | Open | Enables evidence-based routing | Add post-run analytics report |

---

## Recommended Attack Order From Here

### Phase 1 - Make Output Safer

Focus on Issues 6, 20, and 21.

Reason:
- The system is much more stable now, but bad output can still land or partially land.
- Post-apply validation and automatic recovery are the fastest way to reduce trust friction.

### Phase 2 - Improve Runtime Control

Focus on Issues 11, 12, 14, and 25.

Reason:
- These are the remaining orchestration-level gaps that limit confidence under sustained parallel load.

### Phase 3 - Improve Operator Experience

Focus on Issues 17, 18, 19, 22, and 24.

Reason:
- These do not block correctness, but they strongly determine whether KingdomOS feels usable, inspectable, and cost-aware in real runs.

---

## Short Conclusion

KingdomOS is in a materially better state than the original run that produced this backlog. The highest-value concurrency and context bugs have been addressed, and the system should now be noticeably more reliable under parallel execution.

The next ceiling is no longer basic stability. It is operational trust:
- Can bad output be caught automatically?
- Can the system be paused, resumed, and observed cleanly?
- Can routing and escalation be optimized from evidence instead of intuition?

Those are the next improvements worth assigning to an agent.
