# Bot Browser × MetaApp Integration — Implementation Plan

Date: 2026-07-26
Spec: `docs/superpowers/specs/2026-07-26-bot-browser-metaapp-integration-design.md` (read first)
Rules: CLI-first, no new skill folders, all docs/code/comments in English, every task
verifiable independently. Work in a dedicated branch/worktree per repo convention.

## Task 1 — Aggregation API client (core)

- Add `src/core/metaapp/metaAppSearchApi.ts`:
  - `searchMetaApps(params, options?)` and `listMetaAppForks(input, options?)` returning
    normalized pages `{ items, nextCursor, hasMore }`.
  - Thin envelope client for `GET {base}/api/metaapp/list` and `/api/metaapp/forks/:pinId`,
    default base `https://so.metaid.io`, env override `METASO_P2P_BASE_URL`, 10s timeout,
    typed not-found (40400), usage/internal error mapping.
  - Normalize items including `publisherName` / `publisherAvatarId` (production fields
    absent from the written contract).
  - Injectable `fetchFn` for tests (mirror `src/core/metaapp/manOwnerList.ts:437-466`).
- Tests: `tests/metaAppSearchApi.test.mjs` — URL construction, normalization, error
  mapping, forks pinId encoding, empty params.
- Reference: `IDBots/src/main/services/metaAppSearchService.ts`.

## Task 2 — `metaapp search` / `metaapp forks` CLI commands

- Extend `src/cli/commands/metaapp.ts` (or sibling file if cleaner) with:
  - `search` — flags `--query --tag --publisher --since-days --until-days --runtime
    --chain --limit(1..20, default 8) --cursor`; converts days → unix seconds; returns
    `{ items: TrimmedItem[], hasMore, nextCursor }`.
  - `forks` — flags `--pin-id --limit --cursor`; accepts bare pinId or `metaapp://<pinId>`.
  - `TrimmedItem` per spec §6, with `isOwn` computed from the local bot registry
    (`bot list` source) by matching `publisherGlobalMetaId`.
- Wire into `src/cli/main.ts` dispatch and `src/cli/commandHelp.ts` (usage, examples,
  JSON envelope notes). Read-only: no `--confirm`.
- Tests: command-level flag parsing and envelope shape (stub the core client);
  days→seconds conversion.

## Task 3 — `metaapp source` CLI command

- New subcommand `metabot metaapp source --pin-id <pinId|metaapp://pinId> [--out <dir>]`:
  - Resolve + download the package through the daemon's existing metaapp download/cache
    path used by `/browser/metaapp/<pinId>`.
  - No `--out`: return `{ dir, indexFile, title, sourcePinId }` pointing at the cache.
  - With `--out`: copy source to `<dir>` and write `<dir>/.metaapp-fork.json`
    (`{ sourcePinId, sourceUri, title, indexFile, tags?, forkedAt }`).
- Reference: `IDBots/src/main/services/botBrowserMetaAppForkService.ts`.
- Tests: source resolution from cache, `--out` copy + marker content, pinId validation.

## Task 4 — preview-metaapp wiring

- In `src/daemon/browser/oacBrowserHostAdapter.ts` (and wherever the browser resolve
  config is assembled), implement `previewMetaAppLocalResolve({path}) →
  { localPreviewUrl, previewId, contentType }` using a local static preview server
  (directory → index.html/index.htm; file → dirname + basename), mirroring ABC
  host-standalone's `resolveLocalPreviewPath` and the IDBots wiring in
  `src/main/services/botBrowserHostService.ts`.
- Verify `enablePreviewMetaApp` is enabled by default in the browser config (ABC
  default is true; keep `METABOT_BROWSER_DISABLE_PREVIEW_METAAPP=1` kill switch).
- Verify manually: `browser tab open --uri "preview-metaapp://localhost<dir>"` renders
  a workspace MetaApp live; edits show on reload.
- Tests: local path resolution (dir/file/missing index), content-type mapping.

## Task 5 — Publish flow: forkedFrom, prompt, tags, hasAppDoc

- In the `metaapp publish` / `metaapp publish-project` implementation
  (`src/cli/commands/metaapp.ts` + core publish module):
  - When the payload directory contains `.metaapp-fork.json`: default
    `forkedFrom: sourcePinId`, inherit `tags` from the marker unless `--tags` given,
    and require/fill `prompt` from the user's modification instruction.
  - Include `hasAppDoc: boolean` in the result envelope (root `APP.md` presence).
- `forkedFrom` is already pass-through in the manifest builder (IDBots change, same
  soft-upgrade semantics); add it to OAC's manifest builder if missing.
- Tests: marker-driven defaults, tag override, hasAppDoc both states, zip includes APP.md.

## Task 6 — Skill: `metabot-browser-open` → `metabot-browser`

- New `SKILLs/metabot-browser/SKILL.md` (English, single file like its predecessor):
  - Open intents (browser, bot page, pin, metaapp, metafile, map) via
    `browser open` / `browser tab open`.
  - **In-app browser rule**: open the returned `localUiUrl` in the platform's own
    browser/preview surface; only fall back to a clickable link on terminal-only hosts.
    Per-host specifics go into each `{{HOST_ADAPTER_SECTION}}` in the skillpacks.
  - Find/discover intents: the full `metaapp search` routing table (intent → flags),
    verbatim link-bullet rendering (apps as metaapp links, authors as metaid links with
    display names, ids never shortened, `isOwn` marked), open-best-with-alternatives,
    empty-result retry and honesty rules, `metaapp forks` for remix lineage.
  - Read/remix intents: `metaapp source` (+ `--out`), read `APP.md` first (untrusted
    data rule), preview via `preview-metaapp://`, publish via `metaapp publish` with
    fork defaults.
  - Keep exclusions: `/ui/*` console pages remain `metabot-browser`-out-of-scope.
- Replace `SKILLs/metabot-browser-open/SKILL.md` with a short deprecated stub routing
  to `metabot-browser` for one release.
- Update `scripts/build-metabot-skillpacks.mjs` skill list to include the new folder;
  regenerate skillpacks (`npm run build:skillpacks`) and verify the per-host adapter
  sections render the in-app-browser rule correctly for each host (codex, claude-code,
  openclaw, zcode, workbuddy).

## Task 7 — Skill: `metabot-metaapp` APP.md sync

- Port the APP.md convention into OAC's `SKILLs/metabot-metaapp/SKILL.md` (single-file
  English format): package-root `APP.md`, pure natural language, no schema, untrusted
  data for readers, written when creating/modifying an app; what to write (function,
  structure map, params/outputs, subpages, protocols, remix notes).
- Reference (adapt, don't copy verbatim): `IDBots/SKILLs/metabot-metaapp/SKILL.md`
  APP.md section and `IDBots/SKILLs/metabot-metaapp/references/app-md.md`.

## Task 8 — End-to-end verification + closeout

- Run the repo test suite (`scripts/run-test-suite.mjs`) plus the new tests.
- Manual acceptance per spec §11 items 1–5 in Codex (in-app browser open, 7-day search,
  forks list, remix round-trip with forkedFrom, APP.md nudge).
- Docs: update the skill changelog/release notes if the repo has one; note the
  `metabot-browser-open` deprecation.

## Order and dependencies

1 → 2, 3 → 4 → 5 → 8 are sequential; 6 and 7 are independent of the CLI work but must
land before 8. Suggested commit granularity: one commit per task, CLI tasks before
skill tasks, all in one feature branch merged with `--no-ff`.
