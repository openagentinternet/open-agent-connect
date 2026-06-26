# Apps UI Design

## Status

Draft for user review.

## Context

OAC already has CLI and skill workflows for publishing local applications as MetaAPP protocol pins, but the local human UI does not provide a dedicated owner console for finding, sharing, editing, disabling, or deleting the MetaAPPs published by a local Bot.

The new Apps section provides that owner console. It is not a public marketplace and it is not a replacement for MetaWeb.world. It is a local management page scoped to one selected Bot at a time.

## Goals

- Add a first-class local UI section at `/ui/apps`.
- Add the navigation item immediately to the right of Services.
- Use the English label `Apps` and Simplified Chinese label `应用`.
- Let users switch the local Bot whose MetaAPPs are being managed.
- List the selected Bot's on-chain MetaAPPs from MAN by MVC address.
- Show owner MetaAPPs as a tile gallery with 12 items per page.
- Let the owner publish a new MetaAPP from a MetaWeb-style protocol form.
- Let the owner edit an existing MetaAPP with the same form, prefilled from chain data.
- Let the owner delete a MetaAPP through PIN-level revoke.
- Let the owner soft-disable or re-enable a MetaAPP through the MetaAPP protocol `disabled` field.
- Let the owner run a MetaAPP in OAC Browser and share its protocol and Web links.

## Non-goals

- Do not build a global MetaAPP marketplace.
- Do not keep evolving the old `/ui/metaapps` page.
- Do not add search in the first version.
- Do not implement `metacode://` handling in the UI. Source package values use `metafile://` for now.
- Do not add the project-directory publish wizard in the first version.
- Do not publish or release a new production version as part of this feature branch.

## Route And Compatibility

`/ui/apps` is the canonical page.

`/ui/metaapps` remains only as a compatibility route that redirects or aliases to `/ui/apps`. New local links, share bundles, and UI navigation should generate `/ui/apps` when referring to the local owner page.

The Browser runtime route remains separate. Running a MetaAPP should open the existing OAC Browser MetaAPP path for the selected pin.

## Architecture

Use a new Apps UI module instead of continuing the old MetaApps page:

- `src/ui/pages/apps/`
  - Owns the Apps page HTML, client-side page behavior, form state, tile rendering, modal behavior, and i18n key usage.
- Apps API routes
  - Prefer a new `/api/apps/*` surface so Apps owner-management semantics do not collide with the existing `/api/metaapps` gallery surface.
  - The old `/api/metaapps` routes can remain unchanged unless an implementation dependency requires a targeted shared helper.
- `src/core/metaapp/`
  - Reuse existing MetaAPP protocol types and write helpers where appropriate.
  - Add focused helpers for MAN owner-list parsing, MetaAPP protocol form normalization, manual `metafile://` value normalization, and revoke.
- UI navigation and page routing
  - Register Apps as a normal nav item.
  - Keep `/ui/metaapps` as a redirect or alias only.

This keeps the new owner console isolated while still sharing the core MetaAPP protocol logic.

## UI Design

The page uses the same broad local UI language as Bot, Conversations, and Services, but it follows the Services-style single-workspace layout rather than a conversation-style split panel.

Page structure:

- Top toolbar:
  - Title: `Apps`
  - Short human-facing description.
  - Refresh button.
  - Publish MetaApp button.
- Bot selector row:
  - Reuse the local Bot picker behavior used by Services where possible.
  - Default to the active Bot.
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
- Manually enter an existing metafile pin ID.

Manual metafile input accepts either:

- raw pin ID
- `metafile://<pinId>`

The normalized protocol value is always `metafile://<pinId>`.

For `introImgs`, multiple manual pin IDs are accepted and normalized into an array of `metafile://<pinId>` values.

For `code`, use `metafile://<pinId>` in the first version. Do not implement `metacode://` selection or conversion yet.

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

### Bot selection

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

Publish writes:

```text
operation=create
path=/protocols/metaapp
contentType=application/json
content=<MetaAPP protocol JSON>
```

The selected Bot is the actor.

### Edit

Edit writes:

```text
operation=modify
path=@<latestPinId>
contentType=application/json
content=<MetaAPP protocol JSON>
```

The selected Bot must be the owner address that is allowed to modify the latest target pin.

### Delete

Delete writes:

```text
operation=revoke
path=@<latestPinId>
```

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

## Internationalization

All user-visible strings added for Apps must go through the existing i18n dictionaries.

Required top-level labels:

- English nav label: `Apps`
- Simplified Chinese nav label: `应用`

Keep protocol terms and proper nouns such as MetaAPP, MetaID, MetaWeb, Bot, PIN, txid, Trace, and Session untranslated unless an existing dictionary convention already translates them.

## Testing Plan

Route and navigation tests:

- `/ui/apps` serves the Apps page.
- Apps appears immediately after Services in the nav.
- Simplified Chinese nav uses `应用`.
- `/ui/metaapps` redirects or aliases to `/ui/apps`.

API tests:

- `/api/apps` resolves the selected Bot from `from`.
- `/api/apps` constructs the MAN address list URL with the Bot's MVC address.
- Default page size is `12`.
- MAN cursor and next cursor are forwarded through the view model.
- MAN records are parsed into tile/detail view models.
- Revoke records or revoked latest states are hidden.
- `disabled: true` records are returned with disabled state.

Form helper tests:

- Raw pin ID normalizes to `metafile://<pinId>`.
- `metafile://<pinId>` remains normalized.
- Invalid pin IDs are rejected.
- Multiple intro image pin IDs normalize to an array of `metafile://` URLs.
- `runtime` multi-select serializes to slash-separated protocol text.
- `disabled` is serialized as a MetaAPP field and does not trigger revoke.

Write operation tests:

- Publish uses `operation=create`, `path=/protocols/metaapp`, and JSON content.
- Edit uses `operation=modify`, `path=@<latestPinId>`, and JSON content.
- Delete uses `operation=revoke`, `path=@<latestPinId>`.
- Delete success hides the tile; delete failure leaves it visible.

UI behavior tests:

- Bot selector defaults to the active Bot.
- Changing Bot reloads the list.
- Pin copy buttons copy the full pin ID.
- Disabled tiles render Disabled and disable Run.
- Share modal shows both `metaapp://<pinId>` and `https://metaweb.world/metaapp/<pinId>`.
- Publish and Edit forms expose the same field groups.

Verification:

- Run targeted route/API/UI tests for Apps and affected MetaAPP helpers.
- Run `npm run build`.
- Run broader tests only if implementation touches shared runtime behavior, storage formats, chain write plumbing beyond focused MetaAPP helpers, or build artifacts.

## Open Implementation Notes

- The implementation should inspect the existing file upload APIs before adding new upload routes. Prefer reuse if the current upload flow can return metafile pin IDs cleanly.
- The implementation should keep MAN owner-list code separate from the older MetaWeb.world indexer client to avoid confusing source-of-truth semantics.
- The first implementation plan should split work into independently testable units: route/navigation, MAN list API, form normalization helpers, write operations, UI page, and acceptance review.
