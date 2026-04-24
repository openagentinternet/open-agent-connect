# MetaBot Shared Skill Install and Host Bind Design

**Date:** 2026-04-24

## Goal

Define one shared install model for MetaBot skills so:

- MetaBot skills are installed once under `~/.metabot/skills`
- Codex, Claude Code, and OpenClaw consume the same installed skill files
- host integration becomes a thin bind step instead of a second skill installation
- `metabot skills resolve` no longer requires `--host` for normal execution
- installation documentation has one normative entrypoint instead of one separate full runbook per host

## Normative Source

This document is the normative source of truth for shared MetaBot skill installation and host skill binding after the MetaBot storage layout v2 cut-over.

Starting with this design:

- `~/.metabot/skills` is the only installed MetaBot skill content root
- host-native skill roots are projection layers, not independent sources of truth
- shared installed skills must be host-neutral
- the default `metabot skills resolve` path must work without `--host`
- installation documentation must describe one shared install flow first, with host-specific bind notes second

## Relationship To Storage Layout v2

This design extends the storage boundary already defined in:

- `docs/superpowers/specs/2026-04-23-metabot-storage-layout-v2-design.md`

That document already establishes:

- `~/.metabot/skills/` is the global MetaBot-managed skills root
- profile runtime data lives under `~/.metabot/profiles/<slug>/.runtime/`

This document defines how supported coding-agent hosts should consume the global `~/.metabot/skills/` root without duplicating MetaBot skill content into per-host copies.

## Background

The current project has a structural mismatch between the v2 storage layout and the host install implementation.

### Storage design already says:

- MetaBot-managed skills live under `~/.metabot/skills/`

### Current install implementation still does:

- Codex installs skills into `${CODEX_HOME:-$HOME/.codex}/skills`
- Claude Code installs skills into `${CLAUDE_HOME:-$HOME/.claude}/skills`
- OpenClaw installs skills into `${OPENCLAW_HOME:-$HOME/.openclaw}/skills`

### Current skill/resolve shape still assumes:

- installed host-pack skill content is host-specific
- the CLI `skills resolve` path still requires `--host`
- some existing docs still describe older host-shim behavior even though current generated host artifacts are full contracts

That produces four practical problems:

1. The same MetaBot skill content is copied into multiple host roots.
2. Installation instructions are repeated and drift across hosts.
3. One shared installed skill file cannot be reused across hosts because the current source/build flow still injects host-specific metadata and the CLI resolve path requires `--host`.
4. Updating skills for one machine with multiple coding-agent hosts becomes repetitive and error-prone.

## Design Stance

This design follows five hard principles:

1. Installed MetaBot skill content lives once under `~/.metabot/skills`.
2. Host-native skill roots expose MetaBot skills by symlink or equivalent bind, not by copying content.
3. Shared installed MetaBot skills are host-neutral and do not require a host argument to execute correctly.
4. `metabot skills resolve --skill ... --format ...` without `--host` is the canonical execution path.
5. One unified install document is normative; host documents become thin host-binding companions.

## Non-Goals

This round does not attempt to:

- unify unrelated host-native settings, caches, or plugin stores
- remove host-specific skillpack directories from the repository immediately
- support Windows-specific shortcut or junction semantics
- redesign the business content of the individual MetaBot skills
- auto-bind every possible coding-agent host without explicit user or installer intent

## Definitions

### Shared skill root

The global installed MetaBot skill root:

- `~/.metabot/skills`

This directory contains the real installed MetaBot skill files.

### Host-native skill root

The skill directory that a specific coding-agent host scans for its own skills.

Examples:

- Codex: `${CODEX_HOME:-$HOME/.codex}/skills`
- Claude Code: `${CLAUDE_HOME:-$HOME/.claude}/skills`
- OpenClaw: `${OPENCLAW_HOME:-$HOME/.openclaw}/skills`

### Host bind

The act of exposing shared MetaBot skills into a host-native skill root by creating filesystem links from the host-native root to `~/.metabot/skills/<skill>`.

### Shared skill contract

The host-neutral installed `SKILL.md` content under `~/.metabot/skills/<skill>/SKILL.md`.

### Host override render

An optional compatibility rendering path of `metabot skills resolve --host <host>`. This may remain available, but it is not the normative execution path.

## Normative Installed Layout

```text
~/.metabot/
  bin/
    metabot

  skills/
    metabot-ask-master/
      SKILL.md
    metabot-identity-manage/
      SKILL.md
    metabot-network-manage/
      SKILL.md
    ...

~/.codex/
  skills/
    metabot-ask-master -> ~/.metabot/skills/metabot-ask-master
    metabot-identity-manage -> ~/.metabot/skills/metabot-identity-manage
    ...

~/.claude/
  skills/
    metabot-ask-master -> ~/.metabot/skills/metabot-ask-master
    ...

~/.openclaw/
  skills/
    metabot-ask-master -> ~/.metabot/skills/metabot-ask-master
    ...
```

Rules:

- `~/.metabot/skills/<skill>/` contains real files
- host-native `metabot-*` entries are links to the shared root
- host-native roots must not become independent MetaBot content roots again
- non-MetaBot host skills outside the `metabot-*` prefix are not managed by this flow

## Source Of Truth

### Repo authoring source

The authoring source remains:

- `SKILLs/metabot-*/SKILL.md`

However, the source model must change from a host-only render model to a dual-render model.

It is not acceptable to keep a source format that only renders correctly after injecting host-specific metadata.

### Built shared distribution source

The build system must render one shared distribution artifact set:

- `skillpacks/shared/skills/metabot-*/SKILL.md`

These files are the installable shared skill payloads that populate `~/.metabot/skills`.

### Neutral render rule

The builder must support two explicit render modes for MetaBot skills:

1. `shared`
2. `host`

The `shared` render mode produces host-neutral installed skill content for:

- `skillpacks/shared/skills/metabot-*/SKILL.md`

The `host` render mode may still produce host-labeled helper content where needed for:

- host READMEs
- host install wrappers
- optional compatibility outputs

The shared render must not depend on undocumented string stripping of host metadata after the fact.

Instead, the authoring format must explicitly support a neutral render path.

Acceptable implementation patterns include:

- replacing the current host-only metadata token with render-mode-specific metadata blocks
- splitting host metadata into optional include sections
- moving host metadata fully out of the shared skill body

Unacceptable patterns include:

- generating a host-specific skill first and then heuristically deleting host fragments
- keeping a source file that is only valid after `{{HOST_SKILLPACK_METADATA}}` expansion

### Host pack role after this change

Host pack directories remain in the repository, but their role changes:

- they are wrappers for host bind/install convenience
- they are no longer the normative installed source for MetaBot skill content

## Shared Skill Contract Requirements

The installed shared `SKILL.md` files under `~/.metabot/skills` must be valid across all supported hosts.

That means they must:

- avoid host-specific path assumptions
- avoid host-specific tone or wording that changes behavior
- call `metabot skills resolve` without requiring `--host`
- describe the MetaBot runtime contract, not a host-local copy contract

They must not:

- embed `--host codex`
- embed `--host claude-code`
- embed `--host openclaw`
- assume the current host scans `~/.metabot/skills` directly

The shared installed `SKILL.md` files must be rendered from the explicit `shared` render path, not from a host-specific artifact with post-processing.

### Canonical resolve form

The canonical resolve command becomes:

```bash
metabot skills resolve --skill metabot-ask-master --format markdown
```

Not:

```bash
metabot skills resolve --skill metabot-ask-master --host codex --format markdown
```

## `metabot skills resolve` Contract

### Current problem

Today `metabot skills resolve` requires:

- `--skill`
- `--host`
- `--format`

That requirement forces installed shims to be host-specific even when the actual runtime contract is not.

### New contract

`--host` becomes optional.

Required:

- `--skill`
- `--format`

Optional:

- `--host`

Canonical examples:

```bash
metabot skills resolve --skill metabot-network-manage --format markdown
metabot skills resolve --skill metabot-network-manage --format json
```

Compatibility examples:

```bash
metabot skills resolve --skill metabot-network-manage --host codex --format markdown
metabot skills resolve --skill metabot-network-manage --host openclaw --format json
```

### Behavior without `--host`

Without `--host`, the resolver returns the shared host-neutral contract.

This is intentionally the canonical path.

The implementation must not rely on brittle environment sniffing to guess a host at runtime.

Instead:

- the shared contract is designed to be valid on all supported hosts
- no-host resolve is the normal path
- host-specific override rendering is only a compatibility or diagnostics path

### Behavior with `--host`

With `--host`, the resolver may include host-specific metadata or wording if needed, but it must not change the core command contract of the skill unless a real host capability difference exists.

In practice, the preferred outcome is:

- default and host-specific outputs are semantically equivalent
- `--host` survives as a compatibility knob, not a separate skill universe

### JSON output expectations

The JSON envelope should make the resolution mode explicit.

Required compatibility fields:

- `format`
- `host`
- `contract`

Recommended additional fields:

- `skill`
- `requestedHost`
- `resolutionMode`: one of `shared_default` or `host_override`

### Resolver compatibility contract

The resolver migration must preserve the current response shape as much as possible.

Rules:

- the JSON output must keep a top-level `host` field
- the markdown output must keep the existing contract-body shape unless a real contract change is intended
- existing `--host <host>` calls must keep working without behavior regression

To avoid a shape-breaking nullability change, the design standardizes:

- `host: "shared"` when no `--host` is provided
- `host: "<host>"` when `--host <host>` is provided
- `requestedHost`: omitted or `null` when not explicitly requested

This lets the CLI add a no-host mode without removing the existing `host` field from machine-readable output.

That requires widening the current host type from only concrete host ids to:

- `"shared" | "codex" | "claude-code" | "openclaw"`

## Host Bind Flow

### New command surface

Add a host-bind command family:

```bash
metabot host bind-skills --host codex
metabot host bind-skills --host claude-code
metabot host bind-skills --host openclaw
```

This introduces a new top-level CLI group:

- `metabot host`

Initial public subcommands:

- `metabot host bind-skills --host <host>`

The `host` command family must follow the same machine-first CLI conventions as the rest of the project:

- JSON envelope output by default
- `--help` and `--help --json` support
- stable command failure codes
- no interactive prompts

The implementation scope explicitly includes:

- CLI dispatch wiring in the top-level command router
- help-text and machine-readable help wiring
- CLI dependency typing and runtime handler wiring
- test coverage for command parsing, help, and result envelopes

This command is responsible for:

- resolving the target host-native skill root
- ensuring the host-native skill root exists
- creating or refreshing `metabot-*` links into `~/.metabot/skills`
- leaving unrelated non-MetaBot host skills untouched

### Bind semantics

For each managed skill:

- if the host entry already exists as the correct symlink, keep it
- if the host entry exists as the wrong symlink, replace it
- if the host entry exists as a copied directory from the legacy install flow, replace it with a symlink
- if the shared source skill is missing, fail with an actionable error

### Managed scope

The bind flow only manages skills under the MetaBot prefix:

- `metabot-*`

It must not delete, rewrite, or inspect unrelated host skills.

### Failure handling

If the host-native root cannot be resolved or written:

- fail closed
- return the exact host root path
- explain the missing dependency or permission error

### Result contract

Successful `metabot host bind-skills` output should include:

- `host`
- `hostSkillRoot`
- `sharedSkillRoot`
- `boundSkills`
- `replacedEntries`
- `unchangedEntries`

Failure output should remain in the standard command envelope and use specific codes such as:

- `shared_skills_missing`
- `host_skill_root_unresolved`
- `host_skill_bind_failed`

## Shared Install Flow

### New shared install artifact

Add one shared install artifact set:

- `skillpacks/shared/install.sh`
- `skillpacks/shared/skills/metabot-*/`
- `skillpacks/shared/runtime/dist/cli/main.js`
- `skillpacks/shared/runtime/compatibility.json`

`skillpacks/shared/install.sh` installs:

- shared skills into `~/.metabot/skills`
- the primary `metabot` shim into `~/.metabot/bin`

The shared install artifact must preserve the current bundled-runtime install capability.

That means `skillpacks/shared/install.sh` must be able to resolve the MetaBot CLI from:

1. an explicit `METABOT_CLI_ENTRY`
2. a source checkout via `METABOT_SOURCE_ROOT`
3. a bundled packaged runtime inside the shared pack

### Unified installation sequence

The normative install sequence becomes:

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

If the user wants multiple hosts on the same machine:

```bash
metabot host bind-skills --host codex
metabot host bind-skills --host claude-code
metabot host bind-skills --host openclaw
```

The shared install happens once.
Additional hosts only need a bind step.

This sequence is the normative source-checkout flow.

The packaged/offline flow must remain supported through the bundled shared runtime and bundled shared skills inside the distributed pack artifacts.

### Host wrapper installers

Existing host installers may remain, but they become wrappers around the shared flow.

They must remain self-contained when distributed standalone.

Example target behavior of `skillpacks/codex/install.sh`:

1. install shared skills into `~/.metabot/skills`
2. install or refresh `~/.metabot/bin/metabot`
3. bind Codex host skills into `${CODEX_HOME:-$HOME/.codex}/skills`

That keeps backward compatibility for users who still run host-local install scripts, while preserving a single real skill content root.

### Self-contained host-pack packaging rule

Host installers must not assume that a sibling checkout-local `skillpacks/shared` directory exists at install time.

To stay backward-compatible as standalone artifacts, each host pack must bundle a self-contained shared payload copy inside the host pack runtime bundle.

Required bundled payload shape:

- `skillpacks/<host>/runtime/shared-skills/metabot-*/`
- `skillpacks/<host>/runtime/shared-install.sh` or equivalent install helper
- `skillpacks/<host>/runtime/dist/cli/main.js`
- `skillpacks/<host>/runtime/compatibility.json`

Standalone host install behavior must prefer the bundled shared payload.

If the installer is running inside a source checkout, it may optionally use the checkout-local shared pack, but that is an optimization path, not a requirement.

## Documentation Model

### New normative install document

Create one primary install document:

- `docs/install/open-agent-connect.md`

This becomes the normative installation entrypoint.

It should cover:

- shared install prerequisites
- shared install commands
- `PATH` setup for `~/.metabot/bin`
- host bind steps
- post-install verification
- first-run identity handoff

### Existing host documents

Existing host docs stay, but their role changes.

They should:

- link to the unified install document for the primary install flow
- document only host-specific notes and examples
- avoid restating the full installation lifecycle

### Existing agent-install runbooks

`docs/hosts/codex-agent-install.md` should stop being a host-isolated install truth source and instead become a Codex-flavored execution wrapper around the shared install flow.

That means it should:

- reference the shared install root `~/.metabot/skills`
- verify shared skill installation, not host-local copied skill content
- use host bind language for Codex-specific exposure

## Build System Changes

The skillpack build system must generate two categories of output:

1. shared install artifacts
2. host bind wrapper artifacts

### Shared output

New output:

- `skillpacks/shared/README.md`
- `skillpacks/shared/install.sh`
- `skillpacks/shared/skills/metabot-*/SKILL.md`
- `skillpacks/shared/runtime/dist/cli/main.js`
- `skillpacks/shared/runtime/compatibility.json`

### Host output

Host output stays, but becomes wrapper-oriented:

- `skillpacks/codex/install.sh`
- `skillpacks/claude-code/install.sh`
- `skillpacks/openclaw/install.sh`
- `skillpacks/<host>/runtime/shared-skills/metabot-*/`
- `skillpacks/<host>/runtime/shared-install.sh` or equivalent helper

Those installers should no longer be the primary creators of copied skill content in host-native roots.

The build must guarantee that every shipped host pack is self-contained and can perform the shared install + host bind flow without requiring an adjacent repository checkout.

## Migration Rules

This project has not shipped yet, so this round may take a hard cut-over stance.

Rules:

- new installs use the shared root model
- host-native copied MetaBot skill directories are treated as replaceable compatibility leftovers
- bind commands may replace copied `metabot-*` directories with symlinks
- no migration is required for unrelated host-native skills

### Repo migration scope

Even though installed end-user migration is not required, first-party repository migration is required.

This design explicitly includes coordinated updates to:

- `README.md`
- `docs/hosts/codex-agent-install.md`
- `docs/hosts/codex.md`
- `docs/hosts/claude-code.md`
- `docs/hosts/openclaw.md`
- `tests/docs/codexInstallDocs.test.mjs`
- `tests/cli/skills.test.mjs`
- `tests/skillpacks/buildSkillpacks.test.mjs`
- generated `skillpacks/*`

The cut-over is not complete until repo docs, tests, and generated artifacts stop treating `--host` as mandatory for the common `skills resolve` path and stop treating host-local copied MetaBot skills as the normative install target.

During the transition, existing host docs and their tests are still part of the public entry surface and must be updated, not ignored.

## Testing Requirements

### CLI tests

Add tests that prove:

- `metabot skills resolve --skill ... --format markdown` works without `--host`
- `--host` remains accepted as a compatibility parameter
- no-host resolve returns the shared default resolution mode

### Host bind tests

Add tests that prove:

- `metabot host bind-skills --host codex` creates correct symlinks
- re-running bind is idempotent
- copied legacy `metabot-*` directories are replaced by symlinks
- unrelated host-native skills are preserved

### Host compatibility smoke tests

Add one symlink-based compatibility smoke path per supported host:

- Codex
- Claude Code
- OpenClaw

Each smoke path must at minimum verify:

- a host-native skill root populated through symlinks exists in the expected location
- the host-facing install/bind flow leaves the MetaBot skills discoverable at the host root
- the smoke path uses symlinked entries, not copied directories

If a fully automated live-host discovery assertion is not available in this repository, the implementation must add:

- the strongest available automated filesystem/install smoke, and
- an explicit manual host acceptance checklist for release verification

### Build tests

Add tests that prove:

- `skillpacks/shared/skills/*` are generated
- shared generated `SKILL.md` files no longer require `--host`
- host wrapper installers are generated with the correct bind behavior

### Documentation tests

Add tests that prove:

- the unified install document is present and referenced
- host install docs point to the unified install document
- install docs verify `~/.metabot/skills` as the shared installed source

## Error Handling

### Missing shared skill root

If `metabot host bind-skills` runs before shared skills are installed:

- fail with `shared_skills_missing`
- explain that `~/.metabot/skills` must be installed first

### Missing host root configuration

If the requested host root cannot be resolved:

- fail with `host_skill_root_unresolved`
- return the requested host value

### Link creation failure

If a symlink cannot be created:

- fail with `host_skill_bind_failed`
- return the source and destination paths

This round does not require copy fallback.
The design prefers failing with a clear error over silently reintroducing duplicate skill content.

## Open Decision Resolved By This Design

The earlier question was whether `metabot skills resolve` should:

1. auto-detect the current host through environment sniffing, or
2. stop requiring host for the common path

This design chooses:

- no-host shared-default resolve

Reason:

- it achieves the user-facing goal of not needing `--host`
- it avoids brittle host sniffing heuristics
- it allows one shared installed `SKILL.md` to work everywhere

## Expected Outcome

After this design is implemented:

- MetaBot skills are installed once under `~/.metabot/skills`
- Codex, Claude Code, and OpenClaw expose those skills through lightweight binds
- the canonical skill execution contract does not require `--host`
- installation docs stop drifting across hosts
- adding a second or third coding-agent host on the same machine no longer requires reinstalling the MetaBot skills themselves
