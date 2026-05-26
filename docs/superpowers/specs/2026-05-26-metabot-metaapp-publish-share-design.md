# MetaBot MetaApp Publish/Share CLI and Local Gallery Design

**Date:** 2026-05-26

## Goal

Add a CLI-first MetaApp publishing pipeline that lets a local MetaBot take a browser-runnable frontend app or game, package it as a MetaApp, write it on-chain, and make it visible in both the official MetaWeb ecosystem and a local OAC gallery.

The user-facing result should be:

- `metabot metaapp publish` turns a finished project into a MetaApp pin
- `metabot metaapp update` publishes a new version against an existing MetaApp pin
- `metabot metaapp share` gives a copyable pinId and MetaWeb URL, with optional simplebuzz announcement
- `metabot metaapp view` opens the local gallery so the user can see their own published work without leaving OAC
- `metabot metaapp comment` writes a comment using the existing on-chain comment protocol

This round is intentionally narrow:

- focus on browser-runnable frontend apps and games
- reuse existing MetaApp, file upload, chain write, buzz, and paycomment protocols
- keep CLI behavior and help output aligned with the rest of `metabot`
- keep the local gallery visually and structurally consistent with the existing `/ui/*` pages

## Locked Decisions

### 1. CLI style must match the existing CLI

`metaapp` is a new command family inside the existing `metabot` CLI, not a separate product surface.

The command family should follow the same patterns already used by `chain`, `buzz`, `services`, `wallet`, `llm`, and `loom`:

- top-level subcommand group
- `--help` and `--help --json`
- `MetabotCommandResult` envelopes
- `--from` as the canonical actor selector for chain writes
- request-file style only where it helps with complex payload editing
- consistent unknown-command and missing-flag errors

### 2. `--from` is the canonical actor selector for write-capable paths

Any `metaapp` command that writes chain data must support `--from <bot-slug>`.

That includes:

- `publish`
- `update`
- `comment`
- `share` only when it posts a buzz announcement

To match the rest of the CLI, `--from` is optional in the syntax. Omitting it lets the existing runtime dependency use the active identity fallback. If no usable active identity exists, the command should fail with the same identity-resolution style used by existing write commands.

Help examples should prefer explicit `--from` so users can easily publish from different local MetaBots.

Read-only commands do not need `--from`, but they may accept it when the result is actor-scoped.

### 3. The first MVP is browser-runnable work

The first version only promises:

- static frontend sites
- frontend apps
- browser games

If project detection fails, the command should fall back to a manual manifest/edit flow instead of guessing a broken publish plan.

This round does not add a general download-only package system for arbitrary skills or non-browser artifacts.

### 4. Publish and update are confirmation-gated

`publish` and `update` reuse the same detection and packaging pipeline.

The default flow is:

1. inspect the project
2. build a preview manifest
3. show the result
4. only write chain data when the user confirms

The non-interactive contract should be explicit and machine-friendly. If confirmation is missing, return a preview result or `manual_action_required` instead of silently writing.

### 5. Share uses simplebuzz, not a new protocol

`metaapp share` should reuse the existing simplebuzz protocol.

The announcement should quote or reference the published MetaApp pin so the buzz stays linked to the work.

### 6. Comment uses the existing paycomment protocol

`metaapp comment` should reuse `/protocols/paycomment`.

The payload should be the standard comment shape:

- `content`
- `contentType`
- `commentTo`

No new comment protocol is introduced.

### 7. Local gallery is a first-class `/ui` page

The local MetaApp gallery should be a normal built-in OAC page, not a separate standalone app shell.

It should reuse the same visual system as the other `/ui` pages:

- same page shell
- same shared stylesheet
- same panel and action affordances
- same quiet operational tone

The built-in page name should be `metaapps`, so the gallery can be opened by both:

- `metabot metaapp view`
- `metabot ui open --page metaapps`

The page should also appear in the shared `/ui` navigation so it feels like part of the same product surface.

## Command Surface

### `metabot metaapp preview`

Purpose:

- inspect a project directory
- auto-detect common frontend layouts
- derive a draft manifest
- start a local preview URL
- optionally capture a screenshot or cover candidate

Suggested shape:

```bash
metabot metaapp preview --project-dir <path> [--open]
```

Behavior:

- never writes chain data
- never uploads the publish artifact
- returns a structured preview object with the detected project shape and proposed publish manifest
- if the project cannot be classified, return a manual configuration draft instead of guessing

### `metabot metaapp publish`

Purpose:

- publish a new MetaApp from a project directory
- upload the deployable artifact
- write `/protocols/metaapp` with `operation=create`
- update the local gallery cache

Suggested shape:

```bash
metabot metaapp publish --project-dir <path> [--from <bot-slug>] [--manifest-file <path>] [--chain <mvc|btc|opcat>] [--confirm]
```

Behavior:

- detect the project from the directory when no manifest file is provided
- allow a user-edited manifest file to override the auto-generated draft
- package the runtime artifact that MetaWeb can deploy
- use a file-upload-compatible chain choice when one is supplied
- write the MetaApp payload with `operation=create` and `path=/protocols/metaapp`
- return the new `pinId`, the stable `firstPinId` when available, the canonical MetaWeb URL, and the local gallery URL
- if confirmation is missing, return the preview result and do not write

### `metabot metaapp update`

Purpose:

- publish a new version of an existing MetaApp
- reuse the same project inspection and packaging flow as `publish`
- write `/protocols/metaapp` with `operation=modify`
- target the existing MetaApp pin with `path=@<targetPinId>`

Suggested shape:

```bash
metabot metaapp update --target-pin-id <pinid> --project-dir <path> [--from <bot-slug>] [--manifest-file <path>] [--chain <mvc|btc|opcat>] [--confirm]
```

Behavior:

- inherit the previous version draft when possible
- allow the user to edit the manifest before writing
- use a file-upload-compatible chain choice when one is supplied
- preserve version history through the existing MetaWeb indexer semantics
- update the local gallery cache immediately after the write

### `metabot metaapp share`

Purpose:

- produce a copyable share bundle for a published MetaApp
- optionally post a simplebuzz announcement through the existing buzz protocol

Suggested shape:

```bash
metabot metaapp share --pin-id <pinid> [--announce] [--from <bot-slug>] [--chain <mvc|btc|doge|opcat>]
```

Behavior:

- always return the shareable pinId and canonical MetaWeb URL
- include a suggested buzz message that can be reused as-is
- when `--announce` is present, post the buzz and quote the MetaApp pin
- when `--announce` is present, allow the same chain choices as `metabot buzz post`
- when `--announce` is absent, ignore `--chain` for write planning and do not treat it as a trigger for any chain operation

### `metabot metaapp view`

Purpose:

- open the local MetaApp gallery
- optionally jump to a specific MetaApp or the current actor's published work

Suggested shape:

```bash
metabot metaapp view [--from <bot-slug>] [--pin-id <pinid>] [--first-pin-id <pinid>] [--mine]
```

Behavior:

- open the built-in `/ui/metaapps` page
- when `--mine` is set, scope the gallery to the selected actor
- when a pin selector is present, deep-link to the relevant detail view
- `--pin-id` and `--first-pin-id` are mutually exclusive selectors; combining them should fail with `invalid_flag`
- `--mine` is a scope switch and may be combined with `--from`, but it must not be combined with either pin selector

### `metabot metaapp comment`

Purpose:

- post a comment against a MetaApp pin using the existing comment protocol

Suggested shape:

```bash
metabot metaapp comment --pin-id <pinid> --comment <text> [--from <bot-slug>] [--chain <mvc|btc|doge|opcat>]
```

Behavior:

- write `/protocols/paycomment`
- populate `commentTo` with the target MetaApp pinId
- reuse the existing chain-write path and error handling style
- allow the same chain choices as the existing comment-capable chain write path

## Project Detection And Packaging

The publish pipeline should auto-detect common frontend project layouts before falling back to manual input.

Suggested detection order:

1. package.json scripts and lockfiles
2. known frontend framework conventions
3. static `index.html` or equivalent browser entry
4. plain source tree packaging for projects that are already directly runnable

The pipeline should infer:

- project type
- package manager
- build command
- runtime artifact directory
- index file
- browser runtime value
- tags and descriptive metadata

For pure static or uncompiled frontend projects, the source tree itself can be the runtime artifact.

For compiled projects, the build output is the runtime artifact and the source tree is optional metadata, not the deployable payload.

If a project is not clearly publishable as a browser app, return a manual manifest draft instead of forcing a publish.

## MetaApp Payload Rules

The payload must continue to use the existing MetaApp protocol fields.

Important fields:

- `title`
- `appName`
- `prompt`
- `icon`
- `coverImg`
- `introImgs`
- `intro`
- `runtime`
- `indexFile`
- `version`
- `contentType`
- `content`
- `code`
- `contentHash`
- `metadata`
- `disabled`

Publish/update should treat `code` as the deployable artifact pointer, using a `metafile://...` URI that MetaWeb can fetch and unpack.

This is an explicit compatibility choice for the current MetaWeb deployment service. Although the older protocol wording can make `code` sound like source code, the current deployment path reads `code` first and only falls back to `content`. Therefore OAC must not put a non-deployable source archive in `code`.

For the first MVP:

- `code` should contain the deployable runtime artifact URI
- `content` should be empty or mirror the same deployable runtime artifact pin only when needed for compatibility
- source archives, if included, should live under `metadata.sourceArchive`
- `contentType` should describe the deployable artifact, usually `application/zip`

The `metadata` field should carry OAC-specific publish context, such as:

- source directory
- detected project type
- build command
- output directory
- preview info
- optional auxiliary artifact pins

The `content` field should not be used to create a second deployment path that conflicts with `code`.

For the first MVP:

- `runtime` should normally be `browser`
- the deployable artifact should be something MetaWeb can run directly
- zipped runtime output is acceptable
- zipped source output is acceptable for simple static sites

## Local Gallery Design

The local gallery should live under the existing profile runtime layout:

- `~/.metabot/profiles/<slug>/.runtime/state/metaapps/`

The first implementation should use concrete, profile-scoped state files:

- `.runtime/state/metaapps/local-cache.json`
- `.runtime/state/metaapps/indexer-cache.json`

`local-cache.json` is owned by publish/update/share flows and stores optimistic records produced locally.

`indexer-cache.json` is owned by indexer sync or gallery refresh flows and stores the most recent normalized official indexer response.

The merge layer may derive in-memory rows from both files, but it should not write merged rows back as a third source of truth unless a later design explicitly adds that file.

This design must stay inside `.runtime/state/` and avoid the legacy `.metabot/hot` layout.

The gallery should merge three sources:

1. the official MetaWeb MetaApp indexer API
2. the local optimistic cache written after publish/update
3. raw-chain fallback later, if needed

The official indexer is the primary source of truth for:

- version history
- latest resolved version
- download/run affordances

The local cache is the primary source for:

- immediate post-publish visibility
- actor-scoped "my apps" filtering before the indexer catches up

The page should render the same style of dense operational list used by the other `/ui` pages:

- title
- pinId
- version
- runtime
- status
- updated time
- owner or actor context

Each item should expose the obvious actions:

- open
- run
- download
- copy pinId
- share
- comment

The page should not introduce a separate visual language or marketing layout.

## Help And CLI Consistency

Help must be a first-class part of the surface.

The following must work:

- `metabot --help`
- `metabot metaapp --help`
- `metabot metaapp preview --help`
- `metabot metaapp publish --help`
- `metabot metaapp update --help`
- `metabot metaapp share --help`
- `metabot metaapp view --help`
- `metabot metaapp comment --help`
- `--help --json` for the same commands

Each listed command must have a registered `CommandHelpSpec` entry, including `preview`.

The help content should follow the same structure as existing CLI help:

- usage
- summary
- commands
- required flags
- optional flags
- request or preview shape
- success fields
- failure semantics
- examples

The new entries should not make the CLI feel like two products. They should read like a natural extension of the current command tree.

## Error Handling

Use the existing CLI error vocabulary and keep failure modes specific.

Examples:

- missing resolvable actor/identity for write-capable commands should fail clearly
- unknown project shapes should return a manual-action result, not a crash
- unsupported chain choices for file-upload-backed publish/update should fail before writing
- share announcements and comments should reject unsupported chain choices using the same style as other write commands
- chain-write failures should remain distinct from upload failures
- comment and share announcement failures should still return the share or comment preview where possible

The command should preserve useful output even when a later step fails.

## Testing Strategy

Add focused tests that mirror the existing CLI test style.

Recommended coverage:

- help output for the new `metaapp` group and leaf commands
- JSON help output for at least one leaf command
- `--from` propagation for write-capable commands
- publish/update confirmation gating
- `create` vs `modify` routing
- paycomment payload construction for `comment`
- simplebuzz payload construction for `share --announce`
- local gallery route registration
- `ui open --page metaapps` integration
- local cache write and merge behavior

Tests should stay targeted and reuse the existing test harness patterns.

## Non-Goals

This round does not add:

- a general skill/package publishing protocol
- a new chain protocol for works
- a separate visual design system for the gallery
- a raw-chain reindexer inside OAC
- a full marketplace or social feed around MetaApps

Those can come later without changing the core publishing contract defined here.
