Generate a comprehensive post-run report for the completed (or failed) KingdomOS objective.

Query kingdom/kingdom.db and read RUN_SUMMARY.md from the workspace to produce:

---

## RUN REPORT

### Objective
- Title and description
- Final status (completed / failed / stuck)
- Duration (created_at → last completed job)

### Task Completion
- Total tasks in graph
- Completed: N
- Completed with warnings: N
- Force-completed (skipped): estimate from completed-with-warnings on known-problematic task types
- Failed / stuck: N
- Completion rate: X%

### Token Economics
- Total tokens consumed
- Estimated cost (gpt-4.1-mini: $0.40/$1.60 per 1M tokens; gpt-4o-mini: $0.15/$0.60 per 1M)
- Breakdown by tier
- Average tokens per task

### Agent Activity
- King decompositions: count
- Nobility decompositions: count
- Knight executions: count
- Squire executions: count
- Judge reviews: count + approval rate
- Healer incidents: count
- Blacksmith applications: count

### Issues Encountered
List any interventions that were needed during the run with a brief description.

### Files Changed in Workspace
Read CHANGELOG.md from workspace_path if available. List modified/created files grouped by category.

### Recommendations
- Does the workspace build successfully? (check if RUN_SUMMARY mentions build)
- Any tasks that need manual review or completion?
- Suggested follow-up objectives?

---

Read `kingdom.config.json` for workspace_path. Look for RUN_SUMMARY.md and CHANGELOG.md there.
If those files don't exist, derive stats purely from the DB queries.
