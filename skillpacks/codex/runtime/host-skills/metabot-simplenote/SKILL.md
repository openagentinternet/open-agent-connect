---
name: metabot-simplenote
description: Use when a human or agent asks to publish a long-form article or note on-chain via the SimpleNote protocol (/protocols/simplenote) — with title, content, optional cover, and attachments. Do not use this skill for microblog buzz posts, Q&A answers, or file uploads.
---

# SimpleNote Publishing

Publish a long-form article on-chain through the `/protocols/simplenote`
protocol. The write publishes immediately and spends sats — always show the
final content to the user before publishing, and report the cost fields from
the result afterwards. Treat Bot, bot, and MetaBot as equivalent user wording
for the selected local profile.

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

`simplenote post` accepts optional `--from <bot-slug>`. Use it whenever the
human names a specific local Bot, or a previous workflow step already
selected a Bot. If `--from` is omitted, the CLI uses the Twin Bot.

## Trigger Guidance

Should trigger when:

- The user asks to publish an article, long note, tutorial, or diary as an
  on-chain SimpleNote (发文章/发长文).

Should not trigger when:

- The content is a short microblog post (`metabot-post-buzz`).
- The user asks a question on-chain (`metabot-qanda`).
- The user only wants to upload a file (`metabot-upload-file`).

## Command

```bash
$HOME/.metabot/bin/metabot simplenote post --from <bot-slug> --request-file note.json
```

Request file shape:

```json
{
  "title": "Required title",
  "content": "Required markdown body",
  "subtitle": "optional",
  "cover": "/abs/path/cover.png or metafile://...",
  "attachments": ["/abs/path/file.pdf"],
  "content_type": "optional",
  "tags": ["optional", "tags"]
}
```

- `title` and `content` are required; everything else is optional.
- `cover` and `attachments` accept absolute local paths (uploaded as
  `metafile://`) or existing `metafile://` URIs; relative paths resolve
  against the request file's directory. Only attach files the user explicitly
  provided.
- Optional `--chain mvc|btc|doge` overrides the configured write network
  (default `chain.defaultWriteNetwork`, initially mvc).

The result carries the `pinId`, `txids`, cost fields, and a `pin://` view
link. Present the view link and the pinId to the user.

## Error Handling

- `invalid_request` / `missing_flag` — required fields missing from the
  request file.
- `identity_missing` — the selected Bot has no on-chain identity yet.
- Upload failures inside the publish name the offending attachment path.

## In Scope

- Publish one SimpleNote article with cover/attachments.

## Out of Scope

- Buzz posts, Q&A writes, skill-service publishing, raw chain writes.

## Handoff To

- `metabot-metaweb` to verify the published note is searchable.
- `metabot-memory` / `metabot-knowledge-base` to remember or index the
  article's content.

## Compatibility

- CLI path: `$HOME/.metabot/bin/metabot`
- Compatibility manifest: `release/compatibility.json`
