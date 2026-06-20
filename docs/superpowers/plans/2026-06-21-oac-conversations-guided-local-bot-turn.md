# OAC Conversations Guided Local Bot Turn Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-time, local-only guidance control to `/ui/conversations` so a human can steer the next local Bot turn, immediately trigger that outbound turn, reopen a closed conversation when needed, and consume the guidance only after the first successful local outbound private-chat write.

**Architecture:** Keep the feature inside OAC's existing Conversations surfaces. Extend private-chat conversation state with one pending-guidance slot plus compare-and-clear semantics, pass operator guidance into the existing reply-runner prompt contract, reuse the existing simplemsg write and A2A persistence path for the outbound Bot turn, expose a new `POST /api/conversations/guidance` handler in the aggregated Conversations route family, and add a small footer-level guidance control to the Conversations UI with English and Simplified Chinese copy.

**Tech Stack:** Node.js `>=20 <25`, TypeScript strict CommonJS source, Node test runner `.test.mjs` files, OAC daemon route handlers, local UI page script, existing private-chat/A2A persistence helpers.

---

Source of truth:
- `/Users/tusm/Documents/MetaID_Projects/open-agent-connect/.worktrees/codex/conversations-user-guided-dialog/docs/superpowers/specs/2026-06-21-oac-conversations-guided-local-bot-turn-design.md`

Execution baseline:
- Continue in `/Users/tusm/Documents/MetaID_Projects/open-agent-connect/.worktrees/codex/conversations-user-guided-dialog`.
- Do not create another branch or worktree for this feature.

Non-negotiable boundaries:
- Guidance is local-only runtime state. It must not appear as a visible transcript message and must not be sent verbatim as a human-authored remote message.
- Only one pending guidance value exists per conversation. A newer submission replaces an older unconsumed one.
- Guidance is one-shot. Consume it only after the first successful local outbound turn that used it.
- If reply generation or chain write fails, keep the pending guidance intact.
- The UI must call `/api/conversations/guidance`, not `/api/chat/private`.
- Keep all new UI copy in `src/ui/i18n.ts` with both `en` and `zh-CN` coverage.
- Do not add a standing instruction loop, a multi-item queue, or a general human-to-remote-Bot composer.

Recommended helper for commit journals during implementation:

```bash
post_buzz() {
  local body="$1"
  local request_file
  request_file=$(mktemp /tmp/oac-guided-turn-buzz.XXXXXX)
  node -e 'const fs=require("fs"); const [file, content] = process.argv.slice(1); fs.writeFileSync(file, JSON.stringify({ content }, null, 2));' "$request_file" "$body"
  $HOME/.metabot/bin/metabot buzz post --from eric --request-file "$request_file"
}
```

## 1. Confirm The Isolated Planning Baseline

**Files:** none

**Tests:** repository state checks only

- [ ] Confirm the current feature worktree and branch before implementation:

  ```bash
  cd /Users/tusm/Documents/MetaID_Projects/open-agent-connect/.worktrees/codex/conversations-user-guided-dialog
  git status --short --branch
  git worktree list
  ```

  Expected result: the current branch is `codex/conversations-user-guided-dialog`, the active worktree path is the current one, and any unrelated local changes are visible before coding starts.

- [ ] Confirm the approved source-of-truth documents are present:

  ```bash
  test -f /Users/tusm/Documents/MetaID_Projects/open-agent-connect/.worktrees/codex/conversations-user-guided-dialog/docs/superpowers/specs/2026-06-21-oac-conversations-guided-local-bot-turn-design.md
  test -f /Users/tusm/Documents/MetaID_Projects/open-agent-connect/.worktrees/codex/conversations-user-guided-dialog/docs/superpowers/plans/2026-06-21-oac-conversations-guided-local-bot-turn.md
  ```

  Expected result: both commands exit `0`.

## 2. Add Pending-Guidance State And Reply-Runner Prompt Contract

**Files:**
- `src/core/chat/privateChatTypes.ts`
- `src/core/chat/privateChatStateStore.ts`
- `src/core/chat/hostLlmChatReplyRunner.ts`
- `tests/chat/privateChatStateStore.test.mjs`
- `tests/chat/hostLlmChatReplyRunner.test.mjs`

**Tests:**
- `npm run build && node --test tests/chat/privateChatStateStore.test.mjs tests/chat/hostLlmChatReplyRunner.test.mjs`

- [ ] Add failing state-store coverage for one-shot guidance semantics in `tests/chat/privateChatStateStore.test.mjs`:
  - a conversation can persist `pendingGuidanceText` plus `pendingGuidanceCreatedAt`
  - replacing pending guidance overwrites the older value
  - compare-and-clear only clears the matching guidance, and leaves a newer replacement untouched

  Expected failing command before implementation:

  ```bash
  npm run build && node --test tests/chat/privateChatStateStore.test.mjs
  ```

  Expected failing result: TypeScript or runtime assertions fail because the conversation type and store do not yet understand pending guidance fields or compare-and-clear behavior.

- [ ] Add failing prompt-contract coverage in `tests/chat/hostLlmChatReplyRunner.test.mjs`:
  - `buildChatPrompt` includes a local-only operator-guidance section when `operatorGuidanceText` is present
  - `buildChatPrompt` still renders a valid prompt when there is no `inboundMessage` and the turn is operator-triggered
  - the normal prompt still ends with `Reply now:`

  Expected failing command before implementation:

  ```bash
  npm run build && node --test tests/chat/hostLlmChatReplyRunner.test.mjs
  ```

  Expected failing result: the prompt lacks the operator-guidance block or assumes `input.inboundMessage` always exists.

- [ ] Extend `src/core/chat/privateChatTypes.ts` with the minimal new contract:
  - add `pendingGuidanceText: string | null` and `pendingGuidanceCreatedAt: number | null` to `PrivateChatConversation`
  - add optional `operatorGuidanceText?: string | null` to `ChatReplyRunnerInput`
  - make `inboundMessage` nullable or optional so operator-triggered turns do not need a fake remote message

  Expected result: the type layer matches the design without inventing a separate human message type.

- [ ] Add focused state-store helpers in `src/core/chat/privateChatStateStore.ts` instead of open-coding raw `updateState` everywhere:
  - one helper to set or replace pending guidance for one conversation
  - one helper to clear pending guidance only when the stored `(text, createdAt)` still matches the turn that just succeeded
  - normalize older stored conversations that do not have the new fields yet, so existing profiles load with `null` guidance rather than `undefined` surprises

  Required constraint: do not hold the store lock across LLM generation or chain writes.

- [ ] Update `src/core/chat/hostLlmChatReplyRunner.ts` so prompt generation:
  - adds an explicit one-time operator-guidance section
  - keeps the guidance framed as local/private steering, not as peer-authored text
  - still uses existing persona, strategy, history, and exit rules
  - does not require a synthetic inbound message for operator-triggered turns

- [ ] Re-run the targeted contract tests:

  ```bash
  npm run build && node --test tests/chat/privateChatStateStore.test.mjs tests/chat/hostLlmChatReplyRunner.test.mjs
  ```

  Expected passing result: all listed tests pass and the build stays green.

- [ ] Commit this unit:

  ```bash
  git add src/core/chat/privateChatTypes.ts src/core/chat/privateChatStateStore.ts src/core/chat/hostLlmChatReplyRunner.ts tests/chat/privateChatStateStore.test.mjs tests/chat/hostLlmChatReplyRunner.test.mjs
  git commit -m "feat(chat): add one-shot conversation guidance contract"
  ```

  Expected result: one commit containing only state and prompt-contract work.

- [ ] Post the required development journal:

  ```bash
  post_buzz "Development journal: added one-shot private-chat guidance state and prompt contract for Conversations guided local turns, including compare-and-clear semantics and prompt coverage. Commit $(git rev-parse --short HEAD)."
  ```

  Expected result: the buzz post succeeds and returns a `pinId`.

## 3. Reuse The Private-Chat Outbound Turn Path For Guided Local Turns

**Files:**
- `src/core/chat/privateChatAutoReply.ts`
- `src/core/chat/defaultChatReplyRunner.ts`
- `tests/chat/privateChatAutoReply.test.mjs`

**Tests:**
- `npm run build && node --test tests/chat/privateChatAutoReply.test.mjs`

- [ ] Add failing orchestration coverage in `tests/chat/privateChatAutoReply.test.mjs` for the new pending-guidance lifecycle:
  - an inbound-triggered outbound reply consumes matching pending guidance after a successful send
  - a runner failure, skip result, or failed send leaves pending guidance intact
  - a closed conversation with pending guidance is allowed to reopen for the next local outbound turn instead of returning early forever

  Expected failing command before implementation:

  ```bash
  npm run build && node --test tests/chat/privateChatAutoReply.test.mjs
  ```

  Expected failing result: pending guidance is ignored, cleared too early, or blocked by the closed-conversation short-circuit.

- [ ] Refactor `src/core/chat/privateChatAutoReply.ts` so the common outbound private-chat turn path can be reused by both:
  - inbound auto-replies
  - operator-triggered guided turns from the Conversations handler

  Keep the shared logic responsible for:
  - building the reply-runner input
  - applying operator guidance when present
  - normalizing close signals
  - sending the simplemsg reply
  - appending the outbound private-chat message
  - persisting the unified A2A message so existing conversation SSE updates still fire

- [ ] Update `src/core/chat/defaultChatReplyRunner.ts` to tolerate an operator-triggered turn with no `inboundMessage`. Use the last inbound history entry or a generic continuation path instead of throwing.

- [ ] Preserve the existing auto-reply lifecycle for order-protocol messages and ordinary closed conversations that have no pending guidance.

- [ ] Re-run the targeted orchestration tests:

  ```bash
  npm run build && node --test tests/chat/privateChatAutoReply.test.mjs
  ```

  Expected passing result: the auto-reply suite proves that guidance is consumed only after a successful outbound turn and preserved on failure.

- [ ] Commit this unit:

  ```bash
  git add src/core/chat/privateChatAutoReply.ts src/core/chat/defaultChatReplyRunner.ts tests/chat/privateChatAutoReply.test.mjs
  git commit -m "feat(chat): reuse outbound turn flow for guided replies"
  ```

  Expected result: one commit containing only shared private-chat turn orchestration changes.

- [ ] Post the required development journal:

  ```bash
  post_buzz "Development journal: refactored private-chat outbound turn handling so Conversations guidance and inbound auto-reply share the same send, persistence, and one-shot guidance-consumption path. Commit $(git rev-parse --short HEAD)."
  ```

  Expected result: the buzz post succeeds and returns a `pinId`.

## 4. Add The Conversations Guidance Handler And HTTP Route

**Files:**
- `src/daemon/routes/types.ts`
- `src/daemon/routes/conversations.ts`
- `src/daemon/defaultHandlers.ts`
- `tests/daemon/defaultConversationsHandlers.test.mjs`
- `tests/daemon/httpServer.test.mjs`

**Tests:**
- `npm run build && node --test tests/daemon/defaultConversationsHandlers.test.mjs tests/daemon/httpServer.test.mjs`

- [ ] Add failing direct-handler coverage in `tests/daemon/defaultConversationsHandlers.test.mjs` for:
  - immediate guided outbound send for a selected local/peer conversation
  - replacing older unconsumed guidance with the newer submission
  - reopening a closed conversation and resetting it to an active guided-turn lifecycle
  - keeping pending guidance when reply generation or write broadcast fails

  Expected failing command before implementation:

  ```bash
  npm run build && node --test tests/daemon/defaultConversationsHandlers.test.mjs
  ```

  Expected failing result: `handlers.conversations.guidance` does not exist yet or does not preserve the one-shot semantics.

- [ ] Add failing route coverage in `tests/daemon/httpServer.test.mjs` for `POST /api/conversations/guidance`:
  - rejects non-`POST`
  - rejects missing `local`, `peer`, or empty `guidance`
  - passes JSON body fields through to `handlers.conversations.guidance`
  - returns the normal OAC success/failure envelope with the guided-turn result inside `data`

  Expected failing command before implementation:

  ```bash
  npm run build && node --test tests/daemon/httpServer.test.mjs
  ```

  Expected failing result: the route returns `404`, `405`, or `not_implemented`.

- [ ] Extend `src/daemon/routes/types.ts` with a new conversations handler signature:
  - `guidance({ local, peer, guidance })`

- [ ] Update `src/daemon/routes/conversations.ts` to:
  - keep existing `GET` behavior unchanged for list/messages/events
  - accept `POST /api/conversations/guidance`
  - read JSON body via `context.readJsonBody()`
  - validate `local`, `peer`, and non-empty `guidance`
  - return the standard command envelope through the same route helper pattern used by the existing Conversations routes

- [ ] Implement `handlers.conversations.guidance` in `src/daemon/defaultHandlers.ts` with the following behavior:
  - resolve the local Bot profile through the same profile/actor logic already used by conversations and private chat
  - load or create the deterministic private-chat conversation record for the selected peer
  - set or replace pending guidance with a fresh timestamp
  - if the conversation is `closed`, reopen it for a new guided local turn and reset turn count so the previous closed lifecycle does not immediately terminate the new turn
  - load persona, strategy, and recent messages
  - run the shared outbound private-chat turn path with `operatorGuidanceText`
  - clear pending guidance only when the stored guidance still matches the successful turn that just finished
  - keep pending guidance untouched when the runner skips, throws, or the chain write fails
  - return `{ conversationId, state, guidanceApplied, guidanceConsumed, messageId, pinId, txids }` inside `commandSuccess(...)`

  Required constraint: keep using the same A2A persistence path so `/api/conversations/events` receives the usual refresh signal after a guided outbound message.

- [ ] Re-run the targeted daemon tests:

  ```bash
  npm run build && node --test tests/daemon/defaultConversationsHandlers.test.mjs tests/daemon/httpServer.test.mjs
  ```

  Expected passing result: both direct-handler and HTTP route coverage pass, including validation and guidance-consumption semantics.

- [ ] Commit this unit:

  ```bash
  git add src/daemon/routes/types.ts src/daemon/routes/conversations.ts src/daemon/defaultHandlers.ts tests/daemon/defaultConversationsHandlers.test.mjs tests/daemon/httpServer.test.mjs
  git commit -m "feat(conversations): add guided local turn handler"
  ```

  Expected result: one commit containing only the Conversations guidance daemon path.

- [ ] Post the required development journal:

  ```bash
  post_buzz "Development journal: added POST /api/conversations/guidance plus the default Conversations handler that stores one-shot local guidance, reopens closed threads, triggers the local Bot turn immediately, and only consumes guidance after a successful outbound send. Commit $(git rev-parse --short HEAD)."
  ```

  Expected result: the buzz post succeeds and returns a `pinId`.

## 5. Add The Conversations Footer Guidance UI And i18n Copy

**Files:**
- `src/ui/pages/conversations/app.ts`
- `src/ui/i18n.ts`
- `tests/ui/conversationsPageScript.test.mjs`
- `tests/daemon/httpServer.test.mjs`

**Tests:**
- `npm run build && node --test tests/ui/conversationsPageScript.test.mjs tests/daemon/httpServer.test.mjs`

- [ ] Add failing page-script coverage in `tests/ui/conversationsPageScript.test.mjs` for the new footer control:
  - the selected conversation exposes a collapsed `Guide` action
  - clicking it reveals the input plus `Send` and `Cancel`
  - submit posts to `/api/conversations/guidance` with the selected `local`, `peer`, and typed guidance
  - success clears the draft, hides the composer, and refreshes the conversation view
  - failure keeps the draft visible and shows a local error status

  Expected failing command before implementation:

  ```bash
  npm run build && node --test tests/ui/conversationsPageScript.test.mjs
  ```

  Expected failing result: the script has no guidance controls, no POST request, or no local success/error state.

- [ ] Update `src/ui/pages/conversations/app.ts` to replace the read-only-only footer with a small scoped guidance panel:
  - keep the existing read-first thread layout
  - add a collapsed `Guide` button near the current footer area
  - when expanded, render a single-line input, `Send`, `Cancel`, and a short status line
  - disable submit while the POST is in flight
  - after success, clear the input, collapse the panel, and refresh the thread
  - when local Bot or peer selection changes, reset any draft/status that belongs to the old conversation

  Required constraint: keep the control strictly scoped to the currently selected conversation and do not add visible transcript rows for operator guidance.

- [ ] Route every new label, placeholder, and status string through `src/ui/i18n.ts`, with both English and Simplified Chinese coverage. Keep the copy framed as guidance for the local Bot, not a direct message to the remote Bot.

- [ ] Extend `tests/daemon/httpServer.test.mjs` page-render coverage so `/ui/conversations` includes the new guidance affordance in both languages. This is only for rendered copy/markup presence; behavior stays in the page-script test.

- [ ] Re-run the targeted UI tests:

  ```bash
  npm run build && node --test tests/ui/conversationsPageScript.test.mjs tests/daemon/httpServer.test.mjs
  ```

  Expected passing result: the page script and rendered HTML both cover the new guidance control and localized copy.

- [ ] Commit this unit:

  ```bash
  git add src/ui/pages/conversations/app.ts src/ui/i18n.ts tests/ui/conversationsPageScript.test.mjs tests/daemon/httpServer.test.mjs
  git commit -m "feat(ui): add conversations guidance composer"
  ```

  Expected result: one commit containing only the Conversations UI and i18n work.

- [ ] Post the required development journal:

  ```bash
  post_buzz "Development journal: added the Conversations footer guidance control, localized copy, and page-script coverage so a human can steer only the next local Bot turn without becoming a visible chat participant. Commit $(git rev-parse --short HEAD)."
  ```

  Expected result: the buzz post succeeds and returns a `pinId`.

## 6. Run The Focused End-To-End Verification Set

**Files:** none beyond the implemented feature set above

**Tests:**
- `git diff --check`
- `npm run build`
- `node --test tests/chat/privateChatStateStore.test.mjs tests/chat/hostLlmChatReplyRunner.test.mjs tests/chat/privateChatAutoReply.test.mjs tests/daemon/defaultConversationsHandlers.test.mjs tests/daemon/httpServer.test.mjs tests/ui/conversationsPageScript.test.mjs`

- [ ] Run whitespace and merge-conflict hygiene first:

  ```bash
  git diff --check
  ```

  Expected result: no diff hygiene errors.

- [ ] Run the focused build and targeted feature suite:

  ```bash
  npm run build
  node --test tests/chat/privateChatStateStore.test.mjs tests/chat/hostLlmChatReplyRunner.test.mjs tests/chat/privateChatAutoReply.test.mjs tests/daemon/defaultConversationsHandlers.test.mjs tests/daemon/httpServer.test.mjs tests/ui/conversationsPageScript.test.mjs
  ```

  Expected passing result: the build succeeds and every guided-local-turn test passes without needing the full `npm test` suite.

- [ ] Record the final branch state before asking for merge/review:

  ```bash
  git status --short --branch
  git log --oneline --decorate -5
  ```

  Expected result: only the intended feature commits are present, with a clean or intentionally staged worktree.

- [ ] Stop here and request review or execution confirmation rather than inventing extra scope.
