# OAC Browser Boundary Cleanup Design

Date: 2026-06-20
Status: Draft for implementation planning

## Purpose

Open Agent Connect should stop carrying its own Browser core implementation and
instead behave only as an OAC host around Agent Browser Core (ABC).

The target is a single clear boundary:

```text
ABC owns Browser core behavior.
OAC owns only OAC host glue.
```

This change is a cleanup and boundary-correction task. It is not a feature
expansion task.

## Problem Statement

OAC currently contains a mixed Browser architecture:

- ABC packages are already consumed for shared Browser behavior.
- OAC still keeps a local Browser core mirror under `src/core/browser/`.
- OAC still keeps a local standalone Browser host under
  `src/browser/standalone/`.
- OAC Browser startup still flows through two OAC layers:
  `adapter -> core bridge`.

That mixed state makes it hard to know which code path is authoritative when
Browser behavior is wrong or stale.

## Goals

- OAC no longer has its own Browser core type mirror.
- OAC no longer has its own resolver, config, settings, or runtimeContext
  Browser modules.
- OAC has one Browser adapter layer only.
- OAC consumes Browser core behavior from ABC packages instead of local copies.
- OAC stops publishing a standalone Browser host.

## Non-Goals

- Do not modify ABC in this task.
- Do not redesign Browser UI behavior.
- Do not add new Browser capabilities.
- Do not preserve deprecated OAC Browser core files for compatibility if their
  responsibility already exists in ABC.

## Required End State

### 1. OAC keeps only host glue

Allowed OAC-owned Browser responsibilities:

- OAC actor selection and profile context.
- OAC local route wrappers and shell endpoints.
- OAC-owned trusted actions, such as local conversation routing.
- OAC-specific helper code that only translates OAC runtime state into the ABC
  host contract.

OAC must not own Browser resource resolution, Browser config resolution,
Browser settings state machines, Browser URI parsing, or default Browser
homepage logic.

### 2. OAC has one adapter

OAC must expose one Browser adapter only.

The adapter may call ABC package APIs and OAC local helpers, but OAC must not
keep a second internal Browser core bridge layer. The current split between a
host adapter and a separate OAC core bridge should be removed.

### 3. No local Browser core mirror

The following OAC-local Browser core categories must disappear as OAC-owned
modules:

- types mirror
- resolver modules
- config modules
- settings modules
- runtimeContext modules

If a tiny OAC-only conversion helper is still needed after cleanup, it belongs
under an OAC host-glue location such as `src/daemon/browser/`, not under
`src/core/browser/`.

## Source Boundary

The intended source layout after cleanup is:

- keep OAC host glue in `src/daemon/browser/`
- keep OAC Browser HTTP and page wrappers in `src/browser/`
- remove `src/core/browser/`
- remove `src/browser/standalone/`

`src/browser/` remains valid only as an OAC shell around the shared Browser UI
and host contract. It must not grow back into a second Browser core.

## Package and Publish Boundary

OAC should publish only its real runtime entrypoints.

Required package-level cleanup:

- remove the `browser-standalone` bin from `package.json`
- stop producing `dist/browser/standalone/*`
- stop documenting OAC as the standalone Browser host project

Consuming ABC packages is correct. Re-implementing the same Browser core
behavior locally inside OAC is not.

## Documentation Boundary

Current source-of-truth documents must match the new architecture:

- OAC should not describe `browser-standalone` as a supported runtime entrypoint
- OAC should not describe `src/core/browser/` as a legitimate long-term Browser
  core location

Historical dated specs and plans may remain as historical records unless they
are still being used as active operating docs.

## Acceptance Criteria

This cleanup is complete only when all of the following are true:

1. OAC no longer has its own Browser core type mirror.
2. OAC no longer has its own resolver, config, settings, or runtimeContext
   Browser modules.
3. OAC has one Browser adapter only, with no separate OAC core bridge layer.
4. OAC no longer ships `browser-standalone`.
5. OAC Browser glue depends on ABC packages for shared Browser core behavior.
6. OAC tests and package guards reject reintroduction of local Browser core or
   standalone host publishing.

## Verification Shape

Implementation planning should verify at least:

- build passes after removing the old Browser core and standalone host code
- package metadata no longer exposes `browser-standalone`
- tests cover the single-adapter boundary
- tests fail if OAC reintroduces imports from a local Browser core mirror

## Planning Constraint

The follow-up implementation plan should prefer direct cleanup over temporary
compatibility shims. The goal is to remove the mixed architecture, not to hide
it behind another layer.
