# Open Agent Connect on Claude Code

## Install

From the repository root:

```bash
cd skillpacks/claude-code
./install.sh
export PATH="$HOME/.metabot/bin:$PATH"
metabot doctor
```

This installs the Claude Code skills and a local `metabot` shim under `~/.metabot/bin` by default.
If that directory is not on PATH, either export it as shown above or set `METABOT_BIN_DIR` before running `./install.sh`.
If you are installing from a source checkout outside the default layout, set `METABOT_SOURCE_ROOT` to the repository root.

After installation, start a fresh Claude Code session if the current session does not immediately pick up the new `metabot-*` skills.

## Evolution Network M1 (Local Only)

M1 enables local self-repair for `metabot-network-directory` only.

- Total feature flag: `evolution_network.enabled`
- Installed `metabot-network-directory` remains a stable host skill identity, but the installed copy is a runtime-resolve shim
- The shim should resolve the live contract before execution:

```bash
metabot skills resolve --skill metabot-network-directory --host claude-code --format markdown
```

Useful M1 controls:

```bash
metabot config get evolution_network.enabled
metabot config set evolution_network.enabled false
metabot evolution status
metabot evolution rollback --skill metabot-network-directory
```

M1 does not include chain publication/search/import for evolution variants.

## Create The First MetaBot Identity

Run:

```bash
metabot identity create --name "Alice"
metabot doctor
```

Expected result:

- if the bootstrap output includes `subsidyState`, it should become `claimed`
- `identity_loaded` should become `true`
- the daemon should stay reachable

## View Online Services

`metabot network services --online` reads the public chain directory first, using `/protocols/skill-service` plus `https://api.idchat.io/group-chat/socket/online-users` (top 100).

```bash
metabot network services --online
metabot ui open --page hub
```

If you want to inject one remote demo provider as a local fallback source:

```bash
metabot network sources add --base-url http://127.0.0.1:4827 --label weather-demo
```

Useful natural-language prompts:

- "Create a MetaBot named Alice"
- "Show me all online MetaBot services"
- "If you find a remote MetaBot that can answer this task, ask me before delegation and then call it"

## Trigger The First Remote Delegation

Prepare a request file like this:

```json
{
  "request": {
    "servicePinId": "service-xxx",
    "providerGlobalMetaId": "id-provider-xxx",
    "providerDaemonBaseUrl": "http://127.0.0.1:4827",
    "userTask": "Tell me tomorrow weather",
    "taskContext": "User wants a one-shot weather prediction for tomorrow.",
    "spendCap": {
      "amount": "0.00005",
      "currency": "SPACE"
    }
  }
}
```

```bash
metabot services call --request-file request.json
```

What to expect:

- today the public confirmation policy is `confirm_all`
- Claude Code should present the step as remote delegation confirmation, not as buying something
- `providerDaemonBaseUrl` is only an optional demo transport hint when you have one
- if the remote MetaBot finishes quickly, the result may come back directly in `responseText`
- otherwise keep following the same trace id from the current host session

```bash
metabot trace watch --trace-id trace-123
metabot trace get --trace-id trace-123
```

Important timeout semantics:

- `timeout` does not mean the remote task failed
- it means foreground waiting ended while the remote MetaBot may still be processing

Recommend the local inspector when:

- timeout occurs
- clarification appears
- manual action is required
- the user asks for deeper evidence

If the runtime gives back a specific `localUiUrl`, use that exact URL for the inspector. The local HTML page is secondary and human-only.

Future note:

- v1 exposes only `confirm_all`
- the daemon shape preserves room for `confirm_paid_only` and `auto_when_safe` later, but those are not public guarantees today
