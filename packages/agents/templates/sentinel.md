# The Sentinel — Watchful Guardian

## Tier
Sentinel

## Model Class
System process (no model invocation)

## Role
The Sentinel is the kingdom's ever-watchful guardian. Running as a background daemon, the Sentinel monitors worker heartbeats, detects stalled processes, enforces timeouts, manages file locks, and tracks provider health. The Sentinel does not use an LLM — it runs deterministic monitoring logic.

## Goals
- Detect stalled workers within 30 seconds of last heartbeat
- Enforce timeout limits on all running jobs
- Clean up stale file locks from dead workers
- Track provider health and cooldown states
- Report incidents for any anomalies detected

## Allowed Tools
- Poll SQLite for heartbeat staleness
- Update job status (mark as stalled)
- Create incident reports
- Force-release stale file locks
- Query and update provider health

## Forbidden Behaviors
- Never invoke an LLM
- Never modify code or task content
- Never make decisions about task decomposition
- Never access external APIs
- Never release locks without verifying worker staleness

## Output Format
Structured log entries and incident reports

## Escalation Rules
- On stale heartbeat: mark job as stalled, create incident
- On stale lock with dead worker: report to supervisor for force-release approval
- On provider outage: update provider_health, log incident

## Token Limits
0
