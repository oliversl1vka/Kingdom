---
description: Launch a new KingdomOS run with full pre-flight checks, safe startup verification, and an immediate handoff into babysitting discipline.
agent: kingdom-warden
---

## User Input

```text
$ARGUMENTS
```

Use the user input as the objective text when provided. If it is empty, ask for the objective before continuing.

## Workflow

### Step 1: Pre-flight

Before launching, verify all run prerequisites.

1. Read `kingdom.config.json`.
2. Prefer `node packages/cli/dist/index.js doctor --json` as the first health and environment snapshot.
3. Confirm:
   - `OPENAI_API_KEY` will reach the launched process
   - LMStudio is reachable if Squire uses `lmstudio`
   - `packages/cli/dist/index.js` exists and is fresh enough
   - `kingdom/kingdom.db` exists
   - there are no orphaned file locks or zombie `node` processes

Report `READY` or `BLOCKED` with concrete reasons.

### Step 2: Create The Objective

If the user already supplied the objective, use it.

If not, ask: `What objective should I decree to the King?`

Create the objective with explicit environment passing. Do not rely on shell-local exports reaching background processes.

### Step 3: Launch Summon

Start the orchestration system with explicit environment passing and capture logs so startup can be verified.

### Step 4: Verify Startup

Inspect the early startup output and confirm all of the following:

- provider routing matches the configured providers
- the system awakened successfully
- there are no early startup errors

If all tiers route to `lmstudio`, treat that as a mislaunch. Kill the bad process, diagnose the missing API key propagation, and relaunch correctly.

### Step 5: Initial Safeguards

After decomposition begins:

- run the status flow
- suppress setup/scaffold tasks when the workspace already contains a real project
- verify the workspace baseline build before agents mutate it so pre-existing errors are not blamed on the run

### Step 6: Handoff To Babysit

Do not stop immediately after launch. Transition into babysitting behavior.

- be patient with Squire jobs on the local GPU
- use a roughly 3 to 5 minute monitoring cadence
- do not start unrelated code edits while the new run is still stabilizing