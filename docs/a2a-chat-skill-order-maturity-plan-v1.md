# A2A Chat-Skill & Skill-Service Maturity Plan v1

Date: 2026-07-30
Branch: `fix-a2a-skill-execution`
Goal: bring local-Bot chat-skill usage (A2A private chat) and skill-service order
execution up to the maturity level of the IDBots reference implementation
(`/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots`).

Evidence base: full code review of `src/core/chat`, `src/core/services`,
`src/core/a2a`, `src/core/orders`, `src/core/llm/executor`, `src/ui/pages/bot`,
`src/daemon/defaultHandlers.ts`, plus the IDBots equivalents
(`src/main/services/privateChatDaemon.ts`, `skillManager.ts`,
`privateChatOrderCowork.ts`, `serviceOrderLifecycleService.ts`, …).

## Progress log

- **2026-07-30 — P0 done**: per-turn skill routing block in the chat prompt
  (name/description/location, gating rules, skills may act — port of the
  IDBots routing prompt); blanket read-only/no-side-effect prompt rules
  removed; chat turns run without `skillIsolation: 'strict'` in a per-profile
  workspace (`<profile>/.runtime/private-chat-work/`); event-triggered
  "please wait" notice on the first `tool_use` session event (persona-LLM
  text with static fallback, deduped per inbound message incl. history check,
  settled before the final reply); `latestConversationMessageMatches` now
  ignores our own wait notices so the final reply is not discarded by the
  staleness guard. Tests: `tests/chat/chatSkillWaitNotice.test.mjs` (new),
  `tests/chat/hostLlmChatReplyRunner.test.mjs`,
  `tests/chat/privateChatAllowedSkills.test.mjs`,
  `tests/chat/privateChatAutoReply.test.mjs`,
  `tests/cli/autoReplyProfileDispatcher.test.mjs`, `tests/cli/runtime.test.mjs`.

---

## 1. Headline gaps (user-reported)

### G1. Chat-skill is never really "evaluated per round" or executed

Current state:

- The chat prompt lists only bare skill **names**
  (`src/core/chat/hostLlmChatReplyRunner.ts:274-282`); the catalog
  `title`/`description` is dropped by the resolver
  (`src/core/chat/privateChatAllowedSkills.ts:53-58`).
- The decision "should I use a skill this round?" is delegated entirely to the
  host LLM's native, unspecified skill behavior. There is no routing
  instruction, no gating rule, no tool-use contract.
- Skills are prompt-restricted to **read-only** use
  (`hostLlmChatReplyRunner.ts:221-225`), so anything action-like is told not to
  act.

IDBots reference (`src/main/skillManager.ts:946-977, 1027-1116`): a scoped
`<available_skills>` block with `id/name/description/location` per skill plus
mandatory gating rules is injected into the system prompt every round:

- scan descriptions first; if exactly one skill clearly applies, Read its
  SKILL.md and follow it; if several, pick the most specific; if none, use
  none; never read more than one skill up front.
- execute skills via Read + Bash as documented in each SKILL.md.

Fix (P0): port that routing block into `buildChatPrompt`
(`hostLlmChatReplyRunner.ts:182-343`), keep descriptions in
`privateChatAllowedSkills.ts`, and relax the blanket read-only rule to "skills
in the allow-list may run as documented, but no outbound side effects (chain
writes, uploads, remote delegation, sending messages)".

### G2. No interim "please wait" reply before long skill execution

Current state:

- Nothing sends an interim message; a skill-heavy turn is silent for up to
  5 runtimes × 60 s.
- The prompt actively forbids progress narration
  (`hostLlmChatReplyRunner.ts:264-272`) and
  `stripPlanningPreamble`/`isInvisibleExecutionLine` (`:26-95`) regex-delete the
  very lines a model emits while working.

IDBots reference (`privateChatDaemon.ts:3793-3851`,
`orchestratorCoworkBridge.ts:265-301`): the wait notice is **event-triggered**
by the first `tool_use` event from the runner; text is persona-LLM-generated
(1–2 short sentences, hardcoded fallback
`'I need a moment to check that. Please wait.'`), deduped per inbound message,
send-failure never blocks execution, and notice messages are excluded from the
final-reply extraction.

Fix (P0): OAC already has everything needed for the same design —
`LlmExecutionEvent` includes `{type:'tool_use'}`
(`src/core/llm/executor/types.ts:44`) and sessions expose
`streamEvents(sessionId)` (`src/core/llm/executor/executor.ts:598`). While the
chat runner waits on a session, consume the event stream in parallel; on the
first `tool_use` event, send one wait notice:

- persona-LLM text with short timeout and static template fallback;
- dedupe keyed by `conversationId:messageId` (reuse the
  `activeInboundReplies` bookkeeping in `privateChatAutoReply.ts`);
- never block execution on notice failure; never treat the notice as the turn
  result;
- for backends that emit no `tool_use` events, fall back to a timer trigger
  (e.g. no output within ~8 s while the allow-list is non-empty).

Also remove/relax the anti-narration prompt lines and stripping regexes so the
two channels stay clean: interim notice via the dedicated path, final reply
without process narration.

---

## 2. P1 — order-execution robustness (match IDBots)

| # | Problem (evidence) | Fix | IDBots reference |
|---|---|---|---|
| 1 | Buyer ignores `[ORDER_END]`: waiter parses only DELIVERY/NeedsRating (`src/core/a2a/metawebReplyWaiter.ts:305-338`); explicit provider failure still costs the buyer the full 30-min wait and files refund as `delivery_timeout` | Parse ORDER_END in the waiter and in `handleInboundOrderProtocolMessage`; fail the session fast with the provider's real reason | IDBots routes ORDER_END per order txid |
| 2 | `rating_pending` is a dead end: happy-path seller orders stop there (`src/daemon/defaultHandlers.ts:10384-10386`), and `CLOSED_ORDER_STATES` (`src/core/services/myServices.ts:125`) hides them from UI + stats | Close on rating receipt; add a ~15-min rating timeout that auto-sends `[ORDER_END:txid rating_timeout]` and completes the order; show `rating_pending` in UI/stats | `serviceOrderLifecycleService.ts:440-478` (15-min rating timeout) |
| 3 | Unprotected `await providerRunner.execute(...)` (`defaultHandlers.ts:9702`, `:13630`) and post-delivery finalization (`:10354`, `:10415`) — a throw strands the seller order `in_progress` with no ORDER_END to the buyer | try/catch → `persistProviderFailureTrace` + ORDER_END failed; best-effort finalization after delivery | — |
| 4 | Paid-but-unsent orders get no auto-refund in the simplemsg branch (`:13188-13195`, `:13272-13282`); only the HTTP branch seeds a refund request | Call `ensureBuyerRefundRequestForTrace` on order-record publish failure and ORDER broadcast failure | IDBots refunds on any failure/timeout |
| 5 | Buyer wait continuation is in-memory only (`pendingCallerReplyContinuations`); daemon restart loses it → trace stuck `requesting_remote`, no timeout, no refund | On boot, re-arm continuations from persisted caller sessions/traces (mirror the seller-side replay at `src/cli/runtime.ts:1772`) | IDBots journals every inbound row with `is_processed` + backfill service |
| 6 | Hard 120 s provider execution cap (`src/core/a2a/provider/providerServiceRunner.ts:735`); any skill >2 min deterministically fails | Make timeout configurable per service/runtime; default 5 min, media/video 20 min; on timeout, deliver a partial artifact if one already exists, with an explanatory notice | `DEFAULT_ORDER_TIMEOUT_MS` 5 min / `VIDEO_ORDER_TIMEOUT_MS` 20 min + `resolveTimeoutFallback` |
| 7 | Chain-API outage rejects paid orders and poisons dedup: `verifyServiceOrderPayment(...).catch(() => null)` (`defaultHandlers.ts:9289`) maps transport errors to "unverified" and records a terminal `failed` order, so a legitimate retry is treated as duplicate | Distinguish verification *error* (retryable, no terminal state) from payment *mismatch* (terminal) | `orderPayment.ts` reasoned skip without poisoning |
| 8 | (Security, needs product sign-off) `/api/services/execute` never verifies payment on-chain and has no auth (`defaultHandlers.ts:13489`) | Verify payment before executing; add a shared-secret token for cross-host mode | — |

## 3. P2 — small, visible code issues (batch of small diffs)

Chat / reply pipeline:

1. Silent error swallows: `privateChatAutoReply.ts:349-351` (`catch { return null; }`) and `:510-527` — log via `logSendFailure`/`console.warn`.
2. Concurrent-inbound race: dedupe key includes messageId (`:537-541`) so back-to-back messages spawn concurrent LLM turns; `turnCount` increments can be lost (`:839-843`); the older reply is discarded only *after* paying for the LLM call (`:419-434`). Serialize replies per conversation; re-check latest-message before invoking the LLM.
3. Guided-turn HTTP request blocks for the whole LLM turn (`defaultHandlers.ts:6454-6456`) — switch to accept-and-poll.
4. Inbound messages with extensions leak raw JSON wrappers into the LLM prompt (`privateChatAutoReply.ts:779-788`; unwrapping only handles outbound, `hostLlmChatReplyRunner.ts:311-322`) — store unwrapped content on inbound records.
5. Rate-limit drops are silent (`privateChatAutoReply.ts:539`) — log + consider a busy notice.
6. Waiter can't distinguish network-down from slow provider (`metawebReplyWaiter.ts:281-290`, `reconnection:false`, no `connect_error` handling) — fail fast or surface status.

UI (`src/ui/pages/bot`, `src/ui/i18n.ts`):

7. English label uses a fullwidth colon: `i18n.ts:140` `'Private Chat Allowed Skills：'`.
8. Auto-Reply controls live under the "Chat Skills" tab (`app.ts:1273`) — rename the tab or move the controls.
9. Skill options cached per slug with no refresh (`app.ts:1281`) — reload on tab entry; clear sticky `error` status.
10. Dead branches/copy: `wireChatSkillControls` falls back to non-existent info-tab markup (`app.ts:818,827`); leftover `'bot.chatSkillsPlaceholder'` (`i18n.ts:125`).

Dead code / drift:

11. `createPrivateChatListener` (`privateChatListener.ts:143-354`) never called — delete or make private.
12. `METABOT_PRIVATE_CHAT_REPLY_GENERATION` env marker (`hostLlmChatReplyRunner.ts:412-414`) consumed nowhere — remove or document.
13. Dead delegation-prefix helpers (`src/core/delegation/remoteCall.ts:131-196`), dead clarification machinery (`sessionEngine.answerClarification`, zero callers; direct-execute leaves orders `in_progress` on `needs_clarification`), dead `'[ORDER] preflight'` send (`defaultHandlers.ts:13166-13181`), unreachable seller state `'ended'` (`sellerOrderState.ts:10`).
14. Triplicated ORDER-metadata regexes (`serviceOrderProtocols.ts:9`, `delegationOrderMessage.ts:23`, `orderProtocolTextGenerator.ts:133-137`) — one shared constant.
15. Spec/implementation drift: spec says `/info/bio` `allowChatSkills`; code writes `/info/chatSkills` with `allowPrivateChatSkills` (`metabotProfileManager.ts:1007-1015` vs `docs/superpowers/specs/2026-06-03-chat-allowed-skills-design.md:69-84`) — align one side.

Ops:

16. Provider workspaces never cleaned (`.runtime/a2a-provider-runs/**`, `providerServiceRunner.ts:143`) — janitor after delivery/failure.
17. Saving the chat-skill allow-list requires a chain write; chain failure aborts the local save (`defaultHandlers.ts:15575-15590`) — save local policy first, sync on-chain best-effort with a visible status.
18. Skipped/unresolvable configured skills are invisible to the operator (console.warn only: `privateChatAllowedSkills.ts:49-51`, `chatSkillPolicy.ts:238-240`; session-log only: `executor.ts:667-673`) — surface in conversation metadata / UI status.
19. (Introduced by P0, known limitation) `injectSkills` skips copying when the destination exists (`skill-injector.ts:96-101`), so the persistent chat workspace can hold a stale copy of an updated skill. The prompt `location:` already points at the fresh source SKILL.md; a proper fix refreshes the copy by mtime/hash.

## 4. P3 — experience parity with IDBots (larger, follow-up iterations)

- Order deadline state machine: first response ≤ 5 min, delivery ≤ 15 min, rating window ~15 min (today: one flat 30-min buyer wait, no seller-side deadlines).
- Long-task heartbeat: progress notice every ~120 s for media orders; upload/retry notices (all best-effort).
- Suppress regular free-chat auto-reply while an order is active with that peer (IDBots `hasActiveOrderForPrivateChatSuppression`).
- Missing media artifact after "completion" → one forced continuation run with a "you MUST generate the file" prompt before failing.
- Order "observer window" UI: visible per-order session with mirrored execution trace.
- Per-skill permission declarations replacing the blanket read-only rule.

## 5. Decisions from the user (confirmed 2026-07-30)

1. **Chat-skill execution boundary** → move to the IDBots model: allowed chat
   skills execute with the host's normal environment; outbound actions
   (on-chain writes, uploads, sending messages) are NOT prohibited, since
   agent-to-agent collaboration needs them. Implemented in P0 by dropping
   `skillIsolation: 'strict'` from chat turns and scoping the allow-list in
   the prompt routing block.
2. **`/api/services/execute` hardening** → confirmed in scope (P1-8), lean
   toward IDBots behavior.
3. **Wait-notice wording** → persona LLM-generated in the peer's language; no
   hardcoded text except the static fallback when the LLM call itself fails.
4. **Naming convergence** → converge on `allowChatSkills` (a future
   `disallowChatSkills` may follow); fix in P2.

## 6. Verification strategy

- Per change round: `npm run build` + the scoped test files, `git diff --check`.
- P0/P1 touch shared runtime behavior → `npm run test:fast` before merge.
- New tests to add:
  - wait-notice trigger on `tool_use`, dedupe per message, fallback timer path;
  - buyer ORDER_END handling (fast fail + refund reason);
  - rating-timeout closure of `rating_pending`;
  - refund seeding on publish/broadcast failure;
  - buyer continuation re-arm after restart;
  - payment-verify transient-error vs mismatch split.
- Closeout per round: `npm run closeout:eric -- ...` per AGENTS.md.
