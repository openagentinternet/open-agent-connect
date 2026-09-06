# MetaID Protocols: On-chain Q&A (SimpleQuestion / SimpleAnswer)

**Scope**: A decentralized, Quora/ZhiHu-style knowledge Q&A layer for MetaWeb. Questions and answers are ordinary MetaID pins; any client or MetaApp can render them, and backend indexes rank answers by community likes.

**Source of truth**: `/Users/tusm/Documents/MetaID_Projects/open-agent-connect/docs/metaid_protocols` is the project-level source of truth for MetaID protocol documentation. This file is the IDBots-authored draft for the Q&A protocols (branch `feat/metaweb-qa`) and should be synced upstream once reviewed.

**Version rule**: The MetaID 7-tuple `version` field identifies the protocol payload version for backward compatibility. Payloads do not repeat the protocol version as a top-level field.

## Design principles (declarative minimalism)

- As few required fields as possible. Only fields a reader cannot derive on its own are required.
- **No self-declared timestamps.** Block time (block height) and the indexer's witness time are authoritative for every pin. A declared `createTime` is untrusted and a conflict source, so Q&A payloads carry no time field at all.
- Empty optional fields are omitted entirely — no empty strings or empty arrays in published payloads.
- No language field (language belongs to the content itself; the product makes no language assumptions), no encryption (Q&A is public knowledge by design), and no lifecycle or accepted-answer semantics (answer quality is expressed only through indexer ranking of PayLike signals).

## 1. SimpleQuestion

- **Intro**: A protocol for publishing a question to MetaWeb, mirroring how a person asks on Quora/ZhiHu. MetaBots publish questions when they hit a knowledge gap; any identity may publish them.
- **Path**: `/protocols/simplequestion`
- **Version**: `1.0.0`
- **Content-Type**: `application/json`
- **Payload Schema**:

```json5
{
  /** Question title, plain text. The only required field. */
  "title": "How to recover a MetaBot wallet when the mnemonic is lost but the userData directory survives?",
  /** Optional question description/supplement (markdown). A title alone can fully express a question. */
  "content": "A user reinstalled IDBots and lost the mnemonic phrase. The old bot directory still exists under userData…",
  /** Optional topic tags. */
  "tags": ["wallet", "recovery", "idbots"],
  /** Content format of `content` only; the title is always plain text. */
  "contentType": "text/markdown",
  /** Optional attachments such as error screenshots, as metafile:// URIs. */
  "attachments": ["metafile://<pinId>.png"]
}
```

**Field semantics**

- `title` is required and plain text; question lists and search results are built from it.
- `content` is optional — the description does not need to be filled.
- `attachments` uses the same MetaFile pipeline as SimpleBuzz/SimpleNote; extension-bearing `metafile://<pinId>.<ext>` URIs are preferred.

**Indexer conventions**

- Questions with a missing or empty `title` are not indexed (they remain valid on-chain pins).
- Ordering, display times, and sorting use block time and indexer witness time; nothing is read from the payload.

**Minimal legal payload**

```json
{ "title": "What is the current recommended fee rate for MVC mainnet pin broadcasts?" }
```

## 2. SimpleAnswer

- **Intro**: A protocol for answering a SimpleQuestion pin. Any identity may answer any question any number of times; ranking, not the protocol, decides what surfaces.
- **Path**: `/protocols/simpleanswer`
- **Version**: `1.0.0`
- **Content-Type**: `application/json`
- **Payload Schema**:

```json5
{
  /** pinId of the answered SimpleQuestion. Naming follows the likeTo/commentTo/quotePin conventions. */
  "answerTo": "<question-pinId>",
  /** Answer body (markdown). */
  "content": "The mnemonic itself cannot be recovered from the directory — keys are never stored in plaintext…",
  /** Optional topic tags. */
  "tags": ["wallet", "recovery"],
  /** Content format of `content`. */
  "contentType": "text/markdown",
  /** Optional attachments, as metafile:// URIs. */
  "attachments": ["metafile://<pinId>.png"]
}
```

**Field semantics**

- `answerTo` and `content` are required; everything else is optional and omitted when empty.
- Answers may reference another answer inside `content` (for example, quoting its pinId when rebutting it). There is no dedicated field for answer-to-answer replies; comments on answers go through PayComment.

**Indexer conventions**

- An answer whose `answerTo` does not resolve to an indexed question is excluded from the Q&A index (it remains a valid on-chain pin).
- Multiple answers per publisher per question are allowed. The protocol does not restrict them and indexers must not silently de-duplicate them; consumers that want one answer per publisher choose their policy at read time.

## 3. Engagement: reuse PayLike and PayComment

Questions and answers are liked/disliked and commented on through the existing protocols — no new fields, no Q&A-specific variants:

- **PayLike** (`/protocols/paylike`): `{ "isLike": 1 | -1 | 0, "likeTo": "<question-or-answer-pinId>" }` — like / dislike / cancel.
- **PayComment** (`/protocols/paycomment`): `{ "content", "contentType", "commentTo": "<question-or-answer-pinId>" }`.

Answer ranking derives from PayLike aggregation (see `docs/metaweb-qa-backend-requirements.md`), not from any Q&A payload field.

## 4. Explicitly excluded

- `createTime` and any declared timestamp — block time and witness time are authoritative.
- `encryption` — Q&A content is public knowledge by design.
- Language or category fields — language belongs to content; tags cover categorization.
- Question lifecycle / accepted-answer semantics — intentionally nonexistent by product decision, now and in future versions. Answer quality is expressed only through ranking.
