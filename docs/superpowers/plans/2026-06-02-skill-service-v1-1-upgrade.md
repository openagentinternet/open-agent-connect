# Skill Service V1.1 Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Open Agent Connect skill-service publishing, ordering, execution, and rating flows to the `skill-service` v1.1 protocol while preserving backward compatibility with v1.0 records.

**Architecture:** Add a small protocol normalization layer, then route all publish, discovery, UI, order, provider execution, trace, and rating code through it. The public protocol publishes `providerSkill` as an array and uses `skill-service-order` pin ids as order ids; legacy single-skill and payment-txid based records remain readable as fallback data.

**Tech Stack:** TypeScript, Node.js 20+, `node:test`, existing OAC daemon/CLI/UI, MetaID pin publishing, current skillpack build scripts.

**Spec:** `docs/metaid_protocols/02-content-app.md`

**Reference:** `/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/src/main/shared/skillServiceProtocol.js`, `/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/src/main/services/serviceOrderProtocols.js`

**Confirmed scope boundary:** Backend parsing and state should tolerate `postpaid` and `fiat` protocol values, but this implementation only exposes and executes `free` and `prepaid` service calls. `postpaid` and unsupported `fiat` execution paths must fail with explicit unsupported messages rather than silently behaving like prepaid native payment.

---

## Implementation Status (2026-06-02)

This branch has implemented the planned `skill-service` v1.1 upgrade on `codex/skill-service-v1-1-upgrade`.

Completed protocol and business changes:
- `skill-service` publish and modify payloads emit v1.1 fields: `providerSkill` arrays, `paymentTiming`, `settlementKind`, `executionReminder`, and `metadata`.
- Readers preserve v1.0 compatibility by accepting legacy scalar `providerSkill`, legacy payment fields, and old rating records.
- Publish validation accepts multiple safe provider skills, accepts scalar compatibility input from older callers, and falls back to legacy `providerSkill` when a stored `providerSkills` array is empty.
- The publish and my-services UI expose multi-skill selection, free/prepaid controls, execution reminder input, and v1.1 edit defaults.
- Buyer service calls create a `/protocols/skill-service-order` pin for both free and prepaid services, use that pin id as the order id, and keep payment txids only as payment evidence.
- Seller order state, provider summaries, trace projections, refund settlement, and my-services order detail prefer `serviceOrderPinId` while retaining legacy payment-tx fallback where appropriate.
- Provider-side service execution accepts multiple allowed skills and injects `executionReminder` into the provider execution prompt.
- `skill-service-rate` publishing and rating-detail sync include `serviceOrderPinId` and `serviceSkills`, with legacy fallback limited to legacy records that have no service order id.
- E2E fixtures and generated skillpack artifacts were updated to the v1.1 skill-service contract.

Implementation commit sequence:
- `22ca5e33` `feat: add skill service v1.1 protocol helpers`
- `8e261417` `feat: support skill service v1.1 publish records`
- `cc2fd580` `feat: publish skill services with v1.1 cli payloads`
- `a643f272` `feat: update service ui for skill service v1.1`
- `4b90b742` `fix: validate prepaid service edit prices`
- `3716300e` `feat: create skill service orders for service calls`
- `b1711bde` `fix: key seller orders by service order pin`
- `11d47100` `feat: run skill services with multiple provider skills`
- `4a922b53` `test: cover direct multi-skill service execution`
- `ea2ca9e0` `feat: surface service order ids in service state`
- `437034cd` `test: cover service order pin refund settlement`
- `e33ed2b3` `feat: rate services by service order id`
- `79e86336` `fix: restrict rating payment fallback to legacy records`
- `528045fc` `test: align e2e fixtures with skill service v1.1`
- `ac1ee1b1` `chore: sync skill service v1.1 skillpack artifacts`
- `868d4bce` `fix: accept scalar provider skills validation input`
- `62d6bf1c` `fix: normalize scalar provider skill selections`
- `0e8e6808` `fix: preserve legacy provider skill fallback on modify`

Verification completed on the current branch:
- Focused protocol, publish, modify, call-flow, provider execution, seller-order, refund, rating, UI, fixture, and skillpack tests were run at the relevant implementation checkpoints.
- Final full-suite rerun after the latest follow-up fix passed:
  - Non-runtime suite: `1933/1933` passing.
  - Runtime suite: `81/81` passing.

Review status:
- Scoped subagent reviews were run for the later implementation and follow-up checkpoints, including rating fallback, fixture alignment, skillpack regeneration, scalar provider-skill compatibility, and empty stored `providerSkills` fallback.
- The latest follow-up review for `0e8e6808` reported no findings.
- A final full-branch review and acceptance subagent must still run before this branch is considered ready to merge.

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `src/core/services/skillServiceProtocol.ts` | Normalize v1.1 service payload fields, legacy provider skill strings, payment timing, settlement kind, metadata, and `skill-service-order` payloads. |
| `tests/services/skillServiceProtocol.test.mjs` | Unit coverage for provider skill list normalization, payment term normalization, v1.0 compatibility, v1.1 payload building, and unsupported execution boundaries. |

### Existing files to modify

| File | Change |
|---|---|
| `src/core/services/publishService.ts` | Publish v1.1 payloads and keep legacy fallback fields in local records. |
| `src/core/services/servicePublishValidation.ts` | Validate one or more provider skills instead of a single safe skill name. |
| `src/core/discovery/chainServiceDirectory.ts` | Parse v1.1 provider skill arrays and v1.0 strings into normalized service records. |
| `src/core/services/myServices.ts` | Project multi-skill services, payment timing, execution reminder, metadata, and order ids into owned-service UI/API models. |
| `src/core/orders/serviceOrderProtocols.ts` | Add `skill-service-order` payload helpers and order-pin protocol line helpers while preserving existing exports. |
| `src/core/orders/orderMessage.ts` | Include `serviceOrderPinId` and allowed provider skills in buyer order payloads. |
| `src/core/orders/delegationOrderMessage.ts` | Carry provider skill arrays, execution reminder context, and service order pin ids through delegated order requests. |
| `src/core/payments/servicePayment.ts` | Stop creating synthetic free order references; separate payment txids from service order ids. |
| `src/core/payments/servicePaymentVerification.ts` | Continue native payment verification while accepting service order id as the order key. |
| `src/core/a2a/protocol/orderProtocol.ts` | Parse and build `[ORDER_STATUS]`, `[DELIVERY]`, `[NeedsRating]`, and `[ORDER_END]` messages with `order pin id:` metadata. |
| `src/core/a2a/provider/providerServiceRunner.ts` | Inject multiple allowed skills and prepend `executionReminder` to provider execution prompts. |
| `src/core/a2a/provider/serviceRunnerContracts.ts` | Replace single-skill request contracts with normalized allowed-skill arrays while keeping compatibility fallback fields. |
| `src/core/a2a/provider/serviceRunnerRegistry.ts` | Index and resolve runners by service pin id and allowed skills without assuming one service equals one skill. |
| `src/core/chat/sessionTrace.ts` | Store `serviceOrderPinId`, `providerSkills`, and execution reminder metadata in traces. |
| `src/core/orders/sellerOrderState.ts` | Store `serviceOrderPinId` as the primary order id and keep payment txid as payment evidence. |
| `src/core/ratings/ratingDetailState.ts` | Persist rating details keyed by `serviceOrderPinId` first, with legacy `servicePaidTx` fallback. |
| `src/core/ratings/ratingDetailSync.ts` | Parse v1.1 `serviceOrderPinId` and `serviceSkills` from `skill-service-rate` records. |
| `src/core/provider/providerConsole.ts` | Display and look up ratings/orders by service order pin id. |
| `src/daemon/defaultHandlers.ts` | Wire publish, modify, call, provider inbound order, direct execution, trace, and rating flows to v1.1 data. |
| `src/daemon/routes/services.ts` | Accept v1.1 publish/modify/call/rate payload fields through existing service routes. |
| `src/cli/commands/services.ts` | Update CLI payload handling and output labels for multi-skill services and service order ids. |
| `src/cli/runtime.ts` | Forward v1.1 service payloads without collapsing arrays to strings. |
| `src/ui/pages/publish/viewModel.ts` | Expose selected/available skill list state, payment timing, execution reminder, and validation messages. |
| `src/ui/pages/publish/app.ts` | Replace the single-skill select with multi-select controls and add free/prepaid and reminder inputs. |
| `src/ui/pages/my-services/viewModel.ts` | Render owned services and edit forms with multiple skills, payment timing, reminder, and service order ids. |
| `src/ui/pages/my-services/app.ts` | Update edit modal behavior and payload submission for v1.1 service fields. |
| `SKILLs/metabot-post-skillservice/SKILL.md` | Document v1.1 publishing, multi-skill selection, free/prepaid timing, and execution reminders. |
| `skillpacks/**/skills/metabot-post-skillservice/SKILL.md` | Regenerated output from `npm run build:skillpacks`; do not edit generated copies by hand. |
| `tests/**/*.test.mjs` | Update focused coverage for changed contracts and v1.0 fallback behavior. |

---

## Implementation Tasks

### Task 1: Add Skill Service Protocol Normalization

**Files:**
- Create: `src/core/services/skillServiceProtocol.ts`
- Create: `tests/services/skillServiceProtocol.test.mjs`

- [ ] **Step 1: Write failing protocol helper tests**

Cover these cases:
- `providerSkill: "metabot-post-buzz"` normalizes to `["metabot-post-buzz"]`.
- `providerSkill: ["weather-query", "metabot-post-buzz"]` stays ordered for display but is treated as an allow-list, not an execution pipeline.
- Empty, duplicate, unsafe, or non-string provider skills are rejected or filtered according to existing validation behavior.
- Missing `paymentTiming` derives `free` when effective price is zero and `prepaid` when effective price is greater than zero.
- `postpaid` and `fiat` parse without data loss but are marked unsupported for execution.
- `buildSkillServiceOrderPayload()` omits `orderId`, includes `servicePinId`, `paymentTxid`, display price/currency, `settlementKind`, and optional metadata.

Run:

```bash
npm run build && node --test tests/services/skillServiceProtocol.test.mjs
```

Expected: fail because the helper module does not exist.

- [ ] **Step 2: Implement the helper module**

Export focused helpers:
- `normalizeProviderSkillList(value: unknown): string[]`
- `getPrimaryProviderSkill(value: unknown): string | null`
- `normalizeSkillServicePaymentTiming(value: unknown, price: unknown): SkillServicePaymentTiming`
- `normalizeSkillServiceSettlementKind(value: unknown): SkillServiceSettlementKind`
- `isExecutableSkillServicePaymentTerm(term): boolean`
- `buildSkillServiceOrderPayload(input): SkillServiceOrderPayload`

Keep comments short and only where the v1.1/v1.0 fallback boundary is easy to miss.

- [ ] **Step 3: Verify protocol helper tests**

Run:

```bash
npm run build && node --test tests/services/skillServiceProtocol.test.mjs
```

Expected: pass.

- [ ] **Step 4: Commit and post diary**

```bash
git add src/core/services/skillServiceProtocol.ts tests/services/skillServiceProtocol.test.mjs
git commit -m "feat: add skill service v1.1 protocol helpers"
```

After the commit, use the `metabot-post-buzz` skill to post a detailed development diary for this round.

### Task 2: Upgrade Publish, Discovery, and Validation Models

**Files:**
- Modify: `src/core/services/publishService.ts`
- Modify: `src/core/services/servicePublishValidation.ts`
- Modify: `src/core/discovery/chainServiceDirectory.ts`
- Modify: `tests/services/*.test.mjs`
- Modify: `tests/discovery/*.test.mjs` if existing discovery coverage applies

- [ ] **Step 1: Write failing tests**

Add focused tests proving:
- New service publish payloads emit v1.1 `providerSkill` arrays plus `paymentTiming`, `settlementKind`, `executionReminder`, and `metadata`.
- Legacy chain rows with `providerSkill: "single-skill"` still parse.
- v1.1 chain rows expose `providerSkills` plus a legacy `providerSkill` fallback equal to the first skill.
- Validation rejects empty multi-skill lists and reports missing local skills individually.

Run the smallest matching test files after `npm run build`.

- [ ] **Step 2: Implement model changes**

Update service draft/record types to carry:
- `providerSkills: string[]`
- `providerSkill: string | null` as compatibility fallback
- `paymentTiming`
- `settlementKind`
- `executionReminder`
- `metadata`

New publishers should write the v1.1 array payload. Readers must continue accepting the old string payload.

- [ ] **Step 3: Verify publish/discovery tests**

Run:

```bash
npm run build && node --test tests/services/*.test.mjs tests/discovery/*.test.mjs
```

If no discovery tests exist, run the concrete service test files touched by this task.

- [ ] **Step 4: Commit and post diary**

```bash
git add src/core/services src/core/discovery tests/services tests/discovery
git commit -m "feat: support skill service v1.1 publish records"
```

After the commit, use the `metabot-post-buzz` skill to post a detailed development diary for this round.

### Task 3: Update CLI and metabot-post-skillservice Publishing Surfaces

**Files:**
- Modify: `src/cli/commands/services.ts`
- Modify: `src/cli/runtime.ts`
- Modify: `src/daemon/routes/services.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `SKILLs/metabot-post-skillservice/SKILL.md`
- Modify generated skillpack files only through `npm run build:skillpacks`
- Modify: `tests/cli/services.test.mjs`

- [ ] **Step 1: Write failing CLI/payload tests**

Cover payloads containing:
- `providerSkills: ["weather-query", "metabot-post-buzz"]`
- legacy `providerSkill: "metabot-post-buzz"`
- `paymentTiming: "free"` with price omitted or zero
- `paymentTiming: "prepaid"` with a positive price
- `executionReminder`

- [ ] **Step 2: Implement CLI and handler normalization**

Normalize incoming JSON once at the daemon boundary. Do not let CLI code flatten arrays into comma-separated strings.

Update the skill document in English with:
- v1.1 protocol summary
- when to use multiple provider skills
- how to choose free vs prepaid
- how to write execution reminders
- payload examples for publish and modify

- [ ] **Step 3: Regenerate skillpacks**

Run:

```bash
npm run build:skillpacks
```

- [ ] **Step 4: Verify**

Run:

```bash
npm run build && node --test tests/cli/services.test.mjs
```

- [ ] **Step 5: Commit and post diary**

```bash
git add src/cli src/daemon SKILLs/metabot-post-skillservice/SKILL.md skillpacks tests/cli/services.test.mjs
git commit -m "feat: publish skill services with v1.1 cli payloads"
```

After the commit, use the `metabot-post-buzz` skill to post a detailed development diary for this round.

### Task 4: Upgrade Publish and My Services UI

**Files:**
- Modify: `src/ui/pages/publish/viewModel.ts`
- Modify: `src/ui/pages/publish/app.ts`
- Modify: `src/ui/pages/my-services/viewModel.ts`
- Modify: `src/ui/pages/my-services/app.ts`
- Modify: UI tests under `tests/ui/`

- [ ] **Step 1: Write failing UI view-model tests**

Cover:
- Multi-skill selection state.
- Free timing disables or ignores positive-price validation.
- Prepaid timing requires positive price and supported native currency.
- Execution reminder is submitted and displayed.
- Owned services render multiple skills and service order ids.

- [ ] **Step 2: Implement UI controls**

Use restrained operational UI controls:
- Checkbox list or multi-select for provider skills.
- Segmented/toggle control for `free` and `prepaid`.
- Textarea/input for `executionReminder`.
- Existing visual style; no landing-page or decorative redesign.

Submit `providerSkills` arrays. Preserve legacy `providerSkill` only as a fallback value when editing old services.

- [ ] **Step 3: Verify UI behavior**

Run:

```bash
npm run build && node --test tests/ui/*.test.mjs
```

If the changed UI can be served locally without a special setup, also open the affected pages in the Browser plugin and confirm publish/edit controls render without overlap.

- [ ] **Step 4: Commit and post diary**

```bash
git add src/ui tests/ui
git commit -m "feat: update service ui for v1.1 publishing"
```

After the commit, use the `metabot-post-buzz` skill to post a detailed development diary for this round.

### Task 5: Add Skill Service Order Pin Creation and Order Message Metadata

**Files:**
- Modify: `src/core/orders/serviceOrderProtocols.ts`
- Modify: `src/core/orders/orderMessage.ts`
- Modify: `src/core/orders/delegationOrderMessage.ts`
- Modify: `src/core/payments/servicePayment.ts`
- Modify: `src/core/payments/servicePaymentVerification.ts`
- Modify: `tests/orders/*.test.mjs`
- Modify: `tests/payments/*.test.mjs`

- [ ] **Step 1: Write failing order tests**

Cover:
- Free calls create a `skill-service-order` payload with empty `paymentTxid`; no mock txid is generated.
- Native prepaid calls create a `skill-service-order` payload after payment and include the real payment txid.
- Built order messages include `order pin id: <serviceOrderPinId>`.
- Allowed skills are present in the request metadata.
- `postpaid` and unsupported `fiat` execution attempts fail explicitly.

- [ ] **Step 2: Implement order helpers**

Add helpers to build and parse:
- `skill-service-order` payloads.
- `order pin id:` protocol lines.
- allowed skill metadata lines.

Keep payment txids and service order pin ids separate in all return types.

- [ ] **Step 3: Verify order/payment tests**

Run:

```bash
npm run build && node --test tests/orders/*.test.mjs tests/payments/*.test.mjs
```

- [ ] **Step 4: Commit and post diary**

```bash
git add src/core/orders src/core/payments tests/orders tests/payments
git commit -m "feat: create skill service order pins"
```

After the commit, use the `metabot-post-buzz` skill to post a detailed development diary for this round.

### Task 6: Wire Buyer Call Flow to Service Order Pins

**Files:**
- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `src/core/chat/sessionTrace.ts`
- Modify: `src/cli/commands/services.ts`
- Modify: `tests/daemon/*.test.mjs`
- Modify: `tests/cli/services.test.mjs`

- [ ] **Step 1: Write failing call-flow tests**

Cover:
- `services.call` publishes a service order pin for free services.
- `services.call` publishes a service order pin for prepaid services after native payment.
- CLI output labels the order id as the service order pin id.
- Session traces store `serviceOrderPinId`, `paymentTxid`, and `providerSkills`.

- [ ] **Step 2: Implement buyer flow**

Update call execution order:
1. Resolve service payment terms.
2. Execute native payment only when prepaid native payment is required.
3. Publish `/protocols/skill-service-order`.
4. Use the order pin id for direct provider calls and private chat order requests.
5. Store trace/session state with service order id as primary order id.

- [ ] **Step 3: Verify call-flow tests**

Run:

```bash
npm run build && node --test tests/daemon/*.test.mjs tests/cli/services.test.mjs
```

- [ ] **Step 4: Commit and post diary**

```bash
git add src/daemon/defaultHandlers.ts src/core/chat/sessionTrace.ts src/cli/commands/services.ts tests/daemon tests/cli/services.test.mjs
git commit -m "feat: use service order pins for skill calls"
```

After the commit, use the `metabot-post-buzz` skill to post a detailed development diary for this round.

### Task 7: Update Provider Inbound Orders and Multi-Skill Execution

**Files:**
- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `src/core/a2a/provider/providerServiceRunner.ts`
- Modify: `src/core/a2a/provider/serviceRunnerContracts.ts`
- Modify: `src/core/a2a/provider/serviceRunnerRegistry.ts`
- Modify: `tests/a2a/*.test.mjs`
- Modify: `tests/daemon/*.test.mjs`

- [ ] **Step 1: Write failing provider tests**

Cover:
- Provider inbound order parsing reads `order pin id:` and stores it as `serviceOrderPinId`.
- Service skill allow-list mismatch is rejected.
- Provider runner injects all selected allowed skills.
- The provider prompt contains `executionReminder` before service execution instructions.
- The prompt no longer says the bot must use exactly one injected skill.

- [ ] **Step 2: Implement provider flow**

Normalize inbound service records to `providerSkills`. Validate every requested skill against the published allow-list and local runtime availability. Inject all allowed skills into the provider execution environment, but describe them as an allow-list and do not force all skills to be called.

- [ ] **Step 3: Verify provider tests**

Run:

```bash
npm run build && node --test tests/a2a/*.test.mjs tests/daemon/*.test.mjs
```

- [ ] **Step 4: Commit and post diary**

```bash
git add src/core/a2a/provider src/daemon/defaultHandlers.ts tests/a2a tests/daemon
git commit -m "feat: execute skill services with multiple allowed skills"
```

After the commit, use the `metabot-post-buzz` skill to post a detailed development diary for this round.

### Task 8: Update Seller Orders, Provider Console, and Trace State

**Files:**
- Modify: `src/core/orders/sellerOrderState.ts`
- Modify: `src/core/provider/providerConsole.ts`
- Modify: `src/core/chat/sessionTrace.ts`
- Modify: `src/core/services/myServices.ts`
- Modify: `tests/orders/*.test.mjs`
- Modify: `tests/provider/*.test.mjs`
- Modify: `tests/services/*.test.mjs`

- [ ] **Step 1: Write failing state/projection tests**

Cover:
- Seller order records use `serviceOrderPinId` as the stable order id.
- Payment txid remains visible as payment evidence for prepaid native orders.
- My-services order detail displays service order id.
- Legacy orders without service order id still render through payment txid fallback.

- [ ] **Step 2: Implement state migrations in readers**

Prefer reader-side compatibility over bulk migration. Existing JSON records should parse with optional `serviceOrderPinId`; new writes must include it.

- [ ] **Step 3: Verify state/projection tests**

Run:

```bash
npm run build && node --test tests/orders/*.test.mjs tests/provider/*.test.mjs tests/services/*.test.mjs
```

- [ ] **Step 4: Commit and post diary**

```bash
git add src/core/orders src/core/provider src/core/chat src/core/services tests/orders tests/provider tests/services
git commit -m "feat: surface service order ids in service state"
```

After the commit, use the `metabot-post-buzz` skill to post a detailed development diary for this round.

### Task 9: Upgrade Skill Service Ratings

**Files:**
- Modify: `src/core/ratings/ratingDetailState.ts`
- Modify: `src/core/ratings/ratingDetailSync.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `src/core/provider/providerConsole.ts`
- Modify: `tests/ratings/*.test.mjs`
- Modify: `tests/daemon/*.test.mjs`

- [ ] **Step 1: Write failing rating tests**

Cover:
- Published `skill-service-rate` payload includes `serviceOrderPinId`.
- Published payload includes `serviceSkills` array and legacy `serviceSkill` fallback.
- Rating lookup uses `serviceOrderPinId` first.
- Legacy ratings using `servicePaidTx` still match old orders.
- `NeedsRating` and `ORDER_END` messages carry order pin id metadata.

- [ ] **Step 2: Implement rating flow**

Thread `serviceOrderPinId` through rating request handlers, trace readers, provider console lookups, and rating detail sync. Keep `servicePaidTx` when available for backward compatibility only.

- [ ] **Step 3: Verify rating tests**

Run:

```bash
npm run build && node --test tests/ratings/*.test.mjs tests/daemon/*.test.mjs
```

- [ ] **Step 4: Commit and post diary**

```bash
git add src/core/ratings src/daemon/defaultHandlers.ts src/core/provider/providerConsole.ts tests/ratings tests/daemon
git commit -m "feat: rate services by service order id"
```

After the commit, use the `metabot-post-buzz` skill to post a detailed development diary for this round.

### Task 10: Final Cross-Surface Verification and Compatibility Sweep

**Files:**
- Modify any remaining files only if the verification sweep finds missed compatibility breaks.

- [ ] **Step 1: Search for stale single-skill assumptions**

Run:

```bash
rg -n "providerSkill|servicePaidTx|orderReference|paymentTiming|executionReminder|serviceOrderPinId" src tests SKILLs docs
```

Inspect every remaining hit that can affect skill-service publish, call, execute, order, or rating behavior.

- [ ] **Step 2: Run generated artifact build**

Run:

```bash
npm run build:skillpacks
```

- [ ] **Step 3: Run final verification**

Because this upgrade touches shared runtime behavior, wallet/chain write boundaries, persistence formats, UI payloads, and skillpack output, run the full suite:

```bash
npm run build
npm test
```

- [ ] **Step 4: Optional local UI/browser verification**

If a local daemon can be started safely for this profile, open the Browser plugin against the publish and my-services pages and verify:
- Publish page renders multi-skill selection, free/prepaid toggle, and execution reminder.
- Edit modal renders the same fields.
- Text does not overlap on desktop and narrow viewports.

- [ ] **Step 5: Commit and post diary if final sweep changes files**

Only if this task modifies files:

```bash
git add <changed-files>
git commit -m "chore: finish skill service v1.1 compatibility sweep"
```

After the commit, use the `metabot-post-buzz` skill to post a detailed development diary for this round.

---

## Commit Discipline

Each task above is an independent, verifiable unit. Commit immediately after its focused verification passes. After every commit, run the `metabot-post-buzz` skill and post a detailed development diary that includes:
- Commit hash and message.
- Protocol/business behavior changed.
- Files or surfaces touched.
- Verification commands and results.
- Any compatibility caveats.

Do not merge back to `main` until the implementation is complete and verified. If this branch is merged, use `git merge --no-ff` from `main`.
