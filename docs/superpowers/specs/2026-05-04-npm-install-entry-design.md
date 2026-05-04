# NPM Install Entry Design

## Summary

Open Agent Connect should add an npm-first install path:

```bash
npm i -g open-agent-connect
oac install
```

This path must be equivalent in final installed state to the existing
agent-readable install guide at `docs/install/open-agent-connect.md`. The guide
stays as a first-class, beginner-friendly entry point for users who prefer to
ask a local agent to read and execute the installation instructions.

The npm path should simplify the visible user experience without removing the
existing GitHub guide or the release-pack fallback.

## Goals

- Make the primary terminal install path short and memorable.
- Keep `docs/install/open-agent-connect.md` as the friendly runbook for new
  users and local agents.
- Make the npm path and guide path produce the same installed runtime state.
- Avoid asking users to copy a long shell script from the README.
- Keep host binding explicit, observable, and recoverable.
- Reduce the npm package surface so npm publishing does not ship tests,
  generated release packs, or duplicated generated host runtimes.

## Non-Goals

- Do not remove the existing GitHub release host-pack installer in this round.
- Do not rely on `postinstall` to mutate the user's home directory.
- Do not make users install from a local source checkout.
- Do not introduce new storage paths outside the storage layout v2 design.
- Do not make the README the only source of installation truth.

## User-Facing Install Paths

### Path A: NPM Terminal Install

The short terminal path becomes:

```bash
npm i -g open-agent-connect
oac install
```

`npm i -g` installs the package and exposes CLI binaries. `oac install` performs
the local Open Agent Connect installation:

- install or update shared `metabot-*` skills under `~/.metabot/skills`
- install or update the canonical `metabot` shim under `~/.metabot/bin`
- bind the shared skills into the selected host skill root
- verify basic CLI health
- report the identity state and next natural-language step

### Path B: Agent-Readable Guide

The guide path remains:

```text
Read https://github.com/openagentinternet/open-agent-connect/blob/main/docs/install/open-agent-connect.md and install Open Agent Connect for this agent platform.
```

The guide should recommend the npm path when npm is available. It may keep the
GitHub release-pack flow as a fallback for environments where npm is unavailable
or where a pinned release archive is required.

## Equivalence Contract

The npm path and the guide path are equivalent when they leave the machine in
the same observable state:

- `metabot --help` runs successfully.
- `metabot identity --help` runs successfully.
- shared skill directories exist under `~/.metabot/skills/metabot-*`.
- the chosen host has `metabot-*` skill bindings in its host-native skill root.
- the installed CLI reports the package version used for installation.
- if an active identity already exists, the installer reports the current name
  and `globalMetaId`.
- if no active identity exists, the installer tells the user to create one in
  natural language instead of exposing internal setup trivia.

The two paths do not need to perform the same intermediate commands. They only
need to satisfy the same final state and verification contract.

## CLI Shape

The package should expose both binaries:

- `metabot`: the existing runtime CLI.
- `oac`: the Open Agent Connect installer and maintenance CLI.

Initial `oac` commands:

```bash
oac install
oac install --host codex
oac install --host claude-code
oac install --host openclaw
oac doctor
```

`oac install` should try to infer the current host from the environment and
known host home directories. If it cannot infer a single host, it should fail
with a clear instruction to rerun with `--host codex`, `--host claude-code`, or
`--host openclaw`.

When the command runs in a Codex environment, it may default to `codex`. For
Claude Code and OpenClaw, it should use their documented environment/home
signals. If more than one host signal is present, explicit `--host` is required.

`oac doctor` should run the non-mutating verification checks used by
`oac install` so users can confirm the npm path and guide path still satisfy
the same contract.

## Package Layout

The npm package should not publish the current full repository contents. The
current dry-run package includes generated runtimes, release packs, tests, and
other development-only files. The package should use a `files` whitelist or
equivalent packaging control.

Required npm package contents:

- `dist/` runtime CLI output.
- runtime UI assets needed by `metabot ui open`.
- canonical skill source files needed to install `~/.metabot/skills`.
- install templates or installer support code used by `oac install`.
- `release/compatibility.json`.
- `README.md`, `LICENSE`, and the install guide.

Excluded npm package contents:

- `tests/`.
- generated `release/packs/*.tar.gz`.
- generated `skillpacks/*/runtime/node_modules`.
- local diagnostics, logs, and development-only scripts.

If the CLI needs bundled runtime dependencies for the home-directory shim, the
installer should prefer the globally installed npm package path instead of
copying a large generated `node_modules` tree into the package.

## Install Data Flow

1. `npm i -g open-agent-connect` installs package binaries.
2. User runs `oac install`.
3. `oac install` resolves package root and bundled assets.
4. `oac install` determines host mode from `--host` or environment.
5. It installs shared skills to `~/.metabot/skills`.
6. It writes `~/.metabot/bin/metabot` as a shim to the installed npm package's
   `dist/cli/main.js`.
7. It runs host binding through the existing `metabot host bind-skills --host`
   behavior or its shared library equivalent.
8. It runs the equivalence verification checks.
9. It returns a concise user-facing handoff.

## Error Handling

- Missing Node.js or unsupported Node.js version should stop with a clear
  requirement for Node.js `20` to `24`.
- Missing npm should only block the npm path; the guide may still present the
  GitHub release-pack fallback.
- Ambiguous host detection should stop and show the supported `--host` values.
- Existing `~/.metabot` content should be updated idempotently.
- Existing identities and secrets must not be overwritten.
- Failed host binding should leave shared runtime installation intact and tell
  the user which host bind command to retry.

## README And Documentation Changes

The README should make npm the primary visible terminal path:

```bash
npm i -g open-agent-connect
oac install
```

The README should still keep the agent-readable install prompt for beginner
users and explain that it is equivalent in final result to the npm path.

`docs/install/open-agent-connect.md` should become the unified beginner-friendly
guide that prefers npm when available and retains the release-pack script as a
fallback or pinned-release path.

## Testing And Verification

Implementation should add focused tests for:

- `oac install --host <host>` writes shared skill files and host bindings in a
  temporary home.
- `oac install` refuses ambiguous host detection with a useful message.
- `oac doctor` verifies the same final state contract.
- npm package dry-run output excludes generated release packs, tests, and
  generated host `node_modules` trees.

Manual verification before release should include:

```bash
npm run build
npm test
npm pack --dry-run --json
```

For release readiness, a local global install smoke should be run from the
packed tarball in a temporary home:

```bash
npm i -g ./open-agent-connect-<version>.tgz
oac install --host codex
oac doctor
metabot --help
metabot identity --help
```

## Decisions For This Round

- `oac install` may auto-select `codex` when running inside Codex.
- ambiguous host detection must require explicit `--host`.
- `oac update` is out of scope until the npm install path is stable.
