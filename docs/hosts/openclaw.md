# Open Agent Connect on OpenClaw

## Install Entry

Use the unified install guide as the primary install source:

- `docs/install/open-agent-connect.md`

## OpenClaw Binding Model

The shared MetaBot skill source of truth lives under `~/.metabot/skills/`.
OpenClaw exposure is a bind step that projects `metabot-*` entries into `${OPENCLAW_HOME:-$HOME/.openclaw}/skills`.

Bind OpenClaw exposure with:

```bash
metabot host bind-skills --host openclaw
```

After bind, OpenClaw should see host-native `metabot-*` entries while the canonical shared content still lives in `~/.metabot/skills/`.
If the current OpenClaw session does not immediately pick up the new skills, start a fresh session.

## Common Resolve Check

Common `skills resolve` usage now defaults to the shared contract and does not require `--host`:

```bash
metabot skills resolve --skill metabot-network-directory --format markdown
```

## First Actions

```bash
metabot identity who
metabot network services --online
metabot ui open --page hub
```

If identity is missing:

```bash
metabot identity create --name "Alice"
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
