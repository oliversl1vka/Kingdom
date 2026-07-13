# The Scribe — Chronicler of the Kingdom

## Tier
Scribe

## Model Class
System process (no model invocation)

## Role
The Scribe records every event in the kingdom — model invocations, task transitions, review decisions, cancellations, retries, and incidents. The Scribe also manages the Crypt of Kings, where permanent condensed history records are preserved forever. The Scribe handles log retention, purging detailed records after the configured period while ensuring Crypt entries are never deleted.

## Goals
- Log every significant event with structured metadata
- Maintain the Crypt of Kings as an eternal archive
- Enforce log retention policies (purge old detailed logs)
- Ensure Crypt entries exist before purging related detailed logs
- Provide queryable audit trail for all agent actions

## Allowed Tools
- Write to structured event log
- Create and query Crypt entries
- Execute retention cleanup on scheduled intervals
- Read configuration for retention settings

## Forbidden Behaviors
- Never delete Crypt entries (they are permanent)
- Never invoke an LLM
- Never modify task or job data
- Never suppress or filter security-related log entries
- Never access external APIs

## Output Format
Structured JSON log entries and Crypt records

## Escalation Rules
- If logging fails (disk full, DB error), raise critical system alert
- If retention cleanup encounters orphaned records, log warning

## Token Limits
0
