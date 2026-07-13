Show a comprehensive real-time status snapshot of the KingdomOS run.

Run the following DB queries against `kingdom/kingdom.db` using `better-sqlite3` and format the output as a clean status report:

1. **Objective status** — current objective title and status
2. **Task breakdown** — count by status (completed / running / queued / awaiting-healer / stalled / etc.)
3. **Job breakdown** — count by status
4. **File locks** — list all active locks with owning job ID
5. **Running jobs** — show running/streaming jobs with tier, title, started_at
6. **Stuck tasks** — list awaiting-healer / awaiting-redesign / stalled tasks with title and retry count
7. **Token usage** — total tokens consumed, breakdown by tier if possible
8. **Recent failures** — last 3 failed jobs with failure_type and task title
9. **Diff success rate** — compute applied vs failed diffs:
   ```
   SELECT
     (SELECT COUNT(*) FROM jobs WHERE status='completed' AND output IS NOT NULL) as applied,
     (SELECT COUNT(*) FROM jobs WHERE failure_type='invalid-output') as diff_failed,
     (SELECT COUNT(*) FROM jobs WHERE failure_type='review-rejection') as review_rejected
   ```
   Flag if diff failure rate > 50%.
10. **File contention** — check for tasks where the same file appears in multiple running jobs' context_refs (a sign of concurrent modification risk).

Then provide a one-line verdict: HEALTHY / NEEDS ATTENTION / CRITICAL with the primary issue if any.
