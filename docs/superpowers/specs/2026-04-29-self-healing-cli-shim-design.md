# Self-Healing CLI Shim Design

**Date:** 2026-04-29
**Status:** Approved

## Problem

`shared-install.sh` hardcodes the absolute `CLI_ENTRY` path into the generated `metabot` shim at install time. When the install source is a macOS temp directory (e.g. `/var/folders/.../tmp/...`), the path is cleaned up on reboot. The shim then fails with `MODULE_NOT_FOUND`, the daemon never starts, and all MetaBot skills are broken until the user manually reinstalls.

The daemon's own auto-start logic (`ensureDaemonBaseUrl` in `runtime.ts`) is not the problem — it works correctly once the CLI is reachable. The failure is upstream: the shim itself cannot load Node.

## Root Cause

`write_cli_shim` in `shared-install.sh` generates:

```bash
#!/usr/bin/env bash
set -euo pipefail
exec node "/var/folders/.../tmp/.../dist/cli/main.js" "$@"
```

This path is valid at install time but not guaranteed to survive a reboot.

## Solution

Make the shim self-healing by adding a glob fallback. The shim tries the original hardcoded path first. If the file is missing, it searches `~/.metabot/installpacks/*/runtime/dist/cli/main.js` — the stable, reboot-safe location where `install.sh` always extracts the runtime tarball.

### Generated shim (new)

```bash
#!/usr/bin/env bash
set -euo pipefail
CLI_ENTRY="<path written at install time>"
if [ ! -f "$CLI_ENTRY" ]; then
  for _f in "$HOME/.metabot/installpacks"/*/runtime/dist/cli/main.js; do
    [ -f "$_f" ] && CLI_ENTRY="$_f" && break
  done
fi
[ -f "$CLI_ENTRY" ] || {
  echo "MetaBot CLI not found. Please reinstall: https://github.com/openagentinternet/open-agent-connect/releases/latest" >&2
  exit 1
}
exec node "$CLI_ENTRY" "$@"
```

### Key implementation notes

- Use a `for` loop with shell glob expansion instead of `ls` — avoids `ls` parsing issues, locale-dependent sort, and `set -e` interaction with a non-zero `ls` exit when no matches exist.
- The glob expands in filesystem-defined order (not guaranteed to be alphabetical). If multiple host packs are installed, any valid match is acceptable — all packs installed from the same release contain equivalent `main.js` builds. Installing different host packs from different release versions is not a supported configuration; the install flow always installs one host pack at a time and the user is expected to keep packs at the same version.
- `CLI_ENTRY` is always initialized to the primary path before the loop, so `set -u` is never triggered.
- Do **not** set `nullglob` in the shim. When no files match the glob, bash leaves the literal glob string as the loop variable. The `[ -f "$_f" ]` guard inside the loop handles this correctly — it will be false for the literal string, so the loop body is skipped and `CLI_ENTRY` remains the (missing) primary path. The subsequent `[ -f "$CLI_ENTRY" ]` check then triggers the error message.
- The `[ -f "$_f" ] && CLI_ENTRY="$_f" && break` pattern is `set -e`-safe. Under `set -e`, commands that appear as the condition of a `&&`/`||` list are exempt from `set -e` abort — a false `[ -f ]` makes the chain short-circuit without terminating the script. Do not rewrite this as separate `if` statements or add `|| true`.
- The `[ -f ]` check is intentionally the only validation. The shim does not verify that `main.js` is a valid Node module. If the file exists but is corrupt, Node will report the error directly. This is sufficient — the shim's job is to locate and exec, not to validate.

### Fallback resolution order

1. **Primary** — path hardcoded at install time (zero extra cost on normal invocations; the `if [ ! -f ]` check is a single `stat` call)
2. **Fallback** — shell glob over `~/.metabot/installpacks/*/runtime/dist/cli/main.js`, take first match
3. **Error** — print a clear reinstall message and exit non-zero

## Why the glob fallback is reliable

`install.sh` always extracts the runtime tarball to `~/.metabot/installpacks/<host>/runtime/`. This directory is under `$HOME`, not under `/var/folders/tmp`, so it survives reboots. The glob finds any installed host pack (codex, claude-code, openclaw) without needing to know which one was used.

## Scope

### Changed

- `skillpacks/codex/runtime/shared-install.sh` — `write_cli_shim` function
- `skillpacks/claude-code/runtime/shared-install.sh` — same
- `skillpacks/openclaw/runtime/shared-install.sh` — same

All three files are independent copies. There is no `skillpacks/shared/runtime/shared-install.sh` — the shared directory does not contain a runtime installer. All three must be updated together.

### Not changed

- `src/cli/runtime.ts` — `ensureDaemonBaseUrl` auto-start logic is correct and unchanged
- All skill SKILL.md files — no daemon recovery logic needed in skills
- Install flow — no new files, no new commands, no new env vars

## Behavior matrix

| Scenario | Primary path exists | Fallback finds file | Result |
|---|---|---|---|
| Normal invocation | yes | — | exec primary, zero extra stat |
| Post-reboot (temp cleaned) | no | yes | exec fallback silently |
| No valid install found | no | no | clear error + exit 1 |
| File exists but corrupt | yes | — | exec primary; Node reports the error |

"Exists" means `[ -f <path> ]` returns true — the file is present and is a regular file. The shim does not validate that the file is a valid Node module.

## Testing

1. **Normal**: run `metabot identity who` — should work as before.
2. **Simulated reboot**: `cp ~/.metabot/bin/metabot /tmp/test-shim && chmod +x /tmp/test-shim`, edit the primary `CLI_ENTRY` in `/tmp/test-shim` to a nonexistent path, then run `bash /tmp/test-shim identity who` as the same user. The copy reads from the real `~/.metabot/installpacks` via `$HOME` — this is intentional, the test exercises the real fallback path against the live installpack. It should succeed and print the same output as a normal `metabot identity who`.
3. **Full failure**: in a test environment, run the shim with both the primary path and all installpack `main.js` files absent — should print the reinstall message and exit 1.

The error message URL (`https://github.com/openagentinternet/open-agent-connect/releases/latest`) is hardcoded intentionally. If the repo moves, existing shims will need to be regenerated by reinstalling — this is acceptable given that a broken shim already requires reinstall.

## Out of scope

- launchd / systemd service registration (daemon auto-start on login)
- Skill-level daemon health checks
- Network-based auto-repair (re-download on failure)
