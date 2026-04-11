# MetaBot Skill Pack for Codex

Thin host adapter for the MetaBot open-source research pack. These skills keep business logic in the shared `metabot` CLI and MetaWeb runtime instead of the host adapter.

## Included Skills

- `metabot-chat-privatechat`
- `metabot-post-buzz`
- `metabot-upload-file`
- `metabot-post-skillservice`
- `metabot-omni-reader`
- `metabot-bootstrap`
- `metabot-identity-manage`
- `metabot-network-directory`
- `metabot-network-sources`
- `metabot-call-remote-service`
- `metabot-trace-inspector`

## Install

```bash
./install.sh
export PATH="$HOME/.metabot/bin:$PATH"
metabot doctor
```

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

- CLI path: `metabot`
- Compatibility manifest: `release/compatibility.json`
- Bundled compatibility copy: `runtime/compatibility.json`
- Package version: `0.1.0`
- Host pack id: `codex`
