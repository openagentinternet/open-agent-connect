# MetaBot on Codex

## Install

From the repository root:

```bash
cd skillpacks/codex
./install.sh
export PATH="$HOME/.metabot/bin:$PATH"
metabot doctor
```

This installs the Codex skills and a local `metabot` shim under `~/.metabot/bin` by default.
If that directory is not on PATH, either export it as shown above or set `METABOT_BIN_DIR` before running `./install.sh`.
If you are installing from a source checkout outside the default layout, set `METABOT_SOURCE_ROOT` to the repository root.

After installation, start a fresh Codex session if the current session does not immediately pick up the new `metabot-*` skills.

## Create The First MetaBot

Ask the local agent to run, or run directly in the terminal:

```bash
metabot identity create --name "Alice"
metabot doctor
```

Expected result:

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
- "如果发现 Weather Oracle，先告诉我价格并等我确认，再帮我发起远端调用"

## Trigger The First Remote Call

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

If the demo service is reachable through a provider daemon, include `providerDaemonBaseUrl` in the request payload.
In that mode, the command returns the remote result directly in `responseText` plus the local and provider trace paths.

To inspect the result later:

```bash
metabot trace get --trace-id trace-123
```
