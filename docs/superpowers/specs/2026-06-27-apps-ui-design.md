# Apps UI And MetaAPP CLI-First Design

## Status

Approved for implementation planning.

## Context

OAC already has CLI and skill workflows for publishing local applications as MetaAPP protocol pins, but the local human UI does not provide a dedicated owner console for finding, sharing, editing, disabling, or deleting the MetaAPPs published by a local Bot.

The new Apps section provides that owner console. It is not a public marketplace and it is not a replacement for MetaWeb.world. It is a local management page scoped to one selected Bot at a time.

The product label is `Apps`, but the underlying protocol, CLI, daemon handler names, and skills should use `metaapp`. In this project, Apps means MetaAPPs. Adding a separate `metabot apps` command family would create two names for the same domain and should not be done.

## Goals

- Add a first-class local UI section at `/ui/apps`.
- Add the navigation item immediately to the right of Services.
- Use the English label `Apps` and Simplified Chinese label `应用`.
- Keep `/ui/apps` visually aligned with `/ui/bot`, `/ui/conversations`, and `/ui/services`.
- Let users switch the local Bot whose MetaAPPs are being managed.
- List the selected Bot's on-chain MetaAPPs from MAN by MVC address.
- Show owner MetaAPPs as a tile gallery with 12 items per page.
- Let the owner publish a new MetaAPP from a MetaWeb-style protocol form.
- Let the owner edit an existing MetaAPP with the same form, prefilled from chain data.
- Let the owner delete a MetaAPP through PIN-level revoke.
- Let the owner soft-disable or re-enable a MetaAPP through the MetaAPP protocol `disabled` field.
- Let the owner run a MetaAPP in OAC Browser and share its protocol and Web links.
- Make `metabot metaapp` the CLI-first contract used by skills and mirrored by daemon HTTP adapters.

## Non-Goals

- Do not create `metabot apps`.
- Do not use `apps` as the daemon business contract name.
- Do not build a global MetaAPP marketplace.
- Do not keep evolving the old `/ui/metaapps` page.
- Do not add search in the first version.
- Do not implement `metacode://` handling in the UI. Source package values use `metafile://` for now.
- Do not publish or release a new production version as part of this feature branch.

## Naming And Compatibility

`/ui/apps` is the canonical page.

`/ui/metaapps` remains only as a compatibility route that redirects or aliases to `/ui/apps`. New local links, share bundles, and UI navigation should generate `/ui/apps` when referring to the local owner page.

The command namespace remains `metabot metaapp`. The final design must not add `metabot apps`.

The daemon business adapter should use `/api/metaapp/*`. A prototype-only `/api/apps/*` surface should not remain as the public contract. If it exists during development, remove it or leave only a temporary internal compatibility shim before the feature is considered complete.

The Browser runtime route remains separate. Running a MetaAPP should open the existing OAC Browser MetaAPP path for the selected pin, such as `/browser/metaapp/<pinId>` or the existing `metabot browser open --uri metaapp://<pinId>` path.

## CLI-First Architecture

The design follows the same broad pattern as `/ui/bot`:

- The CLI command surface defines the durable user and skill contract.
- The daemon exposes HTTP adapters for browser UI access.
- The UI fetches the local daemon HTTP adapter because browser JavaScript cannot execute the CLI binary directly.
- CLI and daemon handlers share core service functions and return `MetabotCommandResult` envelopes.

The intended flow is:

```text
metabot metaapp command contract
  -> shared MetaAPP owner-management service
  -> daemon /api/metaapp/* adapter
  -> /ui/apps browser page
```

Skills should call the CLI. `/ui/apps` should call the daemon adapter. Both paths must use the same validation, payload building, MAN owner-list parsing, and write helpers.

## CLI Command Surface

### Owner Management Commands

These commands are the canonical contract for the new Apps owner console.

```bash
metabot metaapp list --from <bot> [--size 12] [--cursor <cursor>]
metabot metaapp publish --from <bot> --payload-file <json> --confirm [--chain mvc]
metabot metaapp update --from <bot> --target-pin-id <pinid> --payload-file <json> --confirm [--chain mvc]
metabot metaapp delete --from <bot> --target-pin-id <pinid> --confirm [--chain mvc]
```

`list` resolves the selected Bot, obtains its MVC address, and queries MAN:

```text
https://manapi.metaid.io/address/pin/list/{address}?cursor={cursor}&size={size}&path=/protocols/metaapp
```

`publish` writes:

```text
operation=create
path=/protocols/metaapp
contentType=application/json
content=<MetaAPP protocol JSON>
```

`update` writes:

```text
operation=modify
path=@<latestPinId>
contentType=application/json
content=<MetaAPP protocol JSON>
```

`delete` writes:

```text
operation=revoke
path=@<latestPinId>
```

`delete` is the user-facing action name for PIN-level revoke. It is not the same as protocol-level `disabled`. Revoke is treated as irreversible and revoked MetaAPPs are hidden from the owner console. `disabled` remains editable inside the MetaAPP protocol payload and is reversible.

Write-capable owner-management commands require `--confirm`. Without `--confirm`, they should fail with a clear confirmation-required result and should not write chain data.

### Payload File Semantics

`--payload-file` is a MetaAPP protocol JSON file. It is the CLI equivalent of submitting the `/ui/apps` publish or edit form after any file uploads have already produced `metafile://` references.

Supported payload fields:

- `title`
- `appName`
- `prompt`
- `icon`
- `coverImg`
- `introImgs`
- `intro`
- `runtime`
- `version`
- `contentType`
- `content`
- `indexFile`
- `code`
- `contentHash`
- `metadata`
- `tags`
- `disabled`
- `codeType`

Image fields support either HTTP(S) URLs or metafile references:

- `icon`
- `coverImg`
- `introImgs`

Content package fields support metafile references only:

- `content`
- `code`

Manual metafile input accepts either a raw pin ID or `metafile://<pinId>`, and normalizes to `metafile://<pinId>`.

`runtime` may be represented as either an array of supported runtimes or slash-separated protocol text. The normalized protocol value is slash-separated text such as `browser/ios`.

### Project Packaging Commands

The existing project-directory publishing capability should be renamed because it is not the same operation as direct MetaAPP protocol publishing.

```bash
metabot metaapp preview --project-dir <path> [--manifest-file <path>] [--open]
metabot metaapp publish-project --project-dir <path> [--from <bot>] [--manifest-file <path>] [--chain <mvc|btc|opcat>] [--confirm]
metabot metaapp update-project --target-pin-id <pinid> --project-dir <path> [--from <bot>] [--manifest-file <path>] [--chain <mvc|btc|opcat>] [--confirm]
```

The old `publish --project-dir ...` and `update --project-dir ...` forms should not remain as compatibility aliases. They should fail with a clear migration error that points users to `publish-project` or `update-project`.

`--manifest-file` belongs only to the project packaging flow. It is a local JSON manifest override merged with project detection and artifact upload results. It is not a raw chain payload file.

Project packaging behavior stays the same conceptually:

1. inspect the project directory
2. find or build a browser-runnable artifact directory
3. ZIP and upload that artifact
4. set `content` to the uploaded `metafile://` URI
5. write the MetaAPP protocol payload

### Existing Utility Commands

These commands remain in the `metabot metaapp` group.

```bash
metabot metaapp share --pin-id <pinid> [--announce] [--from <bot>] [--chain <mvc|btc|doge|opcat>]
metabot metaapp comment --pin-id <pinid> --comment <text> [--from <bot>] [--chain <mvc|btc|doge|opcat>]
metabot metaapp view [--from <bot>] [--pin-id <pinid>] [--first-pin-id <pinid>] [--mine]
```

`share` without `--announce` does not write chain data. It returns `metaapp://<pinId>`, `https://metaweb.world/metaapp/<pinId>`, and suggested share text. With `--announce`, it posts a simplebuzz announcement that references the MetaAPP pin.

`comment` writes `/protocols/paycomment` with JSON content containing:

- `content`
- `contentType: text/plain;utf-8`
- `commentTo: <MetaAPP pinId>`

`view` opens the local owner page. It should generate `/ui/apps`, not `/ui/metaapps`. It is not the Browser run command. Running a MetaAPP remains a Browser action.

## Daemon HTTP Adapter

The daemon should expose HTTP routes that mirror the CLI contract for browser use:

```text
GET  /api/metaapp/list?from=<bot>&cursor=<cursor>&size=12
POST /api/metaapp/publish
POST /api/metaapp/update
POST /api/metaapp/delete
POST /api/metaapp/publish-project
POST /api/metaapp/update-project
POST /api/metaapp/share
POST /api/metaapp/comment
```

`preview` and preview asset routes remain available for project packaging:

```text
POST /api/metaapp/preview
GET  /api/metaapp/preview-assets/<previewId>/<assetPath>
```

The HTTP adapter should be thin. It should parse HTTP inputs, call the same core service used by CLI dependencies, and return the same command result shape.

## UI Design

The page uses the same broad local UI language as Bot, Conversations, and Services, but it follows the Services-style single-workspace layout rather than a conversation-style split panel.

Implementation planning for the UI should explicitly use `frontend-skill` and should reuse existing `/ui/bot`, `/ui/conversations`, and `/ui/services` visual patterns. Avoid marketing-page composition and avoid one-off visual systems.

Page structure:

- Top toolbar:
  - Title: `Apps`
  - Refresh button.
  - Publish MetaAPP button.
- Bot selector row:
  - Reuse the local Bot picker behavior used by Services where possible.
  - Default to the active Bot.
  - Bot avatars must render the same way they do in Conversations and Services.
  - Changing the Bot refreshes the owner MetaAPP list.
- Gallery:
  - Tile grid, 12 items per page.
  - Pagination controls using the MAN cursor.
  - No search in the first version.

Tile fields:

- Cover image.
- Icon.
- Title or appName.
- Version and runtime.
- Pin ID with a small copy button.
- Intro.
- Tags.
- State badge.
- Run button.
- Share button.
- Details button.

Cover, icon, and intro image references must render HTTP(S) URLs as well as supported metafile references.

Disabled MetaAPPs:

- `disabled: true` remains visible in Apps.
- The tile shows a Disabled state.
- Run is disabled.
- Share, Details, and Edit remain available so the owner can inspect and restore it.

Detail modal:

- Follows MetaWeb.world's MetaAPP detail structure more than the old OAC MetaApps page.
- Shows icon, title, intro, action buttons, intro images, and protocol tabs.
- Includes Details, AI, and Raw-style sections.
- Details focus on MetaAPP protocol fields:
  - `title`
  - `appName`
  - `prompt`
  - `icon`
  - `coverImg`
  - `introImgs`
  - `intro`
  - `runtime`
  - `version`
  - `contentType`
  - `content`
  - `indexFile`
  - `code`
  - `contentHash`
  - `metadata`
  - `tags`
  - `disabled`
  - `codeType`
- Also show pin metadata such as latest pin ID, operation, path, owner address, and timestamp when available.

Share modal:

- Shows and copies `metaapp://<pinId>`.
- Shows and copies `https://metaweb.world/metaapp/<pinId>`.

Delete modal:

- Uses the user-facing action name Delete/删除.
- Explains that this is PIN-level revoke and is not recoverable.
- Explains that temporary hiding should use Edit plus the `disabled` field instead.

Primary buttons should use the same blue primary style as the rest of the local UI, not green.

## Publish And Edit Form

Publish and Edit use the same form structure. Edit is prefilled from the latest on-chain MetaAPP content and submits a modify operation.

Basic information:

- `appName`
- `title`
- `prompt`
- `intro`
- `tags`

Assets:

- `icon`
- `coverImg`
- `introImgs`
- `content`
- `code`

Each asset input supports two modes:

- Upload a local file through OAC's file upload flow.
- Manually enter an existing reference.

Manual input rules:

- Image fields accept HTTP(S) URLs, raw metafile pin IDs, or `metafile://<pinId>`.
- `content` and `code` accept raw metafile pin IDs or `metafile://<pinId>`.
- `introImgs` accepts multiple image references and normalizes them into an array.
- `code` uses `metafile://<pinId>` in the first version. Do not implement `metacode://` selection or conversion yet.

Technical information:

- `runtime`
  - Multi-select.
  - Options match MetaWeb.world: `browser`, `android`, `ios`, `windows`, `macOS`, `linux`.
  - Stored as slash-separated protocol text, such as `browser/ios`.
- `indexFile`
- `version`
- `contentType`
  - Select list with common MetaAPP content types from MetaWeb.world.
- `codeType`
  - Select list with common source package content types from MetaWeb.world.
- `contentHash`
- `metadata`
- `disabled`

Required fields should match MetaWeb.world's practical form constraints for the first version:

- `appName`
- `title`
- `icon`
- `coverImg`
- at least one `runtime`

## Data Flow

### Bot Selection

The frontend loads local profiles and sends the selected Bot slug as `from=<slug>`. The frontend does not own MVC address resolution.

The daemon resolves the selected Bot identity and obtains the MVC address used for MAN queries and chain writes.

### List

The Apps owner list is sourced from MAN by MVC address:

```text
https://manapi.metaid.io/address/pin/list/{address}?cursor={cursor}&size={size}&path=/protocols/metaapp
```

Default `size` is `12`.

The backend parses MAN records into an Apps gallery view model. The parser should handle `contentSummary` as JSON when needed and preserve raw pin metadata for detail display.

Delete/revoke handling:

- PIN-level revoke records should not be shown as Apps.
- A MetaAPP whose latest state is revoked should be hidden.
- If the MAN response shape requires reconstructing latest state from modify or revoke history, that reconstruction belongs in a focused core helper and should be covered by tests.

Disabled handling:

- `disabled: true` is a MetaAPP protocol field.
- Disabled Apps remain visible.
- Disabled Apps are not runnable from the page.

Local cache:

- MAN is the authority for the owner list.
- Local cache may be used only for short-lived optimistic display after publish/edit/delete while MAN catches up.
- Once MAN returns a corresponding record, MAN data wins.

### Detail

The detail modal can open from the list record. If the list record lacks enough protocol fields or history, the page may call a detail endpoint by pin ID.

The latest pin ID is the target for edit and delete actions.

### Publish

The UI uploads selected local asset files first when needed. After upload, it builds the same payload accepted by `metabot metaapp publish --payload-file`, then calls the daemon `POST /api/metaapp/publish` adapter.

### Edit

The UI builds the same payload accepted by `metabot metaapp update --payload-file`, then calls the daemon `POST /api/metaapp/update` adapter with the latest target pin ID.

### Delete

The UI calls the daemon `POST /api/metaapp/delete` adapter with the latest target pin ID.

After a successful delete, the UI hides the MetaAPP locally. Refresh later reconciles against MAN.

### Run

Run opens the existing OAC Browser MetaAPP route for the selected pin.

The URL generation should remain centralized so future Browser route changes do not require tile/card edits.

## Error Handling

- If no local Bot is initialized, show an empty state with guidance to create or activate a Bot.
- If the selected Bot has no MVC address, show an error state and do not send a MAN list request.
- If MAN list fails, keep the selected Bot and show a retryable error with Refresh.
- If file upload fails, keep the form open and show the failing asset field.
- If manual metafile pin ID validation fails, block submit and mark the field.
- If publish/edit/delete fails, do not remove or mutate the tile optimistically beyond a transient error state.
- If a delete succeeds, hide the tile immediately and reconcile on the next refresh.
- If a disabled MetaAPP is opened, show details and edit actions but keep Run disabled.
- If a user runs old `metabot metaapp publish --project-dir ...` or `metabot metaapp update --project-dir ...`, fail with a migration message pointing to `publish-project` or `update-project`.

## Internationalization

All user-visible strings added for Apps must go through the existing i18n dictionaries.

Required top-level labels:

- English nav label: `Apps`
- Simplified Chinese nav label: `应用`

Keep protocol terms and proper nouns such as MetaAPP, MetaID, MetaWeb, Bot, PIN, txid, Trace, and Session untranslated unless an existing dictionary convention already translates them.

## Testing Plan

CLI contract tests:

- `metabot metaapp list` parses `--from`, `--size`, and `--cursor`.
- `metabot metaapp publish` requires `--payload-file` and rejects `--project-dir`.
- `metabot metaapp update` requires `--target-pin-id` and `--payload-file`, and rejects `--project-dir`.
- `metabot metaapp delete` requires `--target-pin-id` and `--confirm`.
- `metabot metaapp publish-project` and `update-project` preserve the old project packaging behavior.
- Help output documents the new command meanings.

Route and navigation tests:

- `/ui/apps` serves the Apps page.
- Apps appears immediately after Services in the nav.
- Simplified Chinese nav uses `应用`.
- `/ui/metaapps` redirects or aliases to `/ui/apps`.
- `metabot metaapp view` opens `/ui/apps`.

Daemon adapter tests:

- `GET /api/metaapp/list` resolves the selected Bot from `from`.
- `GET /api/metaapp/list` constructs the MAN address list URL with the Bot's MVC address.
- Default page size is `12`.
- MAN cursor and next cursor are forwarded through the view model.
- MAN records are parsed into tile/detail view models.
- Revoke records or revoked latest states are hidden.
- `disabled: true` records are returned with disabled state.
- `/api/metaapp/publish`, `/api/metaapp/update`, and `/api/metaapp/delete` call the same core owner-management helpers used by CLI dependencies.

Form helper tests:

- Raw pin ID normalizes to `metafile://<pinId>`.
- `metafile://<pinId>` remains normalized.
- HTTP(S) image URLs are preserved for `icon`, `coverImg`, and `introImgs`.
- Invalid pin IDs are rejected for metafile-only fields.
- Multiple intro image references normalize to an array.
- `runtime` multi-select serializes to slash-separated protocol text.
- `disabled` is serialized as a MetaAPP field and does not trigger revoke.

Write operation tests:

- Publish uses `operation=create`, `path=/protocols/metaapp`, and JSON content.
- Edit uses `operation=modify`, `path=@<latestPinId>`, and JSON content.
- Delete uses `operation=revoke`, `path=@<latestPinId>`.
- Delete success hides the tile; delete failure leaves it visible.

UI behavior tests:

- Bot selector defaults to the active Bot.
- Bot selector avatars render.
- Changing Bot reloads the list.
- HTTP(S) cover and icon images render in tiles and details.
- Pin copy buttons copy the full pin ID.
- Disabled tiles render Disabled and disable Run.
- Share modal shows both `metaapp://<pinId>` and `https://metaweb.world/metaapp/<pinId>`.
- Publish and Edit forms expose the same field groups.
- Primary buttons use the shared blue primary style.

Verification:

- Run targeted CLI, daemon route, MetaAPP helper, and Apps UI tests.
- Run `npm run build`.
- Run broader tests only if implementation touches shared runtime behavior, storage formats, chain write plumbing beyond focused MetaAPP helpers, or build artifacts.

## Open Implementation Notes

- The implementation should inspect the existing file upload APIs before adding new upload routes. Prefer reuse if the current upload flow can return metafile pin IDs cleanly.
- The implementation should keep MAN owner-list code separate from the older MetaWeb.world indexer client to avoid confusing source-of-truth semantics.
- The implementation should remove the prototype `/api/apps/*` public surface or reduce it to an internal compatibility shim if needed during transition.
- The first implementation plan should split work into independently testable units: CLI contract, shared MetaAPP owner service, daemon adapter, route/navigation, MAN list parsing, form normalization helpers, write operations, UI page adaptation, and acceptance review.
