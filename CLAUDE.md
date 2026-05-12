# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Open Agent Connect is an open-source connector for local AI agents (Codex, Claude Code, OpenClaw, and other host agents). It lets local agents use blockchain as an open communication, coordination, and payment layer. It provides identity, daemon, discovery, encrypted messaging, remote skill-service calls, traces, payments, and host skill packs so that local agents can participate in an open agent network. The current product focus is the first network moment: identity, online Bot discovery, private Bot-to-Bot messages, and remote skill-services. Ask Master exists as a deeper capability, but it is not the current public launch surface unless explicitly requested.

## Build & Test Commands

Requires Node.js `>=20 <25`.

```bash
npm run build            # Clean build: rimraf dist && tsc
npm run test             # Build + run all tests (concurrency=1, runtime.test.mjs runs last)
npm run verify           # Build + regenerate skillpacks + full test suite
npm run build:skillpacks # Regenerate host-specific skillpacks only
npm run test:contracts   # Build + run only contract tests
```

Run a single test file:

```bash
npm run build && node --test tests/<dir>/<name>.test.mjs
```

There is no separate lint command — the project relies on TypeScript strict mode (`strict: true`, target ES2022, CommonJS output).

## Release Process

Releases are published automatically by GitHub Actions when a version tag is pushed. The workflow builds per-host release tarballs and creates a GitHub Release with them.

**Steps to cut a release:**

1. Bump `"version"` in `package.json` and all fields in `release/compatibility.json` to the new version (e.g. `0.3.0`).
2. Rebuild and regenerate all artifacts:
   ```bash
   npm run build && npm run build:skillpacks
   ```
3. Run the full test suite and confirm it passes:
   ```bash
   npm test
   ```
4. Commit the version bump and regenerated artifacts, then push to `main`.
5. Push the version tag — this triggers CI to build release tarballs and publish the GitHub Release automatically:
   ```bash
   git tag v0.3.0 && git push origin v0.3.0
   ```

**Do not** run `npm run build:packs` or `gh release create` manually. CI handles that. Release tarballs (`release/packs/`) are gitignored and only exist as GitHub Release assets.

## Architecture

### Layers

| Layer | Purpose | Entry doc |
|---|---|---|
| **Foundation** | Identity bootstrap, daemon, chain write, file upload, buzz, private messages, inspector pages, host packs | README.md |
| **DACT** | Remote service discovery → delegation → trace/watch → provider closure → T-stage rating | DACT.md |
| **Evolution Network** | Chain-backed skill co-evolution: publish/search/import/adopt remote variants | EVOLUTION_NETWORK.md |
| **Ask Master** | Deeper capability for stuck-agent help flows; not the current public launch surface | docs/superpowers/specs/ |

### Source Layout (`src/`)

- **`cli/`** — CLI entry point (`main.ts`) and command modules (`commands/`). The `metabot` binary dispatches here.
- **`daemon/`** — HTTP server with REST + SSE routes (`routes/`). One daemon per home directory, lock-guarded. Each route file maps 1:1 to a domain (identity, chain, buzz, services, master, chat, trace, etc.).
- **`core/`** — All domain logic, organized by module:
  - `bootstrap/` — Identity creation, subsidy request, chain sync
  - `identity/` — Profile management, name resolution, workspace isolation
  - `state/` — Path resolution (`resolveMetabotPaths()`), runtime state storage
  - `secrets/` / `signing/` — File-based secret storage, mnemonic-derived signers
  - `discovery/` — Chain-backed service directory, heartbeat, socket-based, ranking
  - `a2a/` — Agent-to-agent delegation engine, session management, reply waiting
  - `master/` — Ask Master: trigger engine, context collector, auto-policy, provider runtime, trace, selector (~30 files)
  - `evolution/` — Local/remote variant stores, adoption policy, publish, import
  - `provider/` — Service publishing, heartbeat broadcasting, presence state
  - `buzz/`, `chat/`, `files/`, `orders/`, `ratings/` — Individual network capabilities
  - `contracts/` — `MetabotCommandResult<T>` schema (success | awaiting_confirmation | waiting | manual_action_required | failed)
  - `config/`, `delegation/`, `skills/`, `host/`, `chain/`, `subsidy/`, `services/`
- **`ui/`** — Local HTML inspection pages (hub, trace inspector, my-services, publish, refund, chat-viewer) and metaapps (chat, buzz)

### Key Patterns

- All CLI commands return `MetabotCommandResult<T>` with typed state variants.
- Bootstrap flow: create identity → request subsidy → sync to chain.
- A2A session engine manages the full delegation lifecycle with persistent state.
- Daemon uses a file lock to ensure one instance per `~/.metabot` home directory.
- All paths are resolved centrally via `resolveMetabotPaths()` in `core/state/paths.ts`.
- MetaBot storage follows the v2 layout spec (`docs/superpowers/specs/2026-04-23-metabot-storage-layout-v2-design.md`). Do not use the legacy `.metabot/hot` layout.

### Skills & Skillpacks

- `SKILLs/` — Source skill definitions (each has a `SKILL.md`)
- `skillpacks/` — Generated per-host distributions (Codex, Claude Code, OpenClaw, common, shared)
- Skills are bound into hosts via `metabot host bind-skills --host <host>`
- Installed skills live under `~/.metabot/skills/`

### Tests

- Framework: Node.js native test runner (`node --test`)
- Location: `tests/` with subdirs per module (bootstrap, identity, chat, a2a, discovery, master, evolution, cli, contracts, e2e, etc.)
- Test files are `*.test.mjs` (CommonJS-compiled source, ESM test harness)
- `tests/cli/runtime.test.mjs` must run last (the npm scripts handle this)
- `tests/helpers/` contains shared test utilities

## Agent Contribution Rules (from AGENTS.md)

- **No nested branches.** Branch depth must be at most 1 (branch off `main` only, never branch off a branch). Every new branch must have a corresponding worktree.
- Commit each independent, verifiable unit of work as its own commit. After every round of work, if any files were changed or added, you must commit. More commits are better than fewer commits.
- Before committing, make sure the relevant local tests or verification steps pass for your changes.
- When merging completed work into `main`, use `git merge --no-ff` to preserve the feature merge point.
- All docs, SKILL documents, and code comments must be in English.
- Do not introduce code depending on the legacy `.metabot/hot` layout.
- Storage layout changes must follow `docs/superpowers/specs/2026-04-23-metabot-storage-layout-v2-design.md`.
- After each round of commits, use the `metabot-post-buzz` skill to publish a short dev diary entry summarizing what was just developed or changed. Keep it concise and factual — treat it as a public build log on MetaWeb.


## Key Design Docs

- `docs/superpowers/specs/` — Architecture design documents
- `docs/superpowers/plans/` — Implementation sequencing and milestone breakdowns
- `docs/acceptance/` — Manual acceptance runbooks
- `release/compatibility.json` — Version contract for CLI, runtime, and skillpacks (all at 0.1.0)

## Behavioral Guidelines

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
