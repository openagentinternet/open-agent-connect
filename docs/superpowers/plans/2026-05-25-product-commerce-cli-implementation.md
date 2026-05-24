# Product Commerce CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the CLI-first Product Commerce V1 flow so a local seller bot can publish virtual products, online buyers can discover and buy only online seller products, and seller fulfillment can deliver virtual goods through the existing simplemsg/A2A order flow.

**Architecture:** Add a product domain layer that mirrors the existing skill-service split: protocol validation and chain writes under `src/core/products`, online discovery under `network products`, lifecycle commands under `products`, and daemon routes as thin command-envelope adapters. Buyer and seller order execution should reuse existing wallet payment, simplemsg, A2A transcript, runtime skill execution, and cache-first lookup patterns instead of creating a second commerce stack.

**Tech Stack:** TypeScript, Node.js, existing MetaBot daemon command envelopes, MetaID chain write/read helpers, socket presence directory, existing service payment verification, existing simplemsg/A2A order protocol helpers, Node test runner.

---

## Source Documents

- `docs/metaid_protocols/06-product.md`
- `docs/superpowers/specs/2026-05-25-product-commerce-v1-business-flow.md`
- `docs/superpowers/specs/2026-05-07-skill-service-provider-runtime-design.md`
- `docs/superpowers/specs/2026-05-01-unified-a2a-caller-trace-design.md`
- `docs/superpowers/specs/2026-05-14-metabot-cli-first-ui-v1-design.md`

## V1 Acceptance Scenario

The implementation is accepted when this scenario works through CLI-first commands:

1. Bot Alice has a local fulfillment skill named `S1`.
2. Alice publishes a virtual mobile top-up product listing with two SKUs:
   - SKU1 costs `0.00001 SPACE`.
   - SKU2 costs `0.00005 SPACE`.
3. Alice's listing contains `fulfillment.fulfillmentSkills: ["S1"]`.
4. `metabot network products --online --query "mobile top-up"` shows Alice's product only when Alice is online.
5. Bot Bob buys SKU2 while Alice is online.
6. Bob pays `0.00005 SPACE`, publishes `/protocols/product-order`, sends the product-order reference to Alice over simplemsg, and gets a trace URL.
7. Alice verifies the product-order, listing ownership, SKU, and payment using cache-first local reads and chain fallback.
8. Alice starts a fulfillment conversation where all listing `fulfillmentSkills` are available. The product-order context is provided to that fulfillment round as runtime/conversation context, not passed directly into one skill function.
9. Skill `S1` returns a virtual deliverable such as a card number.
10. Alice sends `[DELIVERY:<orderTxid>]` to Bob with the deliverable.
11. Bob can inspect the order/trace and see the delivered card number.
12. Optional virtual-goods `NeedsRating` can close the A2A session, but V1 does not require `product-review`.

## Non-Goals

- Do not implement `product-review`.
- Do not implement refund automation.
- Do not implement physical shipping or logistics execution.
- Do not add seller identity, seller payment address, payment chain, timestamps, shipping policy, or review policy fields to the protocol payloads.
- Do not create a separate encrypted transport. Use existing `/protocols/simplemsg`.
- Do not ask virtual-goods buyers for phone, email, shipping address, or sensitive per-order fields in the normal V1 flow.
- Do not treat the first `fulfillmentSkills` item as a special primary skill. Every listed skill must be made available to the fulfillment round.

## CLI Surface To Build

```bash
metabot network products [--online] [--cached] [--query <text>] [--search <text>] [--limit <n>]

metabot products skills [--from <bot-slug>]

metabot products publish [--from <bot-slug>] --payload-file <file> [--chain <mvc|btc|doge|opcat>]

metabot products owned list [--from <bot-slug> | --all] [--page <n>] [--page-size <n>] [--refresh]

metabot products buy [--from <bot-slug>] --request-file <file>

metabot products orders list [--from <bot-slug> | --all] [--role <buyer|seller|all>] [--state <state>] [--page <n>] [--page-size <n>]

metabot products orders inspect [--from <bot-slug>] (--order-id <id> | --product-order-pin-id <pinid> | --payment-txid <txid> | --order-txid <txid>)
```

## Command Contract

All commands must return the existing command envelope:

```json
{
  "ok": true,
  "state": "success",
  "data": {}
}
```

Failures must return stable machine-readable `code` values and must not print secrets.

`products buy` must mirror `services call` confirmation behavior:

- First call may return `state: "awaiting_confirmation"` with `confirmRequest`.
- Confirmed call uses the same request plus `confirmed: true`.
- Paid orders must not write `/protocols/product-order` until payment succeeds.
- Offline products must fail before payment.

## File Map

### New core product files

- Create `src/core/products/productTypes.ts`: typed product-listing, SKU, fulfillment, product-order, product directory, purchase plan, and order state contracts.
- Create `src/core/products/productValidation.ts`: schema-level validation for `product-listing`, `product-order`, SKU price, stock, image URI, and fulfillment skill arrays.
- Create `src/core/products/productPublishChain.ts`: chain write adapter for `/protocols/product-listing` and `/protocols/product-order`.
- Create `src/core/products/productDirectory.ts`: chain/cache directory reader, query matching, online seller decoration, and visible product projection.
- Create `src/core/products/productStateStore.ts`: profile-local JSON cache for owned listings, directory cache summaries, buyer orders, and seller orders.
- Create `src/core/products/productPurchasePlanner.ts`: online product/SKU selection, spend cap checks, confirmation envelope construction, and offline rejection.
- Create `src/core/products/productOrderMessages.ts`: simplemsg product order, product delivery, and product status message helpers that stay compatible with scoped A2A tags.
- Create `src/core/products/productFulfillment.ts`: seller-side order resolution, cache-first fetch, payment verification orchestration, and fulfillment round input construction.

### Existing core files to modify

- Modify `src/core/payments/servicePayment.ts` only if a small shared export is needed for product native payment. Keep existing skill-service behavior stable.
- Modify `src/core/payments/servicePaymentVerification.ts` only to expose a shared native verification helper if product fulfillment cannot reuse it cleanly as-is.
- Modify `src/core/a2a/simplemsgClassifier.ts` to classify product order messages if the existing classifier needs an explicit product branch.
- Modify `src/core/a2a/traceProjection.ts` to project product order metadata and delivery result fields.
- Modify `src/core/a2a/conversationPersistence.ts` so inbound product order, product delivery, and product closure messages persist into the same per-peer A2A store as service-order messages.

### CLI files

- Modify `src/cli/main.ts` to dispatch `products`.
- Create `src/cli/commands/products.ts` for `products skills`, `products publish`, `products owned`, `products buy`, and `products orders`.
- Modify `src/cli/commands/network.ts` to dispatch `network products`.
- Modify `src/cli/types.ts` to add `products` and `network.listProducts` dependencies.
- Modify `src/cli/runtime.ts` to map product commands to daemon routes.
- Modify `src/cli/commandHelp.ts` for command help and examples.

### Daemon files

- Modify `src/daemon/routes/network.ts` to add `GET /api/network/products`.
- Create `src/daemon/routes/products.ts` for `/api/products/*` routes if route ownership is clearer than adding to service routes.
- Modify `src/daemon/httpServer.ts` to import and register `handleProductsRoutes`.
- Modify `src/daemon/routes/types.ts` to add product handlers.
- Modify `src/daemon/defaultHandlers.ts` to wire product handlers, using small product core helpers instead of embedding business logic in the daemon file.
- Modify `src/cli/runtime.ts` listener path only if inbound product-order simplemsg needs explicit provider handling.

### UI and skill files

- Do not build product UI in this plan.
- Do not build the companion skill in this plan.
- Leave clean CLI contracts so the next plan can implement UI and SKILL frontends.

### Tests

- Create `tests/products/productValidation.test.mjs`.
- Create `tests/products/productDirectory.test.mjs`.
- Create `tests/products/productPurchasePlanner.test.mjs`.
- Create `tests/products/productOrderMessages.test.mjs`.
- Create `tests/products/productFulfillment.test.mjs`.
- Create `tests/cli/products.test.mjs`.
- Modify `tests/cli/network.test.mjs`.
- Modify `tests/cli/help.test.mjs`.
- Create or modify `tests/daemon/productRoutes.test.mjs`.
- Modify `tests/a2a/simplemsgClassifier.test.mjs` only if classifier behavior changes.
- Modify `tests/a2a/traceProjectionUnifiedStore.test.mjs` so product delivery appears in buyer trace/order inspection.
- Create or modify `tests/a2a/productOrderFlow.test.mjs` for listener/persistence/projection integration around product order and delivery messages.

---

### Task 1: Product Contracts And Validation

**Files:**
- Create: `src/core/products/productTypes.ts`
- Create: `src/core/products/productValidation.ts`
- Create: `tests/products/productValidation.test.mjs`

- [ ] **Step 1: Write failing tests for valid V1 listing**

Cover a virtual listing with two SKUs, `metafile://` images, markdown descriptions, `fulfillment.deliveryEndpoint: "simplemsg"`, and `fulfillment.fulfillmentSkills: ["S1"]`.

Expected valid result:

```js
assert.equal(result.ok, true);
assert.equal(result.value.skus.length, 2);
assert.deepEqual(result.value.fulfillment.fulfillmentSkills, ['S1']);
```

- [ ] **Step 2: Write failing tests for invalid product-listing payloads**

Cover stable validation codes:

- `invalid_product_type`
- `invalid_cover_image_uri`
- `invalid_gallery_image_uri`
- `invalid_description_content_type`
- `missing_fulfillment_skill`
- `duplicate_sku_id`
- `invalid_sku_price`
- `invalid_initial_stock`
- `unsupported_fulfillment_endpoint`

Also assert that `fulfillmentSkills: ["S1", "S2"]` is accepted as a full array and not reduced.

- [ ] **Step 3: Write failing tests for valid and invalid product-order payloads**

Cover required fields:

- `listingPinId`
- `skuId`
- `paymentTxid`

Cover optional fields:

- `settlementKind` defaults to `native`
- `comment` is optional plain text

- [ ] **Step 4: Run validation tests to verify RED**

Run:

```bash
npm run build && node --test tests/products/productValidation.test.mjs
```

Expected: FAIL because product modules do not exist.

- [ ] **Step 5: Implement `productTypes.ts`**

Include:

```ts
export type ProductType = 'virtual' | 'physical';
export type ProductFulfillmentType = 'digital_delivery' | 'physical_shipping';
export type ProductDeliveryEndpoint = 'simplemsg' | 'logistics';

export interface ProductListingPayload {
  name: string;
  title: string;
  productType: ProductType;
  coverImage: string;
  galleryImages?: string[];
  descriptionContentType: string;
  description: string;
  fulfillment: ProductFulfillment;
  skus: ProductSku[];
}
```

Add product-order, directory item, purchase request, confirmation, buyer order, and seller order types.

- [ ] **Step 6: Implement validation helpers**

Expose:

```ts
validateProductListingPayload(input: unknown): ProductValidationResult<ProductListingPayload>
validateProductOrderPayload(input: unknown): ProductValidationResult<ProductOrderPayload>
normalizeProductCurrency(value: unknown): string
```

Use decimal strings for prices. Accept `SPACE` first. Do not add MRC20 fields.

- [ ] **Step 7: Run tests to verify GREEN**

Run:

```bash
npm run build && node --test tests/products/productValidation.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit and buzz**

Commit:

```bash
git add src/core/products/productTypes.ts src/core/products/productValidation.ts tests/products/productValidation.test.mjs
git commit -m "feat: add product protocol validation"
```

Post a development diary with `metabot-post-buzz`.

---

### Task 2: Product Publish Chain And Local Owned Listing State

**Files:**
- Create: `src/core/products/productPublishChain.ts`
- Create: `src/core/products/productStateStore.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Create: `tests/products/productPublishChain.test.mjs`
- Create: `tests/products/productStateStore.test.mjs`

- [ ] **Step 1: Write failing tests for listing chain payload construction**

Assert:

- path is `/protocols/product-listing`
- content type is `application/json`
- payload contains no seller fields
- payload contains no `paymentChain`, `sellerPaymentAddress`, `createdAt`, `updatedAt`, `descriptionUri`, or review policy
- `fulfillmentSkills` array is preserved exactly

- [ ] **Step 2: Write failing tests for product-order chain payload construction**

Assert:

- path is `/protocols/product-order`
- payload contains only `listingPinId`, `skuId`, optional `settlementKind`, `paymentTxid`, and optional `comment`
- payload does not include price, currency, seller, buyer, fulfillment state, review state, or snapshot fields

- [ ] **Step 3: Write failing tests for local product state store**

Use a temp profile root and assert JSON store behavior for:

- owned listings
- product directory cache
- buyer orders
- seller orders
- cache-first lookup by `listingPinId`, `productOrderPinId`, `paymentTxid`, and `orderTxid`

- [ ] **Step 4: Run tests to verify RED**

Run:

```bash
npm run build && node --test tests/products/productPublishChain.test.mjs tests/products/productStateStore.test.mjs
```

Expected: FAIL because modules do not exist.

- [ ] **Step 5: Implement chain write adapter**

Follow `src/core/services/servicePublishChain.ts` style. Expose:

```ts
publishProductListingToChain(input: ProductListingChainWriteInput): Promise<ProductChainWriteResult>
publishProductOrderToChain(input: ProductOrderChainWriteInput): Promise<ProductChainWriteResult>
```

Do not add product-specific wallet logic here.

- [ ] **Step 6: Implement product state store**

Store under the active profile runtime directory, following storage layout v2:

```text
~/.metabot/profiles/<slug>/.runtime/products/products-state.json
```

Use atomic read/write style consistent with nearby state stores. Keep schema versioned.

- [ ] **Step 7: Wire owned listing persistence after publish**

In daemon product publish handler, persist the published listing summary into product state after chain write succeeds.

- [ ] **Step 8: Run tests to verify GREEN**

Run:

```bash
npm run build && node --test tests/products/productPublishChain.test.mjs tests/products/productStateStore.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Commit and buzz**

Commit:

```bash
git add src/core/products/productPublishChain.ts src/core/products/productStateStore.ts src/daemon/defaultHandlers.ts tests/products/productPublishChain.test.mjs tests/products/productStateStore.test.mjs
git commit -m "feat: add product chain writes and state store"
```

Post a development diary with `metabot-post-buzz`.

---

### Task 3: Product Publish CLI And Skill Availability Validation

**Files:**
- Create: `src/cli/commands/products.ts`
- Modify: `src/cli/main.ts`
- Modify: `src/cli/types.ts`
- Modify: `src/cli/runtime.ts`
- Modify: `src/cli/commandHelp.ts`
- Create: `src/daemon/routes/products.ts`
- Modify: `src/daemon/routes/types.ts`
- Modify: `src/daemon/httpServer.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Create: `tests/cli/products.test.mjs`
- Modify: `tests/cli/help.test.mjs`
- Create: `tests/daemon/productRoutes.test.mjs`

- [ ] **Step 1: Write failing CLI tests for `products skills`**

Assert:

```bash
metabot products skills --from alice
```

dispatches:

```js
{ from: 'alice' }
```

to `dependencies.products.listPublishSkills`.

- [ ] **Step 2: Write failing CLI tests for `products publish`**

Assert:

```bash
metabot products publish --from alice --payload-file listing.json --chain mvc
```

reads the JSON file, preserves `fulfillmentSkills`, adds `{ from: "alice", network: "mvc" }`, and calls `dependencies.products.publish`.

Also assert:

- missing `--payload-file` fails with `missing_flag`
- unsupported `--chain eth` fails before handler call
- handler result includes `listingPinId`

- [ ] **Step 3: Write failing CLI tests for `products owned list`**

Cover:

```bash
metabot products owned list --from alice --page 2 --page-size 10 --refresh
metabot products owned list --all
```

Assert parsed input reaches `dependencies.products.listOwned` with pagination and actor fields matching the command.

- [ ] **Step 4: Write failing daemon route tests**

Cover:

- `GET /api/products/skills?from=alice`
- `POST /api/products/publish`
- `GET /api/products/owned?from=alice&page=2&pageSize=10&refresh=true`

Expected route behavior: thin adapter to product handlers, no chain write in route code.

- [ ] **Step 5: Run tests to verify RED**

Run:

```bash
npm run build && node --test tests/cli/products.test.mjs tests/cli/help.test.mjs tests/daemon/productRoutes.test.mjs
```

Expected: FAIL because command and routes do not exist.

- [ ] **Step 6: Implement CLI parser**

Follow `src/cli/commands/services.ts` style:

```ts
export async function runProductsCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>>
```

Implement only:

- `skills`
- `publish`
- `owned list`

Unknown subcommands return `commandUnknownSubcommand`.

- [ ] **Step 7: Implement help entries**

Add:

```bash
metabot products skills [--from <bot-slug>]
metabot products publish [--from <bot-slug>] --payload-file <path> [--chain <mvc|btc|doge|opcat>]
metabot products owned list [--from <bot-slug> | --all] [--page <n>] [--page-size <n>] [--refresh]
```

Make help mention that all `fulfillment.fulfillmentSkills` must exist in the seller bot primary runtime.

- [ ] **Step 8: Implement daemon product publish handler**

Behavior:

1. Resolve selected actor by `from` or active profile.
2. Validate product-listing payload.
3. Validate every `fulfillment.fulfillmentSkills[]` against the selected bot primary runtime skill catalog. Reuse the service publish skill catalog logic where possible.
4. Write `/protocols/product-listing`.
5. Persist owned listing state.
6. Return stable fields:

```json
{
  "listingPinId": "...",
  "txids": ["..."],
  "title": "...",
  "productType": "virtual",
  "skuCount": 2,
  "fulfillmentSkills": ["S1"],
  "network": "mvc"
}
```

- [ ] **Step 9: Implement owned listing handler**

Return paginated local owned listing rows from `productStateStore`, scoped to the selected local bot by default or all local bots with `--all`.

Required row fields:

- `listingPinId`
- `title`
- `name`
- `productType`
- `skuCount`
- `fulfillmentSkills`
- `available`
- `revokedAt`
- `localUpdatedAt`

`localUpdatedAt` is local cache metadata only. It must not be written into protocol payloads.

- [ ] **Step 10: Run tests to verify GREEN**

Run:

```bash
npm run build && node --test tests/cli/products.test.mjs tests/cli/help.test.mjs tests/daemon/productRoutes.test.mjs tests/products/productValidation.test.mjs
```

Expected: PASS.

- [ ] **Step 11: Commit and buzz**

Commit:

```bash
git add src/cli/commands/products.ts src/cli/main.ts src/cli/types.ts src/cli/runtime.ts src/cli/commandHelp.ts src/daemon/routes/products.ts src/daemon/routes/types.ts src/daemon/httpServer.ts src/daemon/defaultHandlers.ts tests/cli/products.test.mjs tests/cli/help.test.mjs tests/daemon/productRoutes.test.mjs
git commit -m "feat: add product publish CLI"
```

Post a development diary with `metabot-post-buzz`.

---

### Task 4: Online Product Directory And `network products`

**Files:**
- Create: `src/core/products/productDirectory.ts`
- Modify: `src/daemon/routes/network.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `src/cli/commands/network.ts`
- Modify: `src/cli/types.ts`
- Modify: `src/cli/runtime.ts`
- Modify: `src/cli/commandHelp.ts`
- Create: `tests/products/productDirectory.test.mjs`
- Modify: `tests/cli/network.test.mjs`
- Modify: `tests/cli/help.test.mjs`

- [ ] **Step 1: Write failing directory tests**

Create fixture listings and fixture online presence. Assert:

- offline seller listing is excluded when `onlineOnly: true`
- online seller listing is included
- query searches product name, title, description, SKU name, SKU description, seller display name, and price currency
- `sellerGlobalMetaId`, `sellerName`, and `online` are decorated output fields, not protocol fields
- `--cached` uses local product cache and does not force chain refresh

- [ ] **Step 2: Write failing CLI tests**

Assert:

```bash
metabot network products --online --cached --query "mobile top-up" --limit 5
```

dispatches:

```js
{ online: true, cached: true, query: 'mobile top-up', limit: 5 }
```

to `dependencies.network.listProducts`.

- [ ] **Step 3: Run tests to verify RED**

Run:

```bash
npm run build && node --test tests/products/productDirectory.test.mjs tests/cli/network.test.mjs tests/cli/help.test.mjs
```

Expected: FAIL because product directory and command are not implemented.

- [ ] **Step 4: Implement product directory search**

Follow the online-service directory pattern:

- read local product directory cache first when `cached` is true
- refresh chain-backed `/protocols/product-listing` when not cached
- derive seller identity from pin creator/owner metadata
- decorate online status from socket presence
- apply `onlineOnly`
- apply text query
- apply bounded `limit` with range `1..100`

- [ ] **Step 5: Add network route**

Add:

```http
GET /api/network/products?online=true&cached=true&query=...&limit=...
```

Return:

```json
{
  "products": [],
  "total": 0,
  "source": "cache|chain",
  "onlineOnly": true,
  "cacheUpdatedAt": 1770000000000
}
```

- [ ] **Step 6: Implement CLI output**

TTY output may render a table similar to `network services`. JSON output remains the command envelope.

Required product row fields:

- `listingPinId`
- `title`
- `name`
- `productType`
- `sellerGlobalMetaId`
- `sellerName`
- `online`
- `skus`
- `fulfillment.fulfillmentType`
- `fulfillment.deliveryEndpoint`

- [ ] **Step 7: Run tests to verify GREEN**

Run:

```bash
npm run build && node --test tests/products/productDirectory.test.mjs tests/cli/network.test.mjs tests/cli/help.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit and buzz**

Commit:

```bash
git add src/core/products/productDirectory.ts src/daemon/routes/network.ts src/daemon/defaultHandlers.ts src/cli/commands/network.ts src/cli/types.ts src/cli/runtime.ts src/cli/commandHelp.ts tests/products/productDirectory.test.mjs tests/cli/network.test.mjs tests/cli/help.test.mjs
git commit -m "feat: add online product discovery"
```

Post a development diary with `metabot-post-buzz`.

---

### Task 5: Product Purchase Planner And Confirmation

**Files:**
- Create: `src/core/products/productPurchasePlanner.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `src/daemon/routes/products.ts`
- Modify: `src/cli/commands/products.ts`
- Modify: `src/cli/types.ts`
- Modify: `src/cli/runtime.ts`
- Modify: `src/cli/commandHelp.ts`
- Create: `tests/products/productPurchasePlanner.test.mjs`
- Modify: `tests/cli/products.test.mjs`
- Modify: `tests/daemon/productRoutes.test.mjs`

- [ ] **Step 1: Write failing planner tests**

Cover:

- exact `listingPinId + skuId` selection
- query-only selection from online product cache
- no match returns `cached_product_match_not_found`
- offline product returns `product_offline`
- `productType: "physical"` returns `unsupported_product_type`
- non-`digital_delivery` fulfillment returns `unsupported_fulfillment_type`
- non-`simplemsg` delivery endpoint returns `unsupported_fulfillment_endpoint`
- spend cap lower than SKU price returns `product_spend_cap_exceeded`
- first paid call returns confirmation when `confirmed` is not true
- confirmed request returns a plan ready for payment

- [ ] **Step 2: Write failing CLI tests for `products buy`**

Assert:

```bash
metabot products buy --from bob --request-file request.json
```

reads JSON and calls `dependencies.products.buy` with `{ from: "bob", ...request }`.

Request shape:

```json
{
  "query": "buy Alice 0.00005 SPACE mobile top-up card",
  "listingPinId": "",
  "skuId": "space-00005",
  "comment": "",
  "spendCap": {
    "amount": "0.00005",
    "currency": "SPACE"
  },
  "policyMode": "confirm_paid_only",
  "confirmed": false
}
```

- [ ] **Step 3: Write failing daemon route tests for purchase planning**

Cover:

- `POST /api/products/buy` returns `awaiting_confirmation` for a paid unconfirmed request.
- `POST /api/products/buy` with an offline product returns `product_offline` before wallet payment.
- `POST /api/products/buy` with physical/logistics product returns the V1 unsupported code before wallet payment.
- Route forwards stable command envelopes and does not embed payment logic in route code.

- [ ] **Step 4: Run tests to verify RED**

Run:

```bash
npm run build && node --test tests/products/productPurchasePlanner.test.mjs tests/cli/products.test.mjs tests/daemon/productRoutes.test.mjs
```

Expected: FAIL because planner and buy command do not exist.

- [ ] **Step 5: Implement planner**

Expose:

```ts
planProductPurchase(input: ProductPurchasePlannerInput): ProductPurchasePlannerResult
```

The planner must not perform payment or chain writes. It only selects product/SKU, checks online status, computes payment fields, and returns confirmation metadata.

The planner must reject V1-unsupported purchases unless all are true:

- `productType === "virtual"`
- `fulfillment.fulfillmentType === "digital_delivery"`
- `fulfillment.deliveryEndpoint === "simplemsg"`

- [ ] **Step 6: Implement `products buy` command parser**

Follow `services call` shape. The CLI command should only read the request file and dispatch to daemon/runtime dependency. It should not implement wallet payment locally.

- [ ] **Step 7: Implement confirmation response**

Use existing command result semantics. Return `awaiting_confirmation` with:

```json
{
  "product": {
    "listingPinId": "...",
    "title": "SPACE Mobile Top-up Card"
  },
  "sku": {
    "skuId": "space-00005",
    "name": "0.00005 SPACE card"
  },
  "seller": {
    "globalMetaId": "...",
    "name": "Alice"
  },
  "payment": {
    "amount": "0.00005",
    "currency": "SPACE"
  },
  "confirmation": {
    "requiresConfirmation": true,
    "policyMode": "confirm_paid_only"
  },
  "confirmRequest": {
    "request": {
      "query": "buy Alice 0.00005 SPACE mobile top-up card",
      "listingPinId": "...",
      "skuId": "space-00005",
      "comment": "",
      "spendCap": {
        "amount": "0.00005",
        "currency": "SPACE"
      },
      "policyMode": "confirm_paid_only",
      "confirmed": true
    }
  }
}
```

The `confirmRequest.request` must be the normalized original purchase request plus `confirmed: true`; it must preserve non-secret fields such as `query`, `comment`, `spendCap`, `policyMode`, `listingPinId`, and `skuId` so the confirmed call cannot drift from the preview.

- [ ] **Step 8: Implement daemon route**

Add `POST /api/products/buy` in `src/daemon/routes/products.ts`. It must call the product buy handler for both preview and confirmed execution. It must not perform payment or chain writes in the route layer.

- [ ] **Step 9: Run tests to verify GREEN**

Run:

```bash
npm run build && node --test tests/products/productPurchasePlanner.test.mjs tests/cli/products.test.mjs tests/daemon/productRoutes.test.mjs
```

Expected: PASS.

- [ ] **Step 10: Commit and buzz**

Commit:

```bash
git add src/core/products/productPurchasePlanner.ts src/daemon/defaultHandlers.ts src/daemon/routes/products.ts src/cli/commands/products.ts src/cli/types.ts src/cli/runtime.ts src/cli/commandHelp.ts tests/products/productPurchasePlanner.test.mjs tests/cli/products.test.mjs tests/daemon/productRoutes.test.mjs
git commit -m "feat: add product purchase planning"
```

Post a development diary with `metabot-post-buzz`.

---

### Task 6: Buyer Payment, product-order Publish, And simplemsg Dispatch

**Files:**
- Create: `src/core/products/productOrderMessages.ts`
- Modify: `src/core/products/productPublishChain.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `src/daemon/routes/products.ts`
- Modify: `src/core/products/productStateStore.ts`
- Modify: `tests/products/productOrderMessages.test.mjs`
- Modify: `tests/products/productPublishChain.test.mjs`
- Modify: `tests/cli/products.test.mjs`
- Modify: `tests/daemon/productRoutes.test.mjs`

- [ ] **Step 1: Write failing message tests**

Assert product order notification includes:

- scoped `[ORDER]` compatible tag
- product-order pin id
- listing pin id
- SKU id
- payment txid
- enough raw content for A2A trace projection

Also assert delivery parser supports:

```json
{
  "productOrderPinId": "...",
  "listingPinId": "...",
  "skuId": "space-00005",
  "paymentTxid": "...",
  "result": "Top-up card: XXXX-XXXX",
  "deliveredAt": 1770000000000
}
```

- [ ] **Step 2: Write failing buy execution tests with fakes**

Use injected fake dependencies for:

- wallet payment executor
- product-order chain writer
- simplemsg sender
- product state store

Assert order:

1. payment executes before product-order publish
2. product-order publish executes before simplemsg
3. no product-order is published when payment fails
4. no payment executes when planner returns offline product
5. wallet payment input contains the seller-derived address from listing pin owner identity, not a protocol payload field
6. wallet payment input pays exactly SKU2's `amount: "0.00005"` and `currency: "SPACE"`
7. wallet payment input uses the supported native chain/network for the SKU currency
8. returned data includes `traceId`, `productOrderPinId`, `paymentTxid`, `orderTxid`, and `localUiUrl`

- [ ] **Step 3: Write failing route tests for confirmed buy execution**

Cover `POST /api/products/buy` with `confirmed: true`:

- payment-before-product-order-write ordering
- product-order-before-simplemsg ordering
- stable failure envelope when payment fails
- stable failure envelope when product-order write fails
- stable failure envelope when simplemsg dispatch fails after payment and order write

- [ ] **Step 4: Run tests to verify RED**

Run:

```bash
npm run build && node --test tests/products/productOrderMessages.test.mjs tests/cli/products.test.mjs tests/daemon/productRoutes.test.mjs
```

Expected: FAIL because execution path is not implemented.

- [ ] **Step 5: Implement payment recipient derivation**

Derive the seller payment address from the seller bot identity associated with the listing pin owner or creator. Do not copy a payment address from `product-listing`, because the protocol intentionally does not contain one.

For V1 SPACE purchases, the buyer payment call must use:

```json
{
  "toAddress": "<seller mvc address derived from seller identity>",
  "amount": "0.00005",
  "currency": "SPACE",
  "settlementKind": "native"
}
```

- [ ] **Step 6: Implement product-order publishing**

After payment succeeds, write `/protocols/product-order` using the minimal protocol payload:

```json
{
  "listingPinId": "<listing-pinid>",
  "skuId": "<sku-id>",
  "settlementKind": "native",
  "paymentTxid": "<payment-txid>",
  "comment": "<optional>"
}
```

- [ ] **Step 7: Implement simplemsg order notification**

Send order notification to seller over existing private-chat/simplemsg writer. The message should carry the product-order pin id and produce an order simplemsg txid. Use that simplemsg txid as `orderTxid` for follow-up tags.

- [ ] **Step 8: Persist buyer order state**

Persist:

- `productOrderPinId`
- `listingPinId`
- `skuId`
- `paymentTxid`
- `orderTxid`
- seller identity
- buyer identity
- state
- trace/session ids

- [ ] **Step 9: Reuse service payment support carefully**

For V1, support the same native payment currencies actually supported by the current service-call payment path. If publish metadata allows more currencies than payment execution, `products buy` must fail before payment with a stable unsupported settlement code.

- [ ] **Step 10: Run tests to verify GREEN**

Run:

```bash
npm run build && node --test tests/products/productOrderMessages.test.mjs tests/products/productPublishChain.test.mjs tests/cli/products.test.mjs tests/daemon/productRoutes.test.mjs
```

Expected: PASS.

- [ ] **Step 11: Commit and buzz**

Commit:

```bash
git add src/core/products/productOrderMessages.ts src/core/products/productPublishChain.ts src/core/products/productStateStore.ts src/daemon/defaultHandlers.ts src/daemon/routes/products.ts tests/products/productOrderMessages.test.mjs tests/products/productPublishChain.test.mjs tests/cli/products.test.mjs tests/daemon/productRoutes.test.mjs
git commit -m "feat: send product orders from buyer CLI"
```

Post a development diary with `metabot-post-buzz`.

---

### Task 7: Seller Product Fulfillment

**Files:**
- Create: `src/core/products/productFulfillment.ts`
- Modify: `src/core/products/productStateStore.ts`
- Modify: `src/core/a2a/simplemsgClassifier.ts` if needed
- Modify: `src/cli/runtime.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Create: `tests/products/productFulfillment.test.mjs`
- Modify: `tests/a2a/simplemsgClassifier.test.mjs` if needed
- Modify: `tests/a2a/providerServiceRunner.test.mjs` if product fulfillment uses the provider runner registry

- [ ] **Step 1: Write failing seller fulfillment tests**

Use fake stores and fake chain fetchers. Cover:

- product-order cache hit avoids chain fetch
- cache miss fetches chain pin and then persists locally
- listing cache hit avoids chain fetch
- listing cache miss fetches chain pin and then persists locally
- referenced listing must belong to local seller bot
- SKU must exist
- payment txid must verify against seller address and SKU price
- every `fulfillmentSkills` entry is passed into the fulfillment round
- product-order context is included in conversation/runtime context

- [ ] **Step 2: Write failing failure tests**

Cover stable codes:

- `product_order_not_found`
- `invalid_product_order_protocol`
- `product_listing_not_found`
- `product_listing_not_owned`
- `product_sku_not_found`
- `product_payment_invalid`
- `product_fulfillment_failed`

- [ ] **Step 3: Run tests to verify RED**

Run:

```bash
npm run build && node --test tests/products/productFulfillment.test.mjs
```

Expected: FAIL because fulfillment module does not exist.

- [ ] **Step 4: Implement cache-first resolution**

Expose:

```ts
resolveProductOrderForSeller(input: ResolveSellerProductOrderInput): Promise<ResolvedSellerProductOrder>
```

Do not fetch chain before checking local cache.

- [ ] **Step 5: Implement payment verification adapter**

Reuse existing native payment verification behavior from skill-service. Do not introduce duplicate chain parsing or a product-specific verifier unless a thin adapter is necessary.

- [ ] **Step 6: Implement fulfillment round construction**

Create a fulfillment input object that includes:

- product-order payload and pin metadata
- product-listing payload and pin metadata
- selected SKU
- buyer identity and order A2A metadata
- payment verification evidence
- complete `fulfillment.fulfillmentSkills` array

This object is runtime/conversation context for the fulfillment round. It is not a direct function argument to one skill.

- [ ] **Step 7: Implement delivery send**

On successful fulfillment, send `[DELIVERY:<orderTxid>]` with:

```json
{
  "productOrderPinId": "<pinid>",
  "listingPinId": "<pinid>",
  "skuId": "<sku-id>",
  "paymentTxid": "<txid>",
  "result": "<seller fulfillment result>",
  "deliveredAt": 1770000000000
}
```

For virtual goods only, optionally send `[NeedsRating:<orderTxid>]` using the existing A2A convention. Keep this private-session closure independent from `product-review`.

- [ ] **Step 8: Persist seller order state**

Persist:

- buyer identity
- product-order pin id
- listing pin id
- SKU id
- payment txid
- order txid
- fulfillment skills
- fulfillment state
- delivery pin id
- failure reason when applicable

- [ ] **Step 9: Run tests to verify GREEN**

Run:

```bash
npm run build && node --test tests/products/productFulfillment.test.mjs tests/a2a/simplemsgClassifier.test.mjs tests/a2a/providerServiceRunner.test.mjs
```

Expected: PASS. If no classifier/provider tests were changed, run only the product fulfillment test.

- [ ] **Step 10: Commit and buzz**

Commit:

```bash
git add src/core/products/productFulfillment.ts src/core/products/productStateStore.ts src/core/a2a/simplemsgClassifier.ts src/cli/runtime.ts src/daemon/defaultHandlers.ts tests/products/productFulfillment.test.mjs tests/a2a/simplemsgClassifier.test.mjs tests/a2a/providerServiceRunner.test.mjs
git commit -m "feat: fulfill product orders on seller"
```

Post a development diary with `metabot-post-buzz`.

---

### Task 8: Product A2A Listener And Trace Projection

**Files:**
- Modify: `src/core/a2a/simplemsgClassifier.ts`
- Modify: `src/core/a2a/conversationPersistence.ts`
- Modify: `src/core/a2a/traceProjection.ts`
- Modify: `src/core/products/productOrderMessages.ts`
- Modify: `src/core/products/productStateStore.ts`
- Modify: `src/cli/runtime.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Create or modify: `tests/a2a/productOrderFlow.test.mjs`
- Modify: `tests/a2a/simplemsgClassifier.test.mjs`
- Modify: `tests/a2a/traceProjectionUnifiedStore.test.mjs`
- Modify: `tests/products/productOrderMessages.test.mjs`

- [ ] **Step 1: Write failing classifier tests**

Simulate inbound simplemsg plaintext for:

- product order notification from Bob to Alice
- product delivery from Alice to Bob
- optional product `NeedsRating`
- product `ORDER_END`

Assert classifier output includes an order kind or metadata that lets runtime dispatch distinguish product commerce from ordinary private chat and skill-service order messages.

- [ ] **Step 2: Write failing listener dispatch tests**

Simulate Bob's order simplemsg reaching Alice. Assert:

- runtime listener classifies it as product order
- seller-side product fulfillment handler is called once
- local seller order session/cache is created or updated
- generic private-chat auto-reply does not consume the product order first

- [ ] **Step 3: Write failing buyer delivery projection tests**

Simulate Alice's `[DELIVERY:<orderTxid>]` simplemsg reaching Bob with:

```json
{
  "productOrderPinId": "<pinid>",
  "listingPinId": "<pinid>",
  "skuId": "space-00005",
  "paymentTxid": "<txid>",
  "result": "Top-up card: XXXX-XXXX",
  "deliveredAt": 1770000000000
}
```

Assert:

- buyer order cache state becomes delivered/completed
- A2A transcript stores the delivery in the same peer conversation file
- trace projection exposes the delivered card number through the trace/order view model
- delivery content is rendered through existing trace-safe markdown/media handling

- [ ] **Step 4: Write failing end-to-end in-memory A2A test**

Using fake message writers/readers and stores, simulate:

1. Bob sends product order simplemsg.
2. Alice receives it and product fulfillment returns `Top-up card: XXXX-XXXX`.
3. Alice sends product delivery simplemsg.
4. Bob receives delivery.
5. Bob's order inspection data includes the delivered card number.

- [ ] **Step 5: Run tests to verify RED**

Run:

```bash
npm run build && node --test tests/a2a/productOrderFlow.test.mjs tests/a2a/simplemsgClassifier.test.mjs tests/a2a/traceProjectionUnifiedStore.test.mjs tests/products/productOrderMessages.test.mjs
```

Expected: FAIL because product A2A integration is not implemented.

- [ ] **Step 6: Implement product message classification**

Prefer extending existing simplemsg/A2A helpers over a separate product-only listener. Product messages must coexist with service-order messages in the same per-peer A2A store.

- [ ] **Step 7: Implement inbound product-order dispatch**

In the runtime listener path, route product order notifications to seller fulfillment before generic private chat handling. Keep the dispatch small; detailed verification and fulfillment stay in `productFulfillment.ts`.

- [ ] **Step 8: Implement buyer delivery persistence and projection**

When buyer receives product `[DELIVERY:<orderTxid>]`, update buyer order cache and append the transcript item so `trace get`, `products orders inspect`, and later UI can display the virtual deliverable.

- [ ] **Step 9: Implement optional virtual-goods closure projection**

If `[NeedsRating:<orderTxid>]` and `[ORDER_END:<orderTxid> rated]` are used for virtual goods, project them as private A2A session closure events. Do not require `product-review`.

- [ ] **Step 10: Run tests to verify GREEN**

Run:

```bash
npm run build && node --test tests/a2a/productOrderFlow.test.mjs tests/a2a/simplemsgClassifier.test.mjs tests/a2a/traceProjectionUnifiedStore.test.mjs tests/products/productOrderMessages.test.mjs
```

Expected: PASS.

- [ ] **Step 11: Commit and buzz**

Commit:

```bash
git add src/core/a2a/simplemsgClassifier.ts src/core/a2a/conversationPersistence.ts src/core/a2a/traceProjection.ts src/core/products/productOrderMessages.ts src/core/products/productStateStore.ts src/cli/runtime.ts src/daemon/defaultHandlers.ts tests/a2a/productOrderFlow.test.mjs tests/a2a/simplemsgClassifier.test.mjs tests/a2a/traceProjectionUnifiedStore.test.mjs tests/products/productOrderMessages.test.mjs
git commit -m "feat: project product orders in a2a"
```

Post a development diary with `metabot-post-buzz`.

---

### Task 9: Product Order Inspection CLI

**Files:**
- Modify: `src/cli/commands/products.ts`
- Modify: `src/cli/types.ts`
- Modify: `src/cli/runtime.ts`
- Modify: `src/cli/commandHelp.ts`
- Modify: `src/daemon/routes/products.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `src/core/products/productStateStore.ts`
- Modify: `tests/cli/products.test.mjs`
- Modify: `tests/daemon/productRoutes.test.mjs`

- [ ] **Step 1: Write failing CLI tests for order list**

Cover:

```bash
metabot products orders list --from bob --role buyer --state delivered --page 2 --page-size 10
metabot products orders list --all --role all
```

Assert parsed input reaches `dependencies.products.listOrders`.

- [ ] **Step 2: Write failing CLI tests for order inspect**

Cover selectors:

- `--order-id`
- `--product-order-pin-id`
- `--payment-txid`
- `--order-txid`

Assert exactly one selector is required.

- [ ] **Step 3: Write failing route tests**

Cover:

- `GET /api/products/orders`
- `GET /api/products/orders/inspect`

or equivalent route style consistent with existing daemon routes.

- [ ] **Step 4: Run tests to verify RED**

Run:

```bash
npm run build && node --test tests/cli/products.test.mjs tests/daemon/productRoutes.test.mjs
```

Expected: FAIL because order inspection is not implemented.

- [ ] **Step 5: Implement order list**

Return paginated local cache rows. Fields:

- `orderId`
- `role`
- `state`
- `productOrderPinId`
- `listingPinId`
- `skuId`
- `title`
- `seller`
- `buyer`
- `paymentTxid`
- `orderTxid`
- `delivery`
- `traceId`
- `updatedAt`

- [ ] **Step 6: Implement order inspect**

Use cache-first lookup by selector. Chain fallback is allowed for `productOrderPinId` when local cache misses, then persist. Return:

- product listing summary
- SKU
- buyer/seller identity
- payment verification summary
- fulfillment skills
- delivery payload
- trace/session URL fields
- public raw protocol payloads for debugging: only `product-listing` and `product-order` JSON

Do not dump decrypted private simplemsg delivery bodies as raw debug blobs from order inspection. Private delivery content should be returned through existing trace-safe rendering fields and summarized order fields.

- [ ] **Step 7: Run tests to verify GREEN**

Run:

```bash
npm run build && node --test tests/cli/products.test.mjs tests/daemon/productRoutes.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit and buzz**

Commit:

```bash
git add src/cli/commands/products.ts src/cli/types.ts src/cli/runtime.ts src/cli/commandHelp.ts src/daemon/routes/products.ts src/daemon/defaultHandlers.ts src/core/products/productStateStore.ts tests/cli/products.test.mjs tests/daemon/productRoutes.test.mjs
git commit -m "feat: add product order inspection CLI"
```

Post a development diary with `metabot-post-buzz`.

---

### Task 10: End-To-End V1 Smoke And Documentation

**Files:**
- Create: `docs/acceptance/product-commerce-v1-cli-smoke.md`
- Modify: `docs/superpowers/plans/2026-05-25-product-commerce-cli-implementation.md` only if implementation discoveries require plan correction
- Modify: generated help tests only if command examples change

- [ ] **Step 1: Write acceptance smoke document**

Document the Alice/Bob/S1 flow using placeholders for pin ids and txids. Include:

```bash
metabot products skills --from alice
metabot products publish --from alice --payload-file alice-product.json --chain mvc
metabot network products --online --query "mobile top-up"
metabot products buy --from bob --request-file bob-buy.json
metabot products buy --from bob --request-file bob-buy-confirmed.json
metabot products orders inspect --from bob --product-order-pin-id <pinid>
metabot products orders inspect --from alice --product-order-pin-id <pinid>
```

- [ ] **Step 2: Add a simple S1 test skill fixture or documented local skill setup**

If a real local skill fixture can be included safely, use it for automated smoke. Otherwise document the exact expected local skill shape and use unit/integration fakes for automated verification.

- [ ] **Step 3: Run focused verification**

Run:

```bash
npm run build
node --test tests/products/*.test.mjs tests/cli/products.test.mjs tests/cli/network.test.mjs tests/daemon/productRoutes.test.mjs
node --test tests/a2a/productOrderFlow.test.mjs tests/a2a/simplemsgClassifier.test.mjs tests/a2a/traceProjectionUnifiedStore.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Run broader relevant verification**

Run:

```bash
node --test tests/a2a/*.test.mjs tests/payments/servicePayment.test.mjs tests/services/servicePublishValidation.test.mjs
```

Expected: PASS. If any test is unrelated and flaky, document exact failure before proceeding.

- [ ] **Step 5: Manual or real-daemon smoke**

When local Alice/Bob profiles and wallet funds are available, run the acceptance document. Record only non-secret evidence:

- listing pin id
- product-order pin id
- payment txid
- order txid
- delivery pin id
- local trace URL

If skipped, document the exact blocker.

- [ ] **Step 6: Commit and buzz**

Commit:

```bash
git add docs/acceptance/product-commerce-v1-cli-smoke.md
git commit -m "docs: add product commerce CLI smoke"
```

Post a development diary with `metabot-post-buzz`.

---

## Final Verification Gate

Before declaring the product-commerce CLI implementation complete, run:

```bash
npm run build
node --test tests/products/*.test.mjs tests/cli/products.test.mjs tests/cli/network.test.mjs tests/cli/help.test.mjs tests/daemon/productRoutes.test.mjs
node --test tests/a2a/*.test.mjs tests/payments/servicePayment.test.mjs tests/services/servicePublishValidation.test.mjs
git status --short --branch
```

For this feature, do not require full `npm test` unless implementation touches broad release/build plumbing, persistence formats outside product/A2A runtime state, or shared payment behavior beyond a thin product adapter. If shared payment behavior changes, run full `npm test`.

## Plan-Level Acceptance Checklist

- [ ] All new product protocol payloads remain pin-native and do not duplicate seller identity, payment address, or timestamps.
- [ ] `fulfillmentSkills` arrays are preserved and all listed skills are available in the fulfillment round.
- [ ] `network products --online` only returns products whose seller bot is online.
- [ ] `products buy` rejects offline products before payment.
- [ ] `products buy` confirms paid purchases before payment unless `confirmed: true`.
- [ ] Payment succeeds before `/protocols/product-order` is published.
- [ ] `product-order` is minimal and does not duplicate listing price/currency.
- [ ] Seller resolution is cache-first with chain fallback and local persistence.
- [ ] Seller payment verification reuses existing native payment verification.
- [ ] Delivery uses simplemsg/A2A `[DELIVERY:<orderTxid>]`.
- [ ] Virtual goods may use optional private-session `NeedsRating`.
- [ ] V1 does not depend on `product-review`.
- [ ] CLI output is machine-readable under JSON envelopes and useful in TTY mode.
- [ ] UI and SKILL frontends can call these CLI commands without duplicating business logic.
