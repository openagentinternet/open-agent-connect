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
