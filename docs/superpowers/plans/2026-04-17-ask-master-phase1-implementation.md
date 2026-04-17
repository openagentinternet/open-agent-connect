# Ask Master Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first working Ask Master phase-1 implementation for Open Agent Connect: independent `master-service` publish/discovery, `metabot master ask/trace`, structured `master_request/master_response` over `simplemsg`, provider-side Official Debug Master fixture, Ask Master trace semantics, and a minimal `manual + suggest` trigger core.

**Architecture:** Reuse the existing CLI/daemon/runtime/trace/private-chat skeletons, but add a new `master` product family with its own command surface and core modules under `src/core/master/`. Keep transport on `simplemsg`, discovery on `/protocols/master-service`, and isolate Ask Master state via dedicated metadata/state files instead of mutating unrelated service-order semantics.

**Tech Stack:** Node.js 20+, TypeScript, existing Metabot CLI/daemon runtime, `node --test`, `simplemsg` private chat crypto in `src/core/chat/privateChat.ts`, current trace/session infrastructure, existing provider heartbeat and directory reader code.

---

## Scope

This plan is intentionally scoped to **Phase 1 only**:

- In scope:
  - `master-service` publish/list
  - `master_request/master_response` validation and `simplemsg` roundtrip
  - `metabot master ask --request-file ...`
  - `metabot master ask --trace-id ... --confirm`
  - `metabot master trace --id ...`
  - provider-side Official Debug Master fixture
  - Ask Master trace metadata
  - Ask Master config defaults
  - minimal trigger core for `manual + suggest`
- Out of scope:
  - full `auto` sending
  - open-ended multi-turn master chat
  - remote code execution on caller machine
  - marketplace / payment / rating / refund logic reuse
  - large UI redesign

## Planned File Structure

### New Core Modules

- Create: `src/core/master/masterTypes.ts`
  - Shared enums/types for publish records, ask draft, preview, pending asks, trace metadata, trigger decisions.
- Create: `src/core/master/masterServiceSchema.ts`
  - `master-service` payload normalization and validation.
- Create: `src/core/master/masterServicePublish.ts`
  - Build/persist published master records and chain payloads for `/protocols/master-service`.
- Create: `src/core/master/masterDirectory.ts`
  - Read/filter `master-service` directory rows from local/runtime/chain directory state.
- Create: `src/core/master/masterMessageSchema.ts`
  - `master_request` / `master_response` parse/validate/serialize helpers.
- Create: `src/core/master/masterPreview.ts`
  - Preview formatting and “final JSON snapshot” assembly.
- Create: `src/core/master/masterPendingAskState.ts`
  - Read/write pending ask records from a dedicated hot-state JSON file.
- Create: `src/core/master/masterTrace.ts`
  - Ask Master trace metadata builder plus canonical-status mapping helpers.
- Create: `src/core/master/masterProviderRuntime.ts`
  - Provider-side request validation, routing, runner orchestration, response building.
- Create: `src/core/master/debugMasterFixture.ts`
  - Official Debug Master fixture rules and stable structured responses.
- Create: `src/core/master/masterTriggerEngine.ts`
  - Observation normalization, trigger evaluation, suppression/cooldown decisions.

### New CLI / Daemon Surfaces

- Create: `src/cli/commands/master.ts`
  - `publish`, `list`, `ask`, `trace` subcommands.
- Create: `src/daemon/routes/master.ts`
  - `/api/master/*` route family for daemon-backed CLI/runtime access.

### Existing Files To Extend

- Modify: `src/cli/main.ts`
  - Register the new `master` command family.
- Modify: `src/cli/types.ts`
  - Add `master` dependency group.
- Modify: `src/cli/runtime.ts`
  - Wire default CLI dependencies to new daemon handlers.
- Modify: `src/cli/commandHelp.ts`
  - Document `metabot master publish/list/ask/trace`.
- Modify: `src/core/config/configTypes.ts`
  - Add `askMaster` config block.
- Modify: `src/core/config/configStore.ts`
  - Normalize/read/write Ask Master config defaults.
- Modify: `src/core/state/paths.ts`
  - Add dedicated file paths for pending asks and, if needed, trigger-state/suppression state.
- Modify: `src/core/state/runtimeStateStore.ts`
  - Extend normalized state only where trace metadata storage must be persisted.
- Modify: `src/core/chat/sessionTrace.ts`
  - Add `askMaster` metadata to `SessionTraceRecord`.
- Modify: `src/core/a2a/publicStatus.ts`
  - Keep compatibility mapping while letting Ask Master canonical status sit above it.
- Modify: `src/daemon/routes/types.ts`
  - Add `master` handler contract.
- Modify: `src/daemon/httpServer.ts`
  - Register the new `master` routes.
- Modify: `src/daemon/defaultHandlers.ts`
  - Implement default `master` handlers using the new core modules.

### Fixtures / Templates / Tests

- Create: `templates/master-service/debug-master.template.json`
  - Provider-side template for the official debug master.
- Create: `e2e/fixtures/master-service-debug.json`
  - Published master fixture for e2e.
- Create: `e2e/fixtures/master-ask-request.json`
  - Caller-side ask draft fixture for e2e.
- Create: `tests/master/*.test.mjs`
  - New focused unit/integration tests for this feature family.
- Modify: `tests/cli/runtime.test.mjs`
  - CLI integration coverage.
- Modify: `tests/daemon/httpServer.test.mjs`
  - HTTP route coverage.
- Modify: `tests/provider/providerRoutes.test.mjs`
  - Provider-side runtime/summary coverage where relevant.

## Task 1: Scaffold The `master` Product Family

**Files:**
- Create: `src/cli/commands/master.ts`
- Create: `src/daemon/routes/master.ts`
- Modify: `src/cli/main.ts`
- Modify: `src/cli/types.ts`
- Modify: `src/cli/runtime.ts`
- Modify: `src/cli/commandHelp.ts`
- Modify: `src/daemon/routes/types.ts`
- Modify: `src/daemon/httpServer.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Test: `tests/cli/masterCommand.test.mjs`
- Test: `tests/daemon/masterRoutes.test.mjs`

- [ ] **Step 1: Write failing command/routing tests**

```js
test('metabot master unknown subcommand is routed through the new command family', async () => {
  const code = await runCli(['master', 'wat'], testContext);
  assert.equal(code, 1);
});

test('GET /api/master/list returns not_implemented before handlers exist', async () => {
  // start test server with empty handlers and assert 200 + not_implemented envelope
});
```

- [ ] **Step 2: Run the targeted tests to confirm the command family does not exist yet**

Run: `npm run build && node --test tests/cli/masterCommand.test.mjs tests/daemon/masterRoutes.test.mjs`

Expected: FAIL with missing command/route implementation assertions.

- [ ] **Step 3: Add the minimal CLI and daemon scaffolding**

Implement:

- `runMasterCommand(args, context)` in `src/cli/commands/master.ts`
- `case 'master':` registration in `src/cli/main.ts`
- `master?: { publish; list; ask; trace; }` dependency surface in `src/cli/types.ts`
- `/api/master/*` route family in `src/daemon/routes/master.ts`
- handler contracts in `src/daemon/routes/types.ts`
- route registration in `src/daemon/httpServer.ts`
- empty-but-typed `master` handlers in `src/daemon/defaultHandlers.ts`
- help entries in `src/cli/commandHelp.ts`

- [ ] **Step 4: Re-run the targeted tests**

Run: `npm run build && node --test tests/cli/masterCommand.test.mjs tests/daemon/masterRoutes.test.mjs`

Expected: PASS with `not_implemented` placeholders, proving the command family and route family exist.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/master.ts src/cli/main.ts src/cli/types.ts src/cli/runtime.ts src/cli/commandHelp.ts src/daemon/routes/master.ts src/daemon/routes/types.ts src/daemon/httpServer.ts src/daemon/defaultHandlers.ts tests/cli/masterCommand.test.mjs tests/daemon/masterRoutes.test.mjs
git commit -m "feat: scaffold master command family"
```

## Task 2: Implement `master-service` Publish And Discovery

**Files:**
- Create: `src/core/master/masterTypes.ts`
- Create: `src/core/master/masterServiceSchema.ts`
- Create: `src/core/master/masterServicePublish.ts`
- Create: `src/core/master/masterDirectory.ts`
- Create: `templates/master-service/debug-master.template.json`
- Modify: `src/core/services/servicePublishChain.ts`
- Modify: `src/core/discovery/chainDirectoryReader.ts`
- Modify: `src/core/discovery/serviceDirectory.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `src/cli/commands/master.ts`
- Test: `tests/master/masterServiceSchema.test.mjs`
- Test: `tests/master/masterDirectory.test.mjs`
- Test: `tests/master/masterPublish.test.mjs`

- [ ] **Step 1: Write failing schema/publish/discovery tests**

```js
test('validateMasterServicePayload accepts the official debug master template', () => {
  const payload = loadFixture('templates/master-service/debug-master.template.json');
  assert.equal(validateMasterServicePayload(payload).ok, true);
});

test('listMasters filters out non-master services and offline providers', async () => {
  // seed mixed directory records and assert:
  // 1) default list keeps both online/offline master-service rows
  // 2) optional online-only filtering removes offline rows
});
```

- [ ] **Step 2: Run the targeted tests to see the missing module failures**

Run: `npm run build && node --test tests/master/masterServiceSchema.test.mjs tests/master/masterDirectory.test.mjs tests/master/masterPublish.test.mjs`

Expected: FAIL with missing module/function errors.

- [ ] **Step 3: Implement `master-service` validation, publish, and list**

Implement:

- strict payload validation for `/protocols/master-service`
- normalized published record shape separate from `skill-service`
- `metabot master publish --payload-file ...`
- `metabot master list`
- optional online-only filtering for callers that need it, without making “online only” the default listing behavior
- directory filtering by:
  - protocol path
  - current host mode
  - `masterKind`

Keep the implementation minimal:

- reuse current publish chain writer
- reuse heartbeat online filtering
- do not add marketplace/payment logic

- [ ] **Step 4: Re-run the targeted tests**

Run: `npm run build && node --test tests/master/masterServiceSchema.test.mjs tests/master/masterDirectory.test.mjs tests/master/masterPublish.test.mjs`

Expected: PASS with the official debug master template publishing and listing correctly.

- [ ] **Step 5: Commit**

```bash
git add src/core/master/masterTypes.ts src/core/master/masterServiceSchema.ts src/core/master/masterServicePublish.ts src/core/master/masterDirectory.ts templates/master-service/debug-master.template.json src/core/services/servicePublishChain.ts src/core/discovery/chainDirectoryReader.ts src/core/discovery/serviceDirectory.ts src/daemon/defaultHandlers.ts src/cli/commands/master.ts tests/master/masterServiceSchema.test.mjs tests/master/masterDirectory.test.mjs tests/master/masterPublish.test.mjs
git commit -m "feat: add master-service publish and discovery"
```

## Task 3: Implement `master_request` / `master_response` Message Contracts

**Files:**
- Create: `src/core/master/masterMessageSchema.ts`
- Modify: `src/core/chat/privateChat.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Test: `tests/master/masterMessageSchema.test.mjs`
- Test: `tests/master/masterSimplemsgRoundtrip.test.mjs`

- [ ] **Step 1: Write failing message-schema and roundtrip tests**

```js
test('parseMasterRequest accepts a valid JSON envelope and rejects missing requestId', () => {
  assert.equal(parseMasterRequest(validRequest).ok, true);
  assert.equal(parseMasterRequest({ ...validRequest, requestId: '' }).ok, false);
});

test('master_request JSON survives sendPrivateChat -> receivePrivateChat roundtrip', () => {
  // encrypt, decrypt, and re-parse as structured message
});
```

- [ ] **Step 2: Run the targeted tests**

Run: `npm run build && node --test tests/master/masterMessageSchema.test.mjs tests/master/masterSimplemsgRoundtrip.test.mjs`

Expected: FAIL until the schema and helpers exist.

- [ ] **Step 3: Implement request/response schema helpers**

Implement:

- `parseMasterRequest`
- `parseMasterResponse`
- `buildMasterRequestJson`
- `buildMasterResponseJson`
- loud-failure behavior for:
  - malformed JSON
  - wrong `type`
  - missing `requestId`
  - missing `traceId`
  - incompatible version

Do not change `simplemsg` crypto semantics; only add structured-message handling above it.

- [ ] **Step 4: Re-run the targeted tests**

Run: `npm run build && node --test tests/master/masterMessageSchema.test.mjs tests/master/masterSimplemsgRoundtrip.test.mjs`

Expected: PASS with structured request/response validation and private-chat roundtrip intact.

- [ ] **Step 5: Commit**

```bash
git add src/core/master/masterMessageSchema.ts src/core/chat/privateChat.ts src/daemon/defaultHandlers.ts tests/master/masterMessageSchema.test.mjs tests/master/masterSimplemsgRoundtrip.test.mjs
git commit -m "feat: add master message schemas"
```

## Task 4: Implement Caller `master ask` Preview, Pending Store, And Confirm Flow

**Files:**
- Create: `src/core/master/masterPreview.ts`
- Create: `src/core/master/masterPendingAskState.ts`
- Modify: `src/core/state/paths.ts`
- Modify: `src/core/config/configTypes.ts`
- Modify: `src/core/config/configStore.ts`
- Modify: `src/cli/commands/master.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Test: `tests/master/masterPreview.test.mjs`
- Test: `tests/master/masterPendingAskState.test.mjs`
- Test: `tests/master/masterAskFlow.test.mjs`
- Test: `tests/config/askMasterConfig.test.mjs`

- [ ] **Step 1: Write failing tests for preview and confirm**

```js
test('master ask returns awaiting_confirmation with stable traceId/requestId and preview snapshot', async () => {
  // ask --request-file -> awaiting_confirmation
});

test('master ask --trace-id ... --confirm reuses the stored pending request instead of recomputing input', async () => {
  // mutate original file after preview and assert confirm still uses stored snapshot
});
```

- [ ] **Step 2: Run the targeted tests**

Run: `npm run build && node --test tests/master/masterPreview.test.mjs tests/master/masterPendingAskState.test.mjs tests/master/masterAskFlow.test.mjs tests/config/askMasterConfig.test.mjs`

Expected: FAIL until preview/state/config plumbing exists.

- [ ] **Step 3: Implement caller ask flow**

Implement:

- `askMaster` config defaults:
  - `enabled`
  - `triggerMode`
  - `confirmationMode`
  - `contextMode`
  - `trustedMasters`
- dedicated pending ask state file under `.metabot/hot/`
- `metabot master ask --request-file ...`
  - validate draft
  - resolve target
  - package context
  - generate `traceId` / `requestId`
  - persist pending snapshot
  - return `awaiting_confirmation`
- `metabot master ask --trace-id ... --confirm`
  - reload pending ask
  - send stored `master_request`
  - preserve timeout semantics

- [ ] **Step 4: Re-run the targeted tests**

Run: `npm run build && node --test tests/master/masterPreview.test.mjs tests/master/masterPendingAskState.test.mjs tests/master/masterAskFlow.test.mjs tests/config/askMasterConfig.test.mjs`

Expected: PASS with two-stage preview/confirm behavior and config defaults in place.

- [ ] **Step 5: Commit**

```bash
git add src/core/master/masterPreview.ts src/core/master/masterPendingAskState.ts src/core/state/paths.ts src/core/config/configTypes.ts src/core/config/configStore.ts src/cli/commands/master.ts src/daemon/defaultHandlers.ts tests/master/masterPreview.test.mjs tests/master/masterPendingAskState.test.mjs tests/master/masterAskFlow.test.mjs tests/config/askMasterConfig.test.mjs
git commit -m "feat: add caller master ask flow"
```

## Task 5: Implement Provider Runtime And Official Debug Master Fixture

**Files:**
- Create: `src/core/master/masterProviderRuntime.ts`
- Create: `src/core/master/debugMasterFixture.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `src/core/a2a/sessionEngine.ts`
- Modify: `src/core/provider/providerConsole.ts`
- Test: `tests/master/masterProviderRuntime.test.mjs`
- Test: `tests/master/debugMasterFixture.test.mjs`
- Test: `tests/provider/providerMasterSummary.test.mjs`

- [ ] **Step 1: Write failing provider/runtime tests**

```js
test('provider runtime accepts a valid master_request for the official debug master and returns completed response', async () => {
  // validated request -> structured response
});

test('official debug master returns stable structured advice for discovery-empty and timeout cases', () => {
  // deterministic fixture output
});
```

- [ ] **Step 2: Run the targeted tests**

Run: `npm run build && node --test tests/master/masterProviderRuntime.test.mjs tests/master/debugMasterFixture.test.mjs tests/provider/providerMasterSummary.test.mjs`

Expected: FAIL until provider runtime and fixture exist.

- [ ] **Step 3: Implement provider-side ask handling**

Implement:

- request validator and router for provider-side `master_request`
- provider runner contract
- Official Debug Master fixture rules for:
  - discovery empty / source missing
  - timeout semantics confusion
  - service/master not found
  - `simplemsg` decrypt/public-key issues
  - schema/validation issues
- response builder that always returns structured `master_response`
- provider-side trace/session projection using existing provider/session skeletons

- [ ] **Step 4: Re-run the targeted tests**

Run: `npm run build && node --test tests/master/masterProviderRuntime.test.mjs tests/master/debugMasterFixture.test.mjs tests/provider/providerMasterSummary.test.mjs`

Expected: PASS with deterministic fixture behavior and provider-side runtime transitions.

- [ ] **Step 5: Commit**

```bash
git add src/core/master/masterProviderRuntime.ts src/core/master/debugMasterFixture.ts src/daemon/defaultHandlers.ts src/core/a2a/sessionEngine.ts src/core/provider/providerConsole.ts tests/master/masterProviderRuntime.test.mjs tests/master/debugMasterFixture.test.mjs tests/provider/providerMasterSummary.test.mjs
git commit -m "feat: add provider master runtime"
```

## Task 6: Implement Ask Master Trace Metadata And `master trace`

**Files:**
- Create: `src/core/master/masterTrace.ts`
- Modify: `src/core/chat/sessionTrace.ts`
- Modify: `src/core/a2a/publicStatus.ts`
- Modify: `src/cli/commands/master.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Test: `tests/master/masterTraceMetadata.test.mjs`
- Test: `tests/master/masterTraceCommand.test.mjs`
- Test: `tests/daemon/masterTraceRoute.test.mjs`

- [ ] **Step 1: Write failing trace tests**

```js
test('ask master traces include askMaster.flow and askMaster.canonicalStatus', () => {
  // build trace and assert metadata exists
});

test('master trace reads ask master semantics instead of private chat wording', async () => {
  // command output must include flow=master and canonical status
});
```

- [ ] **Step 2: Run the targeted tests**

Run: `npm run build && node --test tests/master/masterTraceMetadata.test.mjs tests/master/masterTraceCommand.test.mjs tests/daemon/masterTraceRoute.test.mjs`

Expected: FAIL until Ask Master trace metadata and CLI/route read path exist.

- [ ] **Step 3: Implement trace metadata and read path**

Implement:

- `askMaster.flow = 'master'`
- `askMaster.canonicalStatus` as the only canonical status field
- raw event in `a2a.latestEvent`
- derived display text only in read/view layers
- `metabot master trace --id ...`
- CLI/route output mapping that distinguishes Ask Master from:
  - private chat
  - service call
  - order/rating/refund flows

Defer browser/UI trace rendering updates until a later phase unless CLI/route verification exposes a blocker.

- [ ] **Step 4: Re-run the targeted tests**

Run: `npm run build && node --test tests/master/masterTraceMetadata.test.mjs tests/master/masterTraceCommand.test.mjs tests/daemon/masterTraceRoute.test.mjs`

Expected: PASS with Ask Master traces clearly separated from old product flows.

- [ ] **Step 5: Commit**

```bash
git add src/core/master/masterTrace.ts src/core/chat/sessionTrace.ts src/core/a2a/publicStatus.ts src/cli/commands/master.ts src/daemon/defaultHandlers.ts tests/master/masterTraceMetadata.test.mjs tests/master/masterTraceCommand.test.mjs tests/daemon/masterTraceRoute.test.mjs
git commit -m "feat: add master trace semantics"
```

## Task 7: Implement Minimal Trigger Core (`manual + suggest`)

**Files:**
- Create: `src/core/master/masterTriggerEngine.ts`
- Modify: `src/core/config/configTypes.ts`
- Modify: `src/core/config/configStore.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Test: `tests/master/masterTriggerEngine.test.mjs`
- Test: `tests/master/masterSuppression.test.mjs`
- Test: `tests/master/masterSuggestFlow.test.mjs`

- [ ] **Step 1: Write failing trigger tests**

```js
test('trigger engine returns manual_requested when the user explicitly asks for a master', () => {
  // explicit ask -> manual_requested
});

test('suggest mode emits suggest once for repeated failures and then suppresses duplicates', () => {
  // repeated failures + same trace => suggest once
});

test('askMaster.enabled=false prevents observation collection and trigger evaluation', () => {
  // disabled gate -> skip collector/evaluator entirely
});
```

- [ ] **Step 2: Run the targeted tests**

Run: `npm run build && node --test tests/master/masterTriggerEngine.test.mjs tests/master/masterSuppression.test.mjs tests/master/masterSuggestFlow.test.mjs`

Expected: FAIL until the trigger evaluator exists.

- [ ] **Step 3: Implement minimal trigger engine**

Implement:

- observation normalization from host-visible signals
- decisions:
  - `manual_requested`
  - `suggest`
  - `no_action`
- `auto_candidate` type and plumbing, but keep it gated off in public behavior
- hard gate behavior:
  - when `askMaster.enabled=false`, do not collect Ask Master observations
  - when `askMaster.enabled=false`, do not evaluate trigger decisions
- suppression by:
  - trace
  - master kind
  - repeated rejection
  - repeated identical failure signatures

Do not implement:

- background auto-send
- CoT-based scoring
- complex ML ranking

- [ ] **Step 4: Re-run the targeted tests**

Run: `npm run build && node --test tests/master/masterTriggerEngine.test.mjs tests/master/masterSuppression.test.mjs tests/master/masterSuggestFlow.test.mjs`

Expected: PASS with deterministic `manual + suggest` behavior, suppression, and disabled-mode hard gating.

- [ ] **Step 5: Commit**

```bash
git add src/core/master/masterTriggerEngine.ts src/core/config/configTypes.ts src/core/config/configStore.ts src/daemon/defaultHandlers.ts tests/master/masterTriggerEngine.test.mjs tests/master/masterSuppression.test.mjs tests/master/masterSuggestFlow.test.mjs
git commit -m "feat: add master trigger core"
```

## Task 8: Add End-To-End Fixtures And Final Verification

**Files:**
- Create: `e2e/fixtures/master-service-debug.json`
- Create: `e2e/fixtures/master-ask-request.json`
- Modify: `tests/e2e/fixtureHarness.test.mjs`
- Create: `tests/e2e/masterAskHappyPath.test.mjs`
- Modify: `tests/cli/runtime.test.mjs`
- Modify: `tests/daemon/httpServer.test.mjs`

- [ ] **Step 1: Write failing e2e/integration assertions**

```js
test('caller can preview, confirm, and receive a structured response from the official debug master', async () => {
  // publish/list/ask/trace fixture run
});

test('caller timeout semantics remain unchanged after master ask integration', async () => {
  // no provider reply -> caller stops waiting locally
});
```

- [ ] **Step 2: Run the targeted e2e/integration tests**

Run: `npm run build && node --test tests/e2e/masterAskHappyPath.test.mjs tests/cli/runtime.test.mjs tests/daemon/httpServer.test.mjs`

Expected: FAIL until the full vertical slice is wired end-to-end.

- [ ] **Step 3: Add fixtures and close gaps**

Implement/fix:

- official debug master fixture files
- runtime wiring gaps discovered by integration tests
- timeout behavior parity
- final command/help/trace polish needed to make the happy path readable

- [ ] **Step 4: Run the Phase 1 verification suite**

Run:

```bash
npm run build
node --test tests/master/*.test.mjs
node --test tests/provider/*.test.mjs
node --test tests/daemon/masterRoutes.test.mjs tests/daemon/httpServer.test.mjs
node --test tests/cli/masterCommand.test.mjs tests/cli/runtime.test.mjs
node --test tests/e2e/masterAskHappyPath.test.mjs tests/e2e/fixtureHarness.test.mjs
```

Expected: PASS for the new master-focused test set and no regression in touched integration paths.

- [ ] **Step 5: Commit**

```bash
git add e2e/fixtures/master-service-debug.json e2e/fixtures/master-ask-request.json tests/e2e/masterAskHappyPath.test.mjs tests/e2e/fixtureHarness.test.mjs tests/cli/runtime.test.mjs tests/daemon/httpServer.test.mjs
git commit -m "test: verify ask master phase1 flow"
```

## Verification Notes

- Do not use the full `npm test` suite after every tiny task; use targeted tests while iterating, then run the broader verification in Task 8.
- Keep `.gitignore` changes out of scope unless the user explicitly asks.
- Prefer adding new code under `src/core/master/` rather than stuffing more logic into `src/daemon/defaultHandlers.ts`.
- When extending `src/daemon/defaultHandlers.ts`, factor helpers into the new `src/core/master/` modules first, then keep the handler layer thin.
- Preserve current timeout semantics exactly.
- Never silently downgrade malformed structured responses into plain chat text.

## Acceptance Checklist

- `metabot master publish --payload-file ...` publishes `/protocols/master-service`
- `metabot master list` shows at least one online Official Debug Master
- `metabot master ask --request-file ...` returns preview + `awaiting_confirmation`
- `metabot master ask --trace-id ... --confirm` sends the stored request snapshot
- caller receives a structured `master_response`
- `metabot master trace --id ...` shows Ask Master semantics, not private chat/order semantics
- Official Debug Master fixture is deterministic enough for local smoke tests and CI
- `manual + suggest` trigger logic exists without depending on CoT
