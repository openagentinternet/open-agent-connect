# Unified A2A Caller And Trace Design

**Date:** 2026-05-01

## Goal

Unify private chat and buyer-side skill-service communication in `open-agent-connect` under one A2A model that matches the IDBots `/protocols/simplemsg` behavior closely enough for an `open-agent-connect` caller to pay for, request, observe, receive, and rate an IDBots-compatible MetaBot service.

This design is caller-first. It does not implement seller-side order orchestration in this round, but it must leave clean interfaces for that later work.

## Definition Of A2A

In this project, A2A means every encrypted MetaBot-to-MetaBot communication carried by `/protocols/simplemsg`.

A2A includes:

- ordinary private chat
- skill-service order request messages
- seller acknowledgement and progress messages
- service delivery messages
- rating requests
- buyer rating and order-end messages
- future refund, correction, and seller-side workflow messages

The transport is the same in all cases. The business meaning is derived from message content and metadata, not from a separate storage area or UI surface.

## Source References

### Current `open-agent-connect` surfaces

- `src/cli/commands/services.ts` handles `metabot services call` and `metabot services rate`.
- `src/cli/commands/chat.ts` handles `metabot chat private`.
- `src/daemon/defaultHandlers.ts` contains the current service-call, private-chat, trace, and session handlers.
- `src/core/chat/privateChat.ts` encrypts and decrypts `/protocols/simplemsg`.
- `src/core/chat/privateChatListener.ts` already listens to idchat.io and show.now socket.io endpoints for private messages.
- `src/core/chat/privateChatAutoReply.ts` persists current private-chat state and uses the existing LLM reply runner.
- `src/core/a2a/sessionStateStore.ts` stores current A2A sessions in `.runtime/sessions/a2a-session-state.json`.
- `src/core/a2a/metawebReplyWaiter.ts` waits for provider delivery replies after service calls.
- `src/core/orders/orderMessage.ts` builds the current `[ORDER]` payload.
- `src/core/orders/serviceOrderProtocols.ts` currently supports legacy unscoped `[DELIVERY]` and `[NEEDSRATING]`.
- `src/ui/pages/trace/*` is the current trace UI and already renders markdown plus `metafile://` media previews.
- `src/ui/pages/chat-viewer/*` is the old private-chat viewer and should stop being the primary A2A UI.

### IDBots reference behavior

IDBots is read-only for this project. The reference code lives under:

- `/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/src/main/shared/orderMessage.js`
- `/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/src/main/services/delegationOrderMessage.ts`
- `/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/src/main/services/serviceOrderProtocols.js`
- `/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/src/main/services/orderPayment.ts`
- `/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/src/main/services/metaWebListenerService.ts`
- `/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/src/main/services/privateChatDaemon.ts`
- `/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/src/main/services/simplemsgPeerConversation.ts`
- `/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/src/main/services/serviceOrderLifecycleService.ts`
- `/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/src/main/services/serviceOrderObserverSession.ts`
- `/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/src/renderer/components/cowork/A2AMessageItem.tsx`

## Non-Negotiable Requirements

1. All new storage must follow the MetaBot storage layout v2: profile-specific runtime files live under `~/.metabot/profiles/<slug>/.runtime/`.
2. This project must not add SQLite-backed A2A state for this feature. Runtime A2A data is JSON.
3. New code and docs must not depend on the legacy `.metabot/hot` layout.
4. IDBots code is reference-only and must not be modified.
5. The first implementation phase is caller/buyer-side only.
6. Seller-side order execution is out of scope for this round, but the protocol parser, store, listener, and trace projection must not block seller-side support later.
7. Private chat and skill-service messages must be stored in the same per-peer A2A conversation file.
8. `/ui/trace` is the primary A2A UI for both private chat and service orders.
9. Service and private-chat CLI results must return a trace URL that contains a `sessionId`.
10. Service calls must stop using synthetic payment txids when talking to an on-chain seller. A real payment or a valid free-order reference must be in the `[ORDER]` payload.

## IDBots Protocol Semantics To Match

### Protocol tags

`open-agent-connect` must support these IDBots-compatible tags:

| Tag | Direction in caller flow | Meaning |
|---|---|---|
| `[ORDER]` | buyer to seller | Starts a service order. Contains the raw request and structured payment/service metadata. |
| `[ORDER_STATUS:<orderTxid>]` | seller to buyer | Acknowledgement, progress, fallback, or non-terminal status for one order. |
| `[DELIVERY:<orderTxid>]` | seller to buyer | JSON delivery payload for one order. The payload can include markdown text and `metafile://` artifacts. |
| `[NeedsRating:<orderTxid>]` | seller to buyer | Seller asks buyer to rate the completed service. The tag casing is IDBots-compatible. |
| `[ORDER_END:<orderTxid> <reason>]` | usually buyer to seller | Terminal order message such as buyer rating and farewell. |

Legacy unscoped `[DELIVERY]` and `[NeedsRating]` should remain parseable for backward compatibility. The current `open-agent-connect` parser is also tolerant of the historical uppercase `[NEEDSRATING]` spelling, but new docs and outbound messages must use the IDBots canonical `[NeedsRating]` casing. New outbound service-order messages must use the scoped IDBots-compatible format whenever the order message txid is known.

### Parser API compatibility

The implementation must separate two concerns:

- IDBots-compatible protocol helpers in `src/core/a2a/protocol/orderProtocol.ts`.
- Legacy `open-agent-connect` helper exports in `src/core/orders/serviceOrderProtocols.ts`.

The new IDBots-compatible helpers should match the IDBots parser shapes:

- `parseDeliveryMessage(content)` returns the parsed JSON delivery payload directly, with `orderTxid` attached when the tag is scoped.
- `parseNeedsRatingMessage(content)` returns `{ orderTxid?: string; content: string }`.
- `parseOrderStatusMessage(content)` returns `{ orderTxid?: string; content: string }`.
- `parseOrderEndMessage(content)` returns `{ orderTxid?: string; reason: string; content: string }`.
- `parseOrderScopedProtocolMessage(content)` returns the first matching parser result directly, not an extra wrapper.

Existing `src/core/orders/serviceOrderProtocols.ts` exports must not be broken in the first protocol-parity task. In particular, current callers that expect `parseNeedsRatingMessage(content)` to return a string must either keep that legacy export or be updated in the same task with tests. New code that needs tag, `orderTxid`, and reason metadata should use `simplemsgClassifier` or new explicitly named scoped-parser helpers rather than changing an old export silently.

### `orderTxid` versus `paymentTxid`

This distinction is critical:

- `paymentTxid` is the transaction that transfers payment to the seller or commits the MRC20 payment.
- `orderTxid` is the txid of the buyer's `/protocols/simplemsg` `[ORDER]` message.

IDBots scopes follow-up protocol tags by `orderTxid`, not by `paymentTxid`. The buyer must therefore:

1. make or confirm payment first,
2. build the `[ORDER]` content with `paymentTxid`,
3. send the encrypted simplemsg order,
4. persist the order message txid as `orderTxid`,
5. match `[DELIVERY:<orderTxid>]`, `[NeedsRating:<orderTxid>]`, and `[ORDER_END:<orderTxid> ...]` back to that order.

If the order simplemsg write result exposes only `pinId`, derive txid from a `64hex + iN` pin id when possible and keep both fields.

### `[ORDER]` payload fields

The order payload must keep the current raw request block and add the IDBots payment/service fields:

```text
[ORDER] <display summary>
<raw_request>
<human task text>
</raw_request>
支付金额 <amount> <currency>
txid: <paymentTxid>
commit txid: <paymentCommitTxid>
payment chain: <mvc|btc|doge>
settlement kind: <native|mrc20>
mrc20 ticker: <ticker>
mrc20 id: <id>
service id: <servicePinId>
skill name: <providerSkill or serviceName>
output type: <text|image|video|audio|other>
```

Only include optional lines when values exist. Native SPACE/MVC orders do not need MRC20 fields.

### Delivery payload

New deliveries must parse this shape:

```json
{
  "paymentTxid": "64hex...",
  "servicePinId": "...",
  "serviceName": "...",
  "result": "Markdown text and metafile:// artifacts",
  "deliveredAt": 1770000000
}
```

The trace UI must render `result` as markdown and render every `metafile://` URI as a media preview or download card, reusing the existing `/ui/trace` rendering rules.

### Rating flow

When the caller receives `[NeedsRating:<orderTxid>]`:

1. find the order by `orderTxid`;
2. find the original `[ORDER]` raw request;
3. find the matching scoped `[DELIVERY:<orderTxid>]`;
4. ask the existing private-chat LLM reply path to produce a buyer-style rating and farewell;
5. publish `/protocols/skill-service-rate` when enough service metadata is present;
6. send `[ORDER_END:<orderTxid> rated] <rating text and optional rating pin reference>` through encrypted simplemsg;
7. persist the outbound order-end message in the same peer conversation file.

The rating text should be produced by the LLM, not by a hard-coded template, except for protocol wrapping and required chain metadata.

## Storage Design

### Directory

Add the A2A runtime directory under each MetaBot profile:

```text
~/.metabot/profiles/<slug>/.runtime/A2A/
  chat-<self8>-<peer8>.json
  chat-<self8>-<peer8>.json.lock
```

This directory extends the v2 runtime layer. It does not replace `.runtime/sessions/` immediately, but the new per-peer files become the durable source for simplemsg A2A transcripts.

### File naming

Use lowercase GlobalMetaId prefixes:

```text
chat-<localGlobalMetaId first 8>-<peerGlobalMetaId first 8>.json
```

Example:

```text
chat-idq14hmv-idq1g35d.json
```

If either id is missing, do not write a guessed filename. The caller should fail or wait until identity resolution succeeds.

### File ownership

Each local MetaBot profile owns its own copy of a peer conversation file. If two local MetaBots both talk to the same remote MetaBot, they must write separate files under their own profile runtime directories.

### Message retention

Each per-peer file keeps at most 2000 messages. Trimming removes oldest messages but must preserve enough session and order summary metadata to keep the UI usable.

### Schema

```json
{
  "version": 1,
  "local": {
    "profileSlug": "charles-zhang",
    "globalMetaId": "idq14hmv...",
    "name": "Charles",
    "avatar": "https://..."
  },
  "peer": {
    "globalMetaId": "idq1g35d...",
    "name": "Remote Bot",
    "avatar": "https://...",
    "chatPublicKey": "..."
  },
  "messages": [
    {
      "messageId": "pin-or-tx-derived-id",
      "sessionId": "a2a-peer-idq14hmv-idq1g35d",
      "orderSessionId": "a2a-order-<orderTxid>",
      "direction": "outgoing",
      "kind": "private_chat",
      "protocolTag": null,
      "orderTxid": null,
      "paymentTxid": null,
      "content": "plaintext after decryption",
      "contentType": "text/plain",
      "chain": "mvc",
      "pinId": "....i0",
      "txid": "64hex...",
      "txids": ["64hex..."],
      "replyPinId": null,
      "timestamp": 1770000000000,
      "chainTimestamp": 1770000000,
      "sender": {
        "globalMetaId": "idq14hmv...",
        "name": "Charles",
        "avatar": "https://...",
        "chatPublicKey": "..."
      },
      "recipient": {
        "globalMetaId": "idq1g35d...",
        "name": "Remote Bot",
        "avatar": "https://..."
      },
      "raw": {
        "socket": {}
      }
    }
  ],
  "sessions": [
    {
      "sessionId": "a2a-peer-idq14hmv-idq1g35d",
      "type": "peer",
      "state": "active",
      "createdAt": 1770000000000,
      "updatedAt": 1770000000000,
      "latestMessageId": "..."
    },
    {
      "sessionId": "a2a-order-<orderTxid>",
      "type": "service_order",
      "role": "caller",
      "state": "awaiting_delivery",
      "orderTxid": "<order simplemsg txid>",
      "paymentTxid": "<payment txid>",
      "servicePinId": "...",
      "serviceName": "...",
      "outputType": "text",
      "createdAt": 1770000000000,
      "updatedAt": 1770000000000,
      "firstResponseAt": null,
      "deliveredAt": null,
      "ratingRequestedAt": null,
      "endedAt": null,
      "endReason": null,
      "failureReason": null
    }
  ],
  "indexes": {
    "messageIds": ["..."],
    "orderTxidToSessionId": {
      "<orderTxid>": "a2a-order-<orderTxid>"
    },
    "paymentTxidToSessionId": {
      "<paymentTxid>": "a2a-order-<orderTxid>"
    }
  },
  "updatedAt": 1770000000000
}
```

Implementation can keep indexes as derived data if that is simpler, but tests must prove that lookup by peer, `sessionId`, `orderTxid`, and `paymentTxid` is deterministic.

### Plaintext rule

The per-peer A2A JSON stores decrypted plaintext. It must not store local private keys, wallet mnemonics, or signing secrets.

### Compatibility with existing state

Existing `.runtime/sessions/a2a-session-state.json` and `.runtime/state/private-chat-state.json` may be read during transition, but new simplemsg messages should be written through the unified per-peer A2A store. Trace routes should project from the unified store first, then fall back to existing session state only for older records.

The old private-chat viewer and `privateChatStateStore` are legacy surfaces. This design does not require new unified-store traffic to be mirrored back into `privateChatStateStore`. If `/ui/chat-viewer` remains mounted during migration, it is a deprecated legacy viewer and must not be the URL returned by new A2A commands. If product compatibility later requires it to show new messages, add an explicit projection task from unified A2A storage to the chat-viewer API instead of relying on incidental dual writes.

## Listener Design

### Socket endpoints

The default listener uses the IDBots endpoint order:

1. `wss://api.idchat.io` with path `/socket/socket.io`
2. `wss://www.show.now` with path `/socket/socket.io`

Both endpoints use `type=pc` and `metaid=<localGlobalMetaId>`.

### Listener cardinality

Daemon startup should create one listener per local MetaBot profile that has:

- a `globalMetaId`,
- a private chat key,
- A2A listening enabled.

If there are `n` local MetaBots, there should be `n` logical listeners. A listener may internally connect to two endpoints for fallback, but deduplication must be by `pinId` or txid.

This is a real multi-profile daemon capability, not a drop-in change to the current active-profile listener. The implementation must explicitly read the manager profile registry, resolve each profile runtime path and secret store, instantiate profile-scoped stores, and keep failures isolated so one broken profile does not stop listeners for other profiles.

### Configuration

Add a profile runtime config setting to disable A2A listeners:

```json
{
  "a2a": {
    "simplemsgListenerEnabled": true
  }
}
```

The default is enabled.

### Message normalization

The listener must normalize all incoming and outbound chain writes to one `A2AConversationMessage` shape before persistence:

- resolve local and peer GlobalMetaId,
- resolve names and avatars when available,
- decrypt inbound content,
- classify protocol kind,
- attach chain identity,
- append to the per-peer JSON file,
- update session and order indexes.

### Classification

Classification must return:

- `private_chat`
- `order_protocol:ORDER`
- `order_protocol:ORDER_STATUS`
- `order_protocol:DELIVERY`
- `order_protocol:NeedsRating`
- `order_protocol:ORDER_END`

Unknown plaintext remains `private_chat`. Unknown bracketed tags should be preserved as private chat content rather than dropped.

## Caller Service Flow

### 1. Plan and confirmation

`metabot services call` keeps the existing confirmation behavior:

- resolve provider service,
- show provider, service, price, and currency,
- wait for explicit human confirmation before any paid transfer.

### 2. Payment

After confirmation, the caller must execute or verify the payment before sending `[ORDER]`.

The implementation must add a reusable payment execution boundary instead of using `buildSyntheticPaymentTxid`. A seller that follows IDBots `orderPayment.ts` will reject synthetic payment values.

Required payment result:

```ts
interface A2AOrderPaymentResult {
  paymentTxid: string;
  paymentCommitTxid?: string | null;
  paymentChain: 'mvc' | 'btc';
  paymentAmount: string;
  paymentCurrency: string;
  settlementKind: 'native';
  totalCost?: number | null;
  network?: string | null;
}
```

Free services may use an order reference id instead of a payment txid if that matches the seller-side parser, but paid services must use real payment data.

The current repository only exposes enough service schema and wallet-transfer machinery for native SPACE/MVC and BTC payment flows. MRC20 and DOGE fields are protocol-compatible metadata that should be parsed and preserved when observed, but this caller phase must fail before order send for unsupported settlement modes unless the same implementation task explicitly adds the missing service schema, wallet executor, and tests. Do not synthesize `paymentChain`, `settlementKind`, or MRC20 metadata from thin service rows without a deterministic rule.

### 3. Trace URL before order send

After payment succeeds and before or immediately after the order simplemsg is broadcast, create a local trace/session projection and return a URL of this form:

```text
http://127.0.0.1:<daemonPort>/ui/trace?sessionId=<sessionId>&traceId=<traceId>
```

The `sessionId` is required. `traceId` remains useful for older trace APIs and logs.

### 4. Order send

The caller builds IDBots-compatible `[ORDER]`, encrypts it with the existing simplemsg ECDH path, writes it to `/protocols/simplemsg`, then appends the outbound plaintext and chain metadata to the per-peer A2A JSON file.

The order session remains in `order_pending` until the order message txid is known, then stores:

- `orderTxid`,
- `orderMessagePinId`,
- `paymentTxid`,
- service metadata,
- trace id,
- peer id.

### 5. Waiting and rendering

The daemon should keep the background continuation behavior that waits for seller replies, but it should read the unified per-peer store instead of relying only on the older `metawebReplyWaiter` transcript.

The CLI and host skill should render:

- trace URL immediately after order creation,
- progress status if available,
- delivery markdown in the host conversation,
- `metafile://` links as normal markdown links if the host cannot inline media,
- final trace URL after success, failure, timeout, or refund-required state.

### 6. Delivery

On `[DELIVERY:<orderTxid>]`:

- append message to the peer file,
- parse delivery JSON,
- update order session to delivered,
- expose `resultText` and any `metafile://` artifacts to `/api/trace/sessions/<sessionId>`,
- let the host poll path return the result.

### 7. Needs rating

On `[NeedsRating:<orderTxid>]`:

- append message,
- update order session to rating requested,
- use existing private-chat LLM route to generate the buyer rating/farewell,
- publish `/protocols/skill-service-rate` if required fields exist,
- send `[ORDER_END:<orderTxid> rated] ...`,
- append the outbound order-end message,
- update order session to completed or ended.

### 8. Timeout or failure

On timeout or deterministic failure:

- keep the session visible in `/ui/trace`,
- return a final trace URL with `sessionId`,
- preserve all messages received so far,
- do not claim seller failure if no scoped terminal message was received.

## Private Chat Flow

`metabot chat private` should use the same store and UI:

1. resolve peer chat public key,
2. encrypt and write `/protocols/simplemsg`,
3. append outbound plaintext to the per-peer A2A JSON file,
4. create or update the peer session,
5. return `localUiUrl` as `/ui/trace?sessionId=<peerSessionId>`.

Incoming private-chat messages from the listener append to the same file. Existing auto-reply behavior should be preserved, including:

- skip empty messages,
- skip `Thinking...`,
- skip punctuation-only messages,
- stop on exact `bye`,
- reset ordinary private chat after the inactivity gap,
- display ordinary private-chat messages during active orders without letting them corrupt order protocol matching.

## Trace UI And API

### URL contract

`/ui/trace` must support:

```text
/ui/trace?sessionId=<sessionId>
/ui/trace?sessionId=<sessionId>&traceId=<traceId>
/ui/trace?traceId=<traceId>
```

`sessionId` has priority. `traceId` is a fallback for old links.

### API projection

`/api/trace/sessions` should list projected A2A sessions from the unified store:

- peer private-chat sessions,
- buyer service-order sessions,
- later seller service-order sessions.

`/api/trace/sessions/<sessionId>` should return:

- session summary,
- peer profile,
- local profile,
- order summary when present,
- messages already normalized for the trace view model,
- delivery result metadata,
- status and timestamps.

### UI behavior

The existing trace page layout should be retained unless a specific UI issue blocks the new flow. The page should:

- select the URL `sessionId` on load,
- poll the selected session JSON projection,
- render private chat and service-order messages in the same timeline,
- visually distinguish protocol tags without hiding the plaintext,
- render markdown and `metafile://` previews using the existing trace renderer,
- show `orderTxid`, `paymentTxid`, and `pinId` as copyable technical metadata where the current layout already supports metadata.

The old `/ui/chat-viewer` route can remain temporarily as a deprecated legacy entrypoint, but new CLI and skill outputs must point to `/ui/trace`. New unified-store traffic is not required to appear in chat-viewer unless a separate projection task is approved.

## Module Boundaries

### New or changed core modules

| Module | Responsibility |
|---|---|
| `src/core/a2a/protocol/orderProtocol.ts` | Build and parse IDBots-shaped protocol tags and order payloads without silently breaking legacy `src/core/orders/serviceOrderProtocols.ts` callers. |
| `src/core/a2a/conversationTypes.ts` | Shared per-peer store and message types. |
| `src/core/a2a/conversationStore.ts` | Atomic JSON read/write, locking, trimming, and lookup for `.runtime/A2A/chat-*.json`. |
| `src/core/a2a/simplemsgClassifier.ts` | Classify plaintext into private chat or order protocol kind. |
| `src/core/a2a/simplemsgListener.ts` | Multi-profile socket listener orchestration and message normalization. |
| `src/core/a2a/callerOrderLifecycle.ts` | Caller order state transitions, delivery handling, rating flow, timeout handling. |
| `src/core/a2a/traceProjection.ts` | Project per-peer JSON into trace API/session view models. |
| `src/core/payments/servicePayment.ts` | Reusable service payment execution/verification boundary for caller order creation. |

Existing modules should be adapted rather than rewritten in place when possible.

### Daemon integration

`src/daemon/defaultHandlers.ts` is already too large. New behavior should move into focused core modules and keep daemon handlers thin:

- `services.call` delegates to payment, order lifecycle, and store modules.
- `chat.private` delegates to conversation store and trace URL projection.
- `trace.listSessions` and `trace.getSession` delegate to trace projection.
- daemon startup wires the multi-profile listener lifecycle.

### CLI and skill integration

CLI and skill behavior should remain machine-first:

- paid service calls still require explicit human confirmation,
- `waiting` responses include `traceId`, `sessionId`, and `localUiUrl`,
- polling returns delivery text to the current host session,
- final responses repeat the trace URL.

## Implementation Phases

### Phase 1: Protocol parity and caller order correctness

Deliverables:

- IDBots-compatible protocol parser/builder.
- Real payment execution boundary replacing synthetic payment txids for on-chain seller calls.
- Caller `[ORDER]` send with required payment/service metadata.
- Trace URL includes `sessionId`.
- Existing waiter can still be used, but scoped tags must parse correctly.

### Phase 2: Unified per-peer A2A store and listener

Deliverables:

- `.runtime/A2A/chat-<self8>-<peer8>.json` store.
- One listener per local MetaBot profile with idchat/show.now fallback.
- Listener appends decrypted plaintext messages into per-peer files.
- Service and private-chat outbound writes append to the same files.
- Old stores remain read-only compatibility sources.

### Phase 3: Trace UI unification and rating closure

Deliverables:

- `/ui/trace?sessionId=...` selects exact sessions.
- Private chat uses trace page, not chat-viewer.
- Delivery markdown and media render in trace and host session.
- `[NeedsRating:<orderTxid>]` triggers LLM-generated rating and `[ORDER_END:<orderTxid> rated]`.
- Final success/failure outputs include trace URL again.

## Acceptance Criteria

1. A paid `metabot services call` sends an encrypted `/protocols/simplemsg` `[ORDER]` that IDBots seller code can parse and verify.
2. The `[ORDER]` payload contains real payment metadata and does not use a synthetic payment txid.
3. The order simplemsg txid becomes `orderTxid` and scopes delivery/rating/end messages.
4. Incoming `[DELIVERY:<orderTxid>]` updates the correct order session and returns markdown result text to the caller.
5. Incoming `[NeedsRating:<orderTxid>]` causes the caller to publish a rating and send `[ORDER_END:<orderTxid> rated]`.
6. `metabot services call` returns a trace URL with `sessionId` before waiting and again after terminal status.
7. `metabot chat private` returns `/ui/trace?sessionId=...`.
8. Private chat and service messages with the same peer are stored in one per-peer JSON file.
9. Each per-peer file is capped at 2000 messages.
10. `/ui/trace?sessionId=...` shows the exact peer/order session and polls for new JSON-backed messages.
11. `npm test` passes after each implementation phase.

## Review Questions

These are the main points to confirm before implementation:

1. The scoped protocol should use the order simplemsg txid as `orderTxid`, matching IDBots, even though payment verification uses `paymentTxid`.
2. The runtime directory should use the requested `.runtime/A2A/` casing.
3. Phase 1 may add the real payment boundary and scoped protocol before the full per-peer listener/store lands, as long as later phases complete the unified storage requirement.
4. The old `/ui/chat-viewer` route can remain as a deprecated legacy viewer, but no new successful command should point users there and new unified traffic does not need to be mirrored into its old store.
