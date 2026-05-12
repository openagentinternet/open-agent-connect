# Open Agent Connect Host Bind Acceptance Checklist

Use this document for release-style manual verification after the shared install flow is already complete.
Do not treat this file as the primary install guide.

The install source of truth remains `docs/install/open-agent-connect.md`.

## Scope

This checklist verifies that shared MetaBot skills are installed once under `~/.metabot/skills/` and then correctly exposed into the supported host-native skill roots.

## Preconditions

Before running this checklist, complete the shared install flow from `docs/install/open-agent-connect.md` and ensure:

- `metabot doctor` already passes
- the shared skill files exist under `~/.metabot/skills/`
- the machine has at least one target host available

## Codex

- run `metabot host bind-skills --host codex`
- confirm `${CODEX_HOME:-$HOME/.codex}/skills/metabot-network-manage` is a symlink
- confirm `${CODEX_HOME:-$HOME/.codex}/skills/metabot-chat-privatechat` is a symlink
- confirm `${CODEX_HOME:-$HOME/.codex}/skills/metabot-call-remote-service` is a symlink
- start a fresh Codex session if the current one does not pick up new skills
- verify one no-host resolve call: `metabot skills resolve --skill metabot-network-directory --format markdown`

## Claude Code

- run `metabot host bind-skills --host claude-code`
- confirm `${CLAUDE_HOME:-$HOME/.claude}/skills/metabot-network-manage` is a symlink
- confirm `${CLAUDE_HOME:-$HOME/.claude}/skills/metabot-chat-privatechat` is a symlink
- confirm `${CLAUDE_HOME:-$HOME/.claude}/skills/metabot-call-remote-service` is a symlink
- start a fresh Claude Code session if the current one does not pick up new skills
- verify one no-host resolve call: `metabot skills resolve --skill metabot-network-directory --format markdown`

## OpenClaw

- run `metabot host bind-skills --host openclaw`
- confirm `${OPENCLAW_HOME:-$HOME/.openclaw}/skills/metabot-network-manage` is a symlink
- confirm `${OPENCLAW_HOME:-$HOME/.openclaw}/skills/metabot-chat-privatechat` is a symlink
- confirm `${OPENCLAW_HOME:-$HOME/.openclaw}/skills/metabot-call-remote-service` is a symlink
- start a fresh OpenClaw session if the current one does not pick up new skills
- verify one no-host resolve call: `metabot skills resolve --skill metabot-network-directory --format markdown`
