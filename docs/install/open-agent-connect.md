# Open Agent Connect Install Guide

This is the single normative install guide for `Open Agent Connect`.

Use this document for:

- shared runtime installation
- host skill binding for `Codex`, `Claude Code`, and `OpenClaw`
- post-install verification
- first-run identity handoff

## Prerequisites

Before running install commands, verify:

- repository root contains `package.json`
- repository root contains `skillpacks/shared/install.sh`
- `node` exists and version is `>=20 <25`
- `npm` exists
- at least one target host is available: `Codex`, `Claude Code`, or `OpenClaw`

## Build The Runtime And Shared Skillpacks

Run from the repository root:

```bash
npm install
npm run build
npm run build:skillpacks
```

## Install The Shared MetaBot Runtime

Run from the repository root:

```bash
cd skillpacks/shared
./install.sh
export PATH="$HOME/.metabot/bin:$PATH"
command -v metabot
```

This installs:

- shared MetaBot skills under `~/.metabot/skills/`
- the primary CLI shim under `~/.metabot/bin/metabot`

If the CLI is not on `PATH`, either export `PATH` as shown above or set `METABOT_BIN_DIR` before running `./install.sh`.

## Bind One Host

Choose the host you want to expose immediately after the shared install:

```bash
metabot host bind-skills --host codex
metabot host bind-skills --host claude-code
metabot host bind-skills --host openclaw
```

Each bind projects `metabot-*` entries into the host-native skill root as symlinks back to `~/.metabot/skills/`.

Default host-native roots:

- `Codex`: `${CODEX_HOME:-$HOME/.codex}/skills`
- `Claude Code`: `${CLAUDE_HOME:-$HOME/.claude}/skills`
- `OpenClaw`: `${OPENCLAW_HOME:-$HOME/.openclaw}/skills`

## Bind Multiple Hosts

If you want one machine to serve multiple local hosts, run the shared install once and then bind each host separately:

```bash
metabot host bind-skills --host codex
metabot host bind-skills --host claude-code
metabot host bind-skills --host openclaw
```

This keeps one canonical shared skill root while exposing the same `metabot-*` entries into multiple host-native skill trees.

## Post-Install Verification

Run:

```bash
metabot doctor
metabot --help
metabot identity --help
```

Success criteria:

- `metabot doctor` exits with code `0`
- `metabot doctor` output includes `daemon_reachable`
- `metabot` and `metabot identity` help commands run successfully

Then verify the shared skill files exist:

```bash
SHARED_ASK_MASTER="$HOME/.metabot/skills/metabot-ask-master/SKILL.md"
SHARED_NETWORK_SKILL="$HOME/.metabot/skills/metabot-network-manage/SKILL.md"
SHARED_CHAT_SKILL="$HOME/.metabot/skills/metabot-chat-privatechat/SKILL.md"
test -f "$SHARED_ASK_MASTER"
test -f "$SHARED_NETWORK_SKILL"
test -f "$SHARED_CHAT_SKILL"
```

Optional host binding verification:

```bash
test -L "${CODEX_HOME:-$HOME/.codex}/skills/metabot-ask-master"
test -L "${CLAUDE_HOME:-$HOME/.claude}/skills/metabot-ask-master"
test -L "${OPENCLAW_HOME:-$HOME/.openclaw}/skills/metabot-ask-master"
```

If the shared skill files are correct but a host still behaves as if the skills are stale, restart that host session and retry.

## Common Skill Resolution Check

Common `skills resolve` usage now defaults to the shared skill contract and does not require `--host`:

```bash
metabot skills resolve --skill metabot-network-directory --format markdown
```

Use explicit `--host` only when you need to inspect one host override path.

## First-Run Identity Handoff

After install verification succeeds, continue with the identity flow:

```bash
metabot identity who
```

If identity is missing:

```bash
metabot identity create --name "Alice"
metabot doctor
```

Expected:

- identity is loaded
- doctor still reports daemon reachable

If create returns `identity_name_conflict`, do not manually patch runtime files. Use:

```bash
metabot identity list
metabot identity assign --name "<existing-metabot-name>"
metabot identity who
```

Agent-facing handoff rules:

- keep CLI execution internal
- use natural-language prompts for the user
- use the same language as the user
- if identity already exists, report current name and globalMetaId
- if identity is missing, ask for a natural-language create intent and complete the create flow

## Release-Style Host Acceptance

Keep this install guide install-only.
If you need manual cross-host acceptance after installation, use:

- `docs/acceptance/open-agent-connect-host-bind-checklist.md`
