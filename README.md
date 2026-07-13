```
       |>>     |>>     |>>                       \   |   /
       |       |       |             v              .-.
   _   _   _   _   _   _   _              v      --(   )--
  | |_| |_| |_| |_| |_| |_| |                       '-'
  |                         |          /\        /   |   \
  |   K I N G D O M   O S   |         /  \   /\
  |                         |    /\  /    \ /  \      /\
  |         _______         |   /  \/      V    \    /  \
  |        |       |        |  / /\             /\  /    \
  |________|  [+]  |________|_/_/__\___________/__\/______\
```

# KingdomOS

**Your Agents. Your Terminal. Your Kingdom.**

Plan, execute, review, heal - all from the command line. No browser
required. No babysitting needed. A hierarchical multi-agent
orchestration system where agents form a medieval court: a King sets
intent, Nobility plan, Knights build, and support tiers keep the realm
healthy.

---

## From zero to a working kingdom

```
01  Install               curl -fsSL https://kingdomos.dev/install | sh
02  Set up a kingdom      kingdom setup camelot
03  Decree an objective   kingdom decree "Integrate Stripe billing"
04  Summon the court      kingdom summon --verbose
05  Watch progress        kingdom status
```

- **01 - Install** - one line installs the `kingdom` CLI globally.
  Verify with `kingdom --version`.
- **02 - Set up a kingdom** - scaffolds a `kingdom/` directory: config,
  the SQLite ledger, and workspace.
- **03 - Decree an objective** - queues a high-level objective for the
  King to decompose. Options: `--priority <1-10>`, `--dry-run`,
  `--criteria <file>`.
- **04 - Summon the court** - wakes the agents. Requires `OPENAI_API_KEY`
  in `.env`.
- **05 - Watch progress** - a live dashboard of tasks, jobs, token spend,
  and the current objective.

---

## The court

```
                 [ KING ]             intent + final judgment
                    |
            +-------+-------+
            |               |
        [NOBILITY]       [JUDGE]      planning / review
            |
     +------+------+
     |      |      |
 [KNIGHT][SQUIRE][BLACKSMITH]         implementation / tools
     |
 [SENTINEL][SCRIBE][HEALER]           guard / record / recover
```

---

## Layout

```
packages/
  core/                orchestration kernel
  agents/              tier definitions + roles
  providers/           model routing (openai, llamacpp, lmstudio)
  cli/                 the `kingdom` command
  context-engine/      memory + retrieval
  token-engine/        budgeting + accounting
  telegram-commander/  remote control
website/               the marketing site (canonical brand reference)
```

## Develop

```
pnpm install
pnpm build
pnpm test
```

Configure providers and tiers in `kingdom.config.json`.

## License

Private. All rights reserved.
