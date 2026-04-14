# Codex Agent Identity Runbook

Use this runbook when you want Codex to reliably create or switch to a local MetaBot identity by name.

## Agent Goal

- treat the MetaBot identity name as the canonical local reference
- if the name already exists locally, switch to it
- if the name does not exist, create it in its own dedicated local profile home
- finish with an explicit `identity who` verification report

## Execution Policy

- run in shell mode
- fail fast on unexpected command errors
- never manually edit `~/.metabot/hot/*.json`
- never rename identities by patching runtime files

## Preconditions

Before running commands, verify:

- repository root contains `package.json`
- `metabot` is available in current shell (`command -v metabot`)
- target MetaBot identity name is provided and not empty

If any precondition fails, stop and return a concise blocked report.

## Deterministic Create/Switch Flow

Run from current shell with the requested target name:

```bash
TARGET_NAME="David"

# 1) Inspect local identities first
metabot identity list

# 2) If name already exists, switch directly
metabot identity assign --name "$TARGET_NAME"
```

If step 2 fails because the name does not exist, create a dedicated profile home and bootstrap there:

```bash
TARGET_NAME="David"
PROFILE_SLUG="$(printf '%s' "$TARGET_NAME" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')"
METABOT_HOME="$HOME/.metabot/profiles/$PROFILE_SLUG" metabot identity create --name "$TARGET_NAME"
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

- do not patch runtime files
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
