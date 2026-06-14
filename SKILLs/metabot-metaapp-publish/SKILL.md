---
name: metabot-metaapp-publish
description: Use when an agent needs to preview, publish, update, share, view, or comment on a browser-runnable MetaApp through Open Agent Connect; prefer the metabot metaapp CLI and reuse existing MetaApp/simplebuzz/paycomment protocols.
---

# Bot MetaApp Publish Share

Handle browser-runnable apps, games, and sites as MetaApps through the existing MetaBot CLI and MetaWeb protocols. Treat Bot, bot, and MetaBot wording as equivalent user intent.

{{HOST_ADAPTER_SECTION}}

## Routing

{{SYSTEM_ROUTING}}

## Actor Selection

`metaapp publish`, `metaapp update`, `metaapp share --announce`, and `metaapp comment` accept optional `--from <bot-slug>`.
Use `--from` whenever the human names a specific local Bot or the workflow should stay tied to one actor. If `--from` is omitted, the CLI uses the active identity.

## Trigger Guidance

Should trigger when:

- The human wants to preview a browser-runnable app, game, or site as a MetaApp.
- The human wants to publish, update, share, view, or comment on a MetaApp pin.
- The human wants a local gallery view of previously published MetaApps.

Should not trigger when:

- The human only wants raw deployment hosting or a custom URL scheme.
- The human is managing network sources, identities, or unrelated paid services.

## Commands

Preview a project before publishing:

```bash
{{METABOT_CLI}} metaapp preview --project-dir <path>
```

Prepare a publish confirmation package before any chain write:

```bash
{{METABOT_CLI}} metaapp publish --from <bot-slug> --project-dir <path> --json
```

Publish a new MetaApp only after confirming both the rendered preview and `payloadPreview` JSON:

```bash
{{METABOT_CLI}} metaapp publish --from <bot-slug> --project-dir <path> --confirm
```

Prepare an update confirmation package before any chain write:

```bash
{{METABOT_CLI}} metaapp update --target-pin-id <pinid> --from <bot-slug> --project-dir <path> --json
```

Update an existing MetaApp only after confirming both the rendered preview and `payloadPreview` JSON:

```bash
{{METABOT_CLI}} metaapp update --target-pin-id <pinid> --from <bot-slug> --project-dir <path> --confirm
```

Share a published MetaApp without announcing it:

```bash
{{METABOT_CLI}} metaapp share --pin-id <pinid>
```

Announce the MetaApp through simplebuzz:

```bash
{{METABOT_CLI}} metaapp share --pin-id <pinid> --announce --from <bot-slug>
```

Open the local gallery:

```bash
{{METABOT_CLI}} metaapp view
```

Comment on a MetaApp using the existing paycomment protocol:

```bash
{{METABOT_CLI}} metaapp comment --pin-id <pinid> --comment <text> --from <bot-slug>
```

## Required Semantics

- Publish/update require explicit confirmation through `--confirm`.
- Reuse existing MetaApp, simplebuzz, and paycomment protocol behavior instead of inventing a new publishing surface.
- Surface returned `pinId`, `metawebUrl`, and `localUiUrl` when present.
- Do not invent deployment URLs or custom hosted links.
- `metaapp preview` should be the first step for browser apps, games, and sites before any write.
- Before publish/update confirmation, gather missing user-facing fields such as `title`, `appName`, `coverImg`, `icon`, `intro`, `introImgs`, and `tags`. Ask the human when these values are not obvious or not present in the manifest.
- Put user-facing MetaApp metadata in a manifest file such as `.metaapp.json` or a `--manifest-file` JSON override. Do not encode these fields in local notes that the CLI cannot publish.
- A MetaApp protocol payload must treat `content` as the browser runtime artifact and it must be non-empty. `code` is optional source-code material and may be empty or different from `content`.
- Do not publish local filesystem paths, project directories, artifact directories, build commands, package-manager names, secrets, or workstation details in on-chain `metadata`.
- Run `metaapp publish` or `metaapp update` without `--confirm` before the final write and show the human the returned `payloadPreview` JSON. Confirm only after the human has seen the rendered preview and the JSON payload preview.
- Check `payloadPreview` for non-empty `content`, expected title/cover/intro fields, and absence of local paths before adding `--confirm`.
- `metaapp share` without `--announce` is read-only sharing; ignore write-chain planning in that mode.
- `metaapp share --announce` should quote or reference the MetaApp pin in the buzz announcement.
- `metaapp comment` writes against the target MetaApp pin using the existing comment protocol.
- Treat the local gallery as the built-in `metaapps` page so the same content can be opened from `metaapp view` or `ui open --page metaapps`.

## In Scope

- Preview, publish, update, share, view, and comment workflows for browser-runnable MetaApps.
- Read-only sharing and optional simplebuzz announcement.
- Local gallery discovery of published MetaApps.

## Out of Scope

- Arbitrary deployment hosting or direct URL invention.
- Network source management.
- Identity creation or switching.

## Handoff To

- `metabot-post-buzz` for general buzz posting.
- `metabot-upload-file` when the MetaApp flow needs file upload first.
- `metabot-network-manage` when the actor or local network context must be discovered first.

## Compatibility

- CLI path: `{{METABOT_CLI}}`
- Compatibility manifest: `{{COMPATIBILITY_MANIFEST}}`
