# Codex Agent Identity Runbook

Use this runbook when you want Codex to reliably create or switch to a local MetaBot identity by name.

## Agent Goal

- treat the MetaBot identity name as the canonical local reference
- if the name already exists locally, switch to the indexed profile that best matches it
- if the name does not exist, create it in its own canonical profile home
- finish with an explicit `identity who` verification report

## Execution Policy

- run in shell mode
- fail fast on unexpected command errors
- never manually edit `.runtime/` files
- never rename identities by patching runtime files

## Preconditions

Before running commands, verify:

- repository root contains `package.json`
- `metabot` is available in current shell (`command -v metabot`)
- target MetaBot identity name is provided and not empty

If any precondition fails, stop and return a concise blocked report.

## Canonical V2 Layout

The active v2 layout separates global machine state from per-MetaBot profile state:

- `~/.metabot/manager/identity-profiles.json` is the global profile index
- `~/.metabot/manager/active-home.json` is the active profile pointer
- `~/.metabot/profiles/<slug>/` is one MetaBot profile home
- `~/.metabot/profiles/<slug>/.runtime/` is the machine-managed runtime layer

CLI resolves the canonical profile home from the requested name and the manager index.
Do not hand-compute the filesystem slug or inject `METABOT_HOME` for the normal create and switch flow.

## Deterministic Create/Switch Flow

Run from current shell with the requested target name:

```bash
TARGET_NAME="David"

# 1) Inspect local identities first
metabot identity list

# 2) If name already exists, switch directly
metabot identity assign --name "$TARGET_NAME"
```

If step 2 fails because the name does not exist, create the profile and let the CLI resolve the canonical profile home:

```bash
TARGET_NAME="David"
metabot identity create --name "$TARGET_NAME"
```

Then switch explicitly (idempotent and keeps final state clear):

```bash
metabot identity assign --name "$TARGET_NAME"
```

## Conflict Handling

If create returns `identity_name_taken`:

- do not force-create a second profile with the same name
- run `metabot identity list`
- run `metabot identity assign --name "$TARGET_NAME"`

If create returns `identity_name_conflict`:

- do not patch `.runtime/` files
- run `metabot identity who` and `metabot identity list`
- assign the intended existing profile with `metabot identity assign --name "$TARGET_NAME"` when available

## Verification

Run:

```bash
metabot identity who
metabot identity list
metabot doctor
```

Success criteria:

- `identity who` returns the target name
- `identity list` includes target name as an existing profile
- `metabot doctor` remains healthy (`ok: true` checks for runtime reachability)

## Expected Final Report Format

Return:

- mode: `identity-manage`
- target name
- result: `success`, `failed`, or `blocked`
- commands executed
- active identity summary from `metabot identity who`
- follow-up action required (if any)
