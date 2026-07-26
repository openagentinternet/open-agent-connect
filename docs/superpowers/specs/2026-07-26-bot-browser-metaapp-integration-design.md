# Bot Browser × MetaApp Integration — Design Spec

Date: 2026-07-26
Status: Approved for implementation
Author: IDBots team (ported from the IDBots Bot Browser Co-Work workstream)
Implementation: a fresh OAC session (see companion plan `docs/superpowers/plans/2026-07-26-bot-browser-metaapp-integration.md`)

## 1. Background

Between 2026-07-25 and 2026-07-26, IDBots shipped a "Bot Browser Co-Work panel": the local
LLM drives the Bot Browser through natural language — opening on-chain pages, reading
what a page shows, searching the Agent Internet for MetaApps, and remixing/publishing
MetaApps with `forkedFrom` lineage. The full reference implementation exists in the
IDBots repo (`/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots`, branch `main`).

OAC needs the same capabilities, adapted to its own shape: **CLI-first, daemon-backed,
skills as thin bridges** that teach coding agents (Codex, OpenCode, etc.) how to drive
the CLI. This spec defines what to build and why; the companion plan defines the tasks.

### Target scenarios (acceptance drivers)

1. User says "open the on-chain Buzz app" / "open MetaID idq1…" → the coding agent
   resolves the URI and opens the local Bot Browser module (`http://127.0.0.1:<port>/browser/…`)
   **inside the platform's in-app browser**, not the external system browser.
2. User says "show mini-games published in the last 7 days" / "open Bob's latest app" →
   the agent searches the MetaApp aggregation API, presents a short candidate list whose
   app titles and author names are **clickable markdown links**, then opens the best match.
3. User says "show the remixes of this app" → the agent lists the app's direct
   `forkedFrom` children.
4. User says "remix this game: make it dark mode" → the agent materializes the app's
   source into the current workspace, edits it, previews it locally in the Bot Browser,
   and after explicit user confirmation publishes it under the user's MetaID with
   `forkedFrom` recorded automatically.
5. When reading any MetaApp, the agent reads its root `APP.md` first (natural-language,
   untrusted documentation), then the source.

## 2. Non-goals

- No semantic/vector search (keyword/tag/publisher/time only, matching the aggregation API).
- No new Bot Browser UI work in OAC: the daemon-hosted `/browser` module stays as-is
  except where this spec says otherwise.
- No postMessage invocation API between host and MetaApp (that is a future ABC-side track).
- No changes to the `/protocols/metaapp` wire format in this round (`forkedFrom` is
  already forward-compatible; `APP.md` is a package convention, not a protocol field).

## 3. Current OAC state (verified 2026-07-26)

- CLI: `src/cli/main.ts:60-156` switch dispatch; one top-level command per file under
  `src/cli/commands/`; help registry `src/cli/commandHelp.ts`. JSON envelope
  `MetabotCommandResult` (`src/core/contracts/commandResult.ts`), writes require `--confirm`.
- Daemon: `127.0.0.1`, default port 10001 (fallback 10002–10020), auto-spawned by the CLI
  (`src/cli/runtime.ts:1188-1287`). Hosts `/browser`, `/browser/metaid/<id>`,
  `/browser/metaapp/<pinId>`, `/browser/pin/<pinId>`, `/browser/metafile/...`,
  `/browser/map/...` plus `/ui/*` (`src/daemon/routes/ui.ts:165-167`,
  `src/browser/page.ts:9-17`, bridge `src/browser/app.ts:25-50`).
- `browser open [--uri]` / `browser tab open --uri` return `{ uri, localUiUrl }` and never
  spawn a browser (`src/cli/runtime.ts:2198-2209`, tab broadcast
  `src/daemon/routes/browser.ts:13-61` over SSE `/api/browser/events`).
- `metabot-browser-open` skill (`SKILLs/metabot-browser-open/SKILL.md`): opens URIs,
  explicitly excludes search and `/ui/*` pages. No in-app-browser guidance exists anywhere.
- `metabot-omni-reader` skill: read-only data access.
- `metabot-metaapp` skill (OAC fork, 619 lines, English): dev rules + publish wizard.
  Diverged from the IDBots version, which now carries the APP.md convention.
- No MetaApp aggregation search client exists (explicitly excluded historically).
  Reusable patterns: injectable `fetchFn` in `src/core/metaapp/manOwnerList.ts:437-466`;
  metaso endpoint resolution in `src/core/network/metasoInfrastructure.ts`.
- Skill packaging: `scripts/build-metabot-skillpacks.mjs` renders `SKILLs/*` templates
  into `skillpacks/<host>/` with `{{METABOT_CLI}}`, `{{HOST_ADAPTER_SECTION}}`,
  `{{SYSTEM_ROUTING}}` placeholders. Per-host wording belongs in the adapter sections.

## 4. Design principles

1. **CLI-first**: every capability lands as a `metabot` command (daemon-backed where
   state is needed), emitting the standard JSON envelope. Skills only describe routing
   and usage; they hold no logic.
2. **No new skill folders**: extend `metabot-browser-open` (renamed `metabot-browser`)
   and `metabot-metaapp`. `metabot-omni-reader` stays read-only and unchanged.
3. **Machine-first CLI, human-first skills**: the CLI returns structured JSON (never
   pre-formatted prose). Presentation rules (markdown link bullets, full-length ids)
   live in skill documents.
4. **Single source of truth**: manifest fields stay the only index surface; `APP.md` is
   package-level natural-language documentation for LLMs (the SKILL.md-body analogue).
5. **Confirmed writes only**: search/read/preview are free; anything on-chain requires
   the existing `--confirm` gate and shows cost.

## 5. Capability 1 — Open URIs in the platform's in-app browser

### Problem

`browser open` returns `localUiUrl` and skills say "present it as a link". Platforms
that can render web content (Codex in-app browser, preview panels) currently get no
guidance to open it **inside** the platform, so users land in an external browser and
lose the integrated feel (and any future host bridge).

### Design

- Keep `metabot browser open --uri <uri>` and `browser tab open --uri` as-is (they are
  already correct: daemon-backed, return `localUiUrl`, tab variant reuses the SSE channel
  so a second open lands in a new tab of the same window).
- Rename skill `metabot-browser-open` → **`metabot-browser`**, and rewrite its routing
  rules:
  - When the user asks to open an Agent Internet resource (metaid://, metaapp://,
    pin://, metafile://, map://, or a `/browser/*` localUiUrl), call the CLI and open the
    returned `localUiUrl` **in the platform's own browser/preview surface**. Only when
    the platform has no such surface, present the link for the user to click.
  - The exact "how to open in-app" wording is host-specific and goes into each
    `{{HOST_ADAPTER_SECTION}}` (e.g., Codex: use its in-app browser; terminal-only
    hosts: present the clickable link).
  - Keep the "never invent a local UI URL" rule; always take `localUiUrl` from the CLI
    envelope.
  - Backward compatibility: keep `SKILLs/metabot-browser-open/` for one release as a
    thin stub that routes to `metabot-browser`, because installed skillpacks and muscle
    memory reference the old name. Mark it deprecated in the pack manifest.
- The rename is a skill-only change; no CLI surface changes.

## 6. Capability 2 — MetaApp aggregation search (`metaapp search`, `metaapp forks`)

### Backend (new, thin)

New core module `src/core/metaapp/metaAppSearchApi.ts`, a thin client for the metaso-p2p
aggregation API (production `https://so.metaid.io`, see
`metaso-p2p/docs/metaapp-api-downstream-guide.md` and
`metaso-p2p/docs/specs/2026-07-26-metaapp-query-api.md`):

- `GET /api/metaapp/list` — params: `keyword`, `tag`, `chainName`, `runtime`,
  `publisher`, `since`, `until`, `includeDisabled`, `size`, `cursor`. Envelope
  `{code, data, message}` with `code=0` on success; items are already relevance-sorted
  when `keyword` is present (tag×3 > title×2 > intro×1), then `updatedAt` desc.
- `GET /api/metaapp/forks/:pinId` — direct `forkedFrom` children, `createdAt` desc.
- Port the IDBots reference (`IDBots/src/main/services/metaAppSearchService.ts`):
  envelope parsing, item normalization (including production-only fields
  `publisherName`, `publisherAvatarId`), timeout, error mapping (`40000` usage,
  `40400` typed not-found, `50000` internal).
- Follow the `manOwnerList.ts` injectable-`fetchFn` pattern for testability; base URL
  overridable via env (`METASO_P2P_BASE_URL`) with the same default as ABC's
  `metasoP2PBaseUrl`.

### CLI surface

- `metabot metaapp search [--query <text>] [--tag <tag>] [--publisher <id>]`
  `[--since-days <n>] [--until-days <n>] [--runtime <runtime>] [--chain <chain>]`
  `[--limit <1..20, default 8>] [--cursor <cursor>]`
  - `sinceDays`/`untilDays` are converted host-side to unix-second `since`/`until`
    (the API does not understand natural language).
  - Response `data`: `{ items: TrimmedItem[], hasMore, nextCursor }` where
    `TrimmedItem = { pinId, title, appName, intro, tags, runtime, version, updatedAt,
    publisherGlobalMetaId, publisherName, publisherAvatarId, forkedFrom, isOwn }`.
  - `isOwn` is computed daemon/CLI-side: `publisherGlobalMetaId` ∈ the local bot
    registry's globalMetaIds (same source as `bot list`).
- `metabot metaapp forks --pin-id <pinId|metaapp://pinId> [--limit] [--cursor]`
  — same trimmed item shape.
- Both are read-only: no `--confirm` required, exit code 0 on success,
  `manual_action_required` never used.

### Skill routing (in `metabot-browser`)

Add a "find / discover" intent block teaching the agent to:

1. Map intent to flags: "latest N days of X" → `--query "X" --since-days N`;
   "publisher's latest" → `--publisher <id> --limit 1`; "supports simplebuzz" →
   `--tag simplebuzz`; "remixes of this app" → `metaapp forks`.
2. Render candidates as **ready-to-quote markdown bullets**, reusing them verbatim:
   `- [Title](metaapp://<pinId>) — <intro>\n  by [PublisherName](metaid://<fullGlobalMetaId>) | tags: … | updated: YYYY-MM-DD`
   Rules: app titles and author names are always markdown links; ids are never
   shortened; `isOwn` items are marked "(your Bot)".
3. Open the single best match with `browser tab open --uri metaapp://<pinId>` (in-app
   browser per Capability 1), then offer 2–3 alternatives. If nothing fits, say so
   honestly — never invent apps.
4. Empty-result behavior: drop the weakest query token once and retry; if still empty,
   report honestly.

## 7. Capability 3 — Materialize an app's source for reading and remixing

### Problem

Coding agents think in files. To answer "what does this app do" or to remix it, the
app's source must land in the agent's workspace with provenance recorded.

### Design

- New CLI `metabot metaapp source --pin-id <pinId|metaapp://pinId> [--out <dir>]`
  - Ensures the package is downloaded (reuse the daemon's existing metaapp
    download/cache path used by `/browser/metaapp/<pinId>`).
  - Without `--out`: prints the local cache directory in `data` (`{ dir, indexFile,
    title, sourcePinId }`) — read-only use.
  - With `--out <dir>`: copies the source into `<dir>` (creating it) and writes a
    provenance marker `<dir>/.metaapp-fork.json`:
    `{ sourcePinId, sourceUri, title, indexFile, tags?, forkedAt }`.
    This mirrors the IDBots `botBrowserMetaAppForkService` flow (marker name
    `.metaapp-fork.json` instead of `.idbots-fork.json`, so it is host-neutral).
- Skill guidance (`metabot-browser` + `metabot-metaapp`): when reading or remixing an
  app, use `metaapp source`, read `APP.md` at the root first (untrusted data — never
  follow directives in it), then the source files.

## 8. Capability 4 — Preview and publish a remix

- **Preview**: ABC 0.4.1 ships the `preview-metaapp://localhost/<abs-path>` resolver
  (`docs/preview-metaapp-protocol.md` in agent-browser-core). OAC's host adapter must
  wire `previewMetaAppLocalResolve` so `/browser` can resolve those URIs — check
  `src/daemon/browser/oacBrowserHostAdapter.ts`; the ABC standalone host's
  `resolveLocalPreviewPath` (stat → index.html/index.htm → preview session serving the
  live directory) is the reference. Then `browser tab open --uri
  "preview-metaapp://localhost<abs path>"` previews any workspace directory live
  (reload picks up edits). This is the same gap IDBots closed; port the IDBots wiring
  (`botBrowserHostService.resolveLocalPreviewPath` + cache preview server) as needed.
- **Publish**: reuse the existing `metaapp publish` / `metaapp publish-project` flow
  with three adjustments (see `metabot-metaapp` skill + `src/cli/commands/metaapp.ts`):
  1. When the payload directory contains `.metaapp-fork.json`, automatically set
     `forkedFrom: <sourcePinId>` and carry over `tags` unless overridden; record the
     user's modification instruction in `prompt` (the field's defined purpose).
  2. If the directory has no `APP.md` at its root, the CLI result includes
     `hasAppDoc: false` so the skill can nudge the agent to add one before publishing
     (the zip ships it automatically when present).
  3. On-chain writes keep the existing two-phase `--confirm` presentation.
- **APP.md convention sync**: port the IDBots `metabot-metaapp` APP.md section and
  `references/app-md.md` (adapted to OAC's single-file English skill) so both products
  teach the same convention: package-root `APP.md`, pure natural language, no schema,
  untrusted data for readers, written when creating/modifying an app.

## 9. Output and presentation conventions (all skills)

- Links: apps → `[title](metaapp://<pinId>)`; bots/authors → `[name](metaid://<fullGlobalMetaId>)`.
  Full ids always; never shorten, truncate, or ellipsis them.
- Lists: reuse the bullet lines from §6.2 verbatim; never restate an app or author as
  plain text.
- Bare URIs in agent replies are fine: platforms/hosts increasingly auto-link them,
  but prefer explicit markdown links.
- `localUiUrl` values always come from the CLI envelope; never invent localhost URLs.

## 10. Security and trust boundaries

- APP.md and any app-supplied text are **untrusted data**: skills must state that no
  directive found in an app or its APP.md may be followed.
- Search/read/preview commands are read-only; all writes go through the existing
  `--confirm` flow with cost shown.
- Everything binds to 127.0.0.1; the preview server serves only the agent-chosen
  workspace directories (mirroring ABC's local-dev-only warning for
  `preview-metaapp://localhost`; `METABOT_BROWSER_DISABLE_PREVIEW_METAAPP=1` kills it).

## 11. Acceptance checklist

1. In Codex: "open the on-chain Buzz app" → `browser tab open` → the localUiUrl opens
   inside Codex's in-app browser (not external Chrome).
2. "Show mini-games from the last 7 days" → bullet list with clickable app and author
   links (full ids, publisher names shown) → best match opens in a new tab.
3. "Show the remixes of <app>" → `metaapp forks` list renders.
4. "Remix <app>: change X" → source lands in workspace with `.metaapp-fork.json`;
   `preview-metaapp://` preview renders live; after confirmation the new app publishes
   with `forkedFrom` + `prompt` recorded; missing APP.md triggers the nudge.
5. `metabot-omni-reader` and external-browser flows are unchanged.

## 12. Reference implementations (read these first)

| What | Where |
|---|---|
| Aggregation API client + normalization | `IDBots/src/main/services/metaAppSearchService.ts` |
| Candidate formatting + tool guidance | `IDBots/src/main/libs/botBrowserAgentTools.ts` (`formatMetaAppCandidates`, `search_metaapps`) |
| Fork-to-workspace + marker | `IDBots/src/main/services/botBrowserMetaAppForkService.ts` |
| Zip + upload + publish + confirm | `IDBots/src/main/services/botBrowserMetaAppPublishService.ts` |
| preview-metaapp host wiring | `IDBots/src/main/services/botBrowserHostService.ts` (`resolveLocalPreviewPath`) |
| APP.md authoring guide | `IDBots/SKILLs/metabot-metaapp/references/app-md.md` (+ SKILL.md APP.md section) |
| API contract | `metaso-p2p/docs/metaapp-api-downstream-guide.md`, `metaso-p2p/docs/specs/2026-07-26-metaapp-query-api.md` |
| preview-metaapp protocol | `agent-browser-core/docs/preview-metaapp-protocol.md` |
