# MetaBot Storage Layout v2 Design

**Date:** 2026-04-23

## Goal

Define one clean, stable, profile-first storage layout for MetaBot before public release so:

- global data is stored once under `~/.metabot/`
- per-MetaBot data is isolated under `~/.metabot/profiles/<slug>/`
- persona files and runtime/secrets are physically separated
- future host compatibility with OpenClaw-style agent workspaces becomes straightforward
- new development no longer depends on the legacy `.metabot/hot` layout

## Normative Source

This document is the normative source of truth for MetaBot storage and directory layout in v2.

Starting with the v2 implementation:

- new code must follow this layout
- new documentation must describe this layout
- new tests and fixtures must use this layout
- new code and docs must not introduce fresh references to the legacy `.metabot/hot` layout except when explicitly describing historical behavior

## Background

The current project mixes multiple concepts in ways that are easy to grow but hard to reason about:

- system-wide state and per-profile state are both rooted through `.metabot`
- many unrelated runtime files are grouped under `.metabot/hot`
- persona files and secrets do not have a strong physical boundary
- fallback behavior can treat the host `HOME` as both system home and active MetaBot home

This is workable during early prototyping, but it produces confusing storage semantics:

- some files are global in practice but profile-scoped in meaning
- some files are profile-scoped in practice but stored in locations that feel global
- future compatibility with multi-agent hosts becomes harder because the workspace and runtime layers are not clearly separated

MetaBot v2 should fix this before release by introducing a strict profile-first layout.

## Design Stance

The v2 layout follows four hard principles:

1. Global data lives under `~/.metabot/`.
2. Profile-specific data lives under `~/.metabot/profiles/<slug>/`.
3. Human-editable persona and memory files live in the profile root.
4. Machine-managed runtime, secrets, databases, exports, and locks live under `profile/.runtime/`.

This round intentionally chooses a full cut-over strategy:

- no legacy layout compatibility shim
- no automatic migration for already-installed users
- no dual-read of old and new layouts

That is acceptable because the project has not shipped yet.

## Definitions

### System home

The host user home directory, resolved from `HOME`.

Example:

- `/Users/tusm`

### MetaBot root

The global MetaBot root under the system home:

- `/Users/tusm/.metabot`

### Profile home

One specific MetaBot workspace and runtime root:

- `/Users/tusm/.metabot/profiles/charles-zhang`

### Workspace layer

The profile root itself. This is the human-editable identity, persona, and memory layer.

### Runtime layer

The hidden machine-managed layer inside the profile:

- `/Users/tusm/.metabot/profiles/charles-zhang/.runtime`

## Normative Directory Layout

```text
~/.metabot/
  manager/
    identity-profiles.json
    active-home.json

  skills/
    metabot-identity-manage/
    metabot-post-buzz/
    ...

  profiles/
    <slug>/
      AGENTS.md
      SOUL.md
      IDENTITY.md
      USER.md
      MEMORY.md
      memory/

      .runtime/
        config.json
        identity-secrets.json
        provider-secrets.json
        runtime-state.json
        daemon.json
        runtime.sqlite

        sessions/
          a2a-session-state.json

        evolution/
          executions/
          analyses/
          artifacts/
          index.json
          remote/
            artifacts/
            index.json

        exports/
          chats/
          traces/

        state/
          provider-presence.json
          rating-detail.json
          master-pending-asks.json
          master-suggest-state.json
          master-auto-feedback-state.json
          master-service-state.json
          directory-seeds.json

        locks/
          daemon.lock
```

## Storage Boundaries

### Global layer: `~/.metabot/`

This layer is shared across all local MetaBots on the machine.

#### `manager/`

Purpose:

- maintain the global profile index
- maintain the currently active profile pointer

Allowed contents:

- `identity-profiles.json`
- `active-home.json`

Forbidden contents:

- private keys
- mnemonics
- provider API tokens
- per-profile runtime state

#### `skills/`

Purpose:

- provide one global MetaBot-managed skills root shared by supported hosts

Rules:

- skills are global, not profile-private, in v2
- host integration may later use symlinks or adapters to read this directory
- do not store persona state or private memory here

## Profile Workspace Layer

The profile root is the MetaBot's human-facing home.

Allowed contents:

- identity and persona files
- long-term memory files
- human-maintained notes that belong to this MetaBot

Forbidden contents:

- secrets
- daemon process records
- SQLite files
- export artifacts
- lock files
- machine-generated runtime JSON state

### Required workspace files

#### `AGENTS.md`

Purpose:

- high-level behavior, rules, and operating constraints for the MetaBot

#### `SOUL.md`

Purpose:

- persona, tone, stance, style, and boundaries

#### `IDENTITY.md`

Purpose:

- public-facing identity description
- display name, self-description, external presentation

This file describes identity. It does not store secret identity material.

#### `USER.md`

Purpose:

- durable knowledge about the primary user
- stable preferences and long-term interaction notes

#### `MEMORY.md`

Purpose:

- curated long-term memory
- durable facts and decisions worth preserving

#### `memory/`

Purpose:

- rolling notes and memory logs

V2 minimum contract:

- support `memory/YYYY-MM-DD.md`

### Explicitly out of scope for v2 workspace

The following files are intentionally not standardized in the first v2 cut:

- `TOOLS.md`
- `HEARTBEAT.md`
- `DREAMS.md`
- profile-local `skills/`

These may be added later if needed, but they are not part of the v2 minimum contract.

## Profile Runtime Layer

The `.runtime/` directory is the machine-managed private runtime layer for one MetaBot.

This layer should be treated as implementation-owned state, not as a normal user-authored workspace.

### Root runtime files

#### `config.json`

Purpose:

- per-profile MetaBot configuration

Rule:

- v2 uses profile-scoped config, not one global `~/.metabot/config.json`

#### `identity-secrets.json`

Purpose:

- private identity material for the MetaBot

Examples:

- mnemonic
- secret/private keys
- chat key material
- secret identity derivation inputs

#### `provider-secrets.json`

Purpose:

- secrets for model providers, APIs, and third-party services

This file is separate from `identity-secrets.json` to keep account identity secrets and external provider secrets distinct.

#### `runtime-state.json`

Purpose:

- main runtime state snapshot for the profile

Examples:

- active local identity record
- published services summary
- trace summary state

#### `daemon.json`

Purpose:

- local daemon process metadata for this profile

Examples:

- pid
- host
- port
- base URL
- startup timestamp
- config hash

#### `runtime.sqlite`

Purpose:

- profile-scoped runtime database

### Runtime subdirectories

#### `sessions/`

Purpose:

- session state and future session-scoped artifacts

V2 minimum file:

- `a2a-session-state.json`

Future session transcript files should also live under this root.

#### `evolution/`

Purpose:

- local and imported evolution-network data for this profile

This is the v2 relocation target for the current evolution storage family.

#### `exports/`

Purpose:

- exported output artifacts for this profile

Examples:

- chat markdown exports
- trace markdown exports
- trace JSON exports

Exports are profile-scoped and must not be stored in a global export directory.

#### `state/`

Purpose:

- machine-generated auxiliary JSON state that is neither a secret nor a primary config file

V2 standard files:

- `provider-presence.json`
- `rating-detail.json`
- `master-pending-asks.json`
- `master-suggest-state.json`
- `master-auto-feedback-state.json`
- `master-service-state.json`
- `directory-seeds.json`

#### `locks/`

Purpose:

- lock files used by local runtime processes

V2 standard file:

- `daemon.lock`

Additional lock files should also be placed here instead of polluting the runtime root.

## Profile Metadata Model

`manager/identity-profiles.json` is the global machine-readable profile index.

Each profile record must contain at least:

- `name`
- `slug`
- `aliases`
- `homeDir`
- `globalMetaId`
- `mvcAddress`
- `createdAt`
- `updatedAt`

### Recommended record shape

```json
{
  "profiles": [
    {
      "name": "Charles Zhang",
      "slug": "charles-zhang",
      "aliases": [
        "Charles Zhang",
        "charles zhang",
        "charles-zhang"
      ],
      "homeDir": "/Users/tusm/.metabot/profiles/charles-zhang",
      "globalMetaId": "metaid-xxx",
      "mvcAddress": "xxx",
      "createdAt": 1770000000000,
      "updatedAt": 1770000000000
    }
  ]
}
```

`manager/active-home.json` stores the current active profile pointer.

Recommended shape:

```json
{
  "homeDir": "/Users/tusm/.metabot/profiles/charles-zhang",
  "updatedAt": 1770000000000
}
```

## Slug Rules

Each profile has:

- a human display name
- one stable filesystem slug

The slug is the only directory name under `profiles/`.

### Slug generation rules

1. Normalize Unicode input.
2. Trim leading and trailing whitespace.
3. Convert to lowercase.
4. Treat spaces and common separators as `-`.
5. Remove emoji and unsupported punctuation.
6. Remove diacritics from common Latin characters when possible.
7. Keep only `a-z`, `0-9`, and `-`.
8. Collapse repeated `-`.
9. Remove leading or trailing `-`.
10. If the result is empty, fall back to `mb-<stable-short-hash>`.
11. If the slug already exists, append `-2`, `-3`, and so on.

### Examples

- `Charles Zhang` -> `charles-zhang`
- ` Charles   Zhang ` -> `charles-zhang`
- `Charles_Zhang` -> `charles-zhang`
- `Charles.Zhang` -> `charles-zhang`
- `Chärles Zhang` -> `charles-zhang`
- `Charles Zhang 🤖` -> `charles-zhang`

### Stability rule

Once created, a profile slug should not be automatically changed when the display name changes.

Directory stability is more important than keeping the filesystem path synchronized with presentation edits.

## Name Resolution Rules

The system should not require exact raw-name matches when a human asks to use a MetaBot.

Example:

- human says: `use Charles Zhang`
- system should resolve the best matching profile home for `Charles Zhang`
- system should not require the literal directory name

### Resolution order

When resolving a profile by human input:

1. exact slug match
2. exact normalized display-name match
3. exact normalized alias match
4. ranked best-match search across `slug`, `name`, and `aliases`

### Matching rules

Normalization should ignore superficial differences such as:

- case
- repeated whitespace
- separator choice between spaces, `_`, `-`, and `.`
- emoji and low-value punctuation

### Safety rule

The runtime may auto-select only when one candidate has a clearly dominant score.

If multiple candidates are similarly strong, resolution must stop and ask for disambiguation rather than silently picking one.

## Profile Lifecycle Rules

### `identity create --name <name>`

The create flow should:

1. resolve `systemHomeDir` from `HOME`
2. generate a candidate slug
3. reject or surface likely duplicates using the profile index
4. create `~/.metabot/profiles/<slug>/`
5. create the required workspace files and `memory/`
6. create the `.runtime/` skeleton
7. generate and store identity secrets in `.runtime/identity-secrets.json`
8. write the profile record to `manager/identity-profiles.json`
9. set `manager/active-home.json` to the new profile home

### `identity list`

The list flow should read only from `manager/identity-profiles.json`.

It should not discover profiles by scanning directories as a primary source of truth.

### `identity assign --name <input>`

The assign flow should:

- resolve the best profile match from the index
- update only `active-home.json`
- not create a new profile
- not regenerate secrets
- not rewrite runtime state

### `identity who`

The who flow should:

1. read `active-home.json`
2. resolve the matching profile record from the index
3. return the current active profile details

If the active pointer is invalid, the command should report an explicit error instead of silently falling back to the system home.

## Path Resolution Rules

### System vs profile home

V2 explicitly separates:

- the host system home (`HOME`)
- the active MetaBot profile home

They are not the same concept and must not be conflated.

### Runtime selection priority

When resolving the active profile home:

1. explicit `METABOT_HOME`
2. `manager/active-home.json`
3. otherwise: report that no profile is initialized and require `identity create` or `identity assign`

### Forbidden fallback

V2 must not treat the raw system home itself as a valid profile home fallback.

In other words, the runtime must not silently interpret:

- `/Users/tusm`

as if it were a profile root.

The active profile must always be rooted under:

- `~/.metabot/profiles/<slug>/`

## Implementation Strategy

V2 should be implemented as one full cut-over to the new layout.

### Required strategy

- replace the current legacy path model with a unified v2 path model
- update all runtime stores to use the new path model
- update CLI profile resolution to use the new manager/profile split
- update daemon logic to use the new runtime subdirectories
- update docs, fixtures, and tests to use the new layout

### Required path-model concepts

The central path layer should expose concepts at least equivalent to:

- `systemHomeDir`
- `metabotRoot`
- `managerRoot`
- `skillsRoot`
- `profilesRoot`
- `profileRoot`
- `workspaceRoot`
- `runtimeRoot`
- `sessionsRoot`
- `exportsRoot`
- `evolutionRoot`
- `stateRoot`
- `locksRoot`

It should also expose concrete derived file paths for every standard runtime file.

All code should resolve MetaBot paths from this central model rather than hand-building `.metabot/...` strings.

## Explicit Non-Goals For V2

The first v2 cut intentionally does not include:

- automatic migration from the legacy layout
- simultaneous support for old and new layouts
- profile-private `skills/`
- standardization of `TOOLS.md`
- standardization of `HEARTBEAT.md`
- standardization of `DREAMS.md`
- continued support for using the system home as a profile home fallback

## Documentation And Governance Rules

After this document lands:

- `AGENTS.md` should point to this file as the normative storage-layout reference
- code reviews should treat new `.metabot/hot` references as regressions unless they are historical notes
- future directory/layout changes should update this document first

## Example Concrete Paths

Given:

- system home: `/Users/tusm`
- profile name: `Charles Zhang`
- slug: `charles-zhang`

The resulting important paths are:

- MetaBot root:
  - `/Users/tusm/.metabot`
- Manager root:
  - `/Users/tusm/.metabot/manager`
- Global skills root:
  - `/Users/tusm/.metabot/skills`
- Profile home:
  - `/Users/tusm/.metabot/profiles/charles-zhang`
- Runtime root:
  - `/Users/tusm/.metabot/profiles/charles-zhang/.runtime`
- Identity secrets:
  - `/Users/tusm/.metabot/profiles/charles-zhang/.runtime/identity-secrets.json`
- Provider secrets:
  - `/Users/tusm/.metabot/profiles/charles-zhang/.runtime/provider-secrets.json`
- Runtime config:
  - `/Users/tusm/.metabot/profiles/charles-zhang/.runtime/config.json`

## Summary

MetaBot Storage Layout v2 standardizes the local filesystem model around one simple rule:

- global things live under `~/.metabot/`
- one MetaBot's things live under `~/.metabot/profiles/<slug>/`

Within a profile:

- persona and memory live in the profile root
- secrets and machine-managed runtime state live under `.runtime/`

This creates a clean foundation for the first public version of MetaBot and gives future host compatibility a stable storage contract.
