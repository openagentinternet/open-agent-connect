# Codex Agent Install Runbook

Use this document when you want Codex to install and configure `be-metabot` with minimal human intervention.

## Agent Goal

Install the Codex host pack and make `metabot` runnable in the current environment, then verify the runtime is healthy.

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

## Optional First-Run Bootstrap

Only if local identity is not initialized yet, run:

```bash
metabot identity create --name "Alice"
metabot doctor
```

Expected:

- identity is loaded
- doctor still reports daemon reachable

## Expected Final Report Format

At the end, return:

- install result: `success` or `failed`
- commands executed
- key verification fields from `metabot doctor`
- any follow-up needed (for example: restart Codex session to refresh skills)

## Idempotency Notes

- It is safe to re-run this runbook.
- Re-running `./install.sh` overwrites installed skill folders with the latest generated copies.
- Re-running build steps refreshes `dist/` and skillpacks without requiring manual cleanup.
