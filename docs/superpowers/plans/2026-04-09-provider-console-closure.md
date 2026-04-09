# Provider Console Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current provider-side placeholders into a real M1 closure where a local MetaBot can publish a service on-chain, opt into online presence, inspect provider-side orders, and handle manual refund interruptions from local HTML pages.

**Architecture:** Reuse the existing validated daemon semantics instead of inventing a second product surface. `services publish`, provider traces, and manual refund logic stay the source of truth. Add a small provider-console read model plus one daemon-managed heartbeat loop so `publish`, `my-services`, and `refund` pages become human inspection and action surfaces over the same runtime state.

**Tech Stack:** TypeScript, node:test, existing local daemon routes, runtime hot-state files under `.metabot/hot`, built-in local HTML pages under `src/ui/pages/*`

---

## Scope Guard

This plan is intentionally only for provider closure M1:

- in scope: on-chain service publish, provider online toggle and heartbeat loop, provider inventory/order visibility, manual refund handling, provider HTML pages
- out of scope: full wallet product, generalized marketplace ranking, bulk service management, full revoke/modify workflow, CLI `--help`

## File Map

**Existing files to extend**

- Modify: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/core/services/publishService.ts`
  - Keep the IDBots-compatible service payload contract and enrich local records with chain publish metadata needed by provider views.
- Modify: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/core/state/runtimeStateStore.ts`
  - Add or reference dedicated hot-state storage for provider presence and provider console snapshots without polluting unrelated runtime fields.
- Modify: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/daemon/defaultHandlers.ts`
  - Wire chain-backed publish, provider summary reads, presence toggle, and manual refund confirmation using existing runtime state and trace artifacts.
- Modify: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/daemon/routes/types.ts`
  - Add provider-route handler contracts.
- Modify: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/daemon/httpServer.ts`
  - Register the new provider API routes.
- Modify: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/daemon/routes/ui.ts`
  - Keep built-in page registration aligned with the now-functional provider pages.
- Modify: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/cli/runtime.ts`
  - Start and stop the heartbeat loop in the daemon process when provider presence is enabled.
- Modify: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/ui/pages/publish/app.ts`
  - Replace the placeholder script with a real publish flow that reads defaults and submits one publish payload.
- Modify: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/ui/pages/my-services/app.ts`
  - Replace the placeholder script with a real provider inventory and order view.
- Modify: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/ui/pages/refund/app.ts`
  - Render actual order and refund evidence and wire the confirmation action.

**New files to create**

- Create: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/core/provider/providerConsole.ts`
  - Build one normalized provider read model from runtime services, seller-side traces, and manual refund state.
- Create: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/core/provider/providerPresenceState.ts`
  - Persist whether this local MetaBot is advertising itself online and record the latest heartbeat metadata.
- Create: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/core/provider/providerHeartbeatLoop.ts`
  - Own the daemon-managed write loop for `/protocols/metabot-heartbeat`.
- Create: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/core/services/servicePublishChain.ts`
  - Convert a validated publish payload into the exact chain write request for `/protocols/skill-service`.
- Create: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/daemon/routes/provider.ts`
  - Expose machine-first provider endpoints for publish defaults, provider summary, presence toggle, and refund confirmation.
- Create: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/ui/pages/publish/viewModel.ts`
  - Format one human-facing publish summary and publish result card.
- Create: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/ui/pages/my-services/viewModel.ts`
  - Format service inventory, recent orders, manual actions, and presence state for the provider console page.

**Tests to add or expand**

- Create: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/tests/provider/providerConsole.test.mjs`
- Create: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/tests/provider/providerHeartbeatLoop.test.mjs`
- Create: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/tests/daemon/providerRoutes.test.mjs`
- Create: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/tests/ui/providerViewModels.test.mjs`
- Modify: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/tests/services/publishService.test.mjs`
- Modify: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/tests/cli/runtime.test.mjs`
- Modify: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/tests/daemon/httpServer.test.mjs`

## Task 1: Lock The Provider Read Model

**Files:**
- Create: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/core/provider/providerConsole.ts`
- Create: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/tests/provider/providerConsole.test.mjs`
- Reference: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/core/state/runtimeStateStore.ts`
- Reference: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/core/orders/manualRefund.ts`
- Reference: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/core/chat/sessionTrace.ts`

- [ ] **Step 1: Write the failing test for provider service inventory**

Add a test that feeds one published service record plus one seller-side trace into `buildProviderConsoleSnapshot()` and expects:

- one service inventory entry
- service pin id and availability
- recent seller order count

- [ ] **Step 2: Write the failing test for manual refund focus**

Add a test that feeds one seller trace with `refund_pending` order data and expects one `manualActions` entry with:

- `kind: refund`
- `orderId`
- `refundRequestPinId`
- `traceId`

- [ ] **Step 3: Run the provider read-model test file**

Run: `npm run build && node --test tests/provider/providerConsole.test.mjs`

Expected: FAIL because `src/core/provider/providerConsole.ts` does not exist yet.

- [ ] **Step 4: Implement the minimal provider snapshot builder**

Implement:

- service inventory rows from `state.services`
- recent seller order rows from provider-side traces
- manual refund rows by calling `resolveManualRefundDecision(...)`

- [ ] **Step 5: Run the provider read-model tests**

Run: `npm run build && node --test tests/provider/providerConsole.test.mjs`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/provider/providerConsole.ts tests/provider/providerConsole.test.mjs
git commit -m "feat: add provider console read model"
```

## Task 2: Make `services publish` Write The Real Chain Protocol

**Files:**
- Create: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/core/services/servicePublishChain.ts`
- Modify: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/core/services/publishService.ts`
- Modify: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/daemon/defaultHandlers.ts`
- Modify: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/tests/services/publishService.test.mjs`
- Modify: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/tests/cli/runtime.test.mjs`

- [ ] **Step 1: Write the failing publish payload test**

Extend `tests/services/publishService.test.mjs` so the publish helper must produce the exact chain write request for `/protocols/skill-service`, including:

- JSON payload from the existing service contract
- `contentType: application/json`
- the returned chain pin id persisted as the current service pin id

- [ ] **Step 2: Write the failing runtime test for chain-backed publish**

Extend `tests/cli/runtime.test.mjs` so `metabot services publish` must return a chain-looking `servicePinId` written through the signer path, not only a local synthetic id.

- [ ] **Step 3: Run the targeted publish tests**

Run: `npm run build && node --test tests/services/publishService.test.mjs tests/cli/runtime.test.mjs`

Expected: FAIL because `services.publish` still only stores a local synthetic record.

- [ ] **Step 4: Implement the chain publish helper**

Create a helper that:

- reuses the validated publish payload from `buildPublishedService(...)`
- writes one `create` pin to `/protocols/skill-service`
- returns the actual chain pin id and txids

- [ ] **Step 5: Wire daemon publish through the chain helper**

Update `defaultHandlers.ts` so `services.publish`:

- fails if no local identity exists
- writes the service protocol on-chain
- persists the resulting chain pin id in local service state
- returns the real publish summary envelope

- [ ] **Step 6: Re-run the targeted publish tests**

Run: `npm run build && node --test tests/services/publishService.test.mjs tests/cli/runtime.test.mjs`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/core/services/servicePublishChain.ts src/core/services/publishService.ts src/daemon/defaultHandlers.ts tests/services/publishService.test.mjs tests/cli/runtime.test.mjs
git commit -m "feat: publish services to chain protocol"
```

## Task 3: Add Provider Presence State And Heartbeat Loop

**Files:**
- Create: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/core/provider/providerPresenceState.ts`
- Create: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/core/provider/providerHeartbeatLoop.ts`
- Modify: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/core/state/runtimeStateStore.ts`
- Modify: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/cli/runtime.ts`
- Create: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/tests/provider/providerHeartbeatLoop.test.mjs`
- Modify: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/tests/cli/runtime.test.mjs`

- [ ] **Step 1: Write the failing presence-state test**

Add a test for reading and writing provider presence state with:

- `enabled`
- `lastHeartbeatAt`
- `lastHeartbeatPinId`

- [ ] **Step 2: Write the failing heartbeat-loop test**

Add a test that enables presence and expects the loop to write `/protocols/metabot-heartbeat` using the existing signer interface, then record the latest heartbeat metadata.

- [ ] **Step 3: Run the targeted heartbeat tests**

Run: `npm run build && node --test tests/provider/providerHeartbeatLoop.test.mjs tests/cli/runtime.test.mjs`

Expected: FAIL because no provider presence store or heartbeat loop exists yet.

- [ ] **Step 4: Implement the presence state store**

Persist one dedicated provider-presence hot file. Do not overload unrelated runtime identity fields.

- [ ] **Step 5: Implement the heartbeat loop**

Own:

- start when provider presence is enabled
- periodic `/protocols/metabot-heartbeat` writes
- graceful stop when presence is disabled or daemon shuts down

- [ ] **Step 6: Start the loop from the daemon runtime**

Wire `serveCliDaemonProcess(...)` so the loop is started only after identity is available and only while provider presence is enabled.

- [ ] **Step 7: Re-run the heartbeat tests**

Run: `npm run build && node --test tests/provider/providerHeartbeatLoop.test.mjs tests/cli/runtime.test.mjs`

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/core/provider/providerPresenceState.ts src/core/provider/providerHeartbeatLoop.ts src/core/state/runtimeStateStore.ts src/cli/runtime.ts tests/provider/providerHeartbeatLoop.test.mjs tests/cli/runtime.test.mjs
git commit -m "feat: add provider heartbeat presence loop"
```

## Task 4: Expose Provider APIs Through The Daemon

**Files:**
- Create: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/daemon/routes/provider.ts`
- Modify: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/daemon/routes/types.ts`
- Modify: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/daemon/httpServer.ts`
- Modify: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/daemon/defaultHandlers.ts`
- Create: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/tests/daemon/providerRoutes.test.mjs`

- [ ] **Step 1: Write the failing provider route tests**

Cover:

- `GET /api/provider/summary`
- `POST /api/provider/presence`
- `POST /api/provider/refund/confirm`

Expected fields:

- provider presence state
- current services
- recent seller orders
- manual refund queue

- [ ] **Step 2: Run the provider route tests**

Run: `npm run build && node --test tests/daemon/providerRoutes.test.mjs`

Expected: FAIL because no provider route exists yet.

- [ ] **Step 3: Add provider route contracts**

Extend daemon route types with one `provider` handler group instead of overloading `services` or `ui`.

- [ ] **Step 4: Implement the route handler**

Add `src/daemon/routes/provider.ts` and register it in `httpServer.ts`.

- [ ] **Step 5: Implement the default provider handlers**

Wire:

- summary from `buildProviderConsoleSnapshot(...)`
- presence enable/disable writes
- manual refund confirmation using the existing refund semantics

- [ ] **Step 6: Re-run the provider route tests**

Run: `npm run build && node --test tests/daemon/providerRoutes.test.mjs`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/daemon/routes/provider.ts src/daemon/routes/types.ts src/daemon/httpServer.ts src/daemon/defaultHandlers.ts tests/daemon/providerRoutes.test.mjs
git commit -m "feat: add provider daemon routes"
```

## Task 5: Make The Publish Page Actually Publish

**Files:**
- Modify: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/ui/pages/publish/app.ts`
- Modify: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/ui/pages/publish/index.html`
- Create: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/ui/pages/publish/viewModel.ts`
- Create: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/tests/ui/providerViewModels.test.mjs`
- Modify: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/tests/daemon/httpServer.test.mjs`

- [ ] **Step 1: Write the failing publish page view-model test**

Add a test that expects one human-facing publish summary card with:

- provider identity
- currency and price
- output type
- publish result pin id

- [ ] **Step 2: Write the failing UI-serving test**

Extend `tests/daemon/httpServer.test.mjs` so `GET /ui/publish` must include a form and a local script hook for publish submission.

- [ ] **Step 3: Run the targeted UI tests**

Run: `npm run build && node --test tests/ui/providerViewModels.test.mjs tests/daemon/httpServer.test.mjs`

Expected: FAIL because the publish page is still static copy.

- [ ] **Step 4: Implement the publish page**

Render:

- one small form
- one status panel
- one result card after successful publish

Submit through the daemon route, not through direct chain calls in browser code.

- [ ] **Step 5: Re-run the targeted UI tests**

Run: `npm run build && node --test tests/ui/providerViewModels.test.mjs tests/daemon/httpServer.test.mjs`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/ui/pages/publish/app.ts src/ui/pages/publish/index.html src/ui/pages/publish/viewModel.ts tests/ui/providerViewModels.test.mjs tests/daemon/httpServer.test.mjs
git commit -m "feat: build functional publish page"
```

## Task 6: Make `My Services` A Real Provider Console

**Files:**
- Modify: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/ui/pages/my-services/app.ts`
- Modify: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/ui/pages/my-services/index.html`
- Create: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/ui/pages/my-services/viewModel.ts`
- Modify: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/tests/ui/providerViewModels.test.mjs`
- Modify: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/tests/daemon/httpServer.test.mjs`

- [ ] **Step 1: Write the failing inventory test**

Expect the view model to render:

- current services
- availability
- current chain pin id
- last publish time

- [ ] **Step 2: Write the failing recent-order test**

Expect recent seller orders to show:

- service name
- buyer peer id
- state
- trace link
- manual refund flag when applicable

- [ ] **Step 3: Run the targeted `my-services` tests**

Run: `npm run build && node --test tests/ui/providerViewModels.test.mjs tests/daemon/httpServer.test.mjs`

Expected: FAIL because `my-services` is still static copy.

- [ ] **Step 4: Implement the provider console page**

Fetch `GET /api/provider/summary` and render:

- provider presence card
- service inventory
- recent orders
- manual action queue

- [ ] **Step 5: Re-run the targeted `my-services` tests**

Run: `npm run build && node --test tests/ui/providerViewModels.test.mjs tests/daemon/httpServer.test.mjs`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/ui/pages/my-services/app.ts src/ui/pages/my-services/index.html src/ui/pages/my-services/viewModel.ts tests/ui/providerViewModels.test.mjs tests/daemon/httpServer.test.mjs
git commit -m "feat: build provider services console"
```

## Task 7: Make The Refund Page Perform The Real Human Interruption

**Files:**
- Modify: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/src/ui/pages/refund/app.ts`
- Modify: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/tests/daemon/httpServer.test.mjs`
- Modify: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/tests/provider/providerConsole.test.mjs`

- [ ] **Step 1: Write the failing refund page test**

Expect `GET /ui/refund?orderId=...` to render:

- order id
- refund request pin id
- trace id or session linkage
- one confirm button

- [ ] **Step 2: Write the failing refund confirmation test**

Expect `POST /api/provider/refund/confirm` to clear the manual-action item and persist the refund completion metadata.

- [ ] **Step 3: Run the targeted refund tests**

Run: `npm run build && node --test tests/provider/providerConsole.test.mjs tests/daemon/httpServer.test.mjs`

Expected: FAIL because refund page is read-only and no confirmation action exists yet.

- [ ] **Step 4: Implement the refund confirmation flow**

Reuse the validated seller-side refund semantics. Do not invent a second refund status model for the UI.

- [ ] **Step 5: Re-run the targeted refund tests**

Run: `npm run build && node --test tests/provider/providerConsole.test.mjs tests/daemon/httpServer.test.mjs`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/ui/pages/refund/app.ts tests/provider/providerConsole.test.mjs tests/daemon/httpServer.test.mjs
git commit -m "feat: add provider refund confirmation flow"
```

## Task 8: Verify End-To-End Provider Closure

**Files:**
- Modify: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/tests/cli/runtime.test.mjs`
- Modify: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/docs/acceptance/cross-host-demo-runbook.md`
- Modify: `/Users/tusm/Documents/MetaID_Projects/be-metabot-bootstrap-onboarding/README.md`

- [ ] **Step 1: Add the failing provider-closure acceptance test**

Extend `tests/cli/runtime.test.mjs` so one local provider runtime can:

- publish a service on-chain
- enable presence
- appear in `network services --online`
- receive one seller-side order trace
- surface one manual refund action when needed

- [ ] **Step 2: Run the targeted provider acceptance test**

Run: `npm run build && node --test tests/cli/runtime.test.mjs`

Expected: FAIL until the provider closure path is fully wired.

- [ ] **Step 3: Fix remaining gaps until the acceptance test passes**

Do not add new product scope here. Only close whatever still blocks the provider path above.

- [ ] **Step 4: Update docs**

Document:

- provider publish path
- online toggle
- `my-services` page
- refund page usage

- [ ] **Step 5: Run full verification**

Run: `npm run verify`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add tests/cli/runtime.test.mjs docs/acceptance/cross-host-demo-runbook.md README.md
git commit -m "docs: cover provider console closure"
```

## Follow-On Work, Not In This Plan

- minimal wallet visibility in the provider pages
- `metabot --help` and subcommand `--help`
- revoke / modify flows for already-published services
- richer provider analytics or reputation views
