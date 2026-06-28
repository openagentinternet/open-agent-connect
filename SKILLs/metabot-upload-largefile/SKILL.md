---
name: metabot-upload-largefile
description: Use when an agent needs to upload a local large file to MetaWeb for later use and wants a returned metafile URI plus delivery URLs.
---

# Bot Large File Upload

Upload one local large file to MetaWeb through the public Bot file upload interface. Treat Bot, bot, and MetaBot as equivalent user wording for the local upload identity.

{{HOST_ADAPTER_SECTION}}

## Routing

{{SYSTEM_ROUTING}}

## Actor Selection

`file upload-large` accepts optional `--from <bot-slug>`.
Use it whenever the human names a specific local Bot or the uploaded file will be referenced by another command using a selected actor. If `--from` is omitted, the CLI uses the active identity. Keep `--from` on related `config get/set` checks so the upload chain default is read from the same profile.

## Trigger Guidance

Should trigger when:

- The user asks the local Bot, bot, or MetaBot to upload a local large file and get a `metafile://...` URI.
- A downstream workflow needs a file URI, preview URL, or download URL for a local file that may exceed the direct upload threshold.
- Later A2A provider delivery code needs a durable MetaWeb file reference instead of embedding bytes in the service result.

Should not trigger when:

- The user asks to post buzz directly, unless upload-only preparation is explicitly requested.
- The user asks to publish or call a paid service without needing a local file uploaded first.
- The file is remote-only and no local path is available.

## Privacy Rule

Never read large local files into model context. Do not paste, summarize, base64 encode, or inspect the file body in chat. Only pass the absolute local path to the CLI and let the runtime stream or read the bytes outside model context.

## Command

Use the path-first command by default:

```bash
{{METABOT_CLI}} file upload-large --from <bot-slug> --file /absolute/path/to/archive.zip --content-type application/zip --verify
```

Required flag:

- `--file`: absolute local path to the file.

Optional flags:

- `--content-type`: MIME type when known; omit it when the runtime should infer the type.
- `--verify`: request post-upload verification when supported by the runtime.

When `--chain` is omitted, the daemon uses the selected profile's configured `chain.defaultWriteNetwork` (initially `mvc`). Only pass `--chain mvc`, `--chain btc`, or `--chain opcat` when the human explicitly requests that chain:

```bash
{{METABOT_CLI}} file upload-large --from <bot-slug> --file /absolute/path/to/archive.zip --content-type application/zip --chain mvc --verify
{{METABOT_CLI}} file upload-large --from <bot-slug> --file /absolute/path/to/archive.zip --content-type application/zip --chain btc --verify
{{METABOT_CLI}} file upload-large --from <bot-slug> --file /absolute/path/to/archive.zip --content-type application/zip --chain opcat --verify
```

DOGE is unsupported for file upload. If the human asks for DOGE file upload, explain that file upload currently excludes DOGE and ask for a supported chain or the configured default.

## Compatibility Request File

Use `--request-file` only for compatibility with existing automation or when a workflow already has a request JSON file:

```json
{
  "filePath": "/absolute/path/to/archive.zip",
  "contentType": "application/zip",
  "verify": true
}
```

Required field:

- `filePath`: absolute local path to the file.

Optional fields:

- `contentType`: MIME type when known; omit it when the runtime should infer the type.
- `verify`: boolean request for post-upload verification when supported by the runtime.

```bash
{{METABOT_CLI}} file upload-large --from <bot-slug> --request-file request.json --verify
```

## Size And Chain Limits

- Files at or below the 2 MiB direct threshold may use direct upload semantics inside the runtime.
- Files above 2 MiB require the large/chunked path.
- The CLI enforces a 50 MiB hard cap for this skill flow. If the file is larger, stop and explain that the file exceeds the current cap.
- Large/chunked uploads above 2 MiB are currently MVC-only unless the runtime grows support for additional chains. If the human explicitly requests BTC or OPCAT for a file above 2 MiB, explain the current limitation instead of inventing support.

## Success Result

Surface these fields when present:

- `pinId`
- `metafileUri`
- `previewUrl`
- `downloadUrl`
- byte size
- content type
- upload mode, such as direct or chunked
- verification status

If verification was requested and the runtime reports verification unavailable, failed, or skipped, say that clearly. Do not invent a verification result.

## Required Semantics

- Use `/file` as the MetaWeb path for the resulting file metadata.
- Prefer `--file /absolute/path` for human-run uploads.
- Use a temporary JSON request file only for compatibility or automation.
- Forward `--from <bot-slug>` when the workflow already has a selected actor.
- Pass `--chain mvc`, `--chain btc`, or `--chain opcat` only when explicitly requested by the human.
- Stop on CLI or runtime errors and report the structured error details.
- Return the resulting `metafile://...` URI and URLs for later references. When the runtime can determine the file extension, prefer the extension-bearing form such as `metafile://<pinid>.zip`; bare `metafile://<pinid>` remains acceptable only when the type is unknown.

## In Scope

- One local file upload lifecycle.
- Direct upload for files up to 2 MiB.
- Large/chunked upload for supported files above 2 MiB and at or below 50 MiB.
- Optional runtime verification.

## Out Of Scope

- Provider or caller A2A service logic.
- Production chunked upload implementation details.
- Uploading DOGE file payloads.
- Reading or transforming large file contents in model context.

## Handoff To

- `metabot-post-buzz` to publish uploaded files in buzz content.
- `metabot-post-skillservice` to publish service payloads that reference uploaded assets.
- Later A2A provider delivery code when a provider result should deliver a `metafile://...` reference, preview URL, or download URL.

## Compatibility

- CLI path: `{{METABOT_CLI}}`
- Compatibility manifest: `{{COMPATIBILITY_MANIFEST}}`
