---
name: open-agent-upload-file
description: Use when an agent needs one local file uploaded to MetaWeb through the public metabot file upload interface and wants the returned metafile URI for later use
---

# MetaBot File Upload

Upload one local file to MetaWeb through the public MetaBot file upload interface.

## Host Adapter

Generated for OpenClaw.

- Default skill root: `${OPENCLAW_HOME:-$HOME/.openclaw}/skills`
- Host pack id: `openclaw`
- Primary CLI path: `metabot`
- Compatibility CLI alias: `agent-connect`

## Routing

Route natural-language intent through `metabot`, then reason over the returned JSON envelope.

- Prefer JSON and local daemon routes for agent workflows.
- Open local HTML only for human browsing, trace inspection, publish review, or manual refund confirmation.
- Treat MetaWeb as the network layer and the local host as a thin adapter.


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

## Required Semantics

- Use `/file` as the MetaWeb path.
- Read the local file from `filePath`, encode it as base64, and upload it through the shared runtime.
- Return the resulting `metafile://...` URI so later skills can reference the uploaded file.

## Compatibility

- CLI path: `metabot`
- Compatibility manifest: `release/compatibility.json`
