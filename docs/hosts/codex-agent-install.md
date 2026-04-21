# Codex Agent Install Runbook

Use this document when you want Codex to install and configure `Open Agent Connect` with minimal human intervention.

## Agent Goal

Install the Codex host pack, make `metabot` runnable in the current environment, then verify the runtime is healthy and the latest Ask Master skill contract is active.

## Execution Mode

- run in shell mode
- fail fast on command errors
- prefer idempotent operations
- do not ask for confirmation unless a required dependency is missing or a command fails unexpectedly

## Preconditions

Before running install commands, verify:

- repository root contains `package.json`
- repository root contains `skillpacks/codex/install.sh`
- `node` exists and version is `>=20 <25`
- `npm` exists

If any precondition fails, stop and return a concise failure report with exact missing item and fix hint.

## Install Steps

Run these commands from the repository root:

```bash
npm install
npm run build
npm run build:skillpacks
cd skillpacks/codex
./install.sh
```

## Configure PATH For Current Session

Run:

```bash
export PATH="$HOME/.metabot/bin:$PATH"
```

Then verify:

```bash
command -v metabot
```

If `metabot` is still missing, stop and report that PATH injection failed for the current shell session.

## Post-Install Verification

Run:

```bash
metabot doctor
```

Success criteria:

- command exits with code `0`
- output is machine-readable result JSON
- `daemon_reachable` is present
- install path shows Codex skills under `${CODEX_HOME:-$HOME/.codex}/skills`

Then verify the installed Codex skill file directly:

```bash
INSTALLED_SKILL="${CODEX_HOME:-$HOME/.codex}/skills/metabot-ask-master/SKILL.md"
test -f "$INSTALLED_SKILL"
rg -n "metabot master|metabot advisor" "$INSTALLED_SKILL"
```

Success criteria:

- `"$INSTALLED_SKILL"` exists
- output shows `metabot master` lines
- output does not show stale `metabot advisor` lines

Then verify the repo/base Ask Master contract that should be rendered into the host pack:

```bash
metabot skills resolve --skill metabot-ask-master --host codex --format markdown
```

That command now validates the repo/base contract that should be rendered into the host pack, but it still does **not** by itself prove that the installed Codex skill file has already been refreshed.

## Fresh Install Smoke

After a fresh install or reinstall, run this minimal Ask Master smoke check:

```bash
INSTALLED_SKILL="${CODEX_HOME:-$HOME/.codex}/skills/metabot-ask-master/SKILL.md"
test -f "$INSTALLED_SKILL"
rg -n "metabot master" "$INSTALLED_SKILL"
if rg -n "metabot advisor" "$INSTALLED_SKILL"; then
  echo "stale advisor semantics found in installed Ask Master skill" >&2
  exit 1
fi
metabot skills resolve --skill metabot-ask-master --host codex --format markdown
```

Smoke expectations:

- the installed skill file exists under the Codex skills directory
- the installed skill file contains `metabot master` and fails fast if any stale `metabot advisor` contract remains
- `skills resolve` returns the repo/base Ask Master contract rendered for Codex

## Ask Master Acceptance Lanes

After the install smoke is green, interpret the three Phase-3 Ask Master lanes like this:

- `manual`: the human explicitly asks for one Master, the host builds a request, and the runtime usually stops at preview/confirm before send unless local `confirmationMode=never` allows immediate continuation after request preparation.
- `suggest`: the host notices a stuck or risky situation and proposes Ask Master. After the user accepts, it follows the same local confirmation rule as `manual`.
- `auto`: the host/runtime may prepare or send Ask Master without a new human wording prompt, but only when local Ask Master config and policy allow it.

For Codex acceptance, `manual`, `suggest`, and `auto` should all be explainable in a fresh session. The important part is not that all three always send immediately; the important part is that the host clearly follows the configured confirmation contract.

## Confirmation Mode Semantics

`confirmationMode` controls whether Ask Master must stop at preview/confirm:

- `always`: always stop at preview/confirm before dispatch.
- `sensitive_only`: only trusted plus non-sensitive `auto` payloads may direct send; `manual` and accepted `suggest` still stay in preview/confirm.
- `never`: `manual` asks and accepted `suggest` flows may continue immediately after request preparation. `auto` still needs trusted plus safe payload plus explicit local auto-send policy before it may direct send.

Phase-3 acceptance should focus on `always` and `sensitive_only`. Even in `auto`, preview and confirm remain valid outcomes whenever the local policy picks `preview_confirm`. If you cover `never`, make sure you verify both the reduced-friction `manual/suggest` continuation and the stricter `auto` direct-send gate.

## Single-Machine Dual Terminal Smoke

Use a single-machine dual terminal smoke setup when you want the most realistic local acceptance path without involving a second computer.

Provider terminal:

```bash
metabot identity create --name "Debug Master Provider"
metabot master publish --payload-file e2e/fixtures/master-service-debug.json
metabot daemon start
```

Caller terminal:

```bash
metabot identity create --name "Caller Bot"
metabot network sources add --base-url <provider-base-url>
metabot master list --online
cp e2e/fixtures/master-ask-request.json /tmp/master-request.json
```

Before the caller sends, edit `/tmp/master-request.json` so `target.servicePinId` and `target.providerGlobalMetaId` match one row from `metabot master list --online`.

Manual lane:

```bash
metabot master ask --request-file /tmp/master-request.json
metabot master ask --trace-id <preview-trace-id> --confirm
```

Suggest lane:

- open a fresh Codex session after install
- ask in natural language for Ask Master help and require preview first
- expect the installed `metabot-ask-master` contract to keep the flow on Ask Master, not private chat
- expect the host to show preview/confirm before any send unless local `confirmationMode=never` allows immediate continuation after request preparation

Auto lane:

- enable local Ask Master auto mode before testing
- create a controlled stuck scenario or run the auto e2e coverage from this repo
- expect either preview/confirm or direct send depending local `confirmationMode`, trust, and privacy gate
- if direct send happens, the trace should still explain why that was allowed

This single-machine two-terminal smoke is the clearest acceptance setup for Phase-3 because it lets you inspect provider state, caller preview/confirm behavior, and the resulting Ask Master trace separately.

After the first real Ask Master request succeeds, inspect that trace with:

```bash
metabot master trace --id <real-trace-id>
```

That is the active trace inspection path for Ask Master, but it is a post-flow check, not part of the zero-state fresh install smoke.

If the installed skill file is correct but Codex still behaves like an older session, restart Codex session state and begin a new session before re-testing the Ask Master flow.

## Optional First-Run Bootstrap

Only if local identity is not initialized yet, run:

```bash
metabot identity create --name "Alice"
metabot doctor
```

Expected:

- identity is loaded
- doctor still reports daemon reachable

If create returns `identity_name_conflict`, do not manually patch runtime files.
Use:

```bash
metabot identity who
metabot identity list
metabot identity assign --name "<existing-metabot-name>"
```

## Expected Final Report Format

At the end, return:

- install result: `success` or `failed`
- commands executed
- key verification fields from `metabot doctor`
- any follow-up needed (for example: restart Codex session to refresh skills)

## Idempotency Notes

- It is safe to re-run this runbook.
- Re-running `./install.sh` overwrites installed skill folders with the latest generated copies.
- Re-running `./install.sh` also overwrites any stale installed `metabot-ask-master` copy with the freshly built contract.
- Re-running build steps refreshes `dist/` and skillpacks without requiring manual cleanup.
- If Ask Master behavior looks stale after a rebuild, re-run `npm run build:skillpacks`, reinstall the Codex pack, then repeat:

```bash
INSTALLED_SKILL="${CODEX_HOME:-$HOME/.codex}/skills/metabot-ask-master/SKILL.md"
rg -n "metabot master|metabot advisor" "$INSTALLED_SKILL"
```

You may additionally run:

```bash
metabot skills resolve --skill metabot-ask-master --host codex --format markdown
```

The installed-file check confirms the actual Codex skill currently active in your environment; `skills resolve` is the extra repo/base contract check that the built skillpack should match.
