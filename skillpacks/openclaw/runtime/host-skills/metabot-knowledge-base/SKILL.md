---
name: metabot-knowledge-base
description: Use when a human or agent asks to create, inspect, update, query, feed, or delete a local Bot's document knowledge base (知识库) — searchable corpora with a derived index — or to save a document/web page into the Bot's KB for later retrieval. Do not use this skill for memory entries, dream diaries, or on-chain publishing.
---

# Bot Knowledge Bases

Manage a MetaBot's document knowledge bases: raw document corpora with a
derived search index. Every Bot has at least a default KB; the first KB
created becomes the default. Queries use absolute scoring (coverage × share of
the query's achievable best), so an unrelated query returns an honest empty
result instead of a noisy hit. Treat Bot, bot, and MetaBot as equivalent user
wording for the selected local profile.

## Host Adapter

Generated for OpenClaw.

- Default skill root: `${OPENCLAW_HOME:-$HOME/.openclaw}/skills`
- Host pack id: `openclaw`
- Primary CLI path: `$HOME/.metabot/bin/metabot`

## Routing

Route natural-language intent through `$HOME/.metabot/bin/metabot`, then reason over the returned JSON envelope.

- Prefer JSON and local daemon routes for agent workflows.
- Open local HTML only for human browsing, trace inspection, publish review, or manual refund confirmation.
- Treat MetaWeb as the network layer and the local host as a thin adapter.


## Actor Selection

Knowledge-base commands accept optional `--from <bot-slug>`. Use it whenever
the human names a specific local Bot, or a previous workflow step already
selected a Bot. If `--from` is omitted, the CLI uses the Twin Bot.

## Trigger Guidance

Should trigger when:

- The user asks to create, rename, describe, list, or delete a Bot's
  knowledge base (知识库).
- The user asks the Bot to remember a document, article, web page, or manual
  text as searchable knowledge ("save this into your knowledge base").
- The user wants scored passage search over saved documents.

Should not trigger when:

- The memory request is a simple fact/preference (`metabot-memory`).
- The user wants on-chain search (`metabot-metaweb`) or publishing.

## Verb Cheat-Sheet

| Verb | Purpose | Key flags |
|---|---|---|
| `knowledge-base list` | KBs with doc/chunk counts | — |
| `knowledge-base create` | create a KB (first becomes default) | `--name`, `--description`, `--raw-dir`, `--autolearn on\|off` |
| `knowledge-base update` | rename/re-describe/toggle auto-learn | `--id`, `--name`, `--description`, `--autolearn on\|off` |
| `knowledge-base remove` | delete KB + raw documents | `--id`, **`--confirm`** |
| `knowledge-base query` | scored passage search (CJK bigram aware) | `--text`, `--id`, `--top-k` (default 8), `--min-score` (default 0.18) |
| `knowledge-base add-document` | save one document (indexed immediately) | `--title`, exactly one of `--content` / `--content-file`, `--id`, `--source-type web\|metaweb\|manual`, `--url`, `--pin-id`, `--tags` |
| `knowledge-base learn` | (re)index raw documents | `--id` (default KB), `--full` for a full rebuild |

Example — save a page the Bot just read on-chain:

```bash
$HOME/.metabot/bin/metabot knowledge-base add-document --from <bot-slug> \
  --title "MetaID protocol registry guide" \
  --content-file /tmp/guide.md --source-type metaweb --pin-id <pinId>
```

Example — search across the default KB:

```bash
$HOME/.metabot/bin/metabot knowledge-base query --from <bot-slug> --text "wallet recovery steps"
```

## Useful Behaviors

- `add-document` refreshes the index on save — the document is searchable
  immediately. `learn` is for corpus imports/edits and full rebuilds.
- An empty `query` result means the KB genuinely lacks the material; do not
  lower `--min-score` to force hits, search MetaWeb instead and offer to save
  what you find.
- `remove` refuses without `--confirm` and deletes the raw documents — always
  echo what will be lost and get the user's confirmation first.

## Error Handling

- `kb_not_found` — the `--id` does not exist or belongs to another Bot.
- `invalid_flag` — `add-document` given both `--content` and `--content-file`
  (exactly one), or `--autolearn` given a non on/off value.
- `missing_flag` — `remove` without `--confirm` names what to pass.

## In Scope

- Create/list/update/remove KBs; query passages; add documents; learn/rebuild.

## Out of Scope

- Memory entries, dream diaries, impressions (`metabot-memory`).
- On-chain search and pin reads (`metabot-metaweb`).

## Handoff To

- `metabot-memory` for durable facts, preferences, and knowledge points.
- `metabot-metaweb` to find documents worth saving.

## Compatibility

- CLI path: `$HOME/.metabot/bin/metabot`
- Compatibility manifest: `release/compatibility.json`
