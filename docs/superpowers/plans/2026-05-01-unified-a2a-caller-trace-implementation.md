# Unified A2A Caller And Trace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement caller-side IDBots-compatible A2A service orders and unified private-chat/service trace viewing for `open-agent-connect`.

**Architecture:** Add focused A2A protocol, storage, listener, caller-order, and trace-projection modules, then wire existing CLI/daemon/UI surfaces through those modules. The per-peer JSON store under `.runtime/A2A/` becomes the durable simplemsg transcript source while current session/trace stores remain compatibility projection layers during migration.

**Tech Stack:** TypeScript, Node.js 20+, `node:test`, current MetaBot daemon/CLI, `socket.io-client`, profile runtime JSON storage.

**Spec:** `docs/superpowers/specs/2026-05-01-unified-a2a-caller-trace-design.md`

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `src/core/a2a/protocol/orderProtocol.ts` | IDBots-shaped `[ORDER]`, `[ORDER_STATUS]`, `[DELIVERY]`, `[NeedsRating]`, and `[ORDER_END]` build/parse helpers. Individual parser return shapes must match IDBots. |
| `src/core/a2a/simplemsgClassifier.ts` | Classify decrypted plaintext as private chat or an order protocol message. |
| `src/core/a2a/conversationTypes.ts` | Per-peer JSON schema and normalized message/session/order types. |
| `src/core/a2a/conversationStore.ts` | Atomic locked read/write for `.runtime/A2A/chat-<self8>-<peer8>.json`, trimming, dedupe, and lookup. |
| `src/core/a2a/simplemsgListener.ts` | Multi-profile socket listener manager with idchat.io primary and show.now fallback. |
| `src/core/a2a/callerOrderLifecycle.ts` | Caller-side order state transitions, scoped delivery handling, rating handling, and timeout/failure updates. |
| `src/core/a2a/traceProjection.ts` | Convert unified A2A JSON conversations into `/api/trace/sessions` list/detail view models. |
| `src/core/payments/servicePayment.ts` | Reusable service payment execution result boundary for paid service calls. |
| `tests/a2a/orderProtocolParity.test.mjs` | Protocol parity tests against the IDBots tag contract. |
| `tests/a2a/simplemsgClassifier.test.mjs` | Classification tests for private chat and scoped order protocol messages. |
| `tests/a2a/conversationStore.test.mjs` | Store naming, atomic write, trimming, dedupe, and lookup tests. |
| `tests/a2a/callerOrderLifecycle.test.mjs` | Caller order delivery/rating/end state tests. |
| `tests/a2a/traceProjectionUnifiedStore.test.mjs` | Trace projection tests from unified per-peer JSON. |
| `tests/payments/servicePayment.test.mjs` | Payment boundary tests proving no synthetic txid is used for paid orders. |

### Existing files to modify

| File | Change |
|---|---|
| `src/core/orders/orderMessage.ts` | Delegate to the new order protocol builder or gain the missing IDBots fields. |
| `src/core/orders/delegationOrderMessage.ts` | Include payment chain, settlement kind, commit txid, MRC20, and output type metadata. |
| `src/core/orders/serviceOrderProtocols.ts` | Wrap the new scoped protocol helpers while preserving legacy export shapes used by current callers. |
| `src/core/state/paths.ts` | Add `.runtime/A2A` path helpers without introducing SQLite. |
| `src/core/state/runtimeStateStore.ts` | Ensure `.runtime/A2A` exists in the v2 runtime layout. |
| `src/core/chat/privateChatAutoReply.ts` | Preserve existing LLM reply behavior while appending messages to unified A2A storage. Do not rely on dual-writing to legacy private-chat state for new trace behavior. |
| `src/core/chat/privateChatListener.ts` | Reuse or phase into the new multi-profile listener; do not lose existing decrypt behavior. |
| `src/core/a2a/metawebReplyWaiter.ts` | Parse scoped delivery/rating tags and optionally read unified store updates. |
| `src/daemon/defaultHandlers.ts` | Wire service call, private chat, trace list/detail, and listener startup to focused modules. |
| `src/daemon/routes/trace.ts` | Keep endpoints but allow detail lookup by unified session ids. |
| `src/daemon/routes/ui.ts` | Keep trace as primary. Leave chat-viewer only as a deprecated legacy route or redirect it later; do not return it from new A2A commands. |
| `src/cli/commands/services.ts` | Print and poll `sessionId`-bearing trace URLs. |
| `src/cli/commands/chat.ts` | Surface `/ui/trace?sessionId=...` for private chat sends. |
| `src/cli/runtime.ts` | Wire service payment dependency and trace session metadata through daemon calls. |
| `src/ui/pages/trace/sseClient.ts` | Select URL `sessionId`, poll exact session, and render unified message metadata. |
| `src/ui/pages/trace/viewModel.ts` | Accept private chat and order sessions from the unified projection. |
| `src/ui/pages/trace/index.html` | Minimal style refinements only if unified private-chat/order rows need labels. |
| `tests/orders/serviceOrderProtocols.test.mjs` | Extend tests for scoped IDBots-compatible tags. |
| `tests/cli/services.test.mjs` | Assert `sessionId` trace URL and real payment metadata behavior with mocks. |
| `tests/cli/trace.test.mjs` | Assert session detail lookup by unified session id. |
| `tests/chat/privateChatAutoReply.test.mjs` | Assert existing LLM behavior still works with unified persistence. |
| `tests/chat/privateChatStateStore.test.mjs` | Keep legacy store tests; add transition expectations only if touched. |
| `tests/ui/traceViewModel.test.mjs` | Assert private chat and service-order messages render from the new projection. |

---

## Phase 1: Protocol Parity And Caller Order Correctness

### Task 1: Add IDBots-compatible order protocol helpers

**Files:**
- Create: `src/core/a2a/protocol/orderProtocol.ts`
- Modify: `src/core/orders/serviceOrderProtocols.ts`
- Create: `tests/a2a/orderProtocolParity.test.mjs`
- Modify: `tests/orders/serviceOrderProtocols.test.mjs`

- [ ] **Step 1: Write failing protocol parity tests**

Create `tests/a2a/orderProtocolParity.test.mjs` with cases that assert:

```javascript
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('scoped protocol helpers match IDBots tag syntax', () => {
  const {
    buildOrderStatusMessage,
    buildDeliveryMessage,
    buildNeedsRatingMessage,
    buildOrderEndMessage,
    parseDeliveryMessage,
    parseNeedsRatingMessage,
    parseOrderScopedProtocolMessage,
  } = require('../../dist/core/a2a/protocol/orderProtocol.js');

  const orderTxid = 'a'.repeat(64);
  assert.equal(buildOrderStatusMessage(orderTxid, 'accepted'), `[ORDER_STATUS:${orderTxid}] accepted`);
  assert.equal(buildNeedsRatingMessage(orderTxid, 'please rate'), `[NeedsRating:${orderTxid}] please rate`);
  assert.equal(buildOrderEndMessage(orderTxid, 'rated', 'thanks'), `[ORDER_END:${orderTxid} rated] thanks`);

  const delivery = buildDeliveryMessage({ paymentTxid: 'b'.repeat(64), result: '# Done' }, orderTxid);
  assert.ok(delivery.startsWith(`[DELIVERY:${orderTxid}] `));
  assert.deepEqual(parseDeliveryMessage(delivery), {
    orderTxid,
    paymentTxid: 'b'.repeat(64),
    result: '# Done',
  });
  assert.deepEqual(parseOrderScopedProtocolMessage(delivery), {
    orderTxid,
    paymentTxid: 'b'.repeat(64),
    result: '# Done',
  });
  assert.deepEqual(parseNeedsRatingMessage(`[NeedsRating:${orderTxid}] please rate`), {
    orderTxid,
    content: 'please rate',
  });
});

test('legacy delivery and need-rating message helpers keep current open-agent-connect shapes', () => {
  const { parseDeliveryMessage, parseNeedsRatingMessage } = require('../../dist/core/orders/serviceOrderProtocols.js');
  assert.equal(parseDeliveryMessage('[DELIVERY] {"result":"ok"}').result, 'ok');
  assert.equal(parseNeedsRatingMessage('[NeedsRating] rate me'), 'rate me');
  assert.equal(parseNeedsRatingMessage('[NEEDSRATING] rate me'), 'rate me');
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
npm run build && node --test tests/a2a/orderProtocolParity.test.mjs tests/orders/serviceOrderProtocols.test.mjs
```

Expected: fail because `src/core/a2a/protocol/orderProtocol.ts` does not exist and current protocol helpers do not parse scoped tags.

- [ ] **Step 3: Implement protocol helpers**

Implement helpers with IDBots-shaped return contracts:

```ts
export type OrderProtocolTag = 'ORDER_STATUS' | 'DELIVERY' | 'NeedsRating' | 'ORDER_END';
export function normalizeOrderProtocolTxid(value: unknown): string;
export function buildOrderStatusMessage(orderTxid: string, content: string): string;
export function buildDeliveryMessage(payload: DeliveryMessagePayload, orderTxid?: string | null): string;
export function buildNeedsRatingMessage(orderTxid: string, content: string): string;
export function buildOrderEndMessage(orderTxid: string, reason: string, content: string): string;
export function parseOrderStatusMessage(content: string): ParsedOrderStatusMessage | null;
export function parseDeliveryMessage(content: string): ParsedDeliveryMessage | null;
export function parseNeedsRatingMessage(content: string): ParsedNeedsRatingMessage | null;
export function parseOrderEndMessage(content: string): ParsedOrderEndMessage | null;
export function parseOrderScopedProtocolMessage(content: string): ParsedOrderProtocolMessage | null;
```

`parseDeliveryMessage` returns the delivery payload object directly and attaches `orderTxid` when scoped. `parseNeedsRatingMessage`, `parseOrderStatusMessage`, and `parseOrderEndMessage` return IDBots-style objects with `content` and optional `orderTxid`.

Keep legacy parser behavior in `src/core/orders/serviceOrderProtocols.ts`. Do not silently change current callers that expect `parseNeedsRatingMessage(content)` to return a string. If you choose to migrate that old export to the IDBots object shape, update all current call sites and tests in the same task.

- [ ] **Step 4: Re-run the protocol tests**

Run:

```bash
npm run build && node --test tests/a2a/orderProtocolParity.test.mjs tests/orders/serviceOrderProtocols.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/a2a/protocol/orderProtocol.ts src/core/orders/serviceOrderProtocols.ts tests/a2a/orderProtocolParity.test.mjs tests/orders/serviceOrderProtocols.test.mjs
git commit -m "feat: add idbots-compatible a2a order protocol"
```

### Task 2: Expand order payload metadata

**Files:**
- Modify: `src/core/orders/orderMessage.ts`
- Modify: `src/core/orders/delegationOrderMessage.ts`
- Modify: `tests/orders/serviceOrderProtocols.test.mjs`
- Modify: `tests/cli/services.test.mjs`

- [ ] **Step 1: Write failing payload tests**

Add tests that call `buildOrderPayload` or `buildDelegationOrderPayload` with:

```js
{
  rawRequest: 'generate a release note',
  price: '0.01',
  currency: 'SPACE',
  paymentTxid: 'b'.repeat(64),
  paymentChain: 'mvc',
  settlementKind: 'native',
  serviceId: 'service-pin',
  skillName: 'release-note',
  outputType: 'text'
}
```

Assert the payload includes:

```text
[ORDER]
<raw_request>
generate a release note
</raw_request>
支付金额 0.01 SPACE
txid: bbbbb...
payment chain: mvc
settlement kind: native
service id: service-pin
skill name: release-note
output type: text
```

Add an MRC20 case that includes `commit txid`, `mrc20 ticker`, and `mrc20 id`.

- [ ] **Step 2: Run the failing tests**

Run:

```bash
npm run build && node --test tests/orders/serviceOrderProtocols.test.mjs tests/cli/services.test.mjs
```

Expected: fail because the current order payload lacks those metadata lines.

- [ ] **Step 3: Implement payload fields**

Extend order payload inputs with:

```ts
paymentCommitTxid?: unknown;
paymentChain?: unknown;
settlementKind?: unknown;
mrc20Ticker?: unknown;
mrc20Id?: unknown;
outputType?: unknown;
```

Only append non-empty optional lines.

- [ ] **Step 4: Re-run tests**

Run:

```bash
npm run build && node --test tests/orders/serviceOrderProtocols.test.mjs tests/cli/services.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/orders/orderMessage.ts src/core/orders/delegationOrderMessage.ts tests/orders/serviceOrderProtocols.test.mjs tests/cli/services.test.mjs
git commit -m "feat: include idbots order metadata in service requests"
```

### Task 3: Add service payment boundary and remove synthetic txid for paid orders

**Files:**
- Create: `src/core/payments/servicePayment.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `src/cli/runtime.ts`
- Create: `tests/payments/servicePayment.test.mjs`
- Modify: `tests/cli/services.test.mjs`

- [ ] **Step 1: Write failing payment tests**

Create tests that prove:

- paid service calls require a real payment result before `[ORDER]` is sent;
- the returned `paymentTxid` is the wallet transfer txid;
- `buildSyntheticPaymentTxid` is not used when `providerDaemonBaseUrl` is absent;
- free services may use an order reference id only when price is zero.
- unsupported settlement modes fail before order send with a machine-readable error.

Use dependency injection with a fake payment executor:

```js
const fakePaymentExecutor = async () => ({
  paymentTxid: 'c'.repeat(64),
  paymentChain: 'mvc',
  paymentAmount: '0.01',
  paymentCurrency: 'SPACE',
  settlementKind: 'native',
  totalCost: 123,
  network: 'mvc',
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
npm run build && node --test tests/payments/servicePayment.test.mjs tests/cli/services.test.mjs
```

Expected: fail because service calls currently build a synthetic payment txid.

- [ ] **Step 3: Implement `servicePayment.ts`**

Export:

```ts
export interface A2AOrderPaymentResult {
  paymentTxid: string;
  paymentCommitTxid?: string | null;
  paymentChain: 'mvc' | 'btc';
  paymentAmount: string;
  paymentCurrency: string;
  settlementKind: 'native';
  totalCost?: number | null;
  network?: string | null;
}

export interface ServicePaymentExecutor {
  execute(input: ServicePaymentExecutionInput): Promise<A2AOrderPaymentResult>;
}
```

Wire the daemon dependency so the handler can call this boundary before order build. If existing wallet transfer code only exists in `src/cli/runtime.ts`, extract the reusable logic behind this interface without changing the confirmation semantics.

For this phase, support native SPACE/MVC and BTC payments only, matching the current repository's service schema and transfer executor. Preserve MRC20 and DOGE fields in parsers for observed IDBots messages, but do not claim caller-side payment execution support for them until service publication, directory parsing, wallet transfer, and tests are added. If an advertised service requires unsupported settlement metadata, return a clear failure before writing `[ORDER]`.

- [ ] **Step 4: Re-run tests**

Run:

```bash
npm run build && node --test tests/payments/servicePayment.test.mjs tests/cli/services.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/payments/servicePayment.ts src/daemon/defaultHandlers.ts src/cli/runtime.ts tests/payments/servicePayment.test.mjs tests/cli/services.test.mjs
git commit -m "feat: execute real payment before a2a service orders"
```

### Task 4: Send scoped caller order and return session trace URL

**Files:**
- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `src/cli/commands/services.ts`
- Modify: `tests/cli/services.test.mjs`
- Modify: `tests/cli/trace.test.mjs`

- [ ] **Step 1: Write failing service-call tests**

Assert `services.call` returns `data.session.sessionId` and:

```text
localUiUrl includes /ui/trace
localUiUrl includes sessionId=
localUiUrl includes traceId=
```

Assert the outbound order payload includes the real `paymentTxid` and the added payment/service metadata.

- [ ] **Step 2: Run failing tests**

Run:

```bash
npm run build && node --test tests/cli/services.test.mjs tests/cli/trace.test.mjs
```

Expected: fail because current service URLs include only `traceId` and use synthetic payment metadata.

- [ ] **Step 3: Wire caller order send**

Update the service call path so:

- payment executes first;
- `[ORDER]` payload uses payment result;
- simplemsg write result is captured as `orderPinId`, `orderTxid`, and `orderTxids`;
- trace/session data includes `sessionId`, `traceId`, `orderTxid`, `paymentTxid`, and `localUiUrl`;
- the immediate waiting response includes `/ui/trace?sessionId=...&traceId=...`.

- [ ] **Step 4: Re-run tests**

Run:

```bash
npm run build && node --test tests/cli/services.test.mjs tests/cli/trace.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/defaultHandlers.ts src/cli/commands/services.ts tests/cli/services.test.mjs tests/cli/trace.test.mjs
git commit -m "feat: return session trace urls for a2a service calls"
```

---

## Phase 2: Unified Per-Peer A2A Store And Listener

### Task 5: Add unified conversation types and JSON store

**Files:**
- Create: `src/core/a2a/conversationTypes.ts`
- Create: `src/core/a2a/conversationStore.ts`
- Modify: `src/core/state/paths.ts`
- Modify: `src/core/state/runtimeStateStore.ts`
- Create: `tests/a2a/conversationStore.test.mjs`

- [ ] **Step 1: Write failing store tests**

Test:

- path resolves to `.runtime/A2A/chat-<self8>-<peer8>.json`;
- invalid ids fail instead of guessing a filename;
- append deduplicates by `messageId`;
- store trims to 2000 messages;
- lookup by `sessionId`, `orderTxid`, and `paymentTxid` returns the expected session;
- corrupt JSON is quarantined like existing stores.

- [ ] **Step 2: Run failing tests**

Run:

```bash
npm run build && node --test tests/a2a/conversationStore.test.mjs
```

Expected: fail because the store does not exist.

- [ ] **Step 3: Implement store**

Follow the locking and atomic write pattern from `src/core/a2a/sessionStateStore.ts` and `src/core/chat/privateChatStateStore.ts`. Use `.runtime/A2A`, not SQLite.

- [ ] **Step 4: Re-run tests**

Run:

```bash
npm run build && node --test tests/a2a/conversationStore.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/a2a/conversationTypes.ts src/core/a2a/conversationStore.ts src/core/state/paths.ts src/core/state/runtimeStateStore.ts tests/a2a/conversationStore.test.mjs
git commit -m "feat: add per-peer a2a conversation store"
```

### Task 6: Add simplemsg classifier

**Files:**
- Create: `src/core/a2a/simplemsgClassifier.ts`
- Create: `tests/a2a/simplemsgClassifier.test.mjs`

- [ ] **Step 1: Write failing classifier tests**

Assert classification for:

- ordinary private chat,
- `[ORDER]`,
- `[ORDER_STATUS:<txid>]`,
- `[DELIVERY:<txid>]`,
- `[NeedsRating:<txid>]`,
- `[ORDER_END:<txid> rated]`,
- legacy `[DELIVERY]`,
- legacy `[NEEDSRATING]`,
- unknown bracketed text as private chat.

- [ ] **Step 2: Run failing tests**

Run:

```bash
npm run build && node --test tests/a2a/simplemsgClassifier.test.mjs
```

Expected: fail because the classifier does not exist.

- [ ] **Step 3: Implement classifier**

Return:

```ts
{ kind: 'private_chat' }
```

or:

```ts
{
  kind: 'order_protocol',
  tag: 'DELIVERY',
  orderTxid: '...',
  reason: null
}
```

- [ ] **Step 4: Re-run tests**

Run:

```bash
npm run build && node --test tests/a2a/simplemsgClassifier.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/a2a/simplemsgClassifier.ts tests/a2a/simplemsgClassifier.test.mjs
git commit -m "feat: classify simplemsg a2a protocol messages"
```

### Task 7: Persist outbound service and private-chat messages to unified store

**Files:**
- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `src/core/chat/privateChatAutoReply.ts`
- Modify: `tests/cli/services.test.mjs`
- Modify: `tests/chat/privateChatAutoReply.test.mjs`
- Modify: `tests/chat/privateChat.test.mjs`

- [ ] **Step 1: Write failing persistence tests**

Assert:

- service order send appends an outgoing `ORDER` message to the per-peer file;
- private chat send appends an outgoing `private_chat` message to the same peer file;
- auto-reply appends incoming and outgoing private-chat messages without changing LLM behavior.

- [ ] **Step 2: Run failing tests**

Run:

```bash
npm run build && node --test tests/cli/services.test.mjs tests/chat/privateChatAutoReply.test.mjs tests/chat/privateChat.test.mjs
```

Expected: fail until outbound persistence is wired.

- [ ] **Step 3: Wire persistence**

Normalize outbound chain write results into `A2AConversationMessage` before appending. For service order messages, set both peer session id and order session id.

- [ ] **Step 4: Re-run tests**

Run:

```bash
npm run build && node --test tests/cli/services.test.mjs tests/chat/privateChatAutoReply.test.mjs tests/chat/privateChat.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/defaultHandlers.ts src/core/chat/privateChatAutoReply.ts tests/cli/services.test.mjs tests/chat/privateChatAutoReply.test.mjs tests/chat/privateChat.test.mjs
git commit -m "feat: persist outbound simplemsg to unified a2a store"
```

### Task 8: Add multi-profile simplemsg listener persistence

**Files:**
- Create: `src/core/a2a/simplemsgListener.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `src/core/chat/privateChatListener.ts`
- Create: `tests/a2a/simplemsgListener.test.mjs`

- [ ] **Step 1: Write failing listener tests**

Use fake socket messages to assert:

- one local profile creates one listener identity;
- multiple local profiles create multiple listener identities;
- idchat.io and show.now payload shapes normalize to the same message shape;
- duplicate `pinId` is ignored;
- inbound ciphertext is decrypted and persisted as plaintext;
- messages not addressed to the local profile are ignored.

- [ ] **Step 2: Run failing tests**

Run:

```bash
npm run build && node --test tests/a2a/simplemsgListener.test.mjs
```

Expected: fail because the listener module does not exist.

- [ ] **Step 3: Implement listener manager**

Reuse the existing decryption path from `src/core/chat/privateChatListener.ts`. This is not just a new socket wrapper around the active profile. Add explicit profile-registry iteration so the daemon can start one logical listener per indexed local MetaBot profile, each with its own profile runtime paths, secret store, and unified conversation store. A profile with missing or invalid secrets should log and skip only that profile.

Add daemon startup wiring with config default:

```json
{ "a2a": { "simplemsgListenerEnabled": true } }
```

- [ ] **Step 4: Re-run tests**

Run:

```bash
npm run build && node --test tests/a2a/simplemsgListener.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/a2a/simplemsgListener.ts src/daemon/defaultHandlers.ts src/core/chat/privateChatListener.ts tests/a2a/simplemsgListener.test.mjs
git commit -m "feat: persist inbound simplemsg with multi-profile listener"
```

---

## Phase 3: Trace Projection, UI Unification, And Rating Closure

### Task 9: Project unified store into trace session APIs

**Files:**
- Create: `src/core/a2a/traceProjection.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `src/daemon/routes/trace.ts`
- Create: `tests/a2a/traceProjectionUnifiedStore.test.mjs`
- Modify: `tests/cli/trace.test.mjs`

- [ ] **Step 1: Write failing projection tests**

Assert:

- `/api/trace/sessions` includes private peer sessions and service order sessions from `.runtime/A2A`;
- `/api/trace/sessions/<sessionId>` returns normalized message rows;
- scoped delivery result appears as `responseText` or equivalent detail field;
- projection falls back to existing session-state records for old traces.

- [ ] **Step 2: Run failing tests**

Run:

```bash
npm run build && node --test tests/a2a/traceProjectionUnifiedStore.test.mjs tests/cli/trace.test.mjs
```

Expected: fail until projection exists and trace handlers use it.

- [ ] **Step 3: Implement projection and handlers**

Keep route URLs stable. Add session-id lookup over the unified store before old session-state fallback.

- [ ] **Step 4: Re-run tests**

Run:

```bash
npm run build && node --test tests/a2a/traceProjectionUnifiedStore.test.mjs tests/cli/trace.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/a2a/traceProjection.ts src/daemon/defaultHandlers.ts src/daemon/routes/trace.ts tests/a2a/traceProjectionUnifiedStore.test.mjs tests/cli/trace.test.mjs
git commit -m "feat: project unified a2a conversations into trace api"
```

### Task 10: Make `/ui/trace` select `sessionId` and handle private chat

**Files:**
- Modify: `src/ui/pages/trace/sseClient.ts`
- Modify: `src/ui/pages/trace/viewModel.ts`
- Modify: `src/ui/pages/trace/index.html`
- Modify: `src/daemon/routes/ui.ts`
- Modify: `tests/ui/traceViewModel.test.mjs`

- [ ] **Step 1: Write failing UI model tests**

Assert:

- URL `sessionId` is accepted as initial selected session;
- private-chat messages and order messages map to the same timeline view model;
- delivery markdown remains renderable;
- `metafile://` extraction still works.

- [ ] **Step 2: Run failing tests**

Run:

```bash
npm run build && node --test tests/ui/traceViewModel.test.mjs
```

Expected: fail for the new private-chat/session-id expectations.

- [ ] **Step 3: Implement UI selection and labels**

Update trace client initialization so `sessionId` query param selects exact session. Leave existing layout intact unless private-chat/order label rendering requires minor additions.

- [ ] **Step 4: Re-run tests**

Run:

```bash
npm run build && node --test tests/ui/traceViewModel.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/ui/pages/trace/sseClient.ts src/ui/pages/trace/viewModel.ts src/ui/pages/trace/index.html src/daemon/routes/ui.ts tests/ui/traceViewModel.test.mjs
git commit -m "feat: show unified private chat in trace ui"
```

### Task 11: Route private chat sends to trace URLs

**Files:**
- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `src/cli/commands/chat.ts`
- Modify: `tests/chat/privateChat.test.mjs`
- Modify: `tests/cli/trace.test.mjs`

- [ ] **Step 1: Write failing private-chat URL tests**

Assert `metabot chat private` returns:

```text
localUiUrl contains /ui/trace
localUiUrl contains sessionId=
localUiUrl does not contain /ui/chat-viewer
```

Also assert the selected `sessionId` resolves through `/api/trace/sessions/<sessionId>`.

- [ ] **Step 2: Run failing tests**

Run:

```bash
npm run build && node --test tests/chat/privateChat.test.mjs tests/cli/trace.test.mjs
```

Expected: fail because current private chat returns `/ui/chat-viewer?peer=...`.

- [ ] **Step 3: Change private chat result URL**

After outbound persistence, return `/ui/trace?sessionId=<peerSessionId>&traceId=<traceId>` and keep old trace artifact exports for compatibility.

Do not attempt to keep `/ui/chat-viewer` live by dual-writing new messages into `privateChatStateStore`. The old route may remain mounted as a deprecated legacy viewer, but all new command output and tests should use trace. If a later product decision requires chat-viewer to show unified data, implement that as an explicit projection adapter in a separate task.

- [ ] **Step 4: Re-run tests**

Run:

```bash
npm run build && node --test tests/chat/privateChat.test.mjs tests/cli/trace.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/defaultHandlers.ts src/cli/commands/chat.ts tests/chat/privateChat.test.mjs tests/cli/trace.test.mjs
git commit -m "feat: return trace session urls for private chat"
```

### Task 12: Handle delivery and NeedsRating from unified store

**Files:**
- Create: `src/core/a2a/callerOrderLifecycle.ts`
- Modify: `src/core/a2a/metawebReplyWaiter.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Create: `tests/a2a/callerOrderLifecycle.test.mjs`
- Modify: `tests/services/remoteCall.test.mjs`

- [ ] **Step 1: Write failing lifecycle tests**

Assert:

- `[ORDER_STATUS:<orderTxid>]` updates first-response state;
- `[DELIVERY:<orderTxid>]` updates delivered state and exposes result text;
- delivery with missing expected media artifact becomes a failure state instead of a false success;
- `[NeedsRating:<orderTxid>]` triggers one rating flow;
- duplicate `[NeedsRating:<orderTxid>]` is ignored;
- `[ORDER_END:<orderTxid> rated]` marks the order ended.

- [ ] **Step 2: Run failing tests**

Run:

```bash
npm run build && node --test tests/a2a/callerOrderLifecycle.test.mjs tests/services/remoteCall.test.mjs
```

Expected: fail until lifecycle is implemented.

- [ ] **Step 3: Implement caller lifecycle**

Keep LLM generation behind an injectable rating runner so tests can use deterministic output. Runtime should use the existing private-chat LLM path.

- [ ] **Step 4: Re-run tests**

Run:

```bash
npm run build && node --test tests/a2a/callerOrderLifecycle.test.mjs tests/services/remoteCall.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/a2a/callerOrderLifecycle.ts src/core/a2a/metawebReplyWaiter.ts src/daemon/defaultHandlers.ts tests/a2a/callerOrderLifecycle.test.mjs tests/services/remoteCall.test.mjs
git commit -m "feat: complete caller delivery and rating lifecycle"
```

### Task 13: Host rendering and final trace URL behavior

**Files:**
- Modify: `src/cli/commands/services.ts`
- Modify: `src/cli/commands/pollTraceHelper.ts`
- Modify: `tests/cli/services.test.mjs`
- Modify: `tests/cli/pollTraceHelper.test.mjs`

- [ ] **Step 1: Write failing host output tests**

Assert:

- immediate waiting output includes trace URL;
- completed output prints result text;
- completed output repeats trace URL;
- timeout/failure output repeats trace URL;
- markdown result text is not stripped;
- `metafile://` URIs are preserved in CLI output.

- [ ] **Step 2: Run failing tests**

Run:

```bash
npm run build && node --test tests/cli/services.test.mjs tests/cli/pollTraceHelper.test.mjs
```

Expected: fail where final trace URL or delivery markdown is missing.

- [ ] **Step 3: Implement host rendering**

Keep rendering text-first and machine-safe. Do not attempt to inline binary media in CLI; preserve links and let `/ui/trace` render previews.

- [ ] **Step 4: Re-run tests**

Run:

```bash
npm run build && node --test tests/cli/services.test.mjs tests/cli/pollTraceHelper.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/services.ts src/cli/commands/pollTraceHelper.ts tests/cli/services.test.mjs tests/cli/pollTraceHelper.test.mjs
git commit -m "feat: render a2a delivery results with trace links"
```

---

## Phase 4: Verification And Compatibility

### Task 14: End-to-end mocked socket scenario

**Files:**
- Create: `tests/a2a/callerServiceFlow.integration.test.mjs`

- [ ] **Step 1: Write integration test**

Test a full mocked flow:

1. fake service directory returns one online provider;
2. fake payment executor returns a real-looking txid;
3. service call sends `[ORDER]`;
4. fake socket delivers `[ORDER_STATUS:<orderTxid>]`;
5. fake socket delivers `[DELIVERY:<orderTxid>] {"result":"# Done\nmetafile://...png"}`;
6. fake socket delivers `[NeedsRating:<orderTxid>]`;
7. fake LLM rating runner returns `评分：5分，谢谢，bye`;
8. caller sends `[ORDER_END:<orderTxid> rated]`;
9. trace detail contains the complete timeline.

- [ ] **Step 2: Run failing integration test**

Run:

```bash
npm run build && node --test --test-concurrency=1 tests/a2a/callerServiceFlow.integration.test.mjs
```

Expected: fail until all prior pieces are wired together.

- [ ] **Step 3: Fix integration gaps only**

Do not add new architecture in this task. Fix missing wiring, metadata propagation, or test-time dependency injection gaps.

- [ ] **Step 4: Re-run integration test**

Run:

```bash
npm run build && node --test --test-concurrency=1 tests/a2a/callerServiceFlow.integration.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add tests/a2a/callerServiceFlow.integration.test.mjs src
git commit -m "test: cover caller a2a service flow"
```

### Task 15: Full verification

**Files:**
- No code changes unless verification exposes a real issue.

- [ ] **Step 1: Run full test suite**

Run:

```bash
npm test
```

Expected: pass.

- [ ] **Step 2: Run build and skillpack verification if release artifacts changed**

Run:

```bash
npm run build:skillpacks
```

Expected: pass only if skillpack sources changed. Do not run release pack commands manually.

- [ ] **Step 3: Inspect git diff**

Run:

```bash
git status --short
git diff --stat
```

Expected: only intentional files changed.

- [ ] **Step 4: Commit verification-only fixes if needed**

Only commit if verification required a code/doc fix:

```bash
git add <fixed-files>
git commit -m "fix: stabilize unified a2a verification"
```

## Implementation Notes

- Keep IDBots read-only.
- Commit every independent verifiable unit.
- After every commit, post a detailed development diary with `metabot-post-buzz`.
- Prefer small modules over adding more logic to `src/daemon/defaultHandlers.ts`.
- Do not remove old stores until trace and legacy read paths have an explicit migration story.
- Do not return `/ui/chat-viewer` from new successful commands. It may stay mounted as a deprecated legacy route, or a later task may add an explicit unified-store projection if product compatibility requires it.
- All docs, comments, and new SKILL text must be English.

## Open Review Gates

Implementation must not begin until:

1. the spec document is reviewed,
2. this TDD implementation plan is reviewed,
3. the `gpt-5.4` subagent review issues are resolved or explicitly accepted,
4. the user approves moving from documentation to code.
