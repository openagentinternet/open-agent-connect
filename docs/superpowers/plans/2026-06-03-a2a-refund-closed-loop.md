# A2A Refund Closed Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete OAC A2A skill-service refunds so failed or timed-out caller orders automatically publish refund requests, provider profiles discover and confirm pending refunds, and both sides can see request, settlement, blockers, and finalization in `/ui/refund`, CLI, daemon APIs, and traces.

**Architecture:** Reuse OAC's existing refund primitives: buyer request creation in `src/daemon/defaultHandlers.ts`, seller settlement in `src/core/orders/serviceRefundSettlement.ts`, seller order state in `src/core/orders/sellerOrderState.ts`, and current refund routes/UI. Add focused protocol, chain-reader, lifecycle-retry, and sync modules under `src/core/orders/`. Wire them through daemon routes, CLI, runtime intervals, and `/ui/refund`. Provider value-moving transfers remain explicit-confirmation by default; background work may discover/sync refund requests and finalization pins but must not auto-spend provider funds unless a later explicit product decision adds that mode.

**Tech Stack:** TypeScript strict mode, CommonJS output, Node.js `>=20 <25`, Node test runner, OAC daemon routes, OAC CLI, MetaID chain reads (`/pin/path/list` and pin detail APIs), existing native wallet transfer/finalize code.

---

## Non-Negotiable Rules

- [ ] Create or switch to a feature branch before implementation, for example `codex/a2a-refund-closed-loop`.
- [ ] Do not touch unrelated worktree changes. At plan creation time the checkout already had unrelated modified/generated skillpack files and untracked avatar/write-pin tests.
- [ ] Keep docs, code comments, and new test names in English.
- [ ] Do not introduce any dependency on the legacy `.metabot/hot` layout.
- [ ] Keep provider settlement explicit by default. The provider can confirm in `/ui/refund`, `POST /api/services/refunds/settle`, `POST /api/provider/refund/confirm`, or CLI. Background sync must only discover/mark pending refunds.
- [ ] Reuse `processSellerRefundSettlement` for real settlement instead of creating a second transfer/finalize path.
- [ ] Keep unsupported assets as visible blockers. Do not silently mark non-native/fiat refunds complete.
- [ ] Make one small commit per completed implementation task after the relevant verification passes, then post the required development diary with `metabot-post-buzz` per repository conventions.

---

## Current State To Preserve

OAC already has partial refund support:

- Buyer refund request creation exists in `src/daemon/defaultHandlers.ts`:
  - `buildRefundRequestPayloadForTrace`
  - `ensureBuyerRefundRequestForTrace`
  - timeout, invalid-deliverable, and provider execution failure call sites
  - retry metadata such as `refundRequestAttemptCount`, `refundRequestLastError`, and `refundRequestNextRetryAt`
- Seller settlement exists in `src/core/orders/serviceRefundSettlement.ts`:
  - validates `/protocols/service-refund-request`
  - supports free/zero and native payments
  - executes transfer
  - writes `/protocols/service-refund-finalize`
  - marks seller orders and traces refunded
- Local refund surfaces exist:
  - `GET /api/services/refunds`
  - `POST /api/services/refunds/settle`
  - `POST /api/provider/refund/confirm`
  - `metabot services refunds list|settle`
  - `/ui/refund`
- Provider operations already expose manual action when a seller order is `refund_pending` and has `refundRequestPinId`.

The missing closed-loop pieces are:

- No chain sync equivalent to IDBots `ServiceRefundSyncService`.
- No lifecycle job that consumes buyer refund retry markers after the first failure.
- Provider cannot reliably see refund requests that were only written on chain by the caller.
- Caller cannot reliably learn about provider finalization pins unless local state already observed settlement.
- `/ui/refund` only shows local state; it does not refresh/sync chain refund protocols or present a complete timeline.
- Protocol docs do not define `service-refund-request` and `service-refund-finalize`.

---

## IDBots Reference Behavior To Match

Use IDBots as behavioral reference, not as copy-paste source:

- `ServiceOrderLifecycleService`
  - scans timed-out/failed orders
  - creates `/protocols/service-refund-request`
  - retries failed request writes
  - handles free/self-directed orders without provider transfer
  - mirrors buyer and seller local state
- `ServiceRefundSyncService`
  - scans request pins and finalize pins
  - attaches request pins to existing buyer/seller orders
  - synthesizes seller refund rows when provider did not already have local order state
  - verifies finalize transfer evidence before marking refunded
- `ServiceRefundSettlementService`
  - validates request pin ownership, parties, payment amount, and refund address
  - performs seller transfer
  - writes finalize pin
  - marks both local views when available
- `GigSquareRefundsService` and refund modal
  - refresh refund protocols before listing
  - split "pending for me" and "initiated by me"
  - show process/confirm action only for provider-side actionable rows

---

## Files To Create

- [ ] `src/core/orders/serviceRefundProtocol.ts`
  - Protocol constants for `/protocols/service-refund-request` and `/protocols/service-refund-finalize`.
  - Build and parse helpers for request/finalize payloads.
  - Normalization helpers for amount, asset, txid, party meta IDs, order pin IDs, refund address, timestamps, and optional error/blocker fields.

- [ ] `src/core/orders/serviceRefundChainReader.ts`
  - Chain read helpers for refund request/finalize pins.
  - Use injected fetch/client dependencies so tests can run without network.
  - Page through `/pin/path/list`.
  - Normalize pin records into parsed protocol objects.
  - Reuse patterns from existing chain readers such as rating detail sync and discovery readers.

- [ ] `src/core/orders/serviceRefundLifecycle.ts`
  - Pure lifecycle helpers for buyer-side refund retry scanning.
  - Identify failed/timed-out paid buyer traces whose refund request is missing and whose `nextRetryAt` is due.
  - Call an injected request writer, then update trace refund fields.
  - Preserve existing free/self-directed behavior.

- [ ] `src/core/orders/serviceRefundSync.ts`
  - Pure state transformer that applies request and finalize pins to `RuntimeState`.
  - Attach request pins to buyer traces and seller orders.
  - Synthesize minimal provider-side seller refund records when an on-chain request targets the local provider but no local seller order exists.
  - Apply finalize pins to both caller and provider views after validation.
  - Never perform wallet transfer here.

- [ ] `tests/orders/serviceRefundProtocol.test.mjs`
- [ ] `tests/orders/serviceRefundChainReader.test.mjs`
- [ ] `tests/orders/serviceRefundLifecycle.test.mjs`
- [ ] `tests/orders/serviceRefundSync.test.mjs`

---

## Files To Modify

- [ ] `src/daemon/defaultHandlers.ts`
  - Replace local protocol payload construction with `serviceRefundProtocol` helpers where practical.
  - Add daemon handler for refund sync.
  - Add daemon handler or internal call for buyer refund lifecycle retry scan.
  - Keep existing `ensureBuyerRefundRequestForTrace` behavior compatible.
  - Continue delegating provider settlement to `processSellerRefundSettlement`.

- [ ] `src/daemon/routes/types.ts`
  - Add typed handler contracts for `syncRefunds` and any lifecycle trigger used by routes/runtime.

- [ ] `src/daemon/routes/services.ts`
  - Add `POST /api/services/refunds/sync`.
  - Let `GET /api/services/refunds?refresh=true` perform sync before returning the list.
  - Preserve existing `GET /api/services/refunds` and `POST /api/services/refunds/settle` contracts.

- [ ] `src/daemon/routes/provider.ts`
  - Keep `POST /api/provider/refund/confirm` compatible.
  - If route output currently lacks timeline/finalize fields, return the same enriched shape as services refund settlement.

- [ ] `src/cli/runtime.ts`
  - Add a daemon background refund sync interval similar to the online service cache interval.
  - Include buyer retry scan and chain sync.
  - Clear the interval on daemon shutdown.
  - Use conservative interval defaults and avoid overlapping runs.

- [ ] `src/cli/commands/services.ts`
  - Add `metabot services refunds sync [--from <slug>] [--all]`.
  - Keep `list` and `settle` backward compatible.
  - Allow list to pass `refresh=true` when requested, if command style already supports flags cleanly.

- [ ] `src/cli/commandHelp.ts`
  - Document the new refund sync command.

- [ ] `src/ui/pages/refund/app.ts`
  - Refresh/sync before loading refund rows.
  - Add explicit refresh action.
  - Show caller/provider views, timeline, blockers, and finalization proof.
  - Keep confirm button visible only for provider-side actionable pending rows.

- [ ] `src/ui/pages/refund/index.html`
  - Add any required labels/containers for the refined UI.

- [ ] `docs/metaid_protocols/02-content-app.md`
  - Document `service-refund-request` and `service-refund-finalize` after the `skill-service-order` section.
  - Include field definitions, matching rules, state transitions, and native/non-native settlement constraints.

- [ ] Existing tests to update as needed:
  - `tests/daemon/servicePaymentBoundary.test.mjs`
  - `tests/daemon/providerRoutes.test.mjs`
  - `tests/ui/refundPageApp.test.mjs`
  - `tests/cli/services.test.mjs`
  - `tests/cli/help.test.mjs`
  - Any runtime/daemon interval test that already covers background jobs.

---

## Implementation Tasks

### Task 1: Add Refund Protocol Helpers And Docs

- [ ] Add failing tests in `tests/orders/serviceRefundProtocol.test.mjs`.
- [ ] Create `src/core/orders/serviceRefundProtocol.ts`.
- [ ] Move or mirror constants currently in settlement/default handlers into the helper module.
- [ ] Update `src/core/orders/serviceRefundSettlement.ts` to import constants/parsers from the helper without changing settlement behavior.
- [ ] Update `src/daemon/defaultHandlers.ts` request payload generation to use the helper.
- [ ] Add protocol docs to `docs/metaid_protocols/02-content-app.md`.

Expected helper shape:

```ts
export const SERVICE_REFUND_REQUEST_PATH = "/protocols/service-refund-request";
export const SERVICE_REFUND_FINALIZE_PATH = "/protocols/service-refund-finalize";

export interface ServiceRefundRequestPayload {
  version: 1;
  serviceOrderPinId: string;
  servicePinId?: string;
  paymentTxid?: string;
  paymentAmount?: string;
  paymentAsset?: string;
  buyerGlobalMetaId?: string;
  sellerGlobalMetaId?: string;
  refundAddress?: string;
  reason: string;
  requestedAt: string;
}

export function buildServiceRefundRequestPayload(input: ServiceRefundRequestPayload): ServiceRefundRequestPayload;
export function parseServiceRefundRequestPin(pin: unknown): ParsedServiceRefundRequest | null;
export function parseServiceRefundFinalizePin(pin: unknown): ParsedServiceRefundFinalize | null;
```

Test cases:

- [ ] Builds request payload with stable field names and version.
- [ ] Parses IDBots-compatible request payloads with legacy aliases where OAC already accepts them.
- [ ] Rejects missing order/payment identity for paid refunds.
- [ ] Parses finalize payload with refund txid, request pin id, amount, asset, and parties.
- [ ] Keeps free/zero refund payloads valid without a transfer txid.

Verification:

```bash
npm run build && node --test tests/orders/serviceRefundProtocol.test.mjs
```

Commit:

```bash
git add src/core/orders/serviceRefundProtocol.ts src/core/orders/serviceRefundSettlement.ts src/daemon/defaultHandlers.ts docs/metaid_protocols/02-content-app.md tests/orders/serviceRefundProtocol.test.mjs
git commit -m "feat: add service refund protocol helpers"
```

---

### Task 2: Add Chain Reader For Refund Protocol Pins

- [ ] Add failing tests in `tests/orders/serviceRefundChainReader.test.mjs`.
- [ ] Create `src/core/orders/serviceRefundChainReader.ts`.
- [ ] Implement paged reads for request and finalize paths.
- [ ] Accept injected chain API/fetch dependencies.
- [ ] Normalize chain records before handing them to `serviceRefundProtocol`.
- [ ] Include since/from filters only when existing chain reader conventions support them cleanly.

Expected API shape:

```ts
export interface ServiceRefundChainReader {
  listRefundRequests(options: RefundChainListOptions): Promise<ParsedServiceRefundRequest[]>;
  listRefundFinalizations(options: RefundChainListOptions): Promise<ParsedServiceRefundFinalize[]>;
}

export function createServiceRefundChainReader(deps: ServiceRefundChainReaderDeps): ServiceRefundChainReader;
```

Test cases:

- [ ] Reads one page of request pins.
- [ ] Reads multiple pages until empty or cursor exhausted.
- [ ] Skips malformed pins without failing the whole sync.
- [ ] Normalizes timestamp and pin id fields from chain response variants.
- [ ] Applies identity/path filters expected by the daemon caller.

Verification:

```bash
npm run build && node --test tests/orders/serviceRefundChainReader.test.mjs
```

Commit:

```bash
git add src/core/orders/serviceRefundChainReader.ts tests/orders/serviceRefundChainReader.test.mjs
git commit -m "feat: read service refund protocol pins"
```

---

### Task 3: Add Buyer Refund Lifecycle Retry Scanner

- [ ] Add failing tests in `tests/orders/serviceRefundLifecycle.test.mjs`.
- [ ] Create `src/core/orders/serviceRefundLifecycle.ts`.
- [ ] Extract pure due-refund selection from the current daemon-only flow.
- [ ] Preserve current `ensureBuyerRefundRequestForTrace` behavior for direct failure/timeout handling.
- [ ] Add a daemon-level lifecycle runner that scans persisted traces and calls the existing buyer refund request writer.
- [ ] Ensure the runner is idempotent and respects `refundRequestNextRetryAt`.

Expected API shape:

```ts
export interface BuyerRefundRequestWriter {
  writeRefundRequest(traceId: string): Promise<BuyerRefundRequestWriteResult>;
}

export function selectDueBuyerRefundRequests(input: {
  traces: RuntimeTraceRecord[];
  nowMs: number;
}): RuntimeTraceRecord[];
```

Test cases:

- [ ] Selects failed paid trace with no `refundRequestPinId` and due retry time.
- [ ] Skips traces whose retry time is in the future.
- [ ] Skips already pending/refunded traces.
- [ ] Skips or auto-closes free orders according to existing daemon behavior.
- [ ] Handles self-directed orders without provider transfer.
- [ ] Records retry error and next retry when request write fails.

Verification:

```bash
npm run build && node --test tests/orders/serviceRefundLifecycle.test.mjs
```

Commit:

```bash
git add src/core/orders/serviceRefundLifecycle.ts src/daemon/defaultHandlers.ts tests/orders/serviceRefundLifecycle.test.mjs
git commit -m "feat: retry buyer service refund requests"
```

---

### Task 4: Add Refund Sync State Transformer

- [ ] Add failing tests in `tests/orders/serviceRefundSync.test.mjs`.
- [ ] Create `src/core/orders/serviceRefundSync.ts`.
- [ ] Implement request-pin application to buyer traces.
- [ ] Implement request-pin application to existing seller orders.
- [ ] Implement provider-side synthesized seller refund record when a request targets the local provider and no seller order exists.
- [ ] Implement finalize-pin application to buyer traces and seller orders.
- [ ] Add optional finalize transfer verifier dependency and default to conservative pending/blocker behavior when verification cannot complete.
- [ ] Ensure repeated sync is idempotent.

Matching priority for request pins:

1. Exact `refundRequestPinId`.
2. Exact `paymentTxid`.
3. Exact `serviceOrderPinId` or order pin id alias.
4. Exact `servicePinId` plus buyer/seller globalMetaId.
5. Do not match when more than one local record qualifies.

State outcomes:

- Caller trace with request pin: `order.status = "refund_pending"` unless already `refunded`.
- Provider seller order with request pin: `state = "refund_pending"` and `manualActionRequired = true` via existing provider operations.
- Provider synthesized seller order: minimal enough for `/api/services/refunds`, settlement, and `/ui/refund` to act on it.
- Finalize pin with verified transfer/free evidence: caller and provider rows become `refunded`.
- Invalid or unsupported finalize: row remains pending with visible blocker/reason.

Test cases:

- [ ] Attaches request pin to existing buyer trace by payment txid.
- [ ] Attaches request pin to existing seller order by order pin id.
- [ ] Synthesizes provider seller order from chain request when local order is missing.
- [ ] Does not synthesize when local profile is not the provider.
- [ ] Does not match ambiguous local records.
- [ ] Applies verified finalize pin to both local views.
- [ ] Leaves non-native unsupported refund pending with blocker.
- [ ] Re-running sync produces no duplicate seller orders.

Verification:

```bash
npm run build && node --test tests/orders/serviceRefundSync.test.mjs
```

Commit:

```bash
git add src/core/orders/serviceRefundSync.ts tests/orders/serviceRefundSync.test.mjs
git commit -m "feat: sync service refund state from chain"
```

---

### Task 5: Wire Daemon API, CLI, And Runtime Background Sync

- [ ] Add or update route tests before implementation.
- [ ] Add handler contract to `src/daemon/routes/types.ts`.
- [ ] Add `syncRefunds` handler in `src/daemon/defaultHandlers.ts`.
- [ ] `syncRefunds` should:
  - run buyer lifecycle retry scan
  - read refund request pins
  - read refund finalize pins
  - apply sync state transforms
  - persist changed runtime state
  - return counts for scanned, applied, synthesized, finalized, skipped, and blocked records
- [ ] Add `POST /api/services/refunds/sync`.
- [ ] Add `GET /api/services/refunds?refresh=true`.
- [ ] Add `metabot services refunds sync [--from <slug>] [--all]`.
- [ ] Add command help.
- [ ] Add runtime interval in `src/cli/runtime.ts`.
- [ ] Prevent overlapping interval runs.
- [ ] Clear the interval during daemon shutdown.

Route response shape:

```ts
interface ServiceRefundSyncResponse {
  ok: true;
  scanned: {
    requestPins: number;
    finalizePins: number;
    buyerRetryCandidates: number;
  };
  applied: {
    buyerRequests: number;
    sellerRequests: number;
    synthesizedSellerOrders: number;
    finalizations: number;
  };
  skipped: number;
  blocked: number;
}
```

Test cases:

- [ ] `POST /api/services/refunds/sync` calls daemon handler and returns counts.
- [ ] `GET /api/services/refunds?refresh=true` syncs before listing.
- [ ] Plain `GET /api/services/refunds` stays backward compatible.
- [ ] CLI `services refunds sync` dispatches to daemon endpoint.
- [ ] Help output includes the new command.
- [ ] Runtime starts and stops refund interval without leaking timers.

Verification:

```bash
npm run build
node --test tests/daemon/providerRoutes.test.mjs tests/cli/services.test.mjs tests/cli/help.test.mjs
```

Commit:

```bash
git add src/daemon/defaultHandlers.ts src/daemon/routes/types.ts src/daemon/routes/services.ts src/daemon/routes/provider.ts src/cli/runtime.ts src/cli/commands/services.ts src/cli/commandHelp.ts tests/daemon/providerRoutes.test.mjs tests/cli/services.test.mjs tests/cli/help.test.mjs
git commit -m "feat: wire service refund sync"
```

---

### Task 6: Complete `/ui/refund` User Flow

- [ ] Update UI tests before implementation.
- [ ] Update `src/ui/pages/refund/app.ts`.
- [ ] Update `src/ui/pages/refund/index.html` only if new static containers are needed.
- [ ] On page load, call `POST /api/services/refunds/sync`, then `GET /api/services/refunds?all=true`.
- [ ] Add explicit refresh button that repeats sync plus list.
- [ ] Keep a clear pending/blocked/completed split.
- [ ] Show caller-side "initiated by me" rows and provider-side "pending for me" rows.
- [ ] Show timeline fields:
  - order created
  - failure/timeout reason
  - refund request pin id and requested time
  - provider confirmation status
  - refund txid/finalize pin id
  - final refunded time
- [ ] Show provider `Confirm refund` action only when the row is provider-side, pending, supported, and has a refund request pin.
- [ ] After confirm succeeds, sync/list again so finalization appears in the same view.
- [ ] Preserve existing visual style. This is an operational page, not a marketing page.

Test cases:

- [ ] Initial load calls sync before list.
- [ ] Refresh button calls sync and reloads rows.
- [ ] Provider pending row renders confirm button.
- [ ] Caller initiated row does not render provider confirm button.
- [ ] Blocked unsupported row shows reason.
- [ ] Finalized row shows finalize pin or refund txid.

Verification:

```bash
npm run build && node --test tests/ui/refundPageApp.test.mjs
```

Commit:

```bash
git add src/ui/pages/refund/app.ts src/ui/pages/refund/index.html tests/ui/refundPageApp.test.mjs
git commit -m "feat: complete refund page flow"
```

---

### Task 7: Add End-To-End Refund Lifecycle Acceptance Coverage

- [ ] Extend `tests/daemon/servicePaymentBoundary.test.mjs` or add a focused daemon integration test if the existing file becomes too broad.
- [ ] Cover the full closed loop:
  - caller order fails or times out
  - buyer lifecycle writes refund request
  - provider sync discovers request
  - provider refund list shows actionable pending refund
  - provider confirms refund
  - finalize pin is recorded
  - caller sync observes finalization and marks trace refunded
- [ ] Add unsupported asset coverage:
  - request is visible
  - provider cannot confirm through native settlement path
  - row remains pending/blocked with explicit reason
- [ ] Add idempotency coverage:
  - repeated sync does not duplicate synthesized seller order
  - repeated provider confirm on already-refunded row returns safe result

Verification:

```bash
npm run build
node --test tests/daemon/servicePaymentBoundary.test.mjs tests/orders/serviceRefundSync.test.mjs tests/ui/refundPageApp.test.mjs
```

Commit:

```bash
git add tests/daemon/servicePaymentBoundary.test.mjs tests/orders/serviceRefundSync.test.mjs tests/ui/refundPageApp.test.mjs
git commit -m "test: cover service refund closed loop"
```

---

### Task 8: Final Verification And Cleanup

- [ ] Run targeted refund suite:

```bash
npm run build
node --test \
  tests/orders/serviceRefundProtocol.test.mjs \
  tests/orders/serviceRefundChainReader.test.mjs \
  tests/orders/serviceRefundLifecycle.test.mjs \
  tests/orders/serviceRefundSync.test.mjs \
  tests/orders/serviceRefundSettlement.test.mjs \
  tests/daemon/providerRoutes.test.mjs \
  tests/daemon/servicePaymentBoundary.test.mjs \
  tests/ui/refundPageApp.test.mjs \
  tests/cli/services.test.mjs \
  tests/cli/help.test.mjs
```

- [ ] Run full suite because this touches shared daemon runtime, persistence, API, CLI, wallet settlement, and UI:

```bash
npm test
```

- [ ] Run `git status --short` and confirm only intended files are part of the branch.
- [ ] Confirm generated `dist/` is not committed unless this repo's current workflow explicitly requires generated output for the touched surface.
- [ ] Confirm skillpacks are not rebuilt unless the implementation changes packaged runtime output intentionally and the task requires it.
- [ ] Commit any final docs/test-only cleanup:

```bash
git add docs/metaid_protocols/02-content-app.md
git commit -m "docs: document service refund lifecycle"
```

---

## Acceptance Criteria

- [ ] Caller-side failed/timed-out paid A2A order automatically creates or retries `/protocols/service-refund-request`.
- [ ] Caller-side free/self-directed orders are closed without requiring provider transfer.
- [ ] Provider-side sync discovers on-chain refund requests even if the provider did not already have local seller order state.
- [ ] Provider can confirm eligible native refunds from `/ui/refund`, API, and CLI.
- [ ] Provider confirmation writes `/protocols/service-refund-finalize` and records refund tx evidence.
- [ ] Caller-side sync observes finalization and marks the original trace/order refunded.
- [ ] Caller and provider `/ui/refund` views both show a complete timeline and current status.
- [ ] Unsupported asset refunds remain visible with explicit blocker text.
- [ ] Re-running sync is idempotent.
- [ ] Existing refund routes and CLI commands remain backward compatible.
- [ ] Full local test suite passes before the branch is considered ready.

---

## Do Not Implement In This Round

- [ ] Do not add provider auto-spend settlement mode.
- [ ] Do not add new storage engines or migrations beyond existing runtime JSON state.
- [ ] Do not redesign the whole services/order state model.
- [ ] Do not change rating closure behavior except where tests prove refund closure already needs an existing integration point.
- [ ] Do not add fiat/non-native transfer execution unless a separate payment adapter is explicitly designed.

---

## Implementation Notes

- Prefer pure functions for protocol parsing, lifecycle selection, and state transformation. Keep daemon handlers thin.
- Keep sync conservative when chain data is ambiguous. Mark skipped/blocked rows with a reason instead of guessing.
- Use existing state write helpers and path resolution. Do not write directly under profile directories from new modules unless existing order modules already do so.
- The provider synthesized seller order must include enough data for `processSellerRefundSettlement` to validate and settle using the refund request pin.
- The UI should treat sync failure as non-fatal: show existing local rows plus a visible refresh error.
- Test builders should use isolated profile homes from `tests/helpers/profileHome.mjs` where daemon/runtime state is involved.
