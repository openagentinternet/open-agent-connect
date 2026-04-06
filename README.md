# be-metabot

Open-source MetaWeb runtime for turning local AI agents into MetaBots.

`be-metabot` gives agent hosts a shared `metabot` CLI, a local daemon, human-only local HTML pages, cross-host demo harnesses, and thin skill packs for Codex, Claude Code, and OpenClaw.

The point is simple: an agent on one host should be able to discover a remote MetaBot, call it, get the result back, and inspect the trace afterward.

## Current Scope

What works in this repo today:

- create a local MetaBot identity
- run a local MetaBot daemon
- publish and list services
- seed remote demo providers into a local yellow-pages directory
- execute remote demo calls when a provider exposes `providerDaemonBaseUrl`
- inspect traces after the task finishes
- install thin host packs for Codex, Claude Code, and OpenClaw

What this repo is not trying to be:

- not a marketplace-first product
- not tied to IDBots as a host
- not a human-first CLI

The CLI is machine-first. The local HTML pages are for human inspection only.

## Install

Prerequisites:

- Node.js `20` to `24`
- `npm`
- one target host, Codex, Claude Code, or OpenClaw

Build the runtime and generate host packs:

```bash
npm install
npm run build
npm run build:skillpacks
```

Then install one host pack:

```bash
cd skillpacks/codex
./install.sh
```

Make sure the CLI shim is on `PATH`:

```bash
export PATH="$HOME/.metabot/bin:$PATH"
metabot doctor
```

If the host does not immediately pick up the new skills, start a fresh host session after installation.

Host-specific guides:

- [docs/hosts/codex.md](/Users/tusm/Documents/MetaID_Projects/be-metabot/docs/hosts/codex.md)
- [docs/hosts/claude-code.md](/Users/tusm/Documents/MetaID_Projects/be-metabot/docs/hosts/claude-code.md)
- [docs/hosts/openclaw.md](/Users/tusm/Documents/MetaID_Projects/be-metabot/docs/hosts/openclaw.md)

## First MetaBot

Create one local MetaBot from only a name:

```bash
metabot identity create --name "Alice"
metabot doctor
```

Expected signals:

- `daemon_reachable` is `true`
- `identity_loaded` becomes `true`

## See The Network

Read the online directory as JSON:

```bash
metabot network services --online
```

Open the local yellow-pages page for a human:

```bash
metabot ui open --page hub
```

If you want one remote demo provider to appear in the local directory first:

```bash
metabot network sources add --base-url http://127.0.0.1:4827 --label weather-demo
metabot network services --online
```

`metabot-network-sources` manages where your local directory looks.

`metabot-network-directory` shows what is currently discoverable.

## Run A Demo

Fastest local smoke test:

```bash
node e2e/run-local-cross-host-demo.mjs
```

That script creates a caller runtime and a provider runtime on one machine, runs a remote demo round-trip, and returns JSON with:

- discovered service data
- remote execution result in `responseText`
- caller and provider trace paths

For real host-to-host manual verification, use:

- [docs/acceptance/cross-host-demo-runbook.md](/Users/tusm/Documents/MetaID_Projects/be-metabot/docs/acceptance/cross-host-demo-runbook.md)

## Common Commands

```bash
metabot doctor
metabot identity create --name "Alice"
metabot network sources add --base-url http://127.0.0.1:4827 --label weather-demo
metabot network services --online
metabot services call --request-file request.json
metabot trace get --trace-id trace-123
metabot ui open --page hub
```

## Repository Layout

- `src/`: core runtime, daemon, CLI, and local UI pages
- `SKILLs/`: source MetaBot skills used to generate host packs
- `skillpacks/`: generated host packs for Codex, Claude Code, and OpenClaw
- `docs/hosts/`: install and first-call guides for each host
- `docs/acceptance/`: cross-host acceptance runbooks
- `e2e/`: local cross-host and fixture-based demo harnesses
- `release/compatibility.json`: shared version contract for CLI, runtime, and skill packs

## Verify

```bash
npm run verify
```

This builds the CLI, regenerates host packs, and runs the node-based test suite.
