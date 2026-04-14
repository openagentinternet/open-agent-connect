---
name: metabot-upload-file
description: Use when an agent needs one local file uploaded to MetaWeb through the public metabot file upload interface and wants the returned metafile URI for later use
---

# MetaBot File Upload

Upload one local file to MetaWeb through the public MetaBot file upload interface.

## Host Adapter

{{HOST_SKILLPACK_METADATA}}

## Routing

{{SYSTEM_ROUTING}}

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
{{METABOT_CLI}} file upload --request-file request.json
```

When the human explicitly asks to upload on BTC (for example: `btc`, `比特币`, `bitcoin`), call:

```bash
{{METABOT_CLI}} file upload --request-file request.json --chain btc
```

## Required Semantics

- Use `/file` as the MetaWeb path.
- Read the local file from `filePath`, encode it as base64, and upload it through the shared runtime.
- Return the resulting `metafile://...` URI so later skills can reference the uploaded file.
- If the human names BTC (`btc`, `比特币`, `bitcoin`), pass `--chain btc`; otherwise keep default `mvc`.

## Compatibility

- CLI path: `{{METABOT_CLI}}`
- Compatibility manifest: `{{COMPATIBILITY_MANIFEST}}`
