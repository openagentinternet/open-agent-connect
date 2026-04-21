# Codex Agent Install Runbook

Use this document when you want Codex to install and configure `Open Agent Connect` for end users with minimal human intervention.

This document is install-only. It does not include development testing or release acceptance workflows.

## Agent Goal

Install the Codex host pack, make `metabot` runnable in the current environment, and verify the install is usable.

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

If any precondition fails, stop and return a concise failure report with the exact missing item and a fix hint.

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
metabot --help
metabot identity --help
```

Success criteria:

- `metabot doctor` exits with code `0`
- `metabot doctor` output includes `daemon_reachable`
- `metabot` and `metabot identity` help commands run successfully

Then verify the installed Ask Master skill file exists:

```bash
INSTALLED_SKILL="${CODEX_HOME:-$HOME/.codex}/skills/metabot-ask-master/SKILL.md"
test -f "$INSTALLED_SKILL"
```

Success criteria:

- `"$INSTALLED_SKILL"` exists

If the installed skill file is correct but behavior looks stale, restart the Codex session and retry.

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
- any follow-up needed

## Idempotency Notes

- It is safe to re-run this runbook.
- Re-running `./install.sh` overwrites installed skill folders with the latest generated copies.
- Re-running build steps refreshes `dist/` and skillpacks without requiring manual cleanup.
