# Bot Homepage Basic Tab Design

Date: 2026-06-15
Status: approved product direction, ready for implementation planning

## Purpose

The `/ui/bot` Basic tab already exposes a `Homepage` row, but the current
`Upload` action only opens a placeholder modal and the profile update path does
not write `/info/homepage`. This design turns that placeholder into the first
custom Bot homepage editor.

The feature lets a user choose what visitors should see as the Bot's personal
homepage:

- a generic MetaFile resource, written as a `metafile://` homepage URI; or
- an already published MetaApp, written as a `metaapp://` homepage URI.

The UI remains intentionally small. It does not build a MetaApp picker, renderer
registry, file-type whitelist, or homepage preview in v1.

## Goals

- Define the `/info/homepage` payload OAC writes for custom Bot homepages.
- Replace the placeholder Basic tab Homepage row with a dedicated Homepage
  panel.
- Support local file upload to MetaFile and convert the result into a
  `metafile://` homepage URI.
- Support manual MetaApp pin entry and convert it into a `metaapp://` homepage
  URI.
- Keep the final `/info/homepage` write inside the existing profile metadata
  save flow.
- Keep the implementation compatible with the MetaSo Bot homepage v2 reader,
  which accepts either raw URI content or JSON with a `uri` field.

## Non-Goals

- Do not define which file extensions or MIME types browsers must render for
  `metafile://` homepages.
- Do not add a list of the user's already published MetaApps.
- Do not add a public renderer registry in OAC.
- Do not generate or publish a new MetaApp from this screen.
- Do not make Homepage edits save automatically when the user uploads a file or
  types a MetaApp pin.
- Do not change unrelated Bot profile fields, service publishing, or Browser
  rendering behavior.

## `/info/homepage` Payload

OAC should write JSON to `/info/homepage`, with content type
`application/json`.

For a MetaFile homepage:

```json
{
  "uri": "metafile://<pinId>",
  "renderer": "auto",
  "contentType": "<uploaded-file-mime-type>"
}
```

For a MetaApp homepage:

```json
{
  "uri": "metaapp://<pinId>",
  "renderer": "metaapp",
  "contentType": "application/vnd.metaapp"
}
```

Field rules:

- `uri` is required and is the canonical homepage target.
- `renderer` is a rendering hint for downstream homepage readers. `auto` means
  the browser or future renderer chooses how to handle the MetaFile. `metaapp`
  means the URI points at a MetaApp package.
- `contentType` is required in OAC writes so downstream renderers can make a
  reasonable first decision without fetching the resource first.
- `pinId` and `txid` are intentionally omitted in v1 because the `uri` contains
  the resource pin and the `/info/homepage` pin itself provides the profile
  update proof.

OAC should not write raw string content for new homepage edits. MetaSo can read
raw strings for compatibility, but OAC should use the JSON shape so future
fields can be added without another migration.

## Chain Write Boundary

`/info/homepage` is Bot profile metadata. It should follow the same fixed
profile metadata write boundary as `/info/name`, `/info/avatar`, `/info/bio`,
`/info/persona`, `/info/chatSkills`, and `/info/LLM`.

That means:

- the `/info/homepage` write uses the profile sync path, not the Bot's
  user-configurable `chain.defaultWriteNetwork`;
- v1 writes `/info/homepage` on MVC, matching the existing profile metadata
  writes in `syncMetabotInfoToChain`;
- profile update success should include the homepage write in the same
  `chainWrites` result list shown in the existing success modal.

This keeps identity/profile metadata separate from user-authored Buzz, MetaApp,
or service content.

## Basic Tab UX

Use the selected Option A layout: a dedicated `Homepage` panel inside Public
Identity.

Panel structure:

- Header: `Homepage` plus a compact status label such as `Default`, `Metafile`,
  or `MetaApp`.
- MetaFile section:
  - `Upload` button.
  - Hidden file input.
  - Short status text for ready, uploading, uploaded, or failed states.
  - After success, show the generated `metafile://<pinId>` URI.
- MetaApp section:
  - Text input for a MetaApp pin ID.
  - `Set` button.
  - `?` help affordance with a tooltip explaining where to copy a MetaApp pin
    ID from: the MetaApp publish result or details page.
  - After success, show the generated `metaapp://<pinId>` URI.
- Footer: show the final URI that will be saved, or explain that the default Bot
  Page renderer is still active.

The panel should follow existing `/ui/bot` styling: quiet bordered surfaces,
small buttons, stable spacing, no hero treatment, and no nested decorative card
shells beyond the two functional source sections.

## Save Model

The Homepage panel uses the same explicit save model as the rest of Public
Identity:

1. User uploads a MetaFile or sets a MetaApp pin.
2. The UI updates an in-memory homepage draft.
3. User clicks `Save Public Identity`.
4. OAC writes changed profile fields and `/info/homepage` in the profile update
   flow.

For MetaFile upload, the file content must be pinned before the profile can
reference it. Therefore the `Upload` button performs a chain file upload
immediately, then stores the resulting `metafile://` URI in the draft. If the
user uploads a file and then leaves without saving Public Identity, the file pin
may remain unreferenced by `/info/homepage`; v1 accepts this as the cost of
keeping the profile save flow explicit.

MetaApp pin entry does not write chain data until `Save Public Identity`.

## Data Model

Extend the profile model with an optional homepage value. The stored local value
should preserve the canonical JSON payload rather than only the rendered URI, so
the UI can re-render status, content type, and renderer hint after reload.

Recommended local shape:

```json
{
  "uri": "metafile://<pinId>",
  "renderer": "auto",
  "contentType": "image/png"
}
```

Name the profile field `homepage`. It must be included in:

- `MetabotProfileFull`;
- update profile input normalization;
- profile listing and detail responses used by `/ui/bot`;
- change detection for profile updates;
- `syncMetabotInfoToChain` changed-field handling.

Store the local canonical JSON at:

```text
~/.metabot/profiles/<slug>/.runtime/state/homepage.json
```

Add the path to `resolveMetabotPaths()` as `homepageStatePath` so reads and
writes stay centralized. Do not introduce a legacy `.metabot/hot` path.

## Daemon And Upload Flow

The browser cannot hand a local filesystem path to the existing
`/api/file/upload` JSON route. The implementation should add a small daemon
upload path for this Homepage UI rather than pushing file parsing into the
static page.

Recommended behavior:

- The UI sends selected file bytes, filename, content type, and selected profile
  slug to a profile-homepage upload endpoint.
- The daemon validates that the slug resolves to a local profile with an
  identity.
- The daemon writes the file through the existing file upload core path or an
  equivalent helper that writes `/file` with base64 payload and signer context.
- The daemon returns `pinId`, `metafileUri`, `contentType`, `network`, `txids`,
  and byte count.
- The UI converts the result into the homepage draft JSON and displays the
  final URI.

The upload endpoint should keep DOGE unsupported for file upload, consistent
with the existing file upload helper. If the selected profile has no identity,
the endpoint returns the same style of command failure used by other Bot routes.

## Validation And Errors

MetaFile upload:

- Show `Uploading...` while the daemon request is in flight.
- Disable the upload button while that request is in flight.
- On success, show the `metafile://` URI and mark the draft ready to save.
- On failure, keep the previous draft unchanged and show the daemon error.
- Do not filter MIME types in v1 beyond recording the browser-provided or
  inferred content type.

MetaApp pin entry:

- Trim whitespace.
- Accept either a bare pin ID or `metaapp://<pinId>` input.
- Normalize stored `uri` to `metaapp://<pinId>`.
- Reject empty input.
- Reject values that still contain whitespace after trimming.
- Do not verify the MetaApp exists on-chain in v1.

Save:

- If only Homepage changed, `Save Public Identity` should still be enabled and
  should write only `/info/homepage`.
- If Homepage plus name/bio/avatar/provider fields changed, one save should
  write all changed profile metadata and show all returned txids in the existing
  success modal.
- If no fields changed, keep the existing `No changes` behavior.

## Testing Scope

Focused tests are sufficient for implementation because this is a narrow UI and
profile metadata addition.

Add or update tests for:

- `/ui/bot` renders the dedicated Homepage panel instead of the placeholder row.
- Upload success stores a MetaFile homepage draft and includes it in the save
  payload.
- Upload failure leaves the previous homepage draft unchanged.
- MetaApp pin input normalizes bare pin IDs and `metaapp://` inputs.
- `Save Public Identity` sends homepage changes when homepage is the only
  changed field.
- profile update change detection includes homepage changes.
- `syncMetabotInfoToChain` writes `/info/homepage` as JSON on MVC.
- daemon upload route forwards selected profile context and returns upload
  metadata.

Run `npm run build` and the focused daemon/UI tests changed by the
implementation. A full `npm test` is not required unless the implementation
touches shared chain write plumbing beyond the profile metadata path.
