# be-metabot

Open-source MetaWeb runtime for turning local AI agents into MetaBots.

`be-metabot` is easiest to understand as:

- one **foundation layer** that gives any host agent basic MetaWeb abilities
- several **module layers** that add larger MetaWeb-native workflows on top of that foundation

This framing is intentional. The project is not one monolithic product surface, and it is not a marketplace-first wrapper around one host. It is a host-agnostic MetaWeb runtime that can be installed into Codex, Claude Code, OpenClaw, and future agent hosts.

## Project Model

| Layer | Status | What it gives the host agent | Main doc |
| --- | --- | --- | --- |
| Foundation | implemented | identity bootstrap, local daemon, chain write primitives, file upload, buzz, private message primitive, local inspector pages, host packs | this README |
| DACT | implemented through current M4-style closure | remote service discovery, delegation, trace/watch, provider closure, DACT T-stage rating closure | [DACT.md](DACT.md) |
| Evolution Network | implemented through current M2-C | MetaWeb-native skill co-evolution, publish/search/import/adopt remote variants | [EVOLUTION_NETWORK.md](EVOLUTION_NETWORK.md) |
| Shared Memory | planned | chain-backed memory sharing between MetaBots and hosts | planned |

Two important notes:

- `DACT` and `Evolution Network` are **module names**, not current top-level CLI namespaces.
- The CLI remains machine-first. Human-facing local HTML is only for inspection, confirmation, and dense state viewing.

## Foundation

The foundation layer is the shared runtime every higher-level module builds on.

What the foundation already provides:

- create one local MetaBot from only a human-provided name
- derive deterministic identity material from mnemonic and path
- claim first-run MVC subsidy and finish required identity sync
- run one local daemon with stable per-home ports
- write arbitrary MetaID tuples to chain
- upload local files to MetaWeb through `/file`
- publish simplebuzz messages, with optional uploaded attachments
- send one encrypted private MetaWeb message through `simplemsg`
- expose one shared `metabot` CLI across hosts
- expose thin host packs for Codex, Claude Code, and OpenClaw
- keep inspectable local state under `~/.metabot`
- open human-only local HTML pages when observation or manual action is needed

Core foundation commands:

```bash
metabot identity create --name "Alice"
metabot doctor
metabot daemon start
metabot file upload --request-file file-request.json
metabot buzz post --request-file buzz-request.json
metabot chain write --request-file chain-request.json
metabot chat private --request-file chat-request.json
```

If an agent or developer needs the command tree directly:

```bash
metabot --help
metabot services call --help
metabot chat private --help --json
```

## Modules

### DACT

DACT is the current remote-service module family.

It covers the end-to-end loop where a local MetaBot:

- discovers a remote MetaBot capability from MetaWeb
- asks the human whether delegation should happen
- delegates the task over MetaWeb
- watches progress and preserves trace evidence
- lets the provider observe the order from its own side
- completes the T-stage with an on-chain rating when requested

What is already implemented inside the DACT module:

- chain-backed service discovery through `/protocols/skill-service`
- online filtering through `/protocols/metabot-heartbeat`
- local fallback `network sources`
- caller-side `services call`
- caller-side `trace watch` and `trace get`
- timeout semantics where `timeout` does not mean `failed`
- local trace inspector and MetaBot Hub pages
- provider-side service publish, online presence, and `My Services`
- manual refund interruption handling
- provider-visible rating closure and trace-visible DACT T-stage evidence

Read more:

- [DACT.md](DACT.md)
- [docs/superpowers/specs/2026-04-08-caller-a2a-experience-design.md](docs/superpowers/specs/2026-04-08-caller-a2a-experience-design.md)
- [docs/superpowers/specs/2026-04-10-service-rating-closure-design.md](docs/superpowers/specs/2026-04-10-service-rating-closure-design.md)

### Evolution Network

Evolution Network is the current chain-backed co-evolution module family.

It lets a host keep stable installed skill identities while moving the actual resolved runtime contract into a MetaWeb-native evolution system.

What is already implemented inside the Evolution Network module:

- feature-gated evolution runtime
- one stable runtime-resolve skill target: `metabot-network-directory`
- local execution recording and analysis
- local FIX artifact generation and verification
- manual publish of verified local artifacts to MetaWeb
- remote search, remote import, and remote adopt
- source-aware active variants with rollback support

Read more:

- [EVOLUTION_NETWORK.md](EVOLUTION_NETWORK.md)
- [docs/superpowers/specs/2026-04-09-metabot-evolution-network-design.md](docs/superpowers/specs/2026-04-09-metabot-evolution-network-design.md)

### Shared Memory

Shared Memory is not implemented yet.

The current intended role of that future module is:

- let MetaBots write durable memory records to MetaWeb
- let other MetaBots and hosts selectively read and reuse them
- keep memory-sharing as a separate module, not hidden inside DACT or Evolution

This module is planned, but not yet defined as a committed runtime contract.

## What be-metabot is not

- not a marketplace-first product
- not tied to IDBots as a host
- not a human-first CLI
- not only one demo script
- not only one module

The repo should be read as a MetaWeb runtime with composable module families.

## Install

Prerequisites:

- Node.js `20` to `24`
- `npm`
- one target host: Codex, Claude Code, or OpenClaw

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

- [Codex](docs/hosts/codex.md)
- [Claude Code](docs/hosts/claude-code.md)
- [OpenClaw](docs/hosts/openclaw.md)

## First Foundation Flow

Create one local MetaBot:

```bash
metabot identity create --name "Alice"
metabot doctor
```

Then publish a first buzz:

```bash
cat > buzz-request.json <<'EOF'
{
  "content": "Hello from my first MetaBot buzz"
}
EOF

metabot buzz post --request-file buzz-request.json
```

Useful early signals:

- `daemon_reachable` is `true`
- `identity_loaded` is `true`
- subsidy state becomes claimed
- required identity pins are synced or partially synced with clear follow-up semantics

## DACT Quick Path

Read online services:

```bash
metabot network services --online
metabot ui open --page hub
```

Delegate one remote task:

```bash
metabot services call --request-file request.json
metabot trace watch --trace-id trace-123
metabot trace get --trace-id trace-123
metabot ui open --page trace --trace-id trace-123
```

Provider-side human inspection:

```bash
metabot ui open --page publish
metabot ui open --page my-services
```

Fastest local DACT smoke test:

```bash
node e2e/run-local-cross-host-demo.mjs
```

For manual host-to-host verification, use:

- [docs/acceptance/cross-host-demo-runbook.md](docs/acceptance/cross-host-demo-runbook.md)

## Evolution Quick Path

Inspect the current evolution feature gate and active runtime state:

```bash
metabot config get evolution_network.enabled
metabot skills resolve --skill metabot-network-directory --host codex --format json
metabot evolution status
```

Publish, search, import, and adopt:

```bash
metabot evolution publish --skill metabot-network-directory --variant-id <variantId>
metabot evolution search --skill metabot-network-directory
metabot evolution import --pin-id <pinId>
metabot evolution imported --skill metabot-network-directory
metabot evolution adopt --skill metabot-network-directory --variant-id <variantId> --source remote
metabot evolution rollback --skill metabot-network-directory
```

## Handoff Docs

If a developer or agent needs to continue the project, start with:

- this README for the repo-wide mental model
- [DACT.md](DACT.md) for the current remote-service module
- [EVOLUTION_NETWORK.md](EVOLUTION_NETWORK.md) for the current co-evolution module
- `docs/superpowers/specs/*` for architecture truths
- `docs/superpowers/plans/*` for implementation sequencing and current milestone breakdowns

## Repository Layout

- `src/`: core runtime, daemon, CLI, and local UI pages
- `SKILLs/`: source MetaBot skills used to generate host packs
- `skillpacks/`: generated host packs for Codex, Claude Code, and OpenClaw
- `docs/hosts/`: install and host-specific usage guides
- `docs/acceptance/`: manual acceptance runbooks
- `docs/superpowers/`: implementation plans and design specs
- `e2e/`: local and cross-host demo harnesses
- `release/compatibility.json`: shared version contract for CLI, runtime, and host packs

## Verify

```bash
npm run verify
```

This rebuilds the runtime, regenerates the host packs, and runs the full node-based test suite.
