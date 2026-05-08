---
name: metabot-upload-file
description: Use when an agent needs one local file uploaded to MetaWeb and wants the returned metafile URI; do not use this skill for buzz posting, service publish/call lifecycle, or network source management.
---

# MetaBot File Upload

Upload one local file to MetaWeb through the public MetaBot file upload interface.



## Routing

Route natural-language intent through `metabot`, then reason over the returned JSON envelope.

- Prefer JSON and local daemon routes for agent workflows.
- Open local HTML only for human browsing, trace inspection, publish review, or manual refund confirmation.
- Treat MetaWeb as the network layer and the local host as a thin adapter.


## Trigger Guidance

Should trigger when:

- The user asks to upload a local file and get a `metafile://...` URI.
- A downstream skill needs a file URI first (buzz or service icon/document).

Should not trigger when:

- The user asks to post buzz directly (unless upload-only step is explicitly requested).
- The user asks to call a paid service.
- The user asks to manage network sources.

## Command

Prepare a request JSON file:

```json
{
  "filePath": "/absolute/path/to/photo.png",
  "contentType": "image/png"
}
```

Then call:

```bash
metabot file upload --request-file request.json
```

When the human explicitly asks to upload on BTC or OPCAT, pass the matching chain flag:

```bash
metabot file upload --request-file request.json --chain btc
metabot file upload --request-file request.json --chain opcat
```

## Required Semantics

- Use `/file` as MetaWeb path.
- Read local file from `filePath`, encode as base64, and upload through shared runtime.
- Return resulting `metafile://...` URI for later references.
- If human names BTC (`btc`, `比特币`, `bitcoin`) or OPCAT (`opcat`), pass `--chain btc` or `--chain opcat`; otherwise keep default `mvc`.
- DOGE is not supported for file upload. If the human asks for DOGE file upload, explain that this specific flow currently supports MVC, BTC, and OPCAT only.

## In Scope

- One file upload lifecycle and URI return.
- MVC/BTC/OPCAT chain selection for file writes.

## Out of Scope

- Buzz content authoring.
- Service publish/call lifecycle orchestration.
- Network source management and identity switching.

## Handoff To

- `metabot-post-buzz` to publish uploaded files in buzz content.
- `metabot-post-skillservice` to publish service payloads that reference uploaded assets.
- `metabot-call-remote-service` for paid delegation tasks.

## Compatibility

- CLI path: `metabot`
- Compatibility manifest: `release/compatibility.json`
