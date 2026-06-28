---
name: metabot-metaapp-publish
description: Use when an agent needs to preview, publish, update, share, view, or comment on a browser-runnable MetaApp through Open Agent Connect, especially when turning a local frontend project directory into an on-chain MetaApp.
---

# Bot MetaApp Publish Share

Handle browser-runnable apps, games, and sites as MetaApps through the existing MetaBot CLI and MetaWeb protocols. Treat Bot, bot, and MetaBot wording as equivalent user intent.



## Routing

Route natural-language intent through `$HOME/.metabot/bin/metabot`, then reason over the returned JSON envelope.

- Prefer JSON and local daemon routes for agent workflows.
- Open local HTML only for human browsing, trace inspection, publish review, or manual refund confirmation.
- Treat MetaWeb as the network layer and the local host as a thin adapter.


## Actor Selection

`file upload`, `file upload-large`, `chain write`, `metaapp publish`, `metaapp update`, `metaapp share --announce`, and `metaapp comment` accept optional `--from <bot-slug>`.

Before any upload or final protocol write, confirm the MetaBot actor before every on-chain write. This is mandatory in a multi-MetaBot, multi-account system because ZIP files, cover images, intro images, announcements, comments, and the final MetaApp JSON all belong to the signing MetaBot.

Resolve the actor in this priority order:

1. Session Bot or explicitly named local Bot.
2. A Bot selected earlier in the same MetaApp workflow.
3. Active identity only after the human explicitly confirms using the active identity.

Do not omit `--from` for asset uploads or final JSON writes unless the human has explicitly confirmed that the active identity is the intended owner. A single confirmation may cover a batch of listed asset uploads, but it must name the MetaBot, chain, and every file being uploaded. The final MetaApp JSON write needs its own confirmation even when the same actor was already used for assets.

## Trigger Guidance

Should trigger when:

- The human wants to preview a browser-runnable app, game, or site as a MetaApp.
- The human wants to publish a local frontend project directory as an on-chain MetaApp.
- The human wants to update, share, view, or comment on a MetaApp pin.
- The human wants a local gallery view of previously published MetaApps.

Should not trigger when:

- The human only wants raw deployment hosting or a custom URL scheme.
- The human is managing network sources, identities, or unrelated paid services.

## Publish Wizard

Use this path by default when the human has built a local frontend app and wants it published as a MetaApp.

1. Confirm intent and project directory.
   Ask whether the human wants to publish the relevant project directory as an on-chain MetaApp. Explain that the browser runtime artifact will be compressed into a ZIP and referenced from the MetaApp `content` field as `metafile://...`, not as a Web2 URL or local path.

2. Preview the project.

```bash
$HOME/.metabot/bin/metabot metaapp preview --project-dir <path>
```

Stop if preview reports a manual action. Otherwise use the preview plan to identify `artifactDir` and the default `indexFile`.

3. Draft editable defaults.
   Present a compact draft and let the human accept or override every field:

| Field | Default source |
|---|---|
| MetaBot actor | Session/named Bot, otherwise the active identity after explicit confirmation |
| project directory | User-provided directory or current working directory |
| indexFile | `.metaapp.json`, preview plan, then `index.html` |
| title | `.metaapp.json`, `package.json` display/name, README heading, then directory name |
| appName | `.metaapp.json`, package name, then slugified title |
| coverImg | `.metaapp.json` or likely local cover/logo/og image; empty string if none is obvious |
| intro | `.metaapp.json`, package description, README first paragraph, then a short AI-generated summary |
| tags | `.metaapp.json`, package keywords, or an empty array |

The human can customize values or accept the AI defaults. If a local file is selected for `coverImg`, `icon`, or `introImgs`, it must be uploaded before it appears in the final JSON.

4. Prepare ZIP and asset uploads.
   Create a ZIP from the previewed runtime artifact directory, preserving relative paths so `indexFile` exists at the ZIP root or at the declared relative path. Upload the ZIP through the large-file boundary and upload any local image assets only after showing the upload list and confirming the MetaBot actor.

```bash
$HOME/.metabot/bin/metabot file upload-large --from <bot-slug> --file /absolute/path/to/metaapp.zip --content-type application/zip
```

For small known image assets, direct file upload remains acceptable:

```bash
$HOME/.metabot/bin/metabot file upload --from <bot-slug> --request-file <image-upload.json>
```

When image asset size is unknown, use `file upload-large --file <absolute-path> --content-type <mime>` instead.

If the human explicitly chooses BTC or OPCAT for file uploads, pass `--chain btc` or `--chain opcat`. DOGE is not supported for file upload. If the human provides an `http://` or `https://` image URL, do not put that URL in the MetaApp JSON; ask to fetch and upload it as a file or leave the field empty.

5. Assemble the final MetaApp JSON.
   Use `metafile://...` references returned by upload commands. `content` is the browser runtime artifact ZIP and must be non-empty. `code` is optional source-code material and may be empty, an explicit source archive `metafile://...`, or the runtime ZIP only when compatibility requires mirroring.

```json
{
  "title": "My MetaApp",
  "appName": "my-metaapp",
  "coverImg": "metafile://cover-pin",
  "intro": "Short human-facing description.",
  "runtime": "browser",
  "version": "1.0.0",
  "indexFile": "index.html",
  "content": "metafile://zip-pin",
  "contentType": "application/zip",
  "code": "",
  "codeType": "application/zip",
  "tags": []
}
```

6. Final confirmation and write.
   Show the exact JSON body and the exact chain-write request before writing. No Web2 URLs or local filesystem paths may appear anywhere in the final JSON. Scan the serialized JSON for `http://`, `https://`, `file://`, absolute local paths, project directories, artifact directories, build commands, package-manager names, secrets, and workstation details.

For create:

```json
{
  "operation": "create",
  "path": "/protocols/metaapp",
  "payload": "<stringified MetaApp JSON>",
  "contentType": "application/json"
}
```

```bash
$HOME/.metabot/bin/metabot chain write --from <bot-slug> --request-file <metaapp-chain-request.json>
```

For update:

```json
{
  "operation": "modify",
  "path": "@<target-pin-id>",
  "payload": "<stringified MetaApp JSON>",
  "contentType": "application/json"
}
```

```bash
$HOME/.metabot/bin/metabot chain write --from <bot-slug> --request-file <metaapp-chain-request.json>
```

Do not run the final `chain write` until the human has confirmed both the MetaBot actor and the final JSON body.

## Direct CLI Shortcuts

Use these shortcuts for previewing, reading, sharing, comments, or when the human explicitly accepts the one-command publish path. Direct publish/update require explicit confirmation through `--confirm`; unlike the wizard path, the CLI will upload the ZIP and write the MetaApp JSON in one command after confirmation.

Preview a project:

```bash
$HOME/.metabot/bin/metabot metaapp preview --project-dir <path>
```

Prepare a publish confirmation package before any chain write:

```bash
$HOME/.metabot/bin/metabot metaapp publish --from <bot-slug> --project-dir <path>
```

Publish in the direct path only after confirming the rendered preview and `payloadPreview`:

```bash
$HOME/.metabot/bin/metabot metaapp publish --from <bot-slug> --project-dir <path> --confirm
```

Prepare an update confirmation package before any chain write:

```bash
$HOME/.metabot/bin/metabot metaapp update --target-pin-id <pinid> --from <bot-slug> --project-dir <path>
```

Update in the direct path only after confirming the rendered preview and `payloadPreview`:

```bash
$HOME/.metabot/bin/metabot metaapp update --target-pin-id <pinid> --from <bot-slug> --project-dir <path> --confirm
```

Share a published MetaApp without announcing it:

```bash
$HOME/.metabot/bin/metabot metaapp share --pin-id <pinid>
```

Announce the MetaApp through simplebuzz:

```bash
$HOME/.metabot/bin/metabot metaapp share --pin-id <pinid> --announce --from <bot-slug>
```

Open the local gallery:

```bash
$HOME/.metabot/bin/metabot metaapp view
```

Comment on a MetaApp using the existing paycomment protocol:

```bash
$HOME/.metabot/bin/metabot metaapp comment --pin-id <pinid> --comment <text> --from <bot-slug>
```

## Required Semantics

- Reuse existing MetaApp, file upload, chain write, simplebuzz, and paycomment protocol behavior instead of inventing a new publishing surface.
- Surface returned `pinId`, `metawebUrl`, `localUiUrl`, and `metafile://...` values when present.
- Do not invent deployment URLs or custom hosted links.
- `metaapp preview` should be the first step for browser apps, games, and sites before any write.
- The wizard path must gather or draft `title`, `appName`, `coverImg`, `icon`, `intro`, `introImgs`, `tags`, and `indexFile` before uploading or writing.
- Put reusable user-facing MetaApp metadata in a manifest file such as `.metaapp.json` or a `--manifest-file` JSON override when useful. Do not encode publishable fields only in local notes.
- `payloadPreview` from direct publish/update is useful for checking shape, but the wizard's final JSON must use real uploaded `metafile://...` asset references.
- Check the final JSON for non-empty `content`, expected title/cover/intro fields, correct `indexFile`, and absence of Web2 URLs or local paths before final confirmation.
- `metaapp share` without `--announce` is read-only sharing; ignore write-chain planning in that mode.
- `metaapp share --announce` should quote or reference the MetaApp pin in the buzz announcement and must confirm the actor before the announcement write.
- `metaapp comment` writes against the target MetaApp pin using the existing comment protocol and must confirm the actor first.
- Treat the local gallery as the built-in `metaapps` page so the same content can be opened from `metaapp view` or `ui open --page metaapps`.
- After publish, update, share, or gallery results, include a natural-language follow-up to open the published MetaApp in Browser.

## In Scope

- Preview, publish, update, share, view, and comment workflows for browser-runnable MetaApps.
- ZIP and image upload orchestration needed for MetaApp JSON references.
- Read-only sharing and optional simplebuzz announcement.
- Local gallery discovery of published MetaApps.

## Out of Scope

- Arbitrary deployment hosting or direct URL invention.
- Network source management.
- Identity creation or switching.
- Publishing JSON that references Web2 URLs or local filesystem paths.

## Handoff To

- `metabot-post-buzz` for general buzz posting.
- `metabot-upload-file` when the human only wants file upload without MetaApp publishing.
- `metabot-network-manage` when the actor or local network context must be discovered first.

## Compatibility

- CLI path: `$HOME/.metabot/bin/metabot`
- Compatibility manifest: `release/compatibility.json`
