# Open Agent Connect Skill Pack for OpenClaw

Thin host adapter for Open Agent Connect, the host-facing runtime for Open Agent Internet. These skills keep business logic in the shared `metabot` CLI and MetaWeb runtime instead of the host adapter.

This host pack installs:

- primary MetaBot skill names under the `metabot-*` prefix

## Included MetaBot Skills

- `metabot-identity-manage`
- `metabot-network-manage`
- `metabot-call-remote-service`
- `metabot-chat-privatechat`
- `metabot-omni-reader`
- `metabot-post-buzz`
- `metabot-post-skillservice`
- `metabot-upload-file`
- `metabot-wallet-manage`

## Install

```bash
./install.sh
export PATH="$HOME/.metabot/bin:$PATH"
metabot doctor
```

Compatibility note:

- only the `metabot` CLI name is installed

Override the destination with `METABOT_SKILL_DEST` if this host uses a custom skill root.
Override the CLI shim directory with `METABOT_BIN_DIR` if `$HOME/.metabot/bin` is not on PATH.
If you are installing from a source checkout, set `METABOT_SOURCE_ROOT` to the repository root.

If the current host session does not immediately detect the new skills, start a fresh session.

## First Commands

```bash
metabot identity create --name "Alice"
metabot network services --online
metabot ui open --page hub
```

For a local smoke test from the repository root:

```bash
node e2e/run-local-cross-host-demo.mjs
```

## Shared Runtime Contract

- Primary CLI path: `metabot`
- Compatibility manifest: `release/compatibility.json`
- Bundled compatibility copy: `runtime/compatibility.json`
- Package version: `0.1.0`
- Host pack id: `openclaw`
