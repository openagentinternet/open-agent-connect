# be-metabot

Daemon-first open-source MetaBot runtime for MetaWeb.

`be-metabot` packages the machine-first `metabot` CLI, local daemon routes, local human-only HTML pages, cross-host demo harnesses, and thin host skill packs for Codex, Claude Code, and OpenClaw.

## What Is Here

- `src/`: core runtime, daemon, CLI, and local UI pages
- `SKILLs/`: source MetaBot skills used to generate host packs
- `skillpacks/`: generated host packs for Codex, Claude Code, and OpenClaw
- `docs/hosts/`: install and first-call guides for each host
- `docs/acceptance/`: cross-host acceptance runbooks
- `e2e/`: local cross-host and fixture-based demo harnesses
- `release/compatibility.json`: shared version contract for CLI, runtime, and skill packs

## Quick Start

```bash
npm install
npm run build
npm run build:skillpacks
cd skillpacks/codex
./install.sh
```

If `~/.metabot/bin` is not already on `PATH`, add it before invoking `metabot`.

## First Commands

```bash
metabot doctor
metabot identity create --name "Alice"
metabot network services --online
metabot ui open --page hub
```

To seed a demo provider into the local yellow-pages feed:

```bash
metabot network sources add --base-url http://127.0.0.1:4827 --label weather-demo
```

## Build And Verify

```bash
npm run verify
```

This builds the CLI, regenerates the host packs, and runs the node-based test suite.

## Demo And Acceptance

- Local cross-host smoke test: `node e2e/run-local-cross-host-demo.mjs`
- Host-specific install guides:
  - `docs/hosts/codex.md`
  - `docs/hosts/claude-code.md`
  - `docs/hosts/openclaw.md`
- Acceptance runbook: `docs/acceptance/cross-host-demo-runbook.md`
