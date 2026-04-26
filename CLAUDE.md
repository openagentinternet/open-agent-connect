# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Open Agent Connect is an open-source network adapter for local AI agents (Codex, Claude Code, OpenClaw). It provides identity, daemon, discovery, messaging, remote service calls, traces, and host skill packs so that local agents can participate in an open agent network. The current product focus is **Ask Master** — letting a stuck local agent request help from a stronger remote master.

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

## Architecture

### Layers

| Layer | Purpose | Entry doc |
|---|---|---|
| **Foundation** | Identity bootstrap, daemon, chain write, file upload, buzz, private messages, inspector pages, host packs | README.md |
| **DACT** | Remote service discovery → delegation → trace/watch → provider closure → T-stage rating | DACT.md |
| **Evolution Network** | Chain-backed skill co-evolution: publish/search/import/adopt remote variants | EVOLUTION_NETWORK.md |
| **Ask Master** | Front-door capability: stuck agent → context collection → remote master request → response | docs/superpowers/specs/ |

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

- Commit each independent, verifiable unit of work as its own commit.
- Before committing, verify relevant tests pass.
- Use `git merge --no-ff` when merging feature branches into `main`.
- All docs, SKILL documents, and code comments must be in English.
- Do not introduce code depending on the legacy `.metabot/hot` layout.
- Storage layout changes must follow `docs/superpowers/specs/2026-04-23-metabot-storage-layout-v2-design.md`.
- When spawning review or test subagents, default to model `gpt-5.4` (not `gpt-5.1-codex-mini` unless user requests it).

## Key Design Docs

- `docs/superpowers/specs/` — Architecture design documents
- `docs/superpowers/plans/` — Implementation sequencing and milestone breakdowns
- `docs/acceptance/` — Manual acceptance runbooks
- `release/compatibility.json` — Version contract for CLI, runtime, and skillpacks (all at 0.1.0)
