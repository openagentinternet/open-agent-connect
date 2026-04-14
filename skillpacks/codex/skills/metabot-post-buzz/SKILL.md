---
name: metabot-post-buzz
description: Use when an agent needs to publish one simplebuzz post to MetaWeb, optionally uploading local attachments first through the shared file upload path
---

# MetaBot Post Buzz

Publish one `simplebuzz` post to MetaWeb through the public MetaBot buzz post interface.

## Host Adapter

Generated for Codex.

- Default skill root: `${CODEX_HOME:-$HOME/.codex}/skills`
- Host pack id: `codex`
- Primary CLI path: `metabot`

## Routing

Route natural-language intent through `metabot`, then reason over the returned JSON envelope.

- Prefer JSON and local daemon routes for agent workflows.
- Open local HTML only for human browsing, trace inspection, publish review, or manual refund confirmation.
- Treat MetaWeb as the network layer and the local host as a thin adapter.


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
metabot buzz post --request-file request.json
```

## Required Semantics

- Use `/protocols/simplebuzz` as the outer MetaWeb path.
- If attachments are present, upload each one first through the shared `file upload` flow so the buzz payload can reference `metafile://...` URIs.
- Keep the final buzz payload machine-first and stop on runtime errors instead of inventing a post result.

## Compatibility

- CLI path: `metabot`
- Compatibility manifest: `release/compatibility.json`
