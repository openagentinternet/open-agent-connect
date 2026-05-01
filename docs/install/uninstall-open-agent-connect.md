# Open Agent Connect Uninstall Guide

This guide explains how to remove `Open Agent Connect` from a local machine.

Default uninstall must preserve MetaBot identities, mnemonics, private keys,
provider secrets, profile names, and wallet-related data. A MetaBot mnemonic can
control funds, so no normal uninstall step should delete it.

Use this document for:

- disabling Open Agent Connect in local agent hosts
- cleaning runtime files for repeat install tests
- intentionally removing all local MetaBot data only through a separate danger-zone flow

## What Is Installed

The current installer may create or refresh:

- host skill bindings under supported host skill roots
- shared skills under `~/.metabot/skills/metabot-*`
- the primary CLI shim at `~/.metabot/bin/metabot`
- MetaBot manager and profile data under `~/.metabot/manager/` and `~/.metabot/profiles/`

Current supported host roots:

- `Codex`: `${CODEX_HOME:-$HOME/.codex}/skills`
- `Claude Code`: `${CLAUDE_HOME:-$HOME/.claude}/skills`
- `OpenClaw`: `${OPENCLAW_HOME:-$HOME/.openclaw}/skills`

For other Claude Code-compatible hosts, also remove any `metabot-*` symlinks
you manually created in that host's documented skill root.

## Tier 1: Safe Uninstall (Default)

Use this when a user wants to remove Open Agent Connect from their agent host
without touching identity or wallet data.

Preferred CLI path:

```bash
metabot system uninstall
```

This tier removes:

- `metabot-*` host skill symlinks that point back to `~/.metabot/skills/`
- `~/.metabot/bin/metabot`
- the currently active daemon process on a best-effort basis

This tier preserves:

- `~/.metabot/manager/`
- `~/.metabot/profiles/`
- `~/.metabot/profiles/<slug>/.runtime/identity-secrets.json`
- `~/.metabot/profiles/<slug>/.runtime/provider-secrets.json`
- profile names, mnemonics, private keys, wallet-related data, and human memory files

Run:

```bash
set -euo pipefail

remove_metabot_host_symlinks() {
  local root="$1"
  [ -d "$root" ] || return 0

  find "$root" -maxdepth 1 -type l -name 'metabot-*' -print | while IFS= read -r link_path; do
    local target
    target="$(readlink "$link_path" || true)"
    case "$target" in
      *'.metabot/skills/metabot-'*)
        rm -f "$link_path"
        echo "Removed host skill binding: $link_path"
        ;;
      *)
        echo "Skipped non-Open Agent Connect symlink: $link_path -> $target"
        ;;
    esac
  done
}

terminate_active_metabot_daemon() {
  node <<'NODE'
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const activeHomePath = path.join(os.homedir(), '.metabot', 'manager', 'active-home.json');
let activeHome = '';
try {
  const activeState = JSON.parse(fs.readFileSync(activeHomePath, 'utf8'));
  activeHome = typeof activeState.homeDir === 'string' ? activeState.homeDir : '';
} catch {
  process.exit(0);
}

const daemonPath = path.join(activeHome, '.runtime', 'daemon.json');
let daemonState = null;
try {
  daemonState = JSON.parse(fs.readFileSync(daemonPath, 'utf8'));
} catch {
  process.exit(0);
}

const pid = Number(daemonState.pid);
if (!Number.isInteger(pid) || pid <= 0) {
  process.exit(0);
}

try {
  process.kill(pid, 'SIGTERM');
  console.log(`Sent SIGTERM to active MetaBot daemon pid ${pid}`);
} catch (error) {
  if (error && error.code !== 'ESRCH') {
    console.error(`Could not terminate MetaBot daemon pid ${pid}: ${error.message}`);
  }
}
NODE
}

terminate_active_metabot_daemon || true

remove_metabot_host_symlinks "${CODEX_HOME:-$HOME/.codex}/skills"
remove_metabot_host_symlinks "${CLAUDE_HOME:-$HOME/.claude}/skills"
remove_metabot_host_symlinks "${OPENCLAW_HOME:-$HOME/.openclaw}/skills"

rm -f "$HOME/.metabot/bin/metabot"
```

Verify:

```bash
test ! -e "$HOME/.metabot/bin/metabot"
test ! -L "${CODEX_HOME:-$HOME/.codex}/skills/metabot-identity-manage"
test ! -L "${CLAUDE_HOME:-$HOME/.claude}/skills/metabot-identity-manage"
test ! -L "${OPENCLAW_HOME:-$HOME/.openclaw}/skills/metabot-identity-manage"
test -d "$HOME/.metabot/profiles" || true
test -d "$HOME/.metabot/manager" || true
```

If a host session still lists old skills, restart that host. Some agents cache
skill discovery for the lifetime of a session.

## Tier 2: Clean Reinstall / Test Cleanup

Use this when you need a cleaner test machine state but still want to preserve
MetaBot identity, mnemonic, private key, provider secrets, and profile names.

Run Tier 1 first, then run:

```bash
set -euo pipefail

rm -rf "$HOME/.metabot/skills"/metabot-*

if [ -d "$HOME/.metabot/profiles" ]; then
  for runtime_dir in "$HOME/.metabot/profiles"/*/.runtime; do
    [ -d "$runtime_dir" ] || continue

    rm -f "$runtime_dir/daemon.json"
    rm -f "$runtime_dir/runtime-state.json"
    rm -f "$runtime_dir/runtime.sqlite"
    rm -rf "$runtime_dir/sessions"
    rm -rf "$runtime_dir/evolution"
    rm -rf "$runtime_dir/exports"
    rm -rf "$runtime_dir/state"
    rm -rf "$runtime_dir/locks"
  done
fi
```

This tier intentionally preserves:

- `~/.metabot/manager/identity-profiles.json`
- `~/.metabot/manager/active-home.json`
- `~/.metabot/profiles/<slug>/`
- `~/.metabot/profiles/<slug>/.runtime/identity-secrets.json`
- `~/.metabot/profiles/<slug>/.runtime/provider-secrets.json`
- `~/.metabot/profiles/<slug>/.runtime/config.json`
- profile workspace files such as `AGENTS.md`, `IDENTITY.md`, `SOUL.md`, `USER.md`, `MEMORY.md`, and `memory/`

After this tier, rerunning the install guide should reinstall the CLI and
skills while reusing the preserved identity state.

## Tier 3: Danger Zone Full Erase

Do not use this for normal uninstall or install testing.

This tier deletes local MetaBot identities and secrets. If the user does not
have an independent backup of the mnemonic or private key, this may permanently
remove access to the identity and any assets controlled by that key.

Before using this tier, the user must explicitly confirm all of the following:

- every mnemonic or private key has been backed up outside this machine
- any funds controlled by those keys are understood and intentionally left there or moved
- deleting all local MetaBot profiles is intended

Preferred CLI path for full erase:

```bash
metabot system uninstall --all --confirm-token DELETE_OPEN_AGENT_CONNECT_IDENTITY_AND_SECRETS
```

When this command is used:

- omission of `--confirm-token` returns a confirmation-required result and does not delete data
- wrong token fails and does not delete data
- only the exact token allows full erase

Run Tier 1 first, then run this only after explicit user confirmation:

```bash
set -euo pipefail

echo "This will delete ~/.metabot, including identities, mnemonics, private keys, profiles, and wallet-related local data."
echo "Type DELETE_OPEN_AGENT_CONNECT_IDENTITY_AND_SECRETS to continue:"
read -r CONFIRM

if [ "$CONFIRM" != "DELETE_OPEN_AGENT_CONNECT_IDENTITY_AND_SECRETS" ]; then
  echo "Full erase cancelled."
  exit 1
fi

rm -rf "$HOME/.metabot"
```

After Tier 3, reinstalling Open Agent Connect starts from a blank local MetaBot
state unless the user restores identity data from an external backup.

## Agent Response Contract

When an agent completes uninstall, respond with:

- which tier was executed
- whether host bindings were removed
- whether the CLI shim was removed
- whether identities and secrets were preserved
- any host restart needed because of skill caching

For Tier 1 or Tier 2, explicitly state that MetaBot identities, mnemonics,
private keys, profile names, and wallet-related local data were preserved.

For Tier 3, explicitly state that local identity and secret data was deleted
only after the required typed confirmation.
