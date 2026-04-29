# Self-Healing CLI Shim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the generated `metabot` shim self-healing so it survives macOS reboots that clean `/var/folders/tmp`.

**Architecture:** The `write_cli_shim` function in `scripts/build-metabot-skillpacks.mjs` generates the shim content using `printf`. We change that function to emit a shim with a glob fallback: try the hardcoded primary path first, then search `~/.metabot/installpacks/*/runtime/dist/cli/main.js`. After changing the build script, run `npm run build:skillpacks` to regenerate all three host `shared-install.sh` files.

**Tech Stack:** Node.js (build script), bash (generated shim), Node.js native test runner (tests)

**Note on TDD:** The generated shim is a bash script — there is no automated test harness for it in this project. Manual verification (Tasks 3–4) is the accepted substitute. The test steps are defined before implementation is committed so the expected behavior is clear upfront.

---

## File Map

| File | Action | What changes |
|---|---|---|
| `scripts/build-metabot-skillpacks.mjs` | Modify | `write_cli_shim` function — emit self-healing shim |
| `skillpacks/codex/runtime/shared-install.sh` | Regenerated | `write_cli_shim` function body |
| `skillpacks/claude-code/runtime/shared-install.sh` | Regenerated | same |
| `skillpacks/openclaw/runtime/shared-install.sh` | Regenerated | same |

No new files. No changes to `src/`.

---

## Task 1: Update `write_cli_shim` in the build script

**Files:**
- Modify: `scripts/build-metabot-skillpacks.mjs` lines 261–269

The current `write_cli_shim` function (lines 261–269) looks like this:

```js
write_cli_shim() {
  local target_name="$1"
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    'set -euo pipefail' \
    "exec node \"$CLI_ENTRY\" "'"$@"' \
    > "$BIN_DIR/$target_name"
  chmod +x "$BIN_DIR/$target_name"
}
```

Replace it with the `printf`-based multi-line version below. This approach is used because the build script embeds bash inside a JS template literal — heredocs cannot be used inside template literals without escaping the backtick delimiter.

```js
write_cli_shim() {
  local target_name="$1"
  {
    printf '%s\n' '#!/usr/bin/env bash'
    printf '%s\n' 'set -euo pipefail'
    printf 'CLI_ENTRY="%s"\n' "$CLI_ENTRY"
    printf '%s\n' 'if [ ! -f "$CLI_ENTRY" ]; then'
    printf '%s\n' '  for _f in "$HOME/.metabot/installpacks"/*/runtime/dist/cli/main.js; do'
    printf '%s\n' '    [ -f "$_f" ] && CLI_ENTRY="$_f" && break'
    printf '%s\n' '  done'
    printf '%s\n' 'fi'
    printf '%s\n' '[ -f "$CLI_ENTRY" ] || {'
    printf '%s\n' '  echo "MetaBot CLI not found. Please reinstall: https://github.com/openagentinternet/open-agent-connect/releases/latest" >&2'
    printf '%s\n' '  exit 1'
    printf '%s\n' '}'
    printf '%s\n' 'exec node "$CLI_ENTRY" "$@"'
  } > "$BIN_DIR/$target_name"
  chmod +x "$BIN_DIR/$target_name"
}
```

**Important:** In the JS template literal context, `\n` in `printf '%s\n'` is a literal backslash-n that becomes a newline in the generated bash. The `$CLI_ENTRY`, `$BIN_DIR`, `$target_name` are bash variables (unescaped in the template literal). The `$HOME`, `$_f` are also bash variables — they appear inside single-quoted strings so they are not interpolated by JS.

- [ ] **Step 1: Verify the build script is valid JS before editing**

  ```bash
  node --check scripts/build-metabot-skillpacks.mjs
  ```

  Expected: no output.

- [ ] **Step 2: Replace the `write_cli_shim` function**

  Edit `scripts/build-metabot-skillpacks.mjs` lines 261–269. Replace the entire function body as shown above.

- [ ] **Step 3: Verify the build script is still valid JS after editing**

  ```bash
  node --check scripts/build-metabot-skillpacks.mjs
  ```

  Expected: no output (no syntax errors).

---

## Task 2: Regenerate skillpacks and commit both changes together

**Files:**
- Regenerated: `skillpacks/codex/runtime/shared-install.sh`
- Regenerated: `skillpacks/claude-code/runtime/shared-install.sh`
- Regenerated: `skillpacks/openclaw/runtime/shared-install.sh`

The build script and the generated skillpacks must be committed together so the repo is never in a state where they are out of sync (which would cause CI to build stale skillpacks).

- [ ] **Step 1: Run the build**

  ```bash
  npm run build && npm run build:skillpacks
  ```

  Expected: exits 0, no errors.

- [ ] **Step 2: Verify the generated shim content**

  ```bash
  grep -A 18 "write_cli_shim()" skillpacks/codex/runtime/shared-install.sh
  ```

  Expected output must contain:
  - `for _f in "$HOME/.metabot/installpacks"/*/runtime/dist/cli/main.js`
  - `[ -f "$_f" ] && CLI_ENTRY="$_f" && break`
  - `MetaBot CLI not found. Please reinstall:`

- [ ] **Step 3: Confirm all three files changed identically**

  ```bash
  diff skillpacks/codex/runtime/shared-install.sh skillpacks/claude-code/runtime/shared-install.sh && echo "IDENTICAL"
  diff skillpacks/codex/runtime/shared-install.sh skillpacks/openclaw/runtime/shared-install.sh && echo "IDENTICAL"
  ```

  Expected: both print `IDENTICAL`.

- [ ] **Step 4: Commit build script and regenerated files together**

  ```bash
  git add scripts/build-metabot-skillpacks.mjs \
          skillpacks/codex/runtime/shared-install.sh \
          skillpacks/claude-code/runtime/shared-install.sh \
          skillpacks/openclaw/runtime/shared-install.sh
  git commit -m "fix(shim): make CLI shim self-healing with installpack glob fallback"
  ```

---

## Task 3: Run the full test suite

- [ ] **Step 1: Run all tests**

  ```bash
  npm test
  ```

  Expected: all tests pass, exit 0.

---

## Task 4: Manual verification of the self-healing behavior

- [ ] **Step 1: Make a test copy of the live shim**

  ```bash
  cp ~/.metabot/bin/metabot /tmp/test-shim && chmod +x /tmp/test-shim
  ```

- [ ] **Step 2: Break the primary path in the copy**

  ```bash
  sed -i.bak 's|CLI_ENTRY=".*"|CLI_ENTRY="/nonexistent/path/main.js"|' /tmp/test-shim
  ```

  Verify the edit took effect:

  ```bash
  grep 'CLI_ENTRY=' /tmp/test-shim
  ```

  Expected: `CLI_ENTRY="/nonexistent/path/main.js"`

- [ ] **Step 3: Run the broken shim — expect fallback to succeed**

  ```bash
  bash /tmp/test-shim identity who
  ```

  Expected: command succeeds and prints the active identity name (same as `metabot identity who`).

- [ ] **Step 4: Verify the error message for a fully broken install**

  Find the installpack `main.js` using a safe glob loop (not `ls`):

  ```bash
  INSTALLPACK_JS=""
  for _js in ~/.metabot/installpacks/*/runtime/dist/cli/main.js; do
    [ -f "$_js" ] && INSTALLPACK_JS="$_js" && break
  done
  [ -n "$INSTALLPACK_JS" ] || { echo "No installpack found — skipping full-failure test"; }
  ```

  If `INSTALLPACK_JS` is set, run the full-failure test:

  ```bash
  mv "$INSTALLPACK_JS" "${INSTALLPACK_JS}.bak"
  bash /tmp/test-shim identity who 2>&1 || true
  mv "${INSTALLPACK_JS}.bak" "$INSTALLPACK_JS"
  ```

  Expected: prints `MetaBot CLI not found. Please reinstall: https://github.com/openagentinternet/open-agent-connect/releases/latest` and exits non-zero.

- [ ] **Step 5: Clean up**

  ```bash
  rm /tmp/test-shim /tmp/test-shim.bak 2>/dev/null || true
  ```

---

## Task 5: Install the updated shim locally and smoke-test

- [ ] **Step 1: Identify the installed host pack and re-run install**

  ```bash
  ls ~/.metabot/installpacks/
  ```

  This lists the installed host packs (e.g. `codex`, `claude-code`, `openclaw`). Run install for the one that is present:

  ```bash
  ~/.metabot/installpacks/<host>/runtime/shared-install.sh
  ```

  Expected: exits 0, prints "Installed primary CLI shim".

- [ ] **Step 2: Verify the live shim has the fallback**

  ```bash
  grep "installpacks" ~/.metabot/bin/metabot
  ```

  Expected: prints the glob line `for _f in "$HOME/.metabot/installpacks"/*/runtime/dist/cli/main.js`.

- [ ] **Step 3: Smoke-test the live shim**

  ```bash
  metabot identity who
  ```

  Expected: prints the active identity name.

---

## Spec reference

`docs/superpowers/specs/2026-04-29-self-healing-cli-shim-design.md`
