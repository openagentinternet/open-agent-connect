---
name: metabot-memory
description: Use when a human or agent asks a local Bot to remember, recall, search, or manage long-term memories — durable facts, preferences, dream diaries (梦境/回忆), knowledge points, person impressions, past conversations, or the Bot's own chain-read/publish history. Also use when a conversation should run with the Bot's memory context loaded, or when a host wants to mirror turns into the Bot's transcript store. Do not use this skill for scheduled tasks or on-chain publishing.
---

# Bot Long-Term Memory

Read and manage a MetaBot's long-term memory: scoped memory entries, dream
diaries, knowledge points, person impressions, mirrored transcripts, and the
Bot's own chain-history ledger. All data is local to the Bot's profile. Treat
Bot, bot, and MetaBot as equivalent user wording for the selected local
profile.

## Host Adapter

Generated for ZCode.

- Default skill root: `$HOME/.zcode/skills`
- Host pack id: `zcode`
- Primary CLI path: `$HOME/.metabot/bin/metabot`

## Routing

Route natural-language intent through `$HOME/.metabot/bin/metabot`, then reason over the returned JSON envelope.

- Prefer JSON and local daemon routes for agent workflows.
- Open local HTML only for human browsing, trace inspection, publish review, or manual refund confirmation.
- Treat MetaWeb as the network layer and the local host as a thin adapter.


## Actor Selection

Memory commands accept optional `--from <bot-slug>`. Use it whenever the human
names a specific local Bot, or a previous workflow step already selected a
Bot. If `--from` is omitted, the CLI uses the Twin Bot.

## Trigger Guidance

Should trigger when:

- The user tells a Bot to remember something, forget something, or asks what
  the Bot remembers about them, someone, or a topic (记住/回忆).
- The user asks about the Bot's dream diaries, knowledge points, impressions,
  or past conversations (本地或 A2A 私聊).
- The user asks what the Bot has published or read on-chain recently.
- A workflow wants to load the Bot's memory context before answering as that
  Bot, or mirror a finished turn into the Bot's transcript store.

Should not trigger when:

- The user asks to schedule future work (`metabot-schedule`).
- The user asks to run or inspect dreams themselves (`metabot-dream`).
- The user asks for knowledge-base document search (`metabot-knowledge-base`).

## Verb Cheat-Sheet

| Verb | Purpose | Key flags / payload |
|---|---|---|
| `memory list` | list scoped entries | `--scope-kind owner\|contact\|conversation`, `--scope-key`, `--usage-class`, `--origin conversation\|dream`, `--query`, `--limit` |
| `memory add` | create (or revive a near-duplicate) | `--payload-file { text, scopeKind?, scopeKey?, usageClass?, confidence?, isExplicit?, origin?, source? }` |
| `memory update` | edit entry | `--payload-file { id, text?, confidence?, status?, usageClass?, visibility? }` |
| `memory delete` | soft-delete entry | `--payload-file { id, scopeKind?, scopeKey? }` |
| `memory recall` | dream-diary recall | `--payload-file { query?, dateFrom?, dateTo?, granularity? day\|week\|month, limit? }` (bare payload = last 30 days) |
| `memory search` | keyword search transcripts + A2A messages | `--payload-file { query, maxResults?, before?, after? }` |
| `memory chats` | recent local + A2A conversations | `--limit 1-20`, `--sort-order asc\|desc` |
| `memory blocks` | build the per-turn injection XML | `--payload-file { channel?, peerGlobalMetaId?, externalConversationId?, userText? }` |
| `memory transcript append` | mirror one message | `--payload-file { sessionId, role user\|assistant, text, ts?, turn?, channel?, peerGlobalMetaId? }` |
| `memory transcript read` | read a mirrored session (any Bot with `--any-bot`) | `--session <id>`, `--limit`, `--any-bot` |
| `memory knowledge list` | list knowledge points | `--kind know_how\|pitfall\|principle`, `--category`, `--status`, `--query`, `--limit` |
| `memory knowledge upsert` | save/revise a knowledge point | `--payload-file { topic, summary, kind?, category?, tags?, sources? }` |
| `memory impressions list` / `show` | person impressions | `show` takes `--subject <globalMetaId>` |
| `chainhistory recall` | the Bot's own on-chain writes/reads | `--query`, `--kind write\|read`, `--from-date`, `--to-date`, `--limit` |

All verbs are local reads/writes — no chain writes, no confirmation states.

## Working With Memory Context

`memory blocks` returns the same `<memory>` XML block the DSH host injects
into every Bot turn. Hosts without native injection can call it explicitly:

```bash
$HOME/.metabot/bin/metabot memory blocks --from <bot-slug> --payload-file payload.json
```

with `payload.json` carrying `{ "channel": "<host-id>", "userText": "<the upcoming user message>" }`.
Use the returned `data.xml` as the Bot's memory context when answering as
that Bot. When a host wants its turns remembered the way DSH turns are, mirror
finished turns and run extraction:

```bash
$HOME/.metabot/bin/metabot memory transcript append --from <bot-slug> --payload-file turn-user.json
$HOME/.metabot/bin/metabot memory transcript append --from <bot-slug> --payload-file turn-assistant.json
$HOME/.metabot/bin/metabot memory extract --from <bot-slug> --payload-file extract.json
```

where `extract.json` carries `{ "userText": "...", "assistantText": "...", "sessionId": "...", "channel": "<host-id>" }`.
Explicit `记住…` / `remember this…` requests should always become a `memory
add` with `isExplicit: true`.

## Chain-History Recall

`chainhistory recall` searches what the Bot itself published (writes) and
fully read (reads) on-chain — newest first, default 90-day window, `--limit`
capped at 50 per kind. Use it for "what did I post/read on-chain last week"
questions instead of guessing from transcripts.

## Error Handling

- `invalid_payload` / `invalid_flag` — fix the payload or flag per the message.
- `not_found` — memory id not in the resolved scope, or the entry is
  dream-protected (`self_identity` entries are rewritten only by dreams).
- `identity_missing` (impressions) — the selected Bot has no identity yet.

## In Scope

- List/add/update/delete scoped memory entries; recall dream diaries; search
  transcripts and conversations; knowledge-point list/upsert.
- Read mirrored sessions (including cross-Bot via `--any-bot`), append turns,
  run extraction, build injection blocks.
- Person impressions and chain-history recall.

## Out of Scope

- Running or inspecting dreams (`metabot-dream`).
- Document knowledge bases with their own index (`metabot-knowledge-base`).
- Scheduled tasks (`metabot-schedule`), on-chain publishing.

## Handoff To

- `metabot-dream` for dream runs, status, diaries, and self-identity.
- `metabot-knowledge-base` for corpus documents and scored passage search.
- `metabot-metaweb` for on-chain search and pin reads.

## Compatibility

- CLI path: `$HOME/.metabot/bin/metabot`
- Compatibility manifest: `release/compatibility.json`
