# DSH Memory, Dream & Twin-Bot System Design

**Date:** 2026-08-20
**Branch:** `dsh-memory-twinbot`
**Status:** Draft for review

## 1. Goal

Port the IDBots persona/memory stack to the DSH (DeepSeek Harness) host as a
suite of OAC-backed plugins, so that DSH agents stop feeling like tools and
start feeling like Bots with a personality:

1. **Memory system** — scoped facts, time-anchored diary, person-anchored
   impressions, topic-anchored knowledge, all recalled automatically during
   daily conversations (user chats, A2A private chats).
2. **Dream system** — every night each Bot reviews its day, writes a diary,
   distills value boundaries and knowledge, updates person impressions, and
   evolves its self-identity; later conversations align with that
   self-cognition.
3. **Twin/Worker system** — one Twin Bot per machine acts as the owner's
   chief-of-staff: the owner talks to the Twin, the Twin decomposes work and
   delegates to local Worker Bots, supervises, and reports back.
4. **User model** — a Settings user panel showing the local MetaBot identity,
   plus owner ("master") binding between the local user and each Bot.

Hard constraints approved by the product owner:

- **File storage, not SQLite.** All memory data lives under the MetaBot
  profile (`~/.metabot/profiles/<slug>/`) following the storage layout v2
  spec. Human-readable artifacts are Markdown; machine-managed indexes are
  JSON. The v2 spec document is amended before implementation (its own
  governance rule).
- **Capability core stays in the MetaBot CLI/daemon.** The dsh-plugin host
  half only talks to `metabot` via CLI verbs; scheduling, DSH-session
  injection, tool bridging and UI live in the plugin.
- **Cordis plugins, well decomposed.** One npm package
  (`open-agent-connect-dsh`), multiple internal Cordis sub-plugins connected
  by service seams, each individually useful and independently disableable.
- **UI visually indistinguishable from DSH built-in components** (consume
  `--dsw-alias-*` design tokens; i18n through `ctx.locale`, English +
  Simplified Chinese in sync).
- **Twin → local Worker delegation runs as DSH-local sub-sessions**
  (`ctx.agents.create` + `agentPresets.mount`), not on-chain A2A.

Out of scope for this round (explicitly deferred): group tasks / Bot Hub,
cross-bot memory grants (IDBots ships it disabled by default), on-chain
signed `/info/owner` binding pins (local binding only this round), and any
SQLite use.

## 2. Source system: what IDBots does

Full research notes were gathered from the IDBots checkout at
`/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots`. The memory system is
four subsystems sharing one database, with the dream service as the hub
writing into all four. There are **no embeddings/vector stores anywhere** —
retrieval is keyword scoring + recency; this keeps the port cheap.

### 2.1 Scoped flat facts — `user_memories`

Source: `src/main/sqliteStore.ts:397-433`, `src/main/memory/memoryScope.ts`.

- Scope axis: `owner` (`owner:self`) | `contact`
  (`<channel>:peer:<globalMetaId>`) | `conversation`
  (`<channel>:conversation:<externalConversationId>`).
- Usage class: `profile_fact` | `preference` | `operational_preference` |
  `self_identity` | `work_review` | `value_boundary`.
- Visibility: `local_only` | `external_safe` (only `operational_preference`
  may be `external_safe`; external sessions read at most 3 of those, never
  owner profile facts — this is the privacy boundary).
- Origin: `conversation` | `dream`. Status: `created` | `stale` | `deleted`
  (soft delete only).
- Dedup on write: sha1 fingerprint of normalized text, else near-duplicate
  merge at similarity ≥ 0.82 (phrase ratio + token overlap + char-bigram
  Dice, `coworkStore.ts:237-257`).
- `self_identity` rows are protected: only the dream service may write them.

### 2.2 Time-anchored memory — daily summaries + experience timeline

Source: `src/main/dreamStore.ts`, `src/main/metaidExperienceStore.ts`.

- `metabot_daily_summaries`: one row per Bot per date — diary text, sections
  (`human|a2a|orders|tasks|group_tasks`), stats, session refs.
- `metaid_experience_episodes` + `participants` + `evidence`: real-time
  recorded timeline of interactions keyed by owner GlobalMetaID; evidence
  stores hashes/refs, not raw private text.

### 2.3 Person-anchored memory — impressions

Source: `src/main/metaidImpressionStore.ts`.

- Observations (append-only, dream-written, supersede chains) and one
  snapshot per (observer, subject) GlobalMetaID pair: summary, style
  descriptors, cooperation context, relationship temperature
  (`warming|stable|cooling`), communication guidance, uncertainty.
- Persons are keyed by GlobalMetaID only; names/avatars are display metadata,
  never identity keys.

### 2.4 Topic-anchored memory — knowledge points

Source: `src/main/metaidKnowledgeStore.ts`.

- Entries keyed by (Bot, topic fingerprint): `know_how | pitfall | principle`,
  category, tags, version; upsert bumps version and archives the prior
  revision.

### 2.5 Dream service

Source: `src/main/services/dreamService.ts`, `src/main/libs/dreamPrompt.ts`
(`DREAM_VERSION = 8` there; we start at 1).

- 60 s tick; nightly window 00:00–06:00 local with a deterministic per-Bot
  stagger (`(id * 13) % 240` minutes); missed nights are caught up
  immediately at any time of day; lookback 7 days; failed runs retry with
  bounded exponential backoff (30 min → 6 h).
- Activity gathering per Bot per day: human chats, A2A chats, group task
  activity, orders, scheduled tasks, impression candidates (day's episodes
  grouped by counterparty), existing knowledge topics.
- Two-pass map/reduce for long days (fragment prompts → cached fragments →
  synthesis prompt); single prompt otherwise.
- One LLM JSON output: `daily_summary`, `sections`, `work_reviews`,
  `important_memories`, `value_lessons`, `impression_updates`,
  `knowledge_points`, `self_identity` (200–600 chars, forward-in-time only).
- Writes are **per-date idempotent batches**: re-dreaming a date replaces
  that date's dream batch (soft-delete then rewrite); self-identity never
  regresses; impressions rebuild snapshots; knowledge upserts by topic.
- Empty day → no LLM call, run recorded completed.

### 2.6 Retrieval at conversation time

Source: `src/main/memory/memoryPromptBlocks.ts`,
`src/main/libs/experiencePromptBlocks.ts`,
`src/main/libs/coworkRunner.ts` (`buildVolatileContextPrompt`),
`src/main/memory/memoryScopeResolver.ts`.

- Memory/experience blocks are appended to the **current user message tail**,
  never the stable system head (preserves LLM prefix caching).
- Scoring: base 1; +3 per current-user-text token (≥2 chars) found as a
  substring in the memory text; +6 if the whole user text is contained; sort
  desc, cap 12 per block; global char budget 12000 with oldest-first eviction
  by `lastUsedAt ?? updatedAt`, never evicting the top entry.
- Injected blocks: `<ownerMemories>` / `<contactMemories>` /
  `<conversationMemories>` / `<ownerOperationalPreferences>`,
  `<metabot_self_identity>` + alignment instruction, `<value_boundaries>`
  (≤5), `<work_reviews>` (≤5, group-task path only), `<recent_daily_summaries>`
  (7 days, ≤2000 chars), `<knowledge>` (≤8 items, 2400 chars), person-anchor
  `<metaid_cognition_context>` for A2A 1:1.
- Per-turn automatic writes: regex extractor (explicit `记住…` /
  `remember this…` commands → confidence 0.99; implicit profile/ownership/
  preference signals → 0.86–0.93; ≤2 implicit adds per turn) plus an
  optional LLM judge for borderline candidates (guard levels
  strict 0.85 / standard 0.65 / relaxed 0.5).
- Model-facing tools: `memory_user_edits` (list/add/update/delete),
  `experience_recall`, `knowledge_recall`, `knowledge_upsert`,
  `conversation_search`, `recent_chats`.

### 2.7 Twin/Worker system

Source: `docs/twin-bot-orchestration.md`, `src/main/metabotStore.ts`,
`src/main/services/twinOrchestrationService.ts`,
`src/main/services/twinWorkerDirectoryService.ts`,
`src/main/libs/coworkRunner.ts:4489-4547`.

- `metabot_type: twin | worker`; at most one twin per machine
  (promote demotes the previous twin; `ensureTwinExists()` repairs after
  delete); twin tools are authorized host-side from session→bot attribution,
  never from prompt text.
- Twin-only tools: `local_workers_list` (sanitized roster with persona,
  skills, capability evidence, availability), `local_worker_delegate`
  (bounded step + acceptance criteria + permission scope + idempotency key),
  `twin_task_status/cancel/reassign`, `worker_session_stop`, plus
  `metabot_manage` (list/create/update/delete bots).
- Delegation = spawn a fresh worker session with a fixed worker system
  prompt and a `<twin_delegation>` user-message wrapper; completion inserts
  `[ORCH-NOTIFY] …` into the Twin's session to wake it for review.
- Twin orchestration overlay prompt (verbatim at
  `coworkRunner.ts:4489-4508`) is host-injected, not part of the editable
  persona, so a Worker cannot promote itself by editing bio/soul.

### 2.8 User model

Single local user identity per device; each Bot records
`boss_global_metaid` (owner) — used for twin authorization and display.
IDBots additionally publishes a signed `/info/owner` pin; this round we keep
the binding local only (see §1 out-of-scope).

### 2.9 Settings UI to mirror

`src/renderer/components/settings/MemorySettings.tsx`: Bot selector
(defaults to twin), policy card (enabled, implicit updates, guard level, LLM
judge, max items), self-identity card (read-only), four tabs —
**Knowledge / Contacts / Facts / Dream** (diary with per-date expandable
sections + manual "run dream"). `src/renderer/components/user/UserSettings.tsx`
for the user panel reference.

## 3. Target architecture

```
DSH web GUI
└─ open-agent-connect-dsh (one npm package, dual-face)
   ├─ client half (Cordis, slots/locale)
   │   ├─ settings.section "oac-memory"  → MemoryPanel (bot selector, policy,
   │   │                                   self-identity, Knowledge/Contacts/
   │   │                                   Facts/Dream tabs)
   │   ├─ settings.section "oac-user"    → UserPanel (identity, owner bindings)
   │   └─ Bots panel additions           → twin badge, owner binding status
   └─ host half (Cordis sub-plugins, mounted by root apply)
       ├─ oac-memory-store   provides ctx.oacMemory — typed facade over the
       │                     metabot CLI memory/dream/twin verbs (only module
       │                     that spawns CLI for memory)
       ├─ oac-memory-inject  agent/pre-step memory injection + session/event
       │                     post-turn extraction + transcript mirroring
       ├─ oac-memory-tools   per-agent DSH tools (memory_user_edits,
       │                     experience_recall, knowledge_*, recent_chats,
       │                     conversation_search)
       ├─ oac-dream          nightly scheduler (ctx.interval) driving CLI
       │                     dream runs; LLM via ctx.llm
       ├─ oac-twin           twin-only tools + local delegation orchestration
       │                     (ctx.agents.create + agentPresets.mount)
       └─ oac-user           /oac/api/user/* routes (identity, bindings)

metabot CLI / daemon (OAC core, this repo src/)
   ├─ src/core/memory/*      stores, extractor, prompt blocks, dream pipeline
   ├─ src/cli/commands/      memory, dream, twin verb groups; bot type/owner
   ├─ src/daemon/            A2A auto-reply memory injection + experience
   │                         recording
   └─ ~/.metabot/profiles/<slug>/  file storage (see §4)
```

Layering rules:

- The plugin never reads or writes `~/.metabot` directly; it calls CLI verbs.
- The CLI owns all storage, write semantics, idempotency, dedup, scope
  privacy rules, and the dream write pipeline.
- The plugin owns scheduling, DSH-session integration (injection, tools,
  delegation execution), and UI.
- Other hosts (Codex, Claude Code, …) can later consume the same CLI verbs.

## 4. Storage design (amends storage layout v2)

The v2 spec (`2026-04-23-metabot-storage-layout-v2-design.md`) already
contracts `MEMORY.md` and `memory/YYYY-MM-DD.md` but nothing reads/writes
them today, and `DREAMS.md` is explicitly unstandardized. The spec document
gets an amendment section (Phase 0) adding:

### 4.1 Workspace layer additions (human-readable, profile root)

```text
profiles/<slug>/
  memory/
    YYYY-MM-DD.md        # daily dream diary (dream-written; replaces the
                         # "rolling notes" contract with concrete content)
    self-identity.md     # the Bot's dream-evolved self-cognition
                         # (forward-in-time only; not hand-edited by tools)
```

- `memory/YYYY-MM-DD.md` format: front-matter-free Markdown —
  `# <date> Dream Diary`, the diary text, then `## Human` / `## A2A` /
  `## Tasks` … sections as present, then a `## Stats` block. Regenerated
  wholesale when the date is re-dreamed.
- `memory/self-identity.md` holds only the current self-identity text. Its
  "latest dream date" metadata lives in `dream-runs.json`; writes for older
  dates are refused (forward-only rule).
- `MEMORY.md` stays human-curated; the memory system never overwrites it.
  (The bot-facing curated facts live in the structured store below.)

### 4.2 Runtime layer additions (machine-managed JSON, `.runtime/memory/`)

```text
profiles/<slug>/.runtime/memory/
  memories.json          # scoped fact memories (§5.1)
  knowledge.json         # knowledge entries + revisions (§5.2)
  impressions.json       # person-anchored observations + snapshots (§5.3)
  experience.json        # episode/evidence timeline ledger (§5.4)
  dream-runs.json        # dream idempotency anchor + retry state (§5.5)
  policy.json            # per-Bot memory/dream policy override (§5.6)
  orchestration.json     # twin delegation tasks/steps (§5.7)
  transcripts/<sid>.jsonl  # mirrored DSH session turns (§5.8)
```

Rules:

- All writes are atomic (write `.tmp` then rename), matching existing
  `.runtime/state/*.json` conventions.
- Caps from IDBots are preserved: memory text ≤360 chars (self-identity
  ≤1200), knowledge summary ≤4000, impression texts ≤4000/2000; files stay
  small by design (soft-deleted rows may be compacted on rewrite).
- New path constants are added to `MetabotPaths` in
  `src/core/state/paths.ts` — all code resolves paths from that model.

## 5. Data models (JSON)

### 5.1 `memories.json`

```jsonc
{
  "version": 1,
  "entries": [
    {
      "id": "mem_<ulid>",
      "text": "…",                       // ≤360 chars
      "fingerprint": "sha1:<hex>",        // sha1 of normalized match key
      "confidence": 0.75,
      "isExplicit": false,
      "status": "created",                // created|stale|deleted
      "scopeKind": "owner",               // owner|contact|conversation
      "scopeKey": "owner:self",           // e.g. metaweb_private:peer:<gmid>
      "usageClass": "profile_fact",       // profile_fact|preference|
                                          // operational_preference|
                                          // self_identity|work_review|
                                          // value_boundary
      "visibility": "local_only",         // local_only|external_safe
      "origin": "conversation",           // conversation|dream
      "dreamDate": "2026-08-20",          // only for origin=dream
      "sources": [ { "sessionId": "…", "channel": "…", "messageId": "…",
                     "dreamDate": "…", "isActive": true,
                     "createdAt": 0 } ],
      "createdAt": 0, "updatedAt": 0, "lastUsedAt": 0
    }
  ]
}
```

Port of `user_memories` + `user_memory_sources`. Write semantics (dedup,
revive, merge, near-duplicate 0.82, protected `self_identity`, per-date dream
batch replace, orphan→stale) are ported 1:1 from `coworkStore.ts`.

### 5.2 `knowledge.json`

```jsonc
{ "version": 1,
  "entries": [ { "id": "kn_<ulid>", "topic": "…", "topicFingerprint": "…",
      "summary": "…", "kind": "know_how|pitfall|principle",
      "category": "…?", "tags": ["…"], "confidence": 0.75,
      "status": "active|superseded|archived",
      "origin": "agent|dream|user", "sourceDreamDate": "…?",
      "version": 3, "revisions": [ { "version": 2, "summary": "…",
        "archivedAt": 0 } ],
      "createdAt": 0, "updatedAt": 0, "lastUsedAt": 0 } ] }
```

### 5.3 `impressions.json`

```jsonc
{ "version": 1,
  "observations": [ { "id": "obs_<ulid>", "subjectGlobalMetaId": "…",
      "observation": "…", "interpretation": "…",
      "dimensions": { "styleDescriptors": ["…"], "cooperation": "…" },
      "communicationGuidance": "…",
      "confidence": { "level": "low|medium|high", "uncertainty": "…" },
      "dreamDate": "…", "dreamVersion": 1,
      "idempotencyKey": "…",                 // unique
      "supersedesObservationId": "…?",
      "status": "active|superseded|rejected",
      "episodeIds": ["…"], "evidenceIds": ["…"],
      "createdAt": 0 } ],
  "snapshots": [ { "subjectGlobalMetaId": "…",     // one per subject
      "firstSeenAt": 0, "lastSeenAt": 0, "interactionCount": 0,
      "directInteractionCount": 0,
      "summary": "…", "styleDescriptors": ["…"],
      "cooperationContext": "…",
      "relationshipTemperature": "warming|stable|cooling",
      "communicationGuidance": "…", "uncertainty": "…",
      "latestObservationId": "…", "snapshotVersion": 1,
      "updatedAt": 0 } ] }
```

### 5.4 `experience.json`

```jsonc
{ "version": 1,
  "episodes": [ { "id": "ep_<ulid>",
      "episodeType": "direct_interaction|task_participation|service_order|
                      scheduled_task|public_pin_observation|
                      third_party_reference",
      "sourceChannel": "dsh|metaweb_private|…",
      "sourceKey": "…",                     // unique with sourceChannel
      "sessionId": "…?", "externalConversationId": "…?",
      "participants": [ { "globalMetaId": "…?" ,
                          "unresolvedActorKey": "…?",
                          "identityState": "known|unknown",
                          "role": "…" } ],
      "evidence": [ { "evidenceType": "message|pin|…", "sourceKey": "…",
                      "pinId": "…?", "messageId": "…?",
                      "contentHash": "sha1:<hex>" } ],
      "status": "open|completed|failed|abandoned",
      "createdAt": 0, "updatedAt": 0 } ] }
```

### 5.5 `dream-runs.json`

```jsonc
{ "version": 1,
  "runs": [ { "dreamDate": "2026-08-19",        // unique per Bot
      "status": "running|completed|failed",
      "dreamVersion": 1, "attemptCount": 1,
      "nextRetryAt": 0, "error": "…?",
      "llm": { "provider": "…", "model": "…" },
      "selfIdentityWritten": true,
      "startedAt": 0, "completedAt": 0 } ],
  "fragments": [ { "dreamDate": "…", "fragmentKey": "…",
      "contentHash": "sha256:<hex>", "summary": "…" } ] }
```

### 5.6 `policy.json`

Per-Bot override; absent file = global defaults from
`.runtime/config.json` keys (new) or built-in defaults:

```jsonc
{ "memoryEnabled": true, "memoryImplicitUpdateEnabled": true,
  "memoryLlmJudgeEnabled": false, "memoryGuardLevel": "standard",
  "memoryUserMemoriesMaxItems": 12,           // clamp 1..60
  "memoryPromptMaxChars": 12000,              // clamp 2000..65536
  "dreamEnabled": true }
```

### 5.7 `orchestration.json`

```jsonc
{ "version": 1,
  "tasks": [ { "id": "task_<ulid>", "twinSlug": "…", "ownerGlobalMetaId": "…",
      "title": "…", "goal": "…", "intent": "…?",
      "status": "planning|running|review|completed|failed|cancelled",
      "steps": [ { "id": "step_<ulid>", "workerSlug": "…",
          "objective": "…", "acceptanceCriteria": ["…"],
          "permissionScope": { "…" }, "idempotencyKey": "…",  // unique
          "status": "blocked|ready|queued|running|waiting_input|completed|
                     failed|cancelled",
          "attempts": [ { "id": "att_<ulid>", "dshSessionId": "…?",
              "status": "queued|running|completed|failed|timed_out|cancelled",
              "handoff": "…?", "startedAt": 0, "endedAt": 0 } ] } ],
      "createdAt": 0, "updatedAt": 0 } ] }
```

### 5.8 Transcripts

`.runtime/memory/transcripts/<sessionId>.jsonl`, one JSON per line:

```jsonc
{ "turn": 3, "role": "user|assistant", "text": "…", "ts": 0,
  "channel": "dsh", "peerGlobalMetaId": "…?" }
```

Appended by the plugin's post-turn observer via
`metabot memory transcript append`. Powers `recent_chats` /
`conversation_search` and dream activity gathering for DSH-local sessions.
A2A transcripts already live in `.runtime/A2A/chat-*.json` and are read
directly.

## 6. OAC core work (`src/`)

### 6.1 New module `src/core/memory/`

Each file ports the named IDBots source, swapping SQLite rows for the §5
JSON stores. All stores take `MetabotPaths` and follow existing core-store
conventions (normalize-on-read, atomic write, type guards).

| File | Ports from IDBots | Responsibility |
|---|---|---|
| `memoryTypes.ts` | `memory/memoryScope.ts` | Scope/usage/visibility/origin types, scope-key builders & parsers, guards |
| `memoryStore.ts` | `coworkStore.ts` memory methods | CRUD, fingerprint dedup, near-dup merge (0.82), soft delete, stale marking, per-date dream batch replace, protected self-identity, text caps |
| `memoryPromptBlocks.ts` | `memory/memoryPromptBlocks.ts` | relevance scoring (+3/token, +6 full match), 12/block cap, char-budget eviction, `<ownerMemories>` etc. XML builders |
| `experiencePromptBlocks.ts` | `libs/experiencePromptBlocks.ts` | `<metabot_self_identity>` (+instruction), `<value_boundaries>`, `<work_reviews>`, `<recent_daily_summaries>`, `<knowledge>` blocks |
| `memoryScopeResolver.ts` | `memory/memoryScopeResolver.ts` | channel→scope resolution; external sessions read only `operational_preference`+`external_safe` owner entries (max 3) |
| `memoryExtractor.ts` | `libs/coworkMemoryExtractor.ts` | per-turn regex extraction (explicit 0.99, implicit 0.86–0.93, ≤2/turn) |
| `memoryJudge.ts` | `libs/coworkMemoryJudge.ts` | optional LLM judge for borderline candidates (guard thresholds, 5 s timeout, 10 min cache) |
| `knowledgeStore.ts` | `metaidKnowledgeStore.ts` | topic-fingerprint upsert, revisions |
| `impressionStore.ts` | `metaidImpressionStore.ts` | observations append + snapshot rebuild |
| `experienceStore.ts` | `metaidExperienceStore.ts` | episodes/evidence ledger |
| `dreamStore.ts` | `dreamStore.ts` | daily-activity gathering (transcripts + `.runtime/A2A/*.json` + experience ledger), diary persistence, fragment cache |
| `dreamPrompt.ts` | `libs/dreamPrompt.ts` | prompt templates (verbatim port), due-date algorithm, stagger, budgets; `DREAM_VERSION = 1` |
| `dreamService.ts` | `services/dreamService.ts` | prepare/plan → LLM → parse → `writeDreamResults` semantics (batch replace, forward-only identity, impression/knowledge apply); empty-day short-circuit |
| `twinService.ts` | `metabotStore.ts` twin parts, `twinWorkerDirectoryService.ts` | one-twin invariant (promote demotes, repair on delete), twin authorization, sanitized worker roster builder |
| `orchestrationStore.ts` | `orchestrationStore.ts` | tasks/steps/attempts state machine + idempotency keys |

The dream LLM call is a **dependency-injected `chatCompletion` function**:
`runDream` receives a `complete(systemPrompt, userPrompt) => Promise<string>`.
Two providers of that function exist:

- **Standalone/daemon**: OAC LLM executor via the Bot's primary LLM binding
  (`llmBindingStore` + `llmRuntimeResolver`), for non-DSH environments.
- **DSH**: the dsh-plugin host supplies it through the split verb pair
  `dream plan` / `dream commit` (see §6.2), with `ctx.llm.stream()` as the
  transport. This keeps storage and write semantics in the CLI while using
  the provider the user actually configured in DSH.

### 6.2 CLI verbs

New group `metabot memory` (all JSON envelopes, `--from <slug>` scoped):

| Verb | Purpose |
|---|---|
| `memory list --from <s> [--scope-kind --scope-key --usage-class --status --query --limit]` | list entries |
| `memory add --from <s> --payload-file {text, scopeKind?, scopeKey?, usageClass?, visibility?, confidence?, isExplicit?, allowProtected?}` | create/revive/merge |
| `memory update --from <s> --payload-file {id, text?, confidence?, status?, usageClass?, visibility?}` | update |
| `memory delete --from <s> --payload-file {id}` | soft delete |
| `memory blocks --from <s> --payload-file {channel?, peerGlobalMetaId?, conversationId?, userText?}` | returns the assembled injection XML (scoped memories + experience blocks) — single read API for DSH injection and A2A auto-reply |
| `memory extract --from <s> --payload-file {userText, assistantText, channel?, peerGlobalMetaId?, sessionId?}` | runs extractor (+judge if enabled), applies writes, returns applied changes |
| `memory policy get/set/delete --from <s> [--payload-file]` | per-Bot policy |
| `memory knowledge list/upsert/delete --from <s> [--payload-file]` | knowledge CRUD |
| `memory impressions list --from <s>` / `memory impressions show --from <s> --subject <gmid>` | person-anchor reads |
| `memory recall --from <s> --payload-file {query?, dateFrom?, dateTo?, granularity?, limit?}` | experience/diary recall (`experience_recall` backend) |
| `memory transcript append --from <s> --payload-file {sessionId, turn, role, text, ts, channel, peerGlobalMetaId?}` | mirror one DSH turn |
| `memory chats --from <s> [--limit --cursor]` / `memory search --from <s> --payload-file {query, maxResults?, before?, after?}` | `recent_chats` / `conversation_search` backends over transcripts + A2A stores |

New group `metabot dream`:

| Verb | Purpose |
|---|---|
| `dream due --from <s>` | list due/repair dream dates (window/stagger/backoff logic lives here) |
| `dream status --from <s>` | runs table + latest diary date |
| `dream plan --from <s> --date <YYYY-MM-DD>` | gather activity, build (fragmented) prompt, persist run as `running`; returns `{systemPrompt, userPrompt, parseSpec}` |
| `dream commit --from <s> --payload-file {dreamDate, output}` | parse + validate + `writeDreamResults`; idempotent per date |
| `dream run --from <s> [--date]` | plan + LLM (OAC executor binding) + commit in one shot, for standalone hosts |
| `dream summaries --from <s> [--limit --before]` | diary list for UI |
| `dream self-identity --from <s>` | current self-identity text |

Bot profile extensions (`metabotProfileManager`, `bot create/update/show/list`):

- `botType: 'twin' | 'worker'` (default `worker`); create/promote to `twin`
  demotes the previous twin; deleting the twin promotes the earliest worker;
  `bot show/list` expose the field. Stored following the existing
  `dshLlm*` field precedent.
- `ownerGlobalMetaId` (nullable) + `bot bind-owner --from <s> [--owner <gmid>]`
  / `--unbind`; defaults offered from `metabot identity who`.

New group `metabot twin`:

| Verb | Purpose |
|---|---|
| `twin workers --from <twinSlug>` | sanitized local worker roster (persona summary, skills, availability, active workload, capability evidence from recent diaries) |
| `twin tasks create/list/show/update --from <twinSlug> [--payload-file]` | orchestration bookkeeping (create task+steps, record attempt state, handoff, terminal states) |

### 6.3 Daemon changes (A2A auto-reply memory integration)

In `src/core/chat/privateChatAutoReply.ts` (prompt assembly at `:779`/`:1167`
where `loadChatPersona` + recent messages are gathered):

1. Before the LLM call: call the memory module (same code as
   `memory blocks`) with `channel='metaweb_private'`, the peer's
   GlobalMetaID, and the latest inbound text; append the returned XML as the
   final prompt-context section. Scope rules guarantee only contact-scope +
   `external_safe` operational preferences are included.
2. After the reply: run `memoryExtractor` over the exchange (contact write
   scope), and record an experience episode + evidence hashes
   (`experienceStore`).
3. Gated by the Bot's memory policy (`memoryEnabled`), default on.

## 7. dsh-plugin work (`dsh-plugin/`)

One package, seven internal Cordis plugin modules. Root `apply()` mounts
them with `ctx.plugin(...)`; config toggles (schemastery `Config`) gate each:
`memory`, `memoryInjection`, `memoryTools`, `dream`, `twin`, `user` — all
default enabled. Inter-plugin seam: `ctx.provide('oacMemory', facade)` in
`oac-memory-store`; consumers declare `inject: ['oacMemory', …]`. Typing
follows the existing `src/context-types.ts` restated-structural-types
pattern.

### 7.1 `src/plugins/memory-store.ts` (host)

- Provides `ctx.oacMemory`: typed async facade over every §6.2 verb, built on
  the existing `runMetabot`/`runMetabotWithPayloadFile` bridge.
- Registers `/oac/api/memory/*`, `/oac/api/dream/*`, `/oac/api/twin/*`
  routes (same trust fence, envelope passing, and error mapping as
  `sections.ts`).

### 7.2 `src/plugins/memory-inject.ts` (host)

- **Per-turn injection**: `ctx.on('agent/pre-step', …, { prepend: true })`;
  filter `ctx.agentPresets.composedPreset(agent.ctx)` for `oac-*` → derive
  slug → `oacMemory.blocks({ slug, channel: 'dsh', userText })` where
  `userText` is extracted from `decision.messages` → append one plugin-sourced
  user message (`source: { kind: 'plugin', plugin: 'oac-dsh', form:
  'snapshot' }`) at the tail, exactly the `time-context` pattern
  (`packages/context/time-context/src/index.ts:170-208`). Logged by the loop
  itself, satisfying "model-visible ⟺ logged".
- **Post-turn extraction + transcript mirror**: `ctx.on('session/event', …)`
  watching `turn/end` (reason `completed`) for `oac-*` sessions; slice the
  turn's `user/message` + `assistant/message` events →
  `oacMemory.transcriptAppend(...)` per message + `oacMemory.extract(...)`
  once per turn. Async fire-and-forget with a per-session queue; failures
  logged, never thrown into the loop.
- **Memory Strategy prompt**: a static `agent.ctx.systemPrompt.section`
  (`order` in the tool-guidance band) for `oac-*` agents, registered on
  `agent/created`, teaching when to call the memory tools (ported from
  `coworkRunner.ts:4401-4426`).

### 7.3 `src/plugins/memory-tools.ts` (host)

On `agent/created` for `oac-*` presets, `agent.ctx.tools.register(...)`:

- `memory_user_edits` (list/add/update/delete → CLI verbs; add in owner
  scope, `isExplicit` honored)
- `experience_recall` (→ `memory recall`)
- `knowledge_recall`, `knowledge_upsert` (→ `memory knowledge …`)
- `recent_chats`, `conversation_search` (→ `memory chats` / `memory search`)

Tool names, parameters, and limits are ported 1:1 from
`coworkRunner.ts:6920-7229` so prompt guidance stays valid.

### 7.4 `src/plugins/dream.ts` (host)

- `ctx.interval(tick, config.dream.tickMinutes * 60_000)` (default 10 min).
- Each tick: `metabot bot list` → for each Bot with `dreamEnabled`:
  `dream due` → for each due date (window/catch-up/backoff decided CLI-side):
  `dream plan` → `ctx.llm.stream()` with the Bot's configured DSH
  provider/model (`dshLlmProvider`/`dshLlmModel` from `bot show`, falling
  back to the session default) → assemble full text → `dream commit`.
- Serial execution per Bot, one Bot at a time globally; progress/errors are
  written through `dream commit` and surface in the Dream tab.

### 7.5 `src/plugins/twin.ts` (host)

- Twin-only tools on `agent/created`: registered only when the session's Bot
  is the current twin (`bot show` → `botType === 'twin'` + owner binding
  matches local identity, re-validated at execution time):
  - `local_workers_list` → `metabot twin workers`.
  - `local_worker_delegate` → orchestration `tasks create`, then execute:
    `ctx.agents.create({ meta: { agentPreset: 'oac-<worker>' }, setup:
    (childCtx) => childCtx.agentPresets.mount(childCtx, 'oac-<worker>') })`,
    `child.followup(<twin_delegation> wrapper)`, `child.whenIdle()`, collect
    `finalAssistantOutput(child.session.events)` as the handoff; timeout via
    `AbortSignal.timeout(config.twin.stepTimeoutMs)` (default 300 s, the
    IDBots watchdog value). Attempt state recorded via `twin tasks update`.
  - `twin_task_status`, `twin_task_cancel` → `twin tasks …`.
  - `worker_session_stop` → cancel the attempt's abort controller.
- **ORCH-NOTIFY**: on terminal attempt state, locate the Twin's live agent
  (registry scan for the twin preset) and `agent.followup()` a user message
  `[ORCH-NOTIFY] worker <name> 已完成 task <title> → review，请验收`
  (failure variant likewise), idempotent per attempt. If no twin session is
  live, the notification is pending in `orchestration.json` and delivered on
  the twin's next `agent/created`.
- **Twin overlay prompt**: static `systemPrompt.section` for the twin preset
  only (ported verbatim from `coworkRunner.ts:4489-4508`), plus the dynamic
  `## Local Worker Roster` block appended by the injection module for twin
  sessions, plus twin's distilled impressions-of-workers block (from
  `impressions.json`).
- Worker system prompt for delegated sessions: a preset-level persona
  amendment is NOT used; instead the delegation user message carries the
  `<twin_delegation>` wrapper ported verbatim from
  `twinOrchestrationService.ts:115-136`, and the worker preset's own persona
  stays intact.

### 7.6 `src/plugins/user.ts` (host) + routes

The User panel manages the local human **owner** identity (the person who
talks to the Bots), not a Bot. It is backed by the OAC `metabot user` CLI
group and the `src/core/owner/ownerIdentity.ts` store
(`~/.metabot/owner/identity.json`, mode 0600, holds the mnemonic; see the
storage-layout spec `owner/` section):

- `/oac/api/user/who` → `metabot user who` (public fields only).
- `/oac/api/user/create` → `metabot user create --name` (fresh mnemonic).
- `/oac/api/user/import` → `metabot user import --mnemonic [--name] [--path]`.
- `/oac/api/user/rename` → `metabot user rename --name`.
- `/oac/api/user/reveal` → `metabot user reveal` (backup view).
- `/oac/api/user/delete` → `metabot user delete` (logout).
- `bot bind-owner` (no `--owner`) now defaults the owner to this identity's
  GlobalMetaID, falling back to the active Bot identity.

### 7.7 Client half

- **`oac-memory` Settings section** (`order: 21`, between `oac-bots` 20 and
  `oac-apps` 23): Bot selector (defaults to the twin), policy card
  (collapsible; per-Bot override vs global default; master switch; implicit
  updates; guard level; LLM judge; max items), self-identity card
  (read-only), and four underline tabs mirroring IDBots:
  - **Knowledge** — kind filter, search, inline edit, delete.
  - **Contacts** — person list (GlobalMetaID-anchored, display name from
    sessions), detail view with that person's impression snapshot + facts.
  - **Facts** — owner-scope memories: search, stats, add/edit modal (usage
    class + visibility rules enforced), delete; `self_identity` rows
    protected in UI.
  - **Dream** — diary entries per date with expandable sections/stats,
    failed runs with retry, date-picker "Run dream now"
    (`dream run --date`).
- **`oac-user` Settings section** (`order: 22`): the local human owner
  identity, IDBots-style state machine — empty (create / import), create
  (name), import (name + mnemonic + optional derivation path), backup
  (numbered mnemonic grid + copy + "I've backed it up"), and profile
  (editable name, read-only GlobalMetaID/MVC/MetaID/created with copy,
  "Backup mnemonic" reveal modal, "Log out" delete with confirmation). No
  Bot binding list.
- **Bots panel additions**: a filled "Twin" badge on the twin tile, and a
  "Twin Bot" switch on the Bot edit page Basic tab. The one-twin invariant
  (promote demotes the previous twin; demote re-promotes the earliest
  remaining Bot) is enforced by the daemon, so the switch never leaves zero
  twins.
- New locale namespaces `settings.oac.memory`, `settings.oac.user` (en + zh,
  parity-tested); CSS added to `styles.ts` consuming only `--dsw-alias-*`
  tokens, copying the same DSH surface vocabulary as the existing panels
  (AgentPresetSection cards, Plugins underline tabs, Models form rows and
  switch rows).

## 8. Privacy & scoping rules (unchanged from IDBots)

1. DSH local sessions ↔ owner scope (`owner:self`), full read/write.
2. A2A direct channels ↔ contact scope; external parties never receive owner
   profile facts — at most 3 `operational_preference` entries marked
   `external_safe`.
3. Group/shared channels ↔ conversation scope (materializes with group tasks
   in a later round).
4. `self_identity` is writable only by the dream pipeline.
5. Evidence stores hashes/refs, never raw private text.
6. Twin delegation prompts must not disclose private owner memory or
   unrelated history (enforced by the overlay prompt + the delegation wrapper
   carrying only explicit `verified_context`).

## 9. Phasing & verification

Each phase ends with: scoped tests green, `git diff --check`, closeout
commit + eric journal (repo `AGENTS.md` Definition of Done). Build before
test: `npm run build` (root) and `cd dsh-plugin && npm run build`. Use a
supported Node 20–24 for verification (the default shell node is v26).

- **Phase 0 — Spec & skeleton.** Amend the storage v2 spec doc (§4 layout);
  add `MetabotPaths` memory paths; plugin config toggles. Verify: root build
  + dsh-plugin build + existing dsh-plugin tests.
- **Phase 1 — Memory foundations (core).** `memoryTypes/memoryStore/
  memoryPromptBlocks/memoryScopeResolver/memoryExtractor(+judge)` +
  `memory` CRUD/blocks/extract/policy/transcript/chats/search verbs.
  Verify: new `tests/memory/*.test.mjs` (store CRUD, dedup/merge, scope
  resolver privacy, block ranking/eviction, extractor thresholds) +
  `npm run test:fast`.
- **Phase 2 — Dream (core).** `dreamStore/dreamPrompt/dreamService` +
  `dream` verbs + diary Markdown writer. Verify: dream due-date algorithm
  tests (window, stagger, catch-up, backoff, idempotent re-dream,
  forward-only identity, empty-day no-LLM) with injected fake
  `chatCompletion`; `test:fast`.
- **Phase 3 — Knowledge/impressions/experience (core).** Stores + verbs +
  prompt blocks. Verify: upsert/versioning, snapshot rebuild, recall
  granularity tests.
- **Phase 4 — Twin role & owner binding (core).** Profile fields, invariant,
  `twin workers` roster, `orchestrationStore` + `twin tasks` verbs. Verify:
  invariant tests (promote/demote/delete repair), roster sanitization.
- **Phase 5 — Plugin memory surface.** `oac-memory-store` + routes +
  `oac-memory-inject` + `oac-memory-tools` + Memory settings section.
  Verify: dsh-plugin tests (facade with stubbed `run`, route dispatch,
  section registration shape, locale parity) + manual DSH smoke: chat with a
  Bot, "记住我喜欢……", reload, ask it back.
- **Phase 6 — Dream scheduling (plugin).** `oac-dream` + Dream tab wiring.
  Verify: manual "run dream now" end-to-end on the live DSH profile; diary
  appears; next-day catch-up.
- **Phase 7 — Twin delegation (plugin).** `oac-twin` + twin tools +
  ORCH-NOTIFY + Bots panel badges. Verify: two Bots (twin + worker) live in
  DSH; owner asks twin; worker sub-session runs; twin reports back.
- **Phase 8 — A2A integration (daemon).** Auto-reply injection + extraction
  + experience recording. Verify: existing chat tests + new scoped test for
  injected blocks (contact scope, external_safe gate).
- **Phase 9 — Feel parity pass.** Walk the IDBots memory panel and twin
  flows side by side; fill gaps; update `docs/hosts/dsh.md`, the dsh-plugin
  README, and `AGENTS.md` if conventions changed.

## 10. Test plan

- Core stores: pure-function unit tests with temp profiles via
  `tests/helpers/tempRoots.mjs` (mandatory helper).
- Port fidelity tests mirroring IDBots' own test intents
  (`tests/memoryScopedCrud.test.mjs`, `memoryScopedRecall.test.mjs`,
  `memoryPromptBlocks.test.mjs`, `dreamService.test.mjs`,
  `dreamMemoryWrites.test.mjs`, `metaidKnowledgeStore.test.mjs`,
  `metaidImpressionStore.test.mjs` in the IDBots repo).
- CLI verbs: envelope-shape tests through `runCli` with stubbed stores.
- dsh-plugin: existing pattern (built `lib/` + injected fakes; client tests
  assert on source text; locale parity).
- No new slow files in the fast tier; anything booting daemons goes to
  `INTEGRATION_FILES` in `scripts/run-test-suite.mjs`.

## 11. Risks / open questions

1. **Dream LLM transport on DSH**: `dream plan`/`commit` + `ctx.llm` is the
   default; standalone `dream run` depends on the Bot having an OAC LLM
   binding, which DSH-created Bots may lack — acceptable (DSH is the target
   host), documented in the verbs' help.
2. **`ctx.agents.create` + `agentPresets.mount` for delegation** is a
   supported pattern (preset README, mount.spec.ts) but not yet exercised by
   a third-party plugin; Phase 7 starts with a spike proving mount + followup
   + whenIdle + finalAssistantOutput in the live DSH env.
3. **Transcript mirroring duplicates** DSH session content into metabot
   storage. Accepted: it makes `recent_chats`/`conversation_search`/dream
   gathering uniform and host-agnostic; volume is small (JSONL appends).
4. **DSH not running at night** — the due-date algorithm catches up missed
   dreams whenever the plugin host is alive, same as IDBots when the desktop
   app was off.
5. **Worker preset concurrency**: a busy worker Bot (live user session) may
   receive a delegation sub-session concurrently; delegation sessions are
   separate DSH sessions, so no state corruption, but the roster exposes
   "active workload" so the twin can avoid overloading one worker.

## 12. Porting fidelity notes

- Prompt templates are ported **verbatim** from IDBots (Chinese output
  requirements included — the dream JSON spec mandates Simplified Chinese
  fields): dream system/user prompts (`dreamPrompt.ts:364-369, 542-600`),
  twin overlay (`coworkRunner.ts:4489-4508`), delegation wrapper + worker
  system prompt (`twinOrchestrationService.ts:115-136, 283`), self-identity
  instruction (`experiencePromptBlocks.ts:45`), Memory Strategy section
  (`coworkRunner.ts:4401-4426`), group cognition framing is deferred with
  group tasks.
- Scoring/budget constants ported as-is: +3/token, +6 whole-text, 12/block,
  12000 chars (clamp 2000–65536), 7-day summary window (≤2000 chars),
  30-day recall warm window, ≤8 knowledge items (2400 chars), ≤3 external
  operational preferences, ≤2 implicit adds/turn, guard thresholds
  0.85/0.65/0.5, near-dup 0.82, text caps 360/1200/4000/2000, dream caps
  (5 important memories, 3 value lessons, 5 work reviews, 20 impression
  updates, 6 knowledge points), stagger `(seq * 13) % 240`, lookback 7 days,
  retry 30 min→6 h, window 00:00–06:00.
- `DREAM_VERSION` starts at 1 for the port (IDBots is at 8); version bumps
  follow the same repair-run semantics when our algorithms evolve.
