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
| `knowledge-base study enqueue` | queue a nightly MetaWeb study topic (dedupes while pending/running) | `--topic` (max 200 chars), `--budget-pins 1-50` (default 20) |
| `knowledge-base study status` | the morning report: this Bot's jobs, runs, failures | — |
| `knowledge-base study retry` | requeue failed jobs (3 consecutive nightly failures stop a job) | `--job-id` one job, `--topic` substring, or bare for all failed |

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

Example — assign a long-horizon learning topic for the coming nights:

```bash
$HOME/.metabot/bin/metabot knowledge-base study enqueue --from <bot-slug> \
  --topic "MetaID protocol deep dive" --budget-pins 10
$HOME/.metabot/bin/metabot knowledge-base study status --from <bot-slug>
```

## Surfacing the Knowledge Page

`knowledge-base list`, `knowledge-base query`, and `knowledge-base learn`
success envelopes carry an additive `localUiUrl` field when the CLI can
resolve a local daemon base URL (it is omitted otherwise — a missing link
never fails the command). It deep-links the standalone knowledge-base page
for the resolved Bot, for example
`http://127.0.0.1:10001/ui/kb?from=<bot-slug>`. When it is present, surface it
to the user as a clickable link — opening it in the host's own browser or
preview surface per the host-adapter note above — for example "Knowledge
base: <url>".

## Useful Behaviors

- `add-document` refreshes the index on save — the document is searchable
  immediately. `learn` is for corpus imports/edits and full rebuilds.
- An empty `query` result means the KB genuinely lacks the material; do not
  lower `--min-score` to force hits, search MetaWeb instead and offer to save
  what you find.
- `study enqueue` is for owner-assigned long-horizon learning, never for
  questions the user wants answered now — the daemon drains the queue nightly
  (00:00-06:00). A job that fails 3 nights in a row stops as `[failed]`;
  `study retry` puts it back into the queue.
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
