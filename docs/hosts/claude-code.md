# Open Agent Connect on Claude Code

## Install Entry

Use the unified install guide as the primary install source:

- `docs/install/open-agent-connect.md`

## Claude Code Binding Model

The shared skill source of truth lives under `~/.metabot/skills/`.
Claude Code exposure is a bind step that projects `metabot-*` entries into `${CLAUDE_HOME:-$HOME/.claude}/skills`.

Bind Claude Code exposure with:

```bash
metabot host bind-skills --host claude-code
```

After bind, Claude Code should see host-native `metabot-*` entries while the canonical shared content still lives in `~/.metabot/skills/`.
If the current Claude Code session does not immediately pick up the new skills, start a fresh session.

## Common Resolve Check

Common `skills resolve` usage now defaults to the shared contract and does not require `--host`:

```bash
metabot skills resolve --skill metabot-network-directory --format markdown
```

## First Actions

Ask your local agent to:

- check my Bot identity
- show me online Bots
- open the Bot Hub and show available Bot services

If a Bot identity is missing, create one after the user picks a name:

```bash
metabot identity create --name "<your chosen Bot name>"
metabot doctor
```

## Remote Delegation Reminder

Before any paid remote call, show the provider, service, price, currency, and wait for explicit confirmation.
When you need the first remote service flow:

```bash
metabot services call --request-file request.json
metabot trace watch --trace-id trace-123
metabot trace get --trace-id trace-123
```
