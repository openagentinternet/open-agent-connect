# Cerebellum (小脑) core — OAC dsh-plugin port

Port of IDBots' optional fast decision model (TypeSafe **JEV**,
`POST {baseUrl}/v1/systemone`) into the OAC dsh ecosystem. Every module is
byte-synced to IDBots at commit `d75bea8ac2249da4886bfa0f6f1db838d234ef1f`
(the upstream file path + commit is pinned in each file's header comment);
only mechanical differences required by the new host are allowed, and every
one of them is listed in the PR's diff table.

| File | Ported from (IDBots @ d75bea8a) |
| --- | --- |
| `config.ts` | `src/main/libs/cerebellumConfig.ts` |
| `client.ts` | `src/main/services/jevRelayService.ts` (transport) + `main.ts` call-context semantics |
| `effort.ts` | `src/main/cerebellum/effortSelector.ts` |
| `questions/memoryWriteGate.ts` | `src/main/cerebellum/memoryWriteGate.ts` |
| `questions/memoryRank.ts` | `src/main/cerebellum/memoryRank.ts` |
| `questions/skillShortlist.ts` | `src/main/cerebellum/skillShortlist.ts` |
| `questions/remoteServiceShortlist.ts` | `src/main/cerebellum/remoteServiceShortlist.ts` |
| `questions/knowledgeHotRank.ts` | `src/main/cerebellum/knowledgeHotRank.ts` |
| `questions/volatileBlockGate.ts` | `src/main/cerebellum/volatileBlockGate.ts` |
| `questions/conversationSearchRank.ts` | `src/main/cerebellum/conversationSearchRank.ts` |
| `questions/workerRank.ts` | `src/main/cerebellum/workerRank.ts` |
| `questions/turnDecisionBundle.ts` | `src/main/cerebellum/turnDecisionBundle.ts` |
| `../cerebellum-write-gate.ts` (PR-2 wiring) | `main.ts` gate/ranker factories (`createCerebellumMemoryWriteGate` :3373, `createCerebellumConversationRanker` :3284) + `coworkRunner.ts` consumer (:4034 `runConversationSearchTool`) |
| `../memory-observe.ts` gate hook (PR-2) | `libs/coworkMemoryJudge.ts` `setCerebellumMemoryWriteGate` seat (turn-end brain extraction front door) |
| `../memory-tools.ts` re-rank hook (PR-2) | `coworkRunner.ts` `runConversationSearchTool` re-rank consumer |

Not ported: `groupReplyGate` (OAC has no on-chain group-chat substrate),
`intuitionTool` (brain-invoked tool — later PR), the turn-ack bubble
machinery (IDBots-renderer-bound; only the pure tier-mapping helper ports
with `effort.ts`), the connection-test IPC + settings renderer.

## Standing rules (do not break — ported defect lessons)

1. **Never block a turn.** Every call site gets a hard abort deadline
   (1500 ms shared, 1000 ms for the solo effort call), returns `null` (or a
   fail-open verdict) on ANY failure, and degrades silently to the
   pre-cerebellum behavior. Fail-open everywhere: for gates, `null` and
   `true` BOTH proceed.
2. **Never call JEV without resolved config; never log memory text or the
   API key.** Log verdict/latency/ids/counts only. Question instructions
   stay English; the user's original-language text rides `state`.
3. **Don't ask JEV what code can compute.** Compose atomic judgments in
   code; one question per atomic decision.
4. **ONE shared in-flight bootstrap** across all concurrent decision calls
   (the IDBots 2026-10-15 first-sentence incident: five parallel
   identity-signed bootstraps, 15 s+ each). A 401 triggers exactly ONE
   re-bootstrap retry; a 429-quota opens the 5-minute breaker.
5. **No global effort-suppressing default without IDBots' exact escape
   hatches** (`assistant-mode-global-suppresses` defect): explicit user pick
   always wins; escalation only at P(high)+P(max) ≥ 0.5; unattended
   sessions (schedule/longterm/orchestration/A2A/group tasks) NEVER consult
   the effort selector — auto means max where a brain pick exists.
6. **Surfaced generated text** (none exists in this port — JEV returns
   numbers only): any future fast path that surfaces LLM-generated text MUST
   reject reasoning-promoted content and `stopReason=length` outright, use
   thinking-aware token ceilings, and apply deterministic genre/language
   guards before surfacing (IDBots turn-ack leak chain, fixed upstream in
   `b6be3f54`; root cause: always-thinking model × small token budget ×
   resolver promoting `reasoning_content` into content).
7. **One gate, one source of truth.** Wherever a gate decision is needed
   there is exactly one gate (IDBots' renderer/backend gate divergence is a
   defect, not a feature).
8. **Default OFF in OAC.** IDBots ships the free relay ON at fresh install;
   a headless OAC host sending content categories to a third-party endpoint
   is a consent decision. The plugin ships `enabled: false` semantics — no
   cerebellum config, no JEV calls, zero behavior change.

## Proxy notes

Node's global fetch does not honor `HTTPS_PROXY` by itself (IDBots' HTTP 451
region-block lesson came from bare Node fetch). The default fetch factory in
`client.ts` attaches an undici `EnvHttpProxyAgent` when a proxy env var is
set and `undici` resolves (fail-open to plain fetch otherwise);
`NODE_USE_ENV_PROXY=1` (Node 24+) honors the env natively. The direct
provider's base URL is configurable via config.

## PR-2 wiring: memory write gate + conversation re-rank (default OFF)

`../cerebellum-write-gate.ts` gives the PR-1 runtime its first two turn-path
consumers (design `design-assistant-cerebellum-port.md` §2.2 B4/B5, §3 PR-2):

- **Turn-end memory write gate** (`gateTurnMemoryExtract`): one Noul
  `worth_remembering` in front of the post-turn `memory extract` CLI call.
  Verdict `false` skips the extract for this turn (the transcript mirrors
  still run); `null`/`true`/disabled/any failure proceeds. With the
  cerebellum disabled (the shipped default) the gate resolves no config per
  call, makes ZERO calls (no JEV fetch, no policy read), and the CLI call
  sequence is byte-identical to the ungated build.
- **`conversation_search` re-rank** (`rerankConversationSearch`): one Noul
  `chat_<i>` per hit; the noul replaces recency as the rank key. A score map
  below the 0.8 answer-coverage floor is discarded → the keyword order is
  kept verbatim; blank query / pool < 2 / disabled / any failure → original
  order, zero JEV calls.

### Mechanical differences vs IDBots (PR-2 wiring only; question modules are byte-synced)

| Difference | IDBots | OAC dsh-plugin | Why (design doc) |
| --- | --- | --- | --- |
| Gate seat | In-process: `setCerebellumMemoryWriteGate` inside `coworkMemoryJudge`, the brain-extraction front door | Plugin-side pre-check in the turn-end observer, in front of the `memory extract` CLI call; transcript mirroring stays ungated | §2.2 B4 "cheapest: plugin-side pre-check … no core change, fail-open preserved" — the plugin cannot reach the core judge |
| `explicitOnly` source | In-process `implicitEnabled` read at the extraction site (`main.ts:3389` `explicitOnly: !implicitEnabled`) | `memory policy get` CLI read on gated turns only (`effective.memoryImplicitUpdateEnabled`); any read failure → implicit definition | §5.1 mechanical necessity; the plugin cannot read the core policy store in-process. Fail-open direction: the implicit question ALSO counts explicit remember/forget instructions, so a wrong guess can only cost an extraction call, never a memory |
| Transport | Electron `session.defaultSession.fetch` (system proxy) | Node fetch + undici `EnvHttpProxyAgent` (see Proxy notes) | §5.4 — headless host has no Electron session |
| Search hit grain | One hit per SESSION (`{sessionId, title, human, assistant}`); candidate id = bare `sessionId` | One hit per MESSAGE (`{ts, role, text, sessionId, …}`, several per session possible); candidate id = composite `sessionId#index` | Mechanical: OAC `memory search` returns message-grain records. The composite keeps score-map keys unique — a bare sessionId would collapse the 0.8 coverage-floor `scores.size` math. Ids are opaque; no turn text is added to the payload |
| Candidate text | `formatConversationCandidateText({title, human, assistant})` from stored chat previews | Same byte-synced formatter; `title` = `peerName` (→ `Untitled` when absent), role-split `text` into Human/Assistant | OAC records carry no title field; the formatter (and the later whitespace collapse in `selectConversationRankCandidates`) is upstream code, unchanged |
| Gate/ranker config resolution | `resolveCerebellumCallContext()` lazily per call | `CerebellumRuntime.resolveCallContext()` lazily per call (PR-1 client) | Same "Settings edits apply next turn" semantics |
| Logging | `coworkLog('INFO', 'memory:cerebellumWriteGate' / 'conversation:cerebellumRank', …)` verdict/latency/ids/counts | Plugin logger (`ctx.logger.warn`) one-line verdict/latency/counts — no turn text, no query text | Same ids-only rule, plugin has one log channel |
| Default | Free relay ON at fresh install | OFF until the owner enables it (consent decision) | §5.1 default-ON trap; standing rule 8 |
