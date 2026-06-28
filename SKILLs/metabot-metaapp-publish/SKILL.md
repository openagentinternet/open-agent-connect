---
name: metabot-metaapp-publish
description: Use when an agent needs to preview, publish, update, share, view, or comment on a browser-runnable MetaApp through Open Agent Connect, especially when turning a local frontend project directory into an on-chain MetaApp.
---

# Bot MetaApp Publish Share

Handle browser-runnable apps, games, and sites as MetaApps through the existing MetaBot CLI and MetaWeb protocols. Treat Bot, bot, and MetaBot wording as equivalent user intent.

{{HOST_ADAPTER_SECTION}}

## Routing

{{SYSTEM_ROUTING}}

## Actor Selection

`file upload`, `metaapp publish`, `metaapp update`, `metaapp delete`, `metaapp publish-project`, `metaapp update-project`, `metaapp share --announce`, and `metaapp comment` accept optional `--from <bot-slug>`.

Before any upload or final protocol write, confirm the MetaBot actor before every on-chain write. This is mandatory in a multi-MetaBot, multi-account system because ZIP files, cover images, intro images, announcements, comments, deletion revokes, and the final MetaApp JSON all belong to the signing MetaBot.

Resolve the actor in this priority order:

1. Session Bot or explicitly named local Bot.
2. A Bot selected earlier in the same MetaApp workflow.
3. Active identity only after the human explicitly confirms using the active identity.

Do not omit `--from` for asset uploads or final JSON writes unless the human has explicitly confirmed that the active identity is the intended owner. A single confirmation may cover a batch of listed asset uploads, but it must name the MetaBot, chain, and every file being uploaded. Publish, update, and delete all require explicit confirmation with `--confirm`.

## Trigger Guidance

Should trigger when:

- The human wants to preview a browser-runnable app, game, or site as a MetaApp.
- The human wants to publish a local frontend project directory as an on-chain MetaApp.
- The human wants to create, update, delete, share, view, or comment on a MetaApp pin.
- The human wants a local Apps gallery view of previously published MetaApps.

Should not trigger when:

- The human only wants raw deployment hosting or a custom URL scheme.
- The human is managing network sources, identities, or unrelated paid services.

## Publish Wizard

Use this path by default when the human has built a local frontend app and wants it published as a MetaApp.

1. Confirm intent, actor, chain, and project directory.
   Ask whether the human wants to publish the relevant project directory as an on-chain MetaApp. Explain that the browser runtime artifact will be compressed into a ZIP and referenced from the MetaApp `content` field as `metafile://...`.

2. Preview the project.

```bash
{{METABOT_CLI}} metaapp preview --project-dir <path>
```

Stop if preview reports a manual action. Otherwise use the preview plan to identify `artifactDir`, `indexFile`, manifest defaults, and upload candidates.

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
| icon | `.metaapp.json` or likely local icon file; empty string if none is obvious |
| intro | `.metaapp.json`, package description, README first paragraph, then a short AI-generated summary |
| introImgs | `.metaapp.json` or selected local/image URL references; empty array if none is obvious |
| runtime | `.metaapp.json`, otherwise `browser` |
| contentType | `.metaapp.json`, otherwise `application/zip` |
| tags | `.metaapp.json`, package keywords, or an empty array |

The human can customize values or accept the AI defaults. Local image files must be uploaded or handled by the project packaging command before they appear as `metafile://...` references. HTTP(S) image URLs may be used directly only in image fields such as `coverImg`, `icon`, and `introImgs`.

4. Prepare a manifest when useful.
   Put reusable user-facing MetaApp metadata in a manifest file such as `.metaapp.json` or a `--manifest-file` JSON override. Do not encode publishable fields only in local notes. The manifest may include image fields with `metafile://...` references or HTTP(S) image URLs, but package fields must stay upload-backed.

5. Preview the confirmation package.
   Run the project command without `--confirm` to get the rendered plan and `payloadPreview` without writing to chain.

```bash
{{METABOT_CLI}} metaapp publish-project --project-dir <path> --from <bot-slug> --manifest-file <path>
{{METABOT_CLI}} metaapp update-project --target-pin-id <pinid> --project-dir <path> --from <bot-slug> --manifest-file <path>
```

6. Final confirmation and write.
   Show the exact actor, chain, upload list, target pin for updates, and `payloadPreview` before writing. Scan the final payload for unexpected local filesystem paths, project directories, build commands, package-manager names, secrets, and workstation details. For create or update, run the same project command with `--confirm` only after the human confirms the actor and final payload.

## Direct MetaAPP Protocol Publish

Use this when the MetaAPP payload already references uploaded assets with `metafile://` or HTTP(S) image URLs.

```bash
{{METABOT_CLI}} metaapp list --from <bot-slug>
{{METABOT_CLI}} metaapp publish --from <bot-slug> --payload-file <path> --confirm
{{METABOT_CLI}} metaapp update --from <bot-slug> --target-pin-id <pinid> --payload-file <path> --confirm
{{METABOT_CLI}} metaapp delete --from <bot-slug> --target-pin-id <pinid> --confirm
```

Payload files should contain the MetaAPP protocol JSON body, not a chain-write wrapper. Direct publish creates a `/protocols/metaapp` pin. Direct update modifies the target MetaApp pin. Direct delete revokes the target pin and should be treated as irreversible by the user-facing workflow.

Example direct payload:

```json
{
  "title": "My MetaApp",
  "appName": "my-metaapp",
  "coverImg": "https://example.com/cover.png",
  "icon": "metafile://icon-pin",
  "intro": "Short human-facing description.",
  "introImgs": ["https://example.com/screen.png"],
  "runtime": "browser",
  "version": "1.0.0",
  "indexFile": "index.html",
  "content": "metafile://zip-pin",
  "contentType": "application/zip",
  "code": "metafile://source-pin",
  "codeType": "application/zip",
  "tags": [],
  "disabled": false
}
```

Image fields support HTTP(S) image URLs or `metafile://...` references. The content and code fields must use metafile:// references only. Use `disabled: true` for reversible protocol-level disabling; use `metaapp delete` only when the human explicitly wants deletion/revoke.

## Project Packaging Publish

Use this when starting from a local browser-runnable project directory. Project packaging creates/uploads the ZIP artifact and writes the MetaAPP protocol payload through the MetaApp owner service after explicit confirmation.

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

Comment on a MetaApp using the existing paycomment protocol:

```bash
{{METABOT_CLI}} metaapp comment --pin-id <pinid> --comment <text> --from <bot-slug>
```

## Required Semantics

- Reuse existing MetaApp, file upload, simplebuzz, and paycomment protocol behavior instead of inventing a new publishing surface.
- Surface returned `pinId`, `metawebUrl`, `localUiUrl`, and `metafile://...` values when present.
- Do not invent deployment URLs or custom hosted links.
- `metaapp preview` should be the first step for browser apps, games, and sites before any project packaging write.
- The wizard path must gather or draft `title`, `appName`, `coverImg`, `icon`, `intro`, `introImgs`, `tags`, and `indexFile` before writing.
- Put reusable user-facing MetaApp metadata in a manifest file such as `.metaapp.json` or a `--manifest-file` JSON override when useful.
- `payloadPreview` from publish/update is useful for checking shape, but final package references must use real uploaded `metafile://...` asset references for `content` and `code`.
- Check the final JSON for non-empty `content`, expected title/cover/intro fields, correct `indexFile`, and absence of local filesystem paths before final confirmation.
- `metaapp share` without `--announce` is read-only sharing; ignore write-chain planning in that mode.
- `metaapp share --announce` should quote or reference the MetaApp pin in the buzz announcement and must confirm the actor before the announcement write.
- `metaapp comment` writes against the target MetaApp pin using the existing paycomment protocol and must confirm the actor first.
- Treat the local gallery as the built-in `/ui/apps` Apps page so the same content can be opened from `metaapp view` or `ui open --page apps`.
- After publish, update, share, or gallery results, include a natural-language follow-up to open the published MetaApp in Browser.

## In Scope

- Preview, list, publish, update, delete, share, view, and comment workflows for browser-runnable MetaApps.
- ZIP and image upload orchestration needed for MetaApp JSON references.
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
