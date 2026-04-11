---
name: metabot-identity-manage
description: Use when a host agent needs to create or switch a local MetaBot identity by name with deterministic profile-safe behavior
---

# MetaBot Identity Manage

Create or switch local MetaBot identities by name without manual runtime-state patching.

## Host Adapter

{{HOST_SKILLPACK_METADATA}}

## Routing

{{SYSTEM_ROUTING}}

## Workflow

List local profiles first:

```bash
{{METABOT_CLI}} identity list
```

If target name already exists, switch directly:

```bash
{{METABOT_CLI}} identity assign --name "David"
```

If target name does not exist, create it under a dedicated profile home:

```bash
TARGET_NAME="David"
PROFILE_SLUG="$(printf '%s' "$TARGET_NAME" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')"
METABOT_HOME="$HOME/.metabot/profiles/$PROFILE_SLUG" {{METABOT_CLI}} identity create --name "$TARGET_NAME"
```

Verify and report the active identity at the end:

```bash
{{METABOT_CLI}} identity who
```

## Guardrails

- Local MetaBot names are unique per machine.
- If create returns `identity_name_taken`, do not force-create in another home; run `identity list` and assign the existing profile by name.
- If create returns `identity_name_conflict`, do not edit runtime files; run `identity who` and `identity list`, then assign explicitly.
- Never manually edit `~/.metabot/hot/runtime-state.json`.

## Compatibility

- CLI path: `{{METABOT_CLI}}`
- Compatibility manifest: `{{COMPATIBILITY_MANIFEST}}`
