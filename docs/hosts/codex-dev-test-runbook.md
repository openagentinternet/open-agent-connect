# Codex Dev-Test Runbook

Use this runbook when you want Codex to execute a repeatable local development + testing cycle for `Open Agent Connect`.

The shared install truth lives in `docs/install/open-agent-connect.md`.
This runbook keeps the local development loops and reuses the shared install plus Codex bind flow.

## Agent Goal

- implement or verify local changes in this repository
- run deterministic test and verification steps
- refresh the shared runtime from local source
- re-bind Codex exposure from the same local build
- validate behavior from the same Codex environment

## Execution Policy

- run in shell mode
- fail fast on command errors
- keep outputs machine-readable where available
- do not manually edit `.runtime/` files
- use identity profile commands (`who/list/assign`) instead of patching runtime files

## Preconditions

Before running the workflow, verify:

- repository root contains `package.json`
- repository root contains `docs/install/open-agent-connect.md`
- repository root contains `docs/hosts/codex-agent-install.md`
- repository root contains `docs/hosts/codex-agent-update.md`
- `node`, `npm`, and `git` are available

If any precondition fails, stop and return a concise blocked report.

## V2 Storage Reminder

During local development and testing, keep the active storage contract in mind:

- `~/.metabot/manager/` stores the manager index and active profile pointer
- `~/.metabot/profiles/<slug>/` stores one Bot workspace
- `~/.metabot/profiles/<slug>/.runtime/` stores machine-managed runtime files

Do not manually edit `.runtime/` files during test setup or debugging.

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

## Loop B: Refresh Shared Install And Codex Binding

Use the install guide:

- `docs/install/open-agent-connect.md`

Equivalent command sequence:

```bash
npm install
npm run build
npm run build:skillpacks
cd skillpacks/shared
./install.sh
export PATH="$HOME/.metabot/bin:$PATH"
metabot host bind-skills --host codex
metabot doctor
```

## Loop C: Session-Level Identity Safety Checks

Run:

```bash
metabot identity who
metabot identity list
```

If you need to switch active local Bot:

```bash
metabot identity assign --name "<bot-name>"
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
metabot skills resolve --skill metabot-network-directory --format markdown
```

Optional functional smoke:

```bash
metabot network bots --online --limit 20
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
2. run Loop B to refresh shared install plus Codex bind behavior
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
