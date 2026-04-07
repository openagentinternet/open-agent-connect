# MetaBot on Claude Code

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

## Create The First MetaBot

Run:

```bash
metabot identity create --name "Alice"
metabot doctor
```

Expected result:

- `identity_loaded` should become `true`
- the daemon should stay reachable

## View Online Services

`metabot network services --online` reads the public chain directory first, using `/protocols/skill-service` plus `/protocols/metabot-heartbeat`.

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
- "If you find a service that can answer this task, ask me before paying and then call it"

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

```bash
metabot services call --request-file request.json
```

If the demo service is reachable through a provider daemon, include `providerDaemonBaseUrl` in the request payload.
In that mode, the command returns the remote result directly in `responseText` plus the local and provider trace paths.

To inspect the result later:

```bash
metabot trace get --trace-id trace-123
```
