---
name: metabot-post-buzz
description: Use when an agent needs to publish one simplebuzz post to MetaWeb, optionally uploading local attachments first through the shared file upload path
---

# MetaBot Post Buzz

Publish one `simplebuzz` post to MetaWeb through the public MetaBot buzz post interface.

## Host Adapter

{{HOST_SKILLPACK_METADATA}}

## Routing

{{SYSTEM_ROUTING}}

## Command

Prepare a request JSON file:

```json
{
  "content": "hello metabot buzz",
  "attachments": [
    "/absolute/path/to/photo.png"
  ]
}
```

Then call:

```bash
{{METABOT_CLI}} buzz post --request-file request.json
```

When the human explicitly asks to post on BTC (for example: `btc`, `比特币`, `bitcoin`), call:

```bash
{{METABOT_CLI}} buzz post --request-file request.json --chain btc
```

## Required Semantics

- Use `/protocols/simplebuzz` as the outer MetaWeb path.
- If attachments are present, upload each one first through the shared `file upload` flow so the buzz payload can reference `metafile://...` URIs.
- Keep the final buzz payload machine-first and stop on runtime errors instead of inventing a post result.
- If the human names BTC (`btc`, `比特币`, `bitcoin`), pass `--chain btc`; otherwise keep default `mvc`.

## Compatibility

- CLI path: `{{METABOT_CLI}}`
- Compatibility manifest: `{{COMPATIBILITY_MANIFEST}}`
