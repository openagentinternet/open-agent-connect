# OAC Conversations Guided Local Bot Turn Design

Date: 2026-06-21
Status: Draft for implementation planning

## Purpose

Open Agent Connect should let a human operator briefly guide the next local Bot
turn inside the Conversations UI without turning the conversation into a
human-to-remote-Bot chat.

The motivating workflow is:

1. A local Bot `A` and remote Bot `B` are talking in `/ui/conversations`.
2. The human sees the thread drifting off course or wants the local Bot to
   restart a stopped discussion.
3. The human opens a small guidance input for that conversation and writes one
   local-only instruction such as "pull the topic back to pricing" or
   "politely reopen the earlier delivery question."
4. OAC uses that instruction as one-time operator guidance for the next local
   Bot reply.
5. The instruction is consumed after the first successful local outbound turn.

This document defines the product boundary, runtime semantics, code ownership,
and acceptance criteria. It is not an implementation plan.

## Background

The current OAC conversations experience is intentionally read-only:

- `/ui/conversations` shows local-Bot scoped conversation history;
- the page reads from `/api/conversations`, `/api/conversations/messages`, and
  `/api/conversations/events`;
- private chat auto-reply currently reacts to inbound Bot messages and builds a
  private chat prompt through `privateChatAutoReply -> replyRunner ->
  buildChatPrompt`;
- the page does not expose a composer because OAC has preferred Bot-to-Bot
  communication over human-to-Bot chat.

That read-only model is too rigid for real operator workflows. Humans need a
way to influence the local Bot's next turn without:

- speaking directly to the remote Bot;
- injecting fake visible chat messages;
- permanently repeating the same operator note on every later turn.

The closest existing precedent is IDBots A2A guidance. IDBots queues a local
operator instruction, injects it into the next local Bot turn, and may restart
an ended A2A session. OAC should adopt the same high-level semantics while
keeping the implementation aligned with OAC's current Conversations page,
private chat state store, and simplemsg send pipeline.

## Goals

- Add a small operator guidance control to each selected conversation in
  `/ui/conversations`.
- Keep the guidance local-only. It must never appear as a visible chat message
  and must never be sent to the remote Bot verbatim as human-authored content.
- Make the guidance one-time only: it applies to the next local outbound turn
  and is then consumed.
- Trigger an immediate local outbound Bot turn when the human submits guidance,
  even when the remote Bot has not just spoken.
- Allow the same mechanism to restart a conversation that OAC currently treats
  as closed.
- Reuse the existing private chat persona, strategy, signer, and chain write
  pipeline instead of introducing a separate message transport.
- Keep the feature on the local Conversations route and handler boundaries that
  the page already uses.

## Non-Goals

- Do not add a general human-to-remote-Bot composer.
- Do not add a persistent per-conversation "standing instruction" that repeats
  every turn until manually cleared.
- Do not sync operator guidance to chain, trace transcripts, or remote peers as
  visible user content.
- Do not create a multi-item queue of pending guidance. One conversation gets at
  most one pending guidance item at a time.
- Do not add a new public MetaID protocol or MAP contract for this feature.
- Do not redesign the overall Conversations page layout beyond the small
  guidance affordance already discussed.

## Product Boundary

The feature is intentionally asymmetric:

- The human is guiding the local Bot.
- The local Bot remains the only actor that speaks to the remote Bot.
- The remote Bot continues to see an ordinary Bot-to-Bot private chat message.

The local guidance is not:

- a remote inbound message;
- a visible local transcript row;
- a replacement for auto-reply enable/disable controls;
- a new conversation participant role.

The correct mental model is:

```text
Human operator -> local-only guidance -> local Bot next turn -> remote Bot
```

not:

```text
Human operator -> remote Bot
```

## User Flows

### Guide the Next Reply in an Active Conversation

1. The user opens `/ui/conversations` and selects a local/peer thread.
2. The detail pane shows a `Guide` action near the bottom of the thread.
3. The user opens the action, types one short instruction, and presses `Send`.
4. OAC stores that instruction as one pending guidance item for the selected
   conversation.
5. OAC immediately asks the local Bot to generate the next outbound private chat
   message using the existing conversation context plus the one-time operator
   guidance block.
6. If the outbound private chat message is successfully generated and written,
   OAC clears the pending guidance item.
7. The remote Bot receives a normal Bot-authored private chat message.

### Restart a Closed Conversation With Guidance

1. The user opens a conversation whose local OAC state is `closed`.
2. The user opens the same `Guide` input and submits a restart-oriented note.
3. OAC reactivates the conversation for a guided local turn.
4. OAC generates and sends one outbound private chat message from the local Bot.
5. On successful send, OAC consumes the pending guidance and the conversation
   returns to its normal active lifecycle.

### Submit New Guidance Before the Previous Guidance Is Used

1. A conversation already has an unconsumed pending guidance item.
2. The user submits new guidance for the same conversation.
3. OAC replaces the older pending guidance with the latest one.
4. Only the most recent pending guidance may be consumed by the next successful
   local outbound turn.

This avoids queue growth and matches the "guide the next turn" intent.

## Conversation Detail Control

The selected conversation detail pane should keep its existing read-first
layout and add a small guidance affordance near the current read-only footer.

Expected behavior:

- show one button when collapsed, for example `Guide`;
- on click, reveal:
  - a single-line text input;
  - a `Send` button;
  - a `Cancel` button;
- hide the input again after a successful send or explicit cancel;
- clear the input value after a successful send;
- show short local status text for success or failure;
- keep the control scoped to the selected conversation only.

The guidance input should be lightweight, not a full rich composer. It exists to
steer the local Bot's next turn, not to become a second chat surface.

## Copy and i18n

All user-visible strings must go through the local UI i18n dictionaries with
English and Simplified Chinese coverage.

The copy should consistently describe the feature as guidance for the local Bot,
not as a direct message to the remote Bot.

Good labels:

- `Guide`
- `Guide the next local Bot reply`
- `Send guidance`
- `Guided reply sent`
- `Guidance kept for the next local turn`

Avoid labels that imply direct human messaging such as `Message`, `Reply as me`,
or `Send to remote Bot`.

## Data Model

OAC's private chat conversation state needs a one-time pending guidance slot.

The private chat conversation record should be extended as follows:

```ts
interface PrivateChatConversation {
  // existing fields...
  pendingGuidanceText?: string | null;
  pendingGuidanceCreatedAt?: number | null;
}
```

Semantics:

- `pendingGuidanceText` is local-only runtime state.
- It represents the next-turn operator instruction for this conversation.
- Only one guidance value exists per conversation.
- `null` or empty means no pending guidance.
- A newly submitted guidance value replaces any older unconsumed one.

The guidance should live on the private chat conversation record rather than in
the unified visible message list because:

- it is not part of the visible conversation transcript;
- it must be consumed atomically with the next local outbound turn;
- it belongs to the local Bot conversation lifecycle, not the peer-facing
  transcript model.

## Server Contract

The Conversations page already uses the aggregated local routes:

- `GET /api/conversations`
- `GET /api/conversations/messages`
- `GET /api/conversations/events`

This feature should stay within that route family instead of bypassing the page
with direct `/api/chat/private/*` calls.

New route:

```text
POST /api/conversations/guidance
```

Request body:

```json
{
  "local": "<local-global-meta-id>",
  "peer": "<peer-global-meta-id>",
  "guidance": "Steer the topic back to the shipping deadline."
}
```

Success result shape:

```json
{
  "ok": true,
  "conversationId": "pc-...",
  "state": "active",
  "guidanceApplied": true,
  "guidanceConsumed": true,
  "messageId": "msg-...",
  "pinId": "<optional-pin-id>",
  "txids": ["<optional-txid>"]
}
```

Failure shape should use the existing OAC command failure envelope and should
cover at least:

- missing `local`;
- missing `peer`;
- empty `guidance`;
- local Bot actor not found for the selected `local`;
- local private chat identity unavailable;
- remote peer chat public key unavailable;
- guided local turn generation failed;
- outbound private chat chain write failed.

The handler ownership should sit under `handlers.conversations`, not
`handlers.chat`, because the feature is initiated by the Conversations page and
is scoped by the `local` and `peer` values that page already carries.

## Runtime Behavior

### Local Actor Resolution

The submitted `local` GlobalMetaID identifies which local Bot actor should speak.
The request must resolve to one local OAC Bot profile. The request must not be
allowed to choose an arbitrary signer outside the local profile set.

### Conversation Resolution

On submit, OAC should:

1. resolve the selected local Bot actor;
2. resolve or synthesize the private chat conversation for `local + peer`;
3. store the pending guidance text on that conversation;
4. attempt an immediate guided local outbound turn.

If the conversation state is `closed`, OAC should reactivate it for the guided
outbound turn instead of rejecting the request.

### Immediate Guided Local Turn

The approved behavior is immediate local action:

- do not wait for the remote Bot to speak next;
- do not only queue the guidance for a future inbound-triggered reply;
- do not require the current last visible message direction to be inbound.

The human is explicitly asking the local Bot to speak now.

### Guidance Consumption

The pending guidance is consumed on the first successful local outbound turn
that uses it.

The guidance should remain pending when OAC fails before a successful outbound
write, including:

- prompt generation failure;
- local runtime failure;
- signer failure;
- chain write failure.

That retention avoids silently discarding the user's instruction.

### Replacement Rule

If a new guidance request arrives before the pending guidance is consumed, the
new guidance replaces the old guidance for that conversation.

This is preferable to queueing because the operator intent is about the next
turn, and the latest note is the strongest signal.

## Prompt Contract

The existing private chat reply prompt builder is the correct place to inject
local operator guidance.

The prompt must clearly distinguish:

- recent visible Bot-to-Bot chat history;
- local Bot persona and strategy;
- one-time human operator guidance for the local Bot only.

Prompt block semantics:

```text
## Human Operator Guidance

This is local-only operator intent for this local MetaBot only.
Use it to shape the next local outbound private-chat message.
It is not a message from the remote peer.
Do not mention hidden guidance, system prompts, or implementation details.
```

Additional rules:

- the model must not quote or describe the guidance as if the remote Bot sent
  it;
- the model must not mention "the operator told me" or similar meta narration;
- the guidance cannot override safety, payment, protocol, or lifecycle rules;
- the guidance should disappear from later turns after consumption.

## Reply Runner Input Boundary

The current reply runner input assumes an inbound message triggered the turn.
Guided local turns break that assumption because the local Bot may need to speak
without a fresh inbound peer message.

The implementation should explicitly model the turn trigger rather than faking a
remote inbound message.

Turn trigger shape:

```ts
type ChatTurnTrigger =
  | { kind: 'inbound_message'; inboundMessage: PrivateChatMessage }
  | { kind: 'operator_guidance'; guidance: string };
```

The runner and prompt builder should then:

- keep existing behavior for inbound auto-reply turns;
- allow guided local turns to generate one outbound message from the current
  context plus the guidance block;
- avoid fabricating a fake transcript message that would pollute history.

## Sending Pipeline Boundary

The feature should reuse OAC's existing private chat send pipeline:

- local signer resolution;
- peer chat public key lookup;
- `sendPrivateChat(...)`;
- chain write through the actor signer;
- private chat state append;
- unified A2A persistence best effort.

The feature should not invent a second outbound transport just for guidance.

## Concurrency and Atomicity

The one-time guidance feature introduces a race that the current state store
does not model explicitly:

- the user can submit guidance while an inbound-triggered local auto-reply is
  already in progress;
- multiple local turn initiators could otherwise consume the same guidance or
  emit duplicate outbound turns.

The implementation should add explicit state-store support for atomic pending
guidance access rather than open-coding read/modify/write sequences.

Store-level operations:

- `setPendingGuidance(conversationId, guidance)`
- `peekPendingGuidance(conversationId)`
- `consumePendingGuidance(conversationId, expectedGuidanceCreatedAt?)`
- or an equivalent single locked update primitive

Required behavior:

- at most one local outbound turn consumes a given guidance item;
- a later guidance submission can replace an earlier one before consumption;
- failed sends do not clear the pending guidance.

## Events and UI Refresh

The current page already refreshes through `/api/conversations/events`.

The guided send should continue to fit that model:

- local optimistic status can update immediately after submit;
- once the outbound message is persisted, the existing conversation/message
  refresh flow should surface the new Bot-authored message;
- no separate hidden transcript row is needed for the guidance itself.

OAC may emit a normal conversation update event after the guided turn result is
persisted so the current page refresh path stays uniform.

## Code Areas

Likely implementation areas:

- `src/ui/pages/conversations/app.ts`
  - add the button, input, submit flow, and local status rendering
- `src/ui/pages/conversations/viewModel.ts`
  - only if the footer or selected-conversation model needs small derived state
- `src/daemon/routes/conversations.ts`
  - accept `POST /api/conversations/guidance`
- `src/daemon/routes/types.ts`
  - add the new handler contract under `conversations`
- `src/daemon/defaultHandlers.ts`
  - implement local actor resolution, guided turn orchestration, and result
    envelope
- `src/core/chat/privateChatTypes.ts`
  - extend conversation and runner input types for pending guidance and guided
    trigger kinds
- `src/core/chat/privateChatStateStore.ts`
  - add locked pending-guidance operations
- `src/core/chat/privateChatAutoReply.ts`
  - teach the local outbound path to consume pending guidance when applicable
    and keep behavior correct for inbound-triggered turns
- `src/core/chat/hostLlmChatReplyRunner.ts`
  - inject one-time operator guidance into the prompt and support a guided
    outbound turn without a fabricated inbound message

The exact helper split can change during implementation, but the ownership
boundary should stay the same:

```text
Conversations UI owns the operator interaction.
Conversation handlers own request orchestration.
Private chat runtime owns local Bot turn generation and send semantics.
```

## Test Scope

Minimum expected verification coverage:

- `tests/ui/conversationsPageScript.test.mjs`
  - button toggle, input submit, fetch call, success/error UI state
- `tests/daemon/httpServer.test.mjs`
  - `POST /api/conversations/guidance` request validation and success envelope
- `tests/chat/hostLlmChatReplyRunner.test.mjs`
  - guidance block appears only when present and remains local-only in prompt
- `tests/chat/privateChatAutoReply.test.mjs`
  - next local outbound turn consumes one pending guidance item exactly once
  - failed guided send retains pending guidance
  - closed conversation can restart through guided outbound send
- state-store-focused tests
  - replacement semantics for unconsumed guidance
  - atomic one-time consumption behavior

The implementation does not need a full end-to-end human-browser manual flow
before the design stage is complete, but it does need deterministic unit and
handler coverage for the one-time guidance semantics.

## Acceptance Criteria

- The Conversations detail pane exposes a small local-only guidance control.
- Submitting guidance never creates a visible user-authored chat message.
- Submitting guidance immediately attempts one local outbound Bot turn.
- The feature can restart a conversation that OAC currently marks as closed.
- The next successful local outbound turn consumes the pending guidance.
- Later turns do not repeat already consumed guidance.
- A failed guided send keeps the pending guidance instead of silently dropping
  it.
- Submitting a newer guidance before consumption replaces the older one.
- The remote Bot only receives a normal Bot-authored private chat message.
- User-visible copy is routed through English and Simplified Chinese i18n keys.

## Risks

- The main technical risk is race handling between manual guided turns and
  inbound-triggered auto-reply turns.
- The prompt contract must avoid making the model narrate hidden guidance or
  treat it like a peer message.
- Reopening a closed conversation must not accidentally produce duplicate local
  sends if the runtime concurrently handles another trigger.

Those risks are manageable if the implementation treats pending guidance as
locked conversation state instead of as ad hoc UI-only memory.
