---
name: metabot-upload-file
description: Use when an agent needs one local file uploaded to MetaWeb and wants the returned metafile URI, preview URL, or download URL. This is the single file upload skill for both small and large local files; choose direct or large/chunked upload behavior from file size and runtime limits instead of asking the user to choose another skill.
---

# Bot File Upload

Upload one local file to MetaWeb through the public Bot file upload interface. This is the single file upload skill for small and large files. Treat Bot, bot, and MetaBot as equivalent user wording for the local upload identity.

## Host Adapter

Generated for Codex.

- Default skill root: `${CODEX_HOME:-$HOME/.codex}/skills`
- Host pack id: `codex`
- Primary CLI path: `$HOME/.metabot/bin/metabot`

## Routing

Route natural-language intent through `$HOME/.metabot/bin/metabot`, then reason over the returned JSON envelope.

- Prefer JSON and local daemon routes for agent workflows.
- Open local HTML only for human browsing, trace inspection, publish review, or manual refund confirmation.
- Treat MetaWeb as the network layer and the local host as a thin adapter.


## Actor Selection

`file upload-large` and compatibility `file upload` accept optional `--from <bot-slug>`.

Resolve the actor in this priority order:

1. **Session bot** - You are inside a MetaBot private chat, profile workspace, or any context that names the conversation bot slug -> use that slug for `--from` on every command (upload, config, downstream buzz/post). Never omit `--from` in this case.
2. **Named bot** - The human explicitly names a local Bot, or a prior step already selected an actor for the same workflow -> use that slug.
3. **Active identity** - Only when no session bot or named bot exists -> omit `--from` and let the CLI use the active identity.

Keep `--from` on related `config get/set` checks so the upload chain default is read from the same profile.

## Trigger Guidance

Should trigger when:

- The user asks the local Bot, bot, or MetaBot to upload a local file and get a `metafile://...` URI.
- A downstream workflow needs a file URI, preview URL, or download URL for a local file.
- A downstream skill needs a file URI first, such as buzz attachments, service icons/documents, Loom attachments, MetaApp assets, or A2A delivery artifacts.

Should not trigger when:

- The user asks to post buzz directly, unless upload-only preparation is explicitly requested.
- The user asks to publish or call a paid service without needing a local file uploaded first.
- The file is remote-only and no local path is available.
- The user asks to manage network sources.

## Privacy Rule

Never read large local files into model context. Do not paste, summarize, base64 encode, or inspect the file body in chat. Only pass the absolute local path to the CLI and let the runtime stream or read the bytes outside model context.

## Default Command

Use the path-first large-upload command by default for all local file uploads. For this command, the runtime chooses direct upload for files at or below the 5 MiB direct threshold and large/chunked upload for supported files above that threshold. MVC sponsor, when enabled, follows the same direct-upload window for this command.

```bash
$HOME/.metabot/bin/metabot file upload-large --from <bot-slug> --file /absolute/path/to/archive.zip --content-type application/zip --verify
```

Required flag:

- `--file`: absolute local path to the file.

Optional flags:

- `--content-type`: MIME type when known; omit it when the runtime should infer the type.
- `--verify`: request post-upload verification when supported by the runtime.

When `--chain` is omitted, the daemon uses the selected profile's configured `chain.defaultWriteNetwork` (initially `mvc`). Only pass `--chain mvc`, `--chain btc`, or `--chain opcat` when the human explicitly requests that chain:

```bash
$HOME/.metabot/bin/metabot file upload-large --from <bot-slug> --file /absolute/path/to/photo.png --content-type image/png --chain mvc --verify
$HOME/.metabot/bin/metabot file upload-large --from <bot-slug> --file /absolute/path/to/photo.png --content-type image/png --chain btc --verify
$HOME/.metabot/bin/metabot file upload-large --from <bot-slug> --file /absolute/path/to/photo.png --content-type image/png --chain opcat --verify
```

To inspect or change the selected profile's default write network:

```bash
$HOME/.metabot/bin/metabot config get --from <bot-slug> chain.defaultWriteNetwork
$HOME/.metabot/bin/metabot config set --from <bot-slug> chain.defaultWriteNetwork opcat
```

DOGE is unsupported for file upload. If the human asks for DOGE file upload, explain that this specific flow currently supports MVC, BTC, and OPCAT only.

## Compatibility

Use legacy direct `file upload --request-file` only for existing automation that already produces a request JSON file and is known to stay at or below the direct upload threshold:

```json
{
  "filePath": "/absolute/path/to/photo.png",
  "contentType": "image/png"
}
```

```bash
$HOME/.metabot/bin/metabot file upload --from <bot-slug> --request-file request.json
```

Use `file upload-large --request-file` only for compatibility with existing automation that already has a request JSON file but should still use the unified direct/large runtime boundary:

```json
{
  "filePath": "/absolute/path/to/archive.zip",
  "contentType": "application/zip",
  "verify": true
}
```

```bash
$HOME/.metabot/bin/metabot file upload-large --from <bot-slug> --request-file request.json --verify
```

## Size And Chain Limits

- Files at or below the 5 MiB direct threshold may use direct upload semantics inside the runtime for `file upload-large`.
- Files above 5 MiB require the large/chunked path.
- The CLI enforces a 50 MiB hard cap for this skill flow. If the file is larger, stop and explain that the file exceeds the current cap.
- Large/chunked uploads above 5 MiB are currently MVC-only unless the runtime grows support for additional chains. If the human explicitly requests BTC or OPCAT for a file above 5 MiB, explain the current limitation instead of inventing support.
- MVC sponsor may apply to eligible direct MVC uploads at or below 5 MiB when the sponsor gate is enabled for the selected Bot profile.
- DOGE is unsupported for file upload on both direct and large/chunked paths.

## Success Result

Surface these fields when present:

- `pinId`
- `metafileUri`
- `metawebUrl`
- `previewUrl`
- `downloadUrl`
- byte size
- content type
- upload mode, such as direct or chunked
- verification status

When `pinId` is present and the human asks to view or share the uploaded file, surface the MetaFile Browser URL:

```text
https://openagentinternet.org/browser/metafile/<pinId>
```

Use this MetaFile Browser URL for viewing and sharing uploaded files. Do not use `https://openagentinternet.org/browser/pin/<pinId>` for uploaded file view/share links; `/browser/pin` is the generic pin inspector, not the file-focused viewer.

If verification was requested and the runtime reports verification unavailable, failed, or skipped, say that clearly. Do not invent a verification result.

## Required Semantics

- Use `/file` as the MetaWeb path for the resulting file metadata.
- Prefer `file upload-large --file /absolute/path` for human-run uploads, even when the file may be small.
- Use temporary JSON request files only for compatibility or automation.
- Forward `--from <bot-slug>` when the workflow already has a selected actor.
- Pass `--chain mvc`, `--chain btc`, or `--chain opcat` only when explicitly requested by the human.
- Stop on CLI or runtime errors and report the structured error details.
- Return the resulting `metafile://...` URI and URLs for later references. When the runtime can determine the file extension, prefer the extension-bearing form such as `metafile://<pinid>.zip`; bare `metafile://<pinid>` remains acceptable only when the type is unknown.
- When returning a public view/share link for an uploaded file, use `metawebUrl` when present. If only `pinId` is present, derive `https://openagentinternet.org/browser/metafile/<pinId>` and label it as the MetaFile Browser link.

## In Scope

- One local file upload lifecycle.
- Direct upload for files up to 5 MiB when using `file upload-large`, including eligible MVC sponsor attempts inside the same window.
- Large/chunked upload for supported files above 5 MiB and at or below 50 MiB.
- Optional runtime verification.
- MVC/BTC/OPCAT chain selection for supported file writes.

## Out Of Scope

- Buzz content authoring.
- Provider or caller A2A service logic.
- Production chunked upload implementation details.
- Uploading DOGE file payloads.
- Reading or transforming large file contents in model context.
- Network source management and identity switching.

## Handoff To

- `metabot-post-buzz` to publish uploaded files in buzz content.
- `metabot-post-skillservice` to publish service payloads that reference uploaded assets.
- `metabot-metaapp` for MetaApp workflows that include upload-backed package or image fields.
- Later A2A provider delivery code when a provider result should deliver a `metafile://...` reference, preview URL, or download URL.
- `metabot-call-remote-service` for paid delegation tasks.

## Compatibility Metadata

- CLI path: `$HOME/.metabot/bin/metabot`
- Compatibility manifest: `release/compatibility.json`
