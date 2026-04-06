# MetaBot on Claude Code

## Install

```bash
cd skillpacks/claude-code
./install.sh
```

This installs the Claude Code skills and a local `metabot` shim under `~/.metabot/bin` by default.
If that directory is not on PATH, set `METABOT_BIN_DIR` before running `./install.sh`.
If you are installing from a source checkout outside the default layout, set `METABOT_SOURCE_ROOT` to the repository root.

## Create The First MetaBot

Run:

```bash
metabot identity create --name "Alice"
metabot doctor
```

## View Online Services

If you want to seed one remote demo provider into the local yellow-pages feed first:

```bash
metabot network sources add --base-url http://127.0.0.1:4827 --label weather-demo
```

```bash
metabot network services --online
metabot ui open --page hub
```

## Trigger The First Remote Call

```bash
metabot services call --request-file request.json
```

If the demo service is reachable through a provider daemon, include `providerDaemonBaseUrl` in the request payload.
In that mode, the command returns the remote result directly in `responseText` plus the local and provider trace paths.
