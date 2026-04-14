# Codex Dev-Test Runbook

Use this runbook when you want Codex to execute a repeatable local development + testing cycle for `Open Agent Connect`.

## Agent Goal

- implement or verify local changes in this repository
- run deterministic test and verification steps
- reinstall Codex host pack from local source
- validate behavior from the same Codex environment

## Execution Policy

- run in shell mode
- fail fast on command errors
- keep outputs machine-readable where available
- do not manually edit `~/.metabot/hot/*.json` identity state files
- use identity profile commands (`who/list/assign`) instead of patching runtime files

## Preconditions

Before running the workflow, verify:

- repository root contains `package.json`
- repository root contains `docs/hosts/codex-agent-install.md`
- repository root contains `docs/hosts/codex-agent-update.md`
- `node`, `npm`, and `git` are available

If any precondition fails, stop and return a concise blocked report.

## Loop A: Development Build And Targeted Tests

Run from repository root:

```bash
npm run build
node --test tests/cli/doctor.test.mjs tests/cli/help.test.mjs tests/cli/runtime.test.mjs
```

If this loop fails, stop and return:

- failing command
- top failure reason
- first failing test name (if available)

## Loop B: Reinstall Into Current Codex Environment

Use the install runbook:

- `docs/hosts/codex-agent-install.md`

Equivalent command sequence:

```bash
npm install
npm run build
npm run build:skillpacks
cd skillpacks/codex
./install.sh
cd ../..
export PATH="$HOME/.agent-connect/bin:$PATH"
metabot doctor
```

## Loop C: Session-Level Identity Safety Checks

Run:

```bash
metabot identity who
metabot identity list
```

If you need to switch active local bot:

```bash
metabot identity assign --name "<metabot-name>"
metabot identity who
```

If `metabot identity create --name ...` returns `identity_name_conflict`, do not patch runtime files.  
Use `identity list` + `identity assign` first.

## Loop D: Runtime Smoke Checks

Run:

```bash
metabot doctor
metabot --help
metabot identity --help
```

Optional functional smoke:

```bash
metabot network services --online
metabot ui open --page hub
```

## Loop E: Pre-Release Gate

Before release, run:

```bash
npm run verify
```

This is the release-grade gate. Do not claim release-ready if this fails.

## Suggested Daily Developer Workflow

For daily coding in Codex:

1. run Loop A after each meaningful code change
2. run Loop B to refresh local host pack behavior
3. run Loop C + Loop D for session correctness
4. run Loop E before merge/release

## Expected Final Report Format

At the end, return:

- mode: `dev-test`
- result: `success`, `failed`, or `blocked`
- commands executed
- test summary (pass/fail counts if available)
- identity active profile summary (`who`)
- follow-up action required (if any)
