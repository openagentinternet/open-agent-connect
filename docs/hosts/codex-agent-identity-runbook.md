# Codex Agent Bot Identity Runbook

Use this runbook when you want Codex to reliably create a local Bot identity by name or, only when the operator explicitly asks, designate it as the Twin Bot.

The CLI and storage paths still use `metabot` and `~/.metabot`; keep those exact
terms in commands and path references.

## Agent Goal

- treat the Bot identity name as the canonical local reference
- if the name already exists locally, reuse the indexed profile that best matches it
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
- target Bot identity name is provided and not empty

If any precondition fails, stop and return a concise blocked report.

## Canonical V2 Layout

The current v2 layout separates global machine state from per-Bot profile state:

- `~/.metabot/manager/identity-profiles.json` is the global profile index
- `~/.metabot/profiles/<slug>/` is one Bot profile home
- `~/.metabot/profiles/<slug>/.runtime/` is the machine-managed runtime layer

The Twin Bot (the machine-wide default actor) is derived from each profile's
`botType`: the profile marked `twin` wins; if no profile is marked twin, the
earliest-created profile acts as the default. There is no active profile
pointer file.

CLI resolves the canonical profile home from the requested name and the manager index.
Do not hand-compute the filesystem slug or inject `METABOT_HOME` for the normal create flow.

## Deterministic Create Flow

Run from current shell with the requested target name:

```bash
TARGET_NAME="David"

# 1) Inspect local identities first
metabot identity list

# 2) If the name does not exist, create the profile and let the CLI resolve the canonical profile home
metabot identity create --name "$TARGET_NAME"
```

If the name already exists, the profile is already usable; there is no
separate switch step. Commands run without `--from` resolve to the Twin Bot.

Only when the operator explicitly wants to change the Twin Bot to this
profile, designate it with the structured botType update:

```bash
printf '{"botType":"twin"}\n' > twin-payload.json
metabot bot update --from "$TARGET_NAME" --payload-file twin-payload.json
```

Setting `botType` to `twin` demotes the previous Twin Bot; at most one Twin
Bot exists per machine.

## Conflict Handling

If create returns `identity_name_taken`:

- do not force-create a second profile with the same name
- run `metabot identity list`
- the existing profile needs no switch step; designate it as the Twin Bot with the structured botType update above only when the operator explicitly wants to change the Twin Bot

If create returns `identity_name_conflict`:

- do not patch `.runtime/` files
- run `metabot identity who` and `metabot identity list`
- if the intended existing profile is available, no switch step is needed; designate it as the Twin Bot with the structured botType update above only when the operator explicitly wants to change the Twin Bot

## Verification

Run:

```bash
metabot identity who
metabot identity list
metabot doctor
```

Success criteria:

- `identity list` includes target name as an existing profile
- `identity who` returns the target name when it was designated as the Twin Bot (or when it is the earliest-created profile)
- `metabot doctor` remains healthy (`ok: true` checks for runtime reachability)

## Expected Final Report Format

Return:

- mode: `identity-manage`
- target name
- result: `success`, `failed`, or `blocked`
- commands executed
- Twin Bot summary from `metabot identity who`
- follow-up action required (if any)
