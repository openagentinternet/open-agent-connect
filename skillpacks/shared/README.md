# Shared MetaBot Skills for Open Agent Connect

This shared pack installs the host-neutral MetaBot skills into `~/.metabot/skills` and installs the primary `metabot` shim at `$HOME/.metabot/bin/metabot`.

## Included MetaBot Skills

- `metabot-ask-master`
- `metabot-help`
- `metabot-identity-manage`
- `metabot-network-manage`
- `metabot-call-remote-service`
- `metabot-chat-privatechat`
- `metabot-omni-reader`
- `metabot-post-buzz`
- `metabot-post-skillservice`
- `metabot-loom-wish2task`
- `metabot-upload-file`
- `metabot-wallet-manage`

## Install

```bash
./install.sh
export PATH="$HOME/.metabot/bin:$PATH"
$HOME/.metabot/bin/metabot --help
$HOME/.metabot/bin/metabot identity --help
```

Override the shared skill destination with `METABOT_SHARED_SKILL_DEST` if you need a non-default shared root.
Override the CLI shim directory with `METABOT_BIN_DIR` if `$HOME/.metabot/bin` is not on PATH.
If you are installing from a source checkout, set `METABOT_SOURCE_ROOT` to the repository root.
If you already have a bundled CLI entry, set `METABOT_CLI_ENTRY` directly.

## Shared Runtime Contract

- Primary CLI path: `$HOME/.metabot/bin/metabot`
- Compatibility manifest: `release/compatibility.json`
- Bundled compatibility copy: `runtime/compatibility.json`
- Bundled CLI entry: `runtime/dist/cli/main.js`
- Package version: `0.2.18`
