# Open Agent Connect on Codex

## Install

From the repository root:

```bash
cd skillpacks/codex
./install.sh
export PATH="$HOME/.metabot/bin:$PATH"
metabot doctor
```

This installs the Codex skills plus a primary `metabot` shim under `~/.metabot/bin` by default.
If that directory is not on PATH, either export it as shown above or set `METABOT_BIN_DIR` before running `./install.sh`.
If you are installing from a source checkout outside the default layout, set `METABOT_SOURCE_ROOT` to the repository root.

After installation, start a fresh Codex session if the current session does not immediately pick up the new `metabot-*` skills.

## Evolution Network M1 (Local Only)

M1 enables local self-repair for `metabot-network-directory` only.

- Total feature flag: `evolution_network.enabled`
- Installed `metabot-network-directory` remains a stable host skill identity, but the installed copy is a runtime-resolve shim
- The shim should resolve the live contract before execution:

```bash
metabot skills resolve --skill metabot-network-directory --host codex --format markdown
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

Ask the local agent to run, or run directly in the terminal:

```bash
metabot identity create --name "Alice"
metabot doctor
```

Expected result:

- if the bootstrap output includes `subsidyState`, it should become `claimed`
- `identity_loaded` should become `true`
- the daemon should stay reachable

## View Online Services

`metabot network services --online` reads the public chain directory first, using `/protocols/skill-service` for services and `/protocols/metabot-heartbeat` for online filtering.

For agent-readable discovery:

```bash
metabot network services --online
```

For the local yellow-pages page:

```bash
metabot ui open --page hub
```

If you want to inject one remote demo provider as a local fallback source:

```bash
metabot network sources add --base-url http://127.0.0.1:4827 --label weather-demo
```

In Codex, the natural-language intent is usually one of these:

- "帮我创建一个叫 Alice 的 MetaBot"
- "帮我展示所有在线 MetaBot 服务"
- "如果发现 Weather Oracle，先告诉我预计花费并等我确认，再帮我发起远端委派"

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

Then call:

```bash
metabot services call --request-file request.json
```

What to expect:

- today the public policy is conservative: `confirm_all`
- the current host session should present this as remote delegation confirmation, not as a buy flow
- if the demo service is reachable through a provider daemon, `providerDaemonBaseUrl` acts as an optional transport hint for the first public demo
- if the remote MetaBot returns quickly, the result may already be present in `responseText`
- otherwise the command should still return a `traceId` so Codex can keep following the same remote MetaBot run

Keep the host session updated with:

```bash
metabot trace watch --trace-id trace-123
metabot trace get --trace-id trace-123
```

Important timeout semantics:

- `timeout` is not the same as `failed`
- in v1 it means Codex stopped foreground waiting, but the remote MetaBot may still continue processing

Recommend the local inspector when:

- timeout occurs
- clarification appears
- manual action is required
- the user asks for deeper details

If the runtime returns an exact `localUiUrl`, prefer opening that URL. The local HTML inspector is for human observation only; the main wow moment should still stay inside the Codex session.

Future note:

- v1 publicly uses `confirm_all`
- the runtime leaves room for `confirm_paid_only` and `auto_when_safe`, but those are future policy modes, not current promises
