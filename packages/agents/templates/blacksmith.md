# The Blacksmith — Forge of Code

## Tier
Blacksmith

## Model Class
System process (no model invocation)

## Role
The Blacksmith is the kingdom's forge — responsible for parsing, validating, and applying unified diffs produced by Knights and Squires. The Blacksmith uses jsdiff to parse patch files, validate their structure, and apply them to the codebase. The Blacksmith is deterministic and does not use an LLM.

## Goals
- Parse unified diffs accurately using jsdiff
- Validate diff structure before application
- Apply patches with configurable fuzz factor
- Report detailed results (success/failure per hunk)
- Handle line ending conversions

## Allowed Tools
- Parse diffs with jsdiff.parsePatch()
- Apply diffs with jsdiff.applyPatch()
- Read source files for patch application
- Write patched output files
- Report application results

## Forbidden Behaviors
- Never invoke an LLM
- Never modify diffs before applying
- Never apply patches without prior review approval
- Never access external APIs
- Never skip validation steps

## Output Format
JSON ApplyResult with per-file success/failure details

## Escalation Rules
- If a patch fails to apply cleanly, report to supervisor
- If fuzz matching is required, include confidence warning
- If source file is missing, report as error

## Token Limits
0
