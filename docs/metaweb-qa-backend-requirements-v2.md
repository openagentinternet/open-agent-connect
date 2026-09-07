# Backend Requirements v2 — MetaWeb On-chain Q&A: Comment Threads and Author Answer Listing (metaso-p2p)

## Status

Draft v1.0 for backend development, 2026-09-07. Requested by the IDBots team as the blocking dependency of the **human-facing Q&A MetaApp** (the next phase of the on-chain Quora: `docs/metaweb-qa-frontend-metaapp-guide.md` §6 identified these gaps). Target project: `metaso-p2p` (Go + Gin + PebbleDB, deployed as `https://so.metaid.io`).

This document extends, and follows the conventions of, the deployed v1 contract `docs/specs/2026-09-07-metaweb-qa-api.md`. Per project convention, the backend team should turn R5–R6 into `docs/specs/` contract docs before implementation. Everything here is additive — no change to any existing endpoint or item shape.

Goal: two new read-only capabilities — **R5 comment threads on Q&A pins**, **R6 cross-question answer listing (author pages / newest answers)**.

Non-goals: write APIs; comment threading (replies to comments — flat list only in this round); like/reaction lists on comments; any accepted-answer or lifecycle semantics (the product has none by decision); moderation.

## 1. Background

The v1 Q&A index aggregates PayComment into a plain `commentCount` per question/answer pin but deliberately stores no comment bodies ("comments stay behind the social surfaces") — and the social comments endpoint (`GET /api/social/post/:pinId/comments`) is simplebuzz-only, so **comment content on Q&A pins is currently unreadable anywhere**. A ZhiHu-style frontend cannot render comment threads. Likewise, answers by one publisher can only be listed per-question (`GET /api/qa/questions/:pinId/answers?publisher=`); there is no way to list a publisher's answers across questions, which author pages need.

## 2. R5 — Comment threads: `GET /api/qa/pins/:pinId/comments`

### Indexing change (R5.1)

- Parse and store **PayComment pins whose `commentTo` resolves to a Q&A-indexed pin** (question or answer, any version): `pinId`, `currentPinId`, `commentTo` (normalized to the target's stable pinId), `content` (full body, markdown; store up to a cap — comments are short, suggested 2000 runes, beyond that truncate at index time), `contentType`, publisher, chain, block/relay time. Natural home: extend the `qa` aggregator namespace (the target pin already exists there).
- `modify` updates in place; `revoke` hides the comment (it leaves the list and stops counting in `commentCount`). Mempool comments are indexed immediately (`isMempool: true`), replaced on confirmation — same freshness contract as questions/answers.
- Comments whose target is NOT a Q&A pin stay where they are today (socialcontent owns simplebuzz); this endpoint must not serve them.
- Backfill: extend `metaso-p2p-qa-backfill` to replay historical `/protocols/paycomment` for Q&A targets (idempotent; per-path counts in the completion report).

### Endpoint (R5.2)

`GET /api/qa/pins/:pinId/comments` — idempotent, no auth.

| Param | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `sort` | `newest` \| `oldest` | No | `newest` | `newest` = createdAt desc, tie pinId asc; `oldest` = the reverse (chronological thread reading) |
| `size` | int | No | `20` | 1–50, clamped as usual |
| `cursor` | string | No | — | Opaque offset cursor over the ordered list; invalid → `40000` |

- `pinId` may be any version of a question, or an answer pin. Malformed → `40000`. Target not Q&A-indexed or hidden → `40400`.
- `data` shape: `{items: [comment item], nextCursor, hasMore}`.

Comment item:

```json
{
  "protocol": "paycomment",
  "pinId": "<txid>i0",
  "currentPinId": "<txid>i0",
  "targetPinId": "<txid>i0",
  "chainName": "mvc",
  "content": "Full comment body (markdown, capped at index time).",
  "contentType": "text/markdown",
  "publisher": { "globalMetaId": "…", "metaid": "…", "name": "…" },
  "createdAt": 1755000000,
  "isMempool": false
}
```

Note: full body, not a summary — comments are short and this endpoint is the only place to read them. Likes on comment pins are out of scope (the v1 rule "likes targeting pins outside the Q&A index are ignored" stays).

## 3. R6 — Cross-question answer listing: `GET /api/qa/answers`

### Endpoint

`GET /api/qa/answers` — idempotent, no auth.

| Param | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `publisher` | string | No | — | Filter by answer publisher `globalMetaId` **or** `metaid`, case-insensitive exact match (same semantics as the existing per-question filter). Omitted = all publishers ("newest answers on MetaWeb" feed) |
| `sort` | `newest` \| `top` | No | `newest` | `newest` = createdAt desc, tie pinId asc. `top` = `score` desc, tie newer first — the "best answers" tab of an author page |
| `size` | int | No | `10` | 1–50, clamped as usual |
| `cursor` | string | No | — | Opaque offset cursor; invalid → `40000` |

- Answers to hidden (revoked) questions are excluded, matching the v1 visibility rules. Orphan answers cannot exist (v1 already excludes them).
- `data` shape: `{items: [answer item], nextCursor, hasMore}`.

Answer item: **the existing answer item shape, plus an embedded parent question** (without it, author pages would need one detail call per row):

```json
{
  "protocol": "simpleanswer",
  "pinId": "<txid>i0",
  "currentPinId": "<txid>i0",
  "questionPinId": "<txid>i0",
  "question": { "pinId": "<txid>i0", "title": "How to recover a wallet…", "chainName": "mvc", "createdAt": 1755000000 },
  "chainName": "mvc",
  "summary": "First ~200 runes of the answer…",
  "tags": ["wallet"],
  "publisher": { "globalMetaId": "…", "metaid": "…", "name": "…" },
  "createdAt": 1755000100,
  "isMempool": false,
  "likeCount": 5, "dislikeCount": 1, "commentCount": 0,
  "score": 4
}
```

`question` is a light embed (title + identity of the question); the embedded question carries the same visibility guarantees as the row itself (a row is never served with a hidden parent).

### Author questions feed (R6.2)

Author pages also need the author's **questions** without keywords, and today that has no keyword-free route (`GET /api/qa/search` requires `q`). Add an optional `publisher` param to the existing feed endpoint — one-line additive change, no shape change:

- `GET /api/qa/questions` gains `publisher` (globalMetaId or `metaid`, case-insensitive exact match, same semantics as everywhere else), combinable with the existing `tags`/`minAnswers`/`maxAnswers`/`sort` params.

With R6.1 + R6.2 an author page is fully server-supported: questions tab (`/api/qa/questions?publisher=`), answers tab (`/api/qa/answers?publisher=`), best-answers tab (`/api/qa/answers?publisher=&sort=top`).

## 4. Non-functional requirements

- Same conventions as v1: `{code, data, message, processingTime}` envelope (HTTP 200 always), opaque cursors, error codes `40000/40400/50000`, no auth, permissive CORS.
- Freshness: comments and answers visible within one mempool relay.
- Performance: both endpoints p95 < 300 ms at the projected 12-month corpus; `sort=top` for R6 may precompute per-publisher orderings at index time if a scan is too slow — backend's call, wire format unchanged.

## 5. Deliverables (backend team)

1. `docs/specs/` contract docs for R5–R6 (request/response schemas, error cases, example payloads) — spec-first per project convention.
2. Implementation + unit tests; backfill extension for Q&A-targeted PayComment history with a per-path completion report.
3. Staging deployment with seeded example data (a question with a comment thread; an author with answers on several questions), then a production rollout notice to the IDBots team.

## 6. Open questions for the backend team

- Comment content cap at index time: 2000 runes suggested — acceptable, or store full bodies unbounded?
- Should the per-question detail endpoint (`GET /api/qa/questions/:pinId`) also embed the first comment page, or keep R5 strictly separate? Suggested: keep separate (the question page already embeds answers; comments load lazily in the UI).
- For R6 `sort=top` at scale: per-publisher precomputed ranking vs paged scan — trigger threshold?
- Any objection to the `/api/qa/pins/:pinId/comments` path shape (it intentionally serves both questions and answers)?
