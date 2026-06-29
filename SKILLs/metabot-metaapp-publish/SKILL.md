---
name: metabot-metaapp-publish
description: Use when an agent needs to preview, publish, update, share, view, or comment on a browser-runnable MetaApp through Open Agent Connect, especially when turning a local frontend project directory or ZIP artifact into an on-chain MetaApp.
---

# Bot MetaApp Publish Share

Handle browser-runnable apps, games, and sites as MetaApps through the existing MetaBot CLI and MetaWeb protocols. Treat Bot, bot, and MetaBot wording as equivalent user intent.

{{HOST_ADAPTER_SECTION}}

## Routing

{{SYSTEM_ROUTING}}

## Actor Selection

`file upload-large`, `metaapp publish`, `metaapp update`, `metaapp delete`, `metaapp publish-project`, `metaapp update-project`, `metaapp share --announce`, and `metaapp comment` accept optional `--from <bot-slug>`.

Before any upload or final protocol write, confirm the MetaBot actor before every on-chain write. This is mandatory in a multi-MetaBot, multi-account system because ZIP files, cover images, intro images, announcements, comments, deletion revokes, and the final MetaApp JSON all belong to the signing MetaBot.

Resolve the actor in this priority order:

1. Session Bot or explicitly named local Bot.
2. A Bot selected earlier in the same MetaApp workflow.
3. Active identity only after the human explicitly confirms using the active identity.

Do not omit `--from` for asset uploads or final JSON writes unless the human has explicitly confirmed that the active identity is the intended owner. A single confirmation may cover a batch of listed asset uploads, but it must name the MetaBot, chain, and every file being uploaded. Publish, update, and delete all require explicit confirmation with `--confirm`.

## Trigger Guidance

Should trigger when:

- The human wants to publish a ZIP, local frontend app, game, or site as an on-chain MetaApp.
- The human wants a guided Q&A flow before writing a MetaAPP protocol JSON body.
- The human wants to create, update, delete, share, view, or comment on a MetaApp pin.
- The human wants a local Apps gallery view of previously published MetaApps.

Should not trigger when:

- The human only wants raw deployment hosting or a custom URL scheme.
- The human only wants a file uploaded without a MetaAPP protocol write.
- The human is managing network sources, identities, or unrelated paid services.

## Unified Publish Wizard

Use this path by default for "publish this ZIP/project as a MetaApp" requests. The wizard must collect the human-facing fields, upload local assets first, show the final MetaAPP JSON with real `metafile://...` references, and only then run `metaapp publish` or `metaapp update`.

Do not use `publish-project` as the main wizard path. Keep `publish-project` as an explicit fast path only when the human asks for quick packaging and accepts that the command owns the packaging/write flow.

1. Classify the source artifact.

   - ZIP source: use the provided ZIP as the runtime artifact. Inspect it enough to verify the declared `indexFile` exists in the archive. If it is missing, ask which file should be the default entry or ask for a corrected ZIP.
   - Project directory: run preview to discover the artifact directory and default entry.

```bash
{{METABOT_CLI}} metaapp preview --project-dir <path>
```

   If preview finds `dist`, `build`, `out`, `public`, or project-root `index.html`, package that browser-runnable directory into a ZIP while preserving relative paths. If preview cannot find an entry point, ask the human which built directory or default file should be used before packaging.

2. Ask for the required publish fields first.

   Required non-empty values are `title`, `appName`, and `content`. The `content` value is the uploaded runtime ZIP `metafile://...` URI, so it becomes available after the source artifact upload. Ask for title and app name up front; if the human asks for defaults, use the directory/ZIP base name for `title` and a slugified version for `appName`.

3. Ask for the recommended visual and descriptive fields.

   Ask for `coverImg`, `icon`, and `intro`. Also ask whether there are `introImgs`, `tags`, a `version`, a `runtime`, a custom `indexFile`, or source-code archive material for `code`. If the human skips optional fields, keep the field in the final JSON with an empty or reasonable default value.

| Field | Default when not provided |
|---|---|
| `title` | Human-provided name, otherwise directory/ZIP base name |
| `appName` | Human-provided app name, otherwise slugified `title` |
| `prompt` | Empty string |
| `icon` | Empty string unless a local image, HTTP(S) image URL, or `metafile://...` reference is provided |
| `coverImg` | Empty string unless a local image, HTTP(S) image URL, or `metafile://...` reference is provided |
| `introImgs` | Empty array |
| `intro` | Empty string |
| `runtime` | `browser` |
| `version` | `1.0.0` |
| `contentType` | `application/zip` |
| `content` | Uploaded runtime ZIP `metafile://...` URI; must be non-empty before publish |
| `indexFile` | Preview result, human-provided entry, or `index.html` |
| `code` | Empty string unless a source archive is explicitly provided |
| `contentHash` | Empty string unless already known |
| `metadata` | Empty object |
| `tags` | Empty array |
| `disabled` | `false` |
| `codeType` | `application/zip` when `code` is provided, otherwise empty string |

4. Validate and upload local files.

   Before any upload, show the actor, chain, and upload list. Local image paths for `coverImg`, `icon`, or `introImgs` must be checked as images before upload. Accept only `image/png`, `image/jpeg`, `image/webp`, `image/gif`, or `image/svg+xml`; if MIME detection fails or returns another type, stop and ask for a valid image or an HTTP(S) image URL.

```bash
{{METABOT_CLI}} file upload-large --from <bot-slug> --file <absolute-path> --content-type <mime>
{{METABOT_CLI}} file upload-large --from <bot-slug> --file /absolute/path/to/metaapp.zip --content-type application/zip
```

   Use the built-in file protocol path `/file` through the CLI upload command. Convert each successful upload result into the returned `metafileUri` when present, or build `metafile://<pinId>.<ext>` from the returned pin id and known file extension. Preserve file extensions when known.

   HTTP(S) image URLs may be used directly only in image fields such as `coverImg`, `icon`, and `introImgs`. The `content` field must use `metafile://` references only. The `code` field may be empty, but if present it must also use a `metafile://...` reference.

5. Assemble the protocol JSON.

   Payload files must contain the MetaAPP protocol JSON body, not a chain-write wrapper. Include the complete protocol field set in a stable shape so frontends can parse missing optional information consistently. Keep local filesystem paths, build commands, package-manager details, secrets, and workstation details out of the final JSON.

   The field order for the wizard JSON is: `title`, `appName`, `prompt`, `icon`, `coverImg`, `introImgs`, `intro`, `runtime`, `version`, `contentType`, `content`, `indexFile`, `code`, `contentHash`, `metadata`, `tags`, `disabled`, `codeType`.

Example final payload:

```json
{
  "title": "My MetaApp",
  "appName": "my-metaapp",
  "prompt": "",
  "icon": "metafile://icon-pin.png",
  "coverImg": "metafile://cover-pin.png",
  "introImgs": [],
  "intro": "",
  "runtime": "browser",
  "version": "1.0.0",
  "contentType": "application/zip",
  "content": "metafile://runtime-zip-pin.zip",
  "indexFile": "index.html",
  "code": "",
  "contentHash": "",
  "metadata": {},
  "tags": [],
  "disabled": false,
  "codeType": ""
}
```

6. Confirm before the final write.

   Show the final MetaAPP JSON to the human and say they can edit any field by naming it, for example `change coverImg to ...` or `change intro to ...`. Do not publish until the human confirms this exact JSON and the actor. Then write through the direct publish/update CLI:

```bash
{{METABOT_CLI}} metaapp publish --from <bot-slug> --payload-file <path> --confirm
{{METABOT_CLI}} metaapp update --from <bot-slug> --target-pin-id <pinid> --payload-file <path> --confirm
```

7. Return the result and next steps.

   Surface the created or updated pin id, relevant transaction ids, and the local Browser URL. Use the daemon base URL when the CLI result provides it; otherwise show the route as `http://127.0.0.1:<port>/browser/metaapp/<pinId>`. Also tell the human they can later view or modify the MetaApp from `/ui/apps`.

## Direct MetaAPP Protocol Publish

Use this when the MetaAPP payload already references uploaded assets with `metafile://` or HTTP(S) image URLs and the human does not need Q&A collection.

Payload files should contain the MetaAPP protocol JSON body. Direct publish creates a `/protocols/metaapp` pin. Direct update modifies the target MetaApp pin. Direct delete revokes the target pin and should be treated as irreversible by the user-facing workflow.

```bash
{{METABOT_CLI}} metaapp list --from <bot-slug>
{{METABOT_CLI}} metaapp publish --from <bot-slug> --payload-file <path> --confirm
{{METABOT_CLI}} metaapp update --from <bot-slug> --target-pin-id <pinid> --payload-file <path> --confirm
{{METABOT_CLI}} metaapp delete --from <bot-slug> --target-pin-id <pinid> --confirm
```

Before publishing an existing payload, verify that `title`, `appName`, and `content` are present and non-empty, image fields are HTTP(S) image URLs or `metafile://...` references, `content` uses `metafile://...`, and optional fields from the standard shape are present with empty/default values when omitted by the user.

Use `disabled: true` for reversible protocol-level disabling; use `metaapp delete` only when the human explicitly wants deletion/revoke.

## publish-project Fast Path

`publish-project` and `update-project` can remain available as fast paths for humans who explicitly ask for quick project packaging. They are not the default path for the guided skill workflow because the wizard needs to upload image assets, assemble the final JSON, and show that JSON before the protocol write.

```bash
{{METABOT_CLI}} metaapp publish-project --project-dir <path> --from <bot-slug> --confirm
{{METABOT_CLI}} metaapp update-project --target-pin-id <pinid> --project-dir <path> --from <bot-slug> --confirm
```

Add `--manifest-file <path>` when the publishable fields live outside `.metaapp.json`, and add `--chain mvc|btc|opcat` only when the human explicitly chooses a write/upload network supported by the command. Without `--confirm`, project packaging returns a confirmation package and does not write.

## Direct CLI Shortcuts

Use these shortcuts for reading, sharing, opening, or comments.

Preview a project:

```bash
{{METABOT_CLI}} metaapp preview --project-dir <path>
```

List the selected Bot's MetaApps:

```bash
{{METABOT_CLI}} metaapp list --from <bot-slug> --size 12
```

Share a published MetaApp without announcing it:

```bash
{{METABOT_CLI}} metaapp share --pin-id <pinid>
```

Announce the MetaApp through simplebuzz:

```bash
{{METABOT_CLI}} metaapp share --pin-id <pinid> --announce --from <bot-slug>
```

Open the local Apps gallery:

```bash
{{METABOT_CLI}} metaapp view --mine --from <bot-slug>
{{METABOT_CLI}} ui open --page apps --from <bot-slug>
```

Open a published MetaApp in Browser after publish:

```text
http://127.0.0.1:<port>/browser/metaapp/<pinId>
```

Comment on a MetaApp using the existing paycomment protocol:

```bash
{{METABOT_CLI}} metaapp comment --pin-id <pinid> --comment <text> --from <bot-slug>
```

## Required Semantics

- Reuse existing MetaApp, file upload, simplebuzz, and paycomment protocol behavior instead of inventing a new publishing surface.
- Use the Unified Publish Wizard as the main publish flow for natural-language publish requests.
- Keep `publish-project` only as a fast path when the human explicitly asks for it or accepts it after being told it bypasses the guided JSON review.
- The wizard path must gather or draft `title`, `appName`, `coverImg`, `icon`, `intro`, `introImgs`, `tags`, and `indexFile` before writing.
- The final protocol JSON must include `title`, `appName`, `prompt`, `icon`, `coverImg`, `introImgs`, `intro`, `runtime`, `version`, `contentType`, `content`, `indexFile`, `code`, `contentHash`, `metadata`, `tags`, `disabled`, and `codeType`.
- `title`, `appName`, and `content` must be non-empty before publish; every other field may use an empty or reasonable default value.
- Local image assets must be MIME checked and uploaded before they are inserted into the JSON. Do not put local paths in image fields.
- Package fields must stay upload-backed. `content` must use `metafile://` references only, and `code` must be empty or a `metafile://...` reference.
- For parser compatibility, state this plainly in reviews: content must use metafile:// references only.
- Show the final MetaAPP JSON after uploads and before the final `metaapp publish` or `metaapp update` command.
- `metaapp share` without `--announce` is read-only sharing; ignore write-chain planning in that mode.
- `metaapp share --announce` should quote or reference the MetaApp pin in the buzz announcement and must confirm the actor before the announcement write.
- `metaapp comment` writes against the target MetaApp pin using the existing paycomment protocol and must confirm the actor first.
- Treat the local gallery as the built-in `/ui/apps` Apps page so the same content can be opened from `metaapp view` or `ui open --page apps`.
- After publish, update, share, or gallery results, include a natural-language follow-up with the Browser route `/browser/metaapp/<pinId>` when a pin id is known.

## In Scope

- Guided Q&A publish/update workflows for browser-runnable MetaApps.
- ZIP and project-directory source handling.
- ZIP and image upload orchestration needed for MetaAPP JSON references.
- Read-only sharing and optional simplebuzz announcement.
- Local Apps gallery discovery of published MetaApps.

## Out of Scope

- Arbitrary deployment hosting or direct URL invention.
- Network source management.
- Identity creation or switching.
- Publishing package fields that reference Web2 URLs or local filesystem paths.

## Handoff To

- `metabot-post-buzz` for general buzz posting.
- `metabot-upload-file` when the human only wants file upload without MetaApp publishing.
- `metabot-network-manage` when the actor or local network context must be discovered first.

## Compatibility

- CLI path: `{{METABOT_CLI}}`
- Compatibility manifest: `{{COMPATIBILITY_MANIFEST}}`
