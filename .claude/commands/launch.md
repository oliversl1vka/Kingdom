Launch a new KingdomOS run. Performs pre-flight checks, then starts the orchestration system correctly.

## STEP 1 — PRE-FLIGHT

Run all pre-flight checks from CLAUDE.md:
1. Verify OPENAI_API_KEY is in .env (grep it, don't print it)
2. Verify LMStudio is accessible at localhost:1234/v1/models (if lmstudio tier enabled in config)
3. Verify packages/cli/dist/index.js exists and is recent (ls -la)
4. Check kingdom/kingdom.db exists
5. Check for any orphaned file locks or zombie node processes

Report: READY or BLOCKED with reason.

## STEP 2 — OBJECTIVE

If the user has already specified an objective, use that.
If not, ask: "What objective should I decree to the King?"

Then create the objective:
```bash
OPENAI_API_KEY=$(grep OPENAI_API_KEY .env | cut -d= -f2 | tr -d '\r') \
  node packages/cli/dist/index.js decree "<OBJECTIVE>"
```

Show the created objective ID.

## STEP 3 — LAUNCH SUMMON

Start the orchestration system with explicit env var passing:
```bash
OPENAI_API_KEY=$(grep OPENAI_API_KEY .env | cut -d= -f2 | tr -d '\r') \
  node packages/cli/dist/index.js summon --verbose > kingdom_run.log 2>&1 &
echo "Kingdom PID: $!"
```

## STEP 4 — VERIFY STARTUP

Wait 10 seconds, then check kingdom_run.log for:
- Provider routing table (confirm openai tiers show openai, squire shows lmstudio)
- "Kingdom awakened" message
- No startup errors

If provider routing is wrong (all lmstudio), kill immediately and diagnose.

## STEP 5 — INITIAL SAFEGUARDS

Wait 30 seconds for King decomposition to begin, then:
- Run /fix to suppress setup/scaffold tasks (protects existing project files)
- Run /status to confirm healthy start
- Verify the workspace currently builds BEFORE agents touch it (baseline):
  ```bash
  WORKSPACE=$(node -e "console.log(require('./kingdom.config.json').workspace_path)")
  cd "$WORKSPACE" && npm run build 2>&1 | tail -5
  ```
  If the baseline is already broken, note the errors — they are pre-existing, not caused by agents.

## STEP 6 — HANDOFF TO BABYSIT

Switch to babysit monitoring mode. Continue monitoring until completion.
