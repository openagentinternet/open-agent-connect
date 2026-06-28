# Product Commerce UI Design And Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CLI-first Product Commerce V1 browser UI so local MetaBot users can publish virtual products, discover online products, purchase SKUs with explicit confirmation, and inspect buyer/seller product orders from one local workspace.

**Architecture:** Add one built-in `/ui/products` page that is a thin HTML interface over the existing Product Commerce CLI/daemon contracts. The UI must reuse `/api/network/products`, `/api/products/*`, `/api/bot/profiles`, and the existing command-envelope semantics; it must not add product protocol fields, duplicate payment logic, or create a second fulfillment stack.

**Tech Stack:** TypeScript CommonJS, existing local daemon routes, existing `MetabotCommandResult` envelopes, built-in HTML/CSS/vanilla TypeScript UI pages, Node.js built-in test runner, isolated Playwright UI smoke tests.

---

## Source Documents

- Product protocol: `docs/metaid_protocols/06-product.md`
- Product business flow: `docs/superpowers/specs/2026-05-25-product-commerce-v1-business-flow.md`
- Product CLI plan: `docs/superpowers/plans/2026-05-25-product-commerce-cli-implementation.md`
- Product CLI smoke runbook: `docs/acceptance/product-commerce-v1-cli-smoke.md`
- Product skill design: `docs/superpowers/specs/2026-05-26-metabot-product-commerce-skill-design.md`
- Product skill implementation plan: `docs/superpowers/plans/2026-05-26-metabot-product-commerce-skill-implementation.md`
- CLI-first UI design baseline: `docs/superpowers/specs/2026-05-14-metabot-cli-first-ui-v1-design.md`
- Existing UI references:
  - `src/ui/shared.css`
  - `src/ui/pages/hub/*`
  - `src/ui/pages/publish/*`
  - `src/ui/pages/my-services/*`
  - `src/ui/pages/loom/*`
- Existing Product Commerce implementation:
  - `src/cli/commands/products.ts`
  - `src/cli/commands/network.ts`
  - `src/daemon/routes/products.ts`
  - `src/daemon/routes/network.ts`
  - `src/core/products/*`

## Current Baseline

The CLI-first Product Commerce flow already exists:

```bash
metabot network products [--online] [--cached] [--query <text>] [--search <text>] [--limit <n>]
metabot products skills [--from <bot-slug>]
metabot products publish [--from <bot-slug>] --payload-file <file> [--chain <mvc|btc|doge|opcat>]
metabot products owned list [--from <bot-slug> | --all] [--page <n>] [--page-size <n>] [--refresh]
metabot products buy [--from <bot-slug>] --request-file <file>
metabot products orders list [--from <bot-slug> | --all] [--role <buyer|seller|all>] [--state <state>] [--page <n>] [--page-size <n>]
metabot products orders inspect [--from <bot-slug>] (--order-id <id> | --product-order-pin-id <pinid> | --payment-txid <txid> | --order-txid <txid>)
```

The daemon already exposes matching HTTP adapters:

| Capability | Route |
| --- | --- |
| product fulfillment skill catalog | `GET /api/products/skills?from=<seller-slug>` |
| product listing publish | `POST /api/products/publish` |
| product purchase preview/confirm | `POST /api/products/buy` |
| seller-owned listing cache | `GET /api/products/owned?from=<slug>&all=<bool>&page=<n>&pageSize=<n>&refresh=<bool>` |
| product order list | `GET /api/products/orders?from=<slug>&all=<bool>&role=<buyer|seller|all>&state=<state>&page=<n>&pageSize=<n>` |
| product order inspection | `GET /api/products/orders/inspect?...selector...` |
| online product discovery | `GET /api/network/products?online=true&query=<text>&limit=<n>` |
| local profile choices | `GET /api/bot/profiles` |

The current built-in UI has no product page. Product users can only operate through CLI/SKILL.

## Product Scope

Product Commerce UI V1 covers virtual goods only:

- `productType: "virtual"`
- `fulfillment.fulfillmentType: "digital_delivery"`
- `fulfillment.deliveryEndpoint: "simplemsg"`
- `fulfillment.fulfillmentSkills[]` are all available to the seller fulfillment round.
- Product-order context enters the fulfillment conversation/runtime context; it is not passed as one direct skill function argument.

Out of scope for this UI:

- physical products;
- logistics flow;
- product-review;
- refunds;
- shipping policy;
- return policy;
- seller identity fields;
- seller payment address fields;
- timestamps in protocol payloads;
- MRC20;
- phone/email/shipping-address collection;
- raw decrypted delivery body dumps.

## Selected UI Approach

Build a new `/ui/products` workspace instead of overloading existing pages:

- `/ui/hub` remains the service hub.
- `/ui/publish` remains the skill-service publisher.
- `/ui/my-services` remains the seller-owned skill-service ledger.
- `/ui/products` owns product marketplace, product publishing, owned listings, and product order inspection.

This keeps product semantics visible and avoids mixing skill-service orders with product orders. The page should still feel consistent with the OAC UI system and the CLI-first UI design.

## Visual Thesis

A dense local commerce console: calm OAC surfaces, compact product rows, clear seller/buyer actor selection, visible online state, and modal confirmations for irreversible chain/payment actions.

## Content Plan

- Primary workspace: segmented views for `Marketplace`, `Sell`, and `Orders`.
- Marketplace: online-only product search, product/SKU comparison, and purchase preview.
- Sell: seller actor, fulfillment skill catalog, product-listing builder, JSON preview, and publish confirmation.
- Orders: buyer/seller order lists, inspection detail, payment/order/delivery evidence, and trace links when available.

## Interaction Thesis

- Browsing is fast and low-chrome: search updates product rows and the selected product detail without leaving the page.
- Every paid or chain-writing operation uses preview first, then a confirmation modal with actor, price, SKU, protocol effect, and CLI-equivalent command.
- Order inspection never exposes private delivery content as raw blobs; it summarizes status and provides copyable IDs/links.

## Page Information Architecture

### Route

Add `/ui/products` as a built-in UI page and `metabot ui open --page products` as the CLI bridge.

Initial URL parameters:

- `?from=<bot-slug>`: optional actor hint for buyer/seller selectors.
- `?listingPinId=<pinid>`: optional marketplace detail selector.
- `?productOrderPinId=<pinid>`: optional order inspection selector.
- `?tab=marketplace|sell|orders`: optional initial tab.

### Top Bar

The page should use a restrained operational toolbar:

- title: `Products`
- segmented control: `Marketplace`, `Sell`, `Orders`
- buyer/seller actor selectors populated from `/api/bot/profiles`
- refresh button
- compact status area for last load, error, or pending operation

Do not add a marketing hero. This is an operational tool.

### Marketplace View

Default state:

- query input with placeholder `mobile top-up`;
- online-only toggle fixed to enabled for V1 purchase flow;
- product list sorted as returned by `/api/network/products`;
- selected product detail with cover, description, seller, fulfillment summary, and SKU table;
- purchase panel with buyer actor, selected SKU, spend cap, optional comment, preview button.

Rules:

- The UI must request `online=true` when loading purchasable marketplace products.
- Offline products may be visible only in a future cached/read-only mode; V1 purchase buttons must stay disabled for offline products.
- The selected SKU price becomes the default spend cap. The human may lower/raise it, but `products buy` decides whether it is allowed.
- The first purchase call must send `confirmed: false`.
- The second purchase call may send `confirmed: true` only after explicit confirmation.
- Do not add a separate buyer-side txid verification step.

### Sell View

The Sell view guides a seller through Product V1 listing publication.

Required sections:

1. Seller actor selection.
2. Fulfillment skill catalog loaded by `GET /api/products/skills?from=<seller>`.
3. Product fields:
   - `name`
   - `title`
   - `coverImage`
   - `galleryImages`
   - `descriptionContentType`
   - `description`
4. Fulfillment fields fixed to V1:
   - `fulfillmentType: "digital_delivery"`
   - `deliveryEndpoint: "simplemsg"`
   - `fulfillmentSkills`
   - optional `estimatedDeliverySeconds`
   - optional `deliverableDescription`
5. SKU editor:
   - `skuId`
   - `name`
   - `image`
   - `descriptionContentType`
   - `description`
   - `price.amount`
   - `price.currency`
   - `initialStock`
6. JSON preview.
7. Publish confirmation modal.

Rules:

- Run the skills load before accepting a fulfillment skill as valid.
- Present only returned skills as selectable `fulfillmentSkills`.
- Allow multiple fulfillment skills; do not mark the first one as primary.
- Use metafile URI fields for images in V1. Local upload UX may be added later through the existing file upload capability, but this UI plan does not add a browser data-URL upload flow.
- `initialStock` must be a finite positive integer. If the seller wants unlimited-like stock, they can enter a large number such as `99999999`.
- The UI must preview the exact JSON payload before `POST /api/products/publish`.
- Publish confirmation must show seller actor, network, listing title, SKU count, fulfillment skills, and protocol path.

### Owned Listings View

Owned listings can live inside the Sell tab below the publish form, or in a sub-panel. It should call:

```text
GET /api/products/owned?from=<seller>&page=<n>&pageSize=<n>&refresh=<bool>
GET /api/products/owned?all=true&page=<n>&pageSize=<n>&refresh=<bool>
```

Use `from=<seller>` when a seller actor is selected. Use `all=true` only for the cross-local-profile read-only view. Do not send `from` and `all=true` together.

V1 owned listing actions:

- refresh;
- inspect listing payload;
- copy listing pin id;
- select a listing as a marketplace detail if it is also in directory cache.

Do not add modify/revoke controls unless the CLI and product protocol support them in a later plan.

### Orders View

The Orders view covers both buyer and seller order caches.

Controls:

- actor selector;
- role filter: `buyer`, `seller`, `all`;
- state filter;
- pagination;
- selector input for direct inspection by product-order pin id, order txid, payment txid, or local order id.

List route:

```text
GET /api/products/orders?from=<slug>&role=<buyer|seller|all>&state=<state>&page=<n>&pageSize=<n>
GET /api/products/orders?all=true&role=<buyer|seller|all>&state=<state>&page=<n>&pageSize=<n>
```

The `role=all` filter means "include buyer and seller order roles." The `all=true` query means "read across all local MetaBot profiles." They are independent; a global all-profile order view should send both `all=true` and the selected `role`.

Inspect route:

```text
GET /api/products/orders/inspect?from=<slug>&productOrderPinId=<pinid>
```

Detail content:

- role;
- state;
- listing pin id;
- SKU id;
- payment txid;
- product-order pin id;
- order simplemsg txid;
- seller/buyer globalMetaId when present;
- payment verification result for seller orders;
- fulfillment skill list for seller orders;
- delivery pin id and delivery summary when present;
- trace/session links when present;
- failure reason when present.

Never render decrypted private delivery bodies as raw debug text.

## API Contract Notes

The UI should keep the existing command-envelope pattern:

```json
{
  "ok": true,
  "state": "success",
  "data": {}
}
```

Failure handling rules:

- show `code` and `message` without hiding the machine-readable code;
- preserve `state: "awaiting_confirmation"` for purchase preview;
- do not treat HTTP 200 as success unless `ok === true`;
- do not retry payment or publish actions automatically;
- keep confirmation modal state separate from ordinary form state so refresh cannot trigger writes.

## View Model Design

Create `src/ui/pages/products/viewModel.ts` with pure projection functions. It should not use `fetch`, DOM, chain, wallet, or daemon APIs.

Suggested exports:

```ts
export interface ProductCommercePageViewModel { /* serializable UI model */ }
export function buildProductCommercePageViewModel(input: ProductCommerceViewModelInput): ProductCommercePageViewModel;
export function buildProductListingPreview(input: ProductListingFormInput): ProductListingPreviewResult;
export function buildProductPurchasePreviewRequest(input: ProductPurchaseFormInput): ProductPurchaseRequestPreviewResult;
export function formatProductMediaUri(value: unknown): string;
```

Projection responsibilities:

- normalize product directory rows from `/api/network/products`;
- normalize owned listing rows from `/api/products/owned`;
- normalize order rows and inspection detail from `/api/products/orders*`;
- build compact labels for price, stock, SKU count, actor, state, payment, delivery, and fulfillment;
- derive disabled reasons for missing actor, missing SKU, offline seller, unsupported product type, unsupported fulfillment, missing fulfillment skills, invalid metafile URI, invalid stock, and missing explicit confirmation;
- convert `metafile://...` references into `/api/file/avatar?ref=...` for image preview when possible.

## Safety Requirements

- Explicit confirmation is required before product publish.
- Explicit confirmation is required before paid purchase.
- The confirmation modal must be dismissed after execution so a browser refresh cannot re-run a mutation.
- Confirm buttons must disable while requests are in flight.
- The UI must not ask buyers for phone, email, shipping address, or sensitive per-order inputs.
- The UI must not invent seller identity, seller payment address, payment chain, timestamps, shipping policy, review policy, or MRC20 fields.
- The UI must not design product-review or refund flows.
- The UI must not classify the first fulfillment skill as primary.
- The UI must not expose private delivery raw content.

## File Structure

Create:

- `src/ui/pages/products/viewModel.ts`
- `src/ui/pages/products/app.ts`
- `src/ui/pages/products/index.html`
- `tests/ui/productCommerceViewModel.test.mjs`
- `tests/ui/productCommercePageScript.test.mjs`
- `tests/playwright/product-commerce-ui.spec.mjs`

Modify:

- `src/daemon/routes/types.ts`
- `src/daemon/routes/ui.ts`
- `src/cli/commands/ui.ts`
- `src/cli/commandHelp.ts`
- `tests/daemon/httpServer.test.mjs`
- `tests/cli/doctor.test.mjs`
- `tests/cli/help.test.mjs`
- `SKILLs/metabot-product-commerce/SKILL.md`
- `tests/skillpacks/buildSkillpacks.test.mjs`
- rendered skillpack copies after `npm run build:skillpacks`
- `docs/acceptance/product-commerce-v1-cli-smoke.md` or a new UI acceptance runbook if the existing CLI smoke becomes too long

Do not modify:

- `docs/metaid_protocols/06-product.md`
- product protocol validation rules, unless a separate protocol SDD is approved
- wallet/payment verification internals
- simplemsg encryption semantics
- seller fulfillment runtime behavior

## Subagent-Driven Execution Rules

- Use a fresh implementation subagent for each task.
- The controller must review and verify each task before moving to the next one.
- Each task needs spec review and code-quality review before being marked complete.
- Review and test subagents should use model `gpt-5.5`.
- If review finds issues, send the same task implementation subagent back for focused fixes.
- Commit each independent, verified repository modification round.
- After every commit, use the `metabot-post-buzz` skill to post an on-chain development diary with commit SHA, summary, and verification evidence.
- Do not proceed to real browser/on-chain acceptance until all unit and route tests pass.

---

## Task 1: Register The Products UI Page

**Files:**

- Create: `src/ui/pages/products/index.html`
- Create: `src/ui/pages/products/app.ts`
- Modify: `src/daemon/routes/types.ts`
- Modify: `src/daemon/routes/ui.ts`
- Modify: `src/cli/commands/ui.ts`
- Modify: `src/cli/commandHelp.ts`
- Test: `tests/daemon/httpServer.test.mjs`
- Test: `tests/cli/doctor.test.mjs`
- Test: `tests/cli/help.test.mjs`

- [ ] **Step 1: Write failing route and CLI tests**

Add coverage that expects:

- `GET /ui/products` returns HTML.
- The navigation contains `Products`.
- The HTML includes `data-products-shell`, `data-products-tab="marketplace"`, `data-products-tab="sell"`, and `data-products-tab="orders"`.
- `metabot ui open --page products` returns `/ui/products`.
- `metabot ui open --page products --from alice` returns `/ui/products?from=alice`.
- help output lists `products` as a supported UI page in usage text, flag descriptions or page list copy, and examples.

Run:

```bash
npm run build && node --test tests/daemon/httpServer.test.mjs tests/cli/doctor.test.mjs tests/cli/help.test.mjs
```

Expected: FAIL because the page is not registered.

- [ ] **Step 2: Add the page type and route registration**

Update `MetabotUiPageName`:

```ts
export type MetabotUiPageName = 'hub' | 'publish' | 'my-services' | 'trace' | 'refund' | 'chat-viewer' | 'bot' | 'loom' | 'products';
```

Register `buildProductsPageDefinition` in `PAGE_BUILDERS` and add `{ page: 'products', label: 'Products' }` to navigation.

- [ ] **Step 3: Add the initial page builder**

Create `src/ui/pages/products/app.ts` with a minimal `LocalUiPageDefinition`:

- page: `products`
- title: `Products`
- eyebrow: `Product Commerce`
- heading: `Products`
- description: `Publish, buy, and inspect Product Commerce V1 virtual goods.`
- content with the required shell and tab anchors
- script that does not perform writes on load

- [ ] **Step 4: Add the HTML template**

Create `src/ui/pages/products/index.html` following existing built-in page placeholders:

```html
__PAGE_TITLE__
__PAGE_NAV__
__PAGE_CONTENT__
__PAGE_SCRIPT__
```

Use `/ui/shared.css` and page-local styles. Keep the first implementation simple and stable.

- [ ] **Step 5: Add UI open support**

Add `products` to `SUPPORTED_UI_PAGES` in `src/cli/commands/ui.ts`.

Update `src/cli/commandHelp.ts` so `metabot ui open --help` includes `products` everywhere the supported built-in UI page set is described:

- summary or descriptive page list;
- `--page <page>` option description;
- examples, including `metabot ui open --page products` and `metabot ui open --page products --from alice`.

Do not update only examples; generated help text must make `products` discoverable without reading examples.

- [ ] **Step 6: Verify**

Run:

```bash
npm run build && node --test tests/daemon/httpServer.test.mjs tests/cli/doctor.test.mjs tests/cli/help.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit and post diary**

```bash
git add src/ui/pages/products/index.html src/ui/pages/products/app.ts src/daemon/routes/types.ts src/daemon/routes/ui.ts src/cli/commands/ui.ts src/cli/commandHelp.ts tests/daemon/httpServer.test.mjs tests/cli/doctor.test.mjs tests/cli/help.test.mjs
git commit -m "feat: add products ui route"
```

Post a development diary with `metabot-post-buzz`.

---

## Task 2: Add Product Commerce View Models

**Files:**

- Create: `src/ui/pages/products/viewModel.ts`
- Modify: `src/ui/pages/products/app.ts`
- Test: `tests/ui/productCommerceViewModel.test.mjs`

- [ ] **Step 1: Write failing view-model tests**

Cover:

- product directory rows render title, seller, online state, SKU count, first price, and cover preview URI;
- unsupported physical/logistics products are marked disabled for purchase;
- selected SKU builds a purchase preview request with `confirmed: false`, `listingPinId`, `skuId`, `spendCap`, and optional `comment`;
- listing form builds a Product V1 payload with fixed fulfillment type and endpoint;
- listing form rejects non-`metafile://` cover/gallery/SKU image values;
- listing form rejects missing fulfillment skills not returned by the loaded skill catalog;
- SKU stock rejects `0`, negative, non-integer, and empty values;
- `99999999` is accepted as ordinary finite stock;
- order rows never include raw delivery body fields;
- fulfillment labels state that all fulfillment skills are available, not only the first.

Run:

```bash
npm run build && node --test tests/ui/productCommerceViewModel.test.mjs
```

Expected: FAIL because the view model does not exist.

- [ ] **Step 2: Implement pure projection helpers**

Create pure helpers for:

- text normalization;
- price formatting;
- timestamp formatting;
- order state labels;
- `metafile://` validation;
- media preview URI conversion to `/api/file/avatar?ref=<pin-ref>`;
- product row normalization;
- SKU row normalization;
- listing preview payload creation;
- purchase preview request creation.

No helper in this file may call `fetch`, read files, write files, access wallet state, or mutate DOM.

- [ ] **Step 3: Wire the page builder to embed the view-model runtime source**

Use the same pattern as existing pages:

```ts
const buildProductCommercePageViewModelSource = buildProductCommercePageViewModelRuntimeSource();
```

If using `Function.toString()`, keep exported helpers deterministic and browser-compatible.

- [ ] **Step 4: Verify**

Run:

```bash
npm run build && node --test tests/ui/productCommerceViewModel.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit and post diary**

```bash
git add src/ui/pages/products/viewModel.ts src/ui/pages/products/app.ts tests/ui/productCommerceViewModel.test.mjs
git commit -m "feat: add products ui view model"
```

Post a development diary with `metabot-post-buzz`.

---

## Task 3: Build Marketplace Discovery UI

**Files:**

- Modify: `src/ui/pages/products/app.ts`
- Modify: `src/ui/pages/products/index.html`
- Test: `tests/ui/productCommercePageScript.test.mjs`

- [ ] **Step 1: Write failing page-script tests for marketplace loading**

Use the existing VM-based page script pattern from `tests/ui/loomPageScript.test.mjs`.

Assert:

- page load requests `/api/bot/profiles`;
- marketplace load requests `/api/network/products?online=true&limit=20` by default;
- entering query `mobile top-up` requests `/api/network/products?online=true&query=mobile%20top-up&limit=20`;
- product rows render seller, SKU count, price, and online status;
- selecting a product renders detail and SKU choices;
- offline products have disabled purchase controls when supplied by a test fixture;
- fetch failure shows the command-envelope code/message area.

Run:

```bash
npm run build && node --test tests/ui/productCommercePageScript.test.mjs
```

Expected: FAIL because marketplace behavior is not implemented.

- [ ] **Step 2: Implement marketplace DOM structure**

Add:

- query input;
- refresh button;
- product list container;
- selected product detail;
- SKU selector table;
- buyer actor selector;
- spend cap inputs;
- comment input;
- preview purchase button.

Keep the default layout dense: list and detail side by side on desktop, stacked or horizontally scrollable on small screens.

- [ ] **Step 3: Implement marketplace fetch state**

Client state should include:

```js
{
  profiles: [],
  marketplace: null,
  marketplaceError: null,
  selectedListingPinId: '',
  selectedSkuId: '',
  buyerSlug: '',
  query: '',
  busy: false
}
```

Fetch through a shared `loadJson()` helper that checks `payload.ok === true`.

- [ ] **Step 4: Implement selection and disabled reasons**

Use view-model disabled reasons for:

- no buyer actor;
- no product selected;
- no SKU selected;
- offline seller;
- unsupported product type;
- unsupported fulfillment;
- missing/invalid spend cap.

- [ ] **Step 5: Verify**

Run:

```bash
npm run build && node --test tests/ui/productCommercePageScript.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit and post diary**

```bash
git add src/ui/pages/products/app.ts src/ui/pages/products/index.html tests/ui/productCommercePageScript.test.mjs
git commit -m "feat: add products marketplace ui"
```

Post a development diary with `metabot-post-buzz`.

---

## Task 4: Add Purchase Preview And Confirmation

**Files:**

- Modify: `src/ui/pages/products/app.ts`
- Modify: `src/ui/pages/products/index.html`
- Test: `tests/ui/productCommercePageScript.test.mjs`
- Test: `tests/daemon/productRoutes.test.mjs` only if route behavior needs an additional guard

- [ ] **Step 1: Write failing tests for purchase preview**

Assert:

- clicking preview posts to `/api/products/buy` with `from: <buyer>`, `confirmed: false`, `listingPinId`, `skuId`, `spendCap`, and `comment`;
- an `awaiting_confirmation` envelope opens a confirmation modal;
- the modal renders buyer actor, listing pin id, SKU id, amount, currency, seller, and CLI-equivalent command text;
- no payment txid or product-order pin id is shown during preview.

- [ ] **Step 2: Write failing tests for confirmed purchase**

Assert:

- confirm posts the returned `confirmRequest.request` plus `from: <buyer>` and `confirmed: true`;
- confirm button disables while busy;
- success renders `productOrderPinId`, `paymentTxid`, `orderTxid`, `traceId`, and local UI URL when present;
- cancellation closes the modal without posting the confirmed request;
- browser refresh or marketplace refresh does not repeat the confirmed purchase.

Run:

```bash
npm run build && node --test tests/ui/productCommercePageScript.test.mjs
```

Expected: FAIL before implementation.

- [ ] **Step 3: Implement preview request building**

Use the view-model purchase request helper. Do not manually construct a separate buyer-side txid verification step.

- [ ] **Step 4: Implement confirmation modal**

Modal requirements:

- `role="dialog"`;
- focus moves into modal on open;
- Escape closes only when not busy;
- confirm button text clearly indicates payment;
- copyable JSON preview is available but not dominant;
- success state replaces the dangerous confirm controls.

- [ ] **Step 5: Verify**

Run:

```bash
npm run build && node --test tests/ui/productCommercePageScript.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit and post diary**

```bash
git add src/ui/pages/products/app.ts src/ui/pages/products/index.html tests/ui/productCommercePageScript.test.mjs
git commit -m "feat: add products purchase confirmation ui"
```

Post a development diary with `metabot-post-buzz`.

---

## Task 5: Build Seller Product Publish UI

**Files:**

- Modify: `src/ui/pages/products/app.ts`
- Modify: `src/ui/pages/products/index.html`
- Test: `tests/ui/productCommercePageScript.test.mjs`
- Test: `tests/ui/productCommerceViewModel.test.mjs`

- [ ] **Step 1: Write failing tests for seller actor and skills**

Assert:

- switching to Sell tab loads `/api/bot/profiles`;
- selecting seller `alice` loads `/api/products/skills?from=alice`;
- fulfillment skill options come only from the returned catalog;
- if skill loading fails, publish controls are disabled and the code/message are visible;
- selected skills can include more than one entry.

- [ ] **Step 2: Write failing tests for listing form validation**

Assert:

- required product fields are enforced;
- image fields require `metafile://`;
- `productType`, `fulfillmentType`, and `deliveryEndpoint` are fixed to Product V1 values;
- `descriptionContentType` supports `text/markdown` and `text/html` only if existing validation allows it;
- at least one SKU is required;
- SKU prices require amount and currency;
- stock must be a finite positive integer;
- no seller identity/payment/timestamp/shipping/review/MRC20 fields are included.

- [ ] **Step 3: Write failing tests for publish preview and confirmation**

Assert:

- preview renders exact JSON payload;
- publish confirmation shows seller actor, network, SKU count, fulfillment skills, and `/protocols/product-listing`;
- confirm posts to `/api/products/publish` with `from`, `network`, and the previewed payload;
- success shows listing pin id and txids when returned;
- cancellation does not post.

Run:

```bash
npm run build && node --test tests/ui/productCommercePageScript.test.mjs tests/ui/productCommerceViewModel.test.mjs
```

Expected: FAIL before implementation.

- [ ] **Step 4: Implement the Sell form**

Use feature-complete but restrained controls:

- text inputs for `name`, `title`, cover image URI, SKU id/name/image/price/stock;
- textarea for markdown descriptions;
- chips or checkboxes for fulfillment skills;
- add/remove SKU controls;
- gallery URI list editor;
- network select for publish chain;
- JSON preview panel;
- confirmation modal.

Do not add local browser file upload in this task. If humans need metafile URIs from local files, point them to existing file upload CLI/SKILL handoff until a separate browser upload design is approved.

- [ ] **Step 5: Verify**

Run:

```bash
npm run build && node --test tests/ui/productCommercePageScript.test.mjs tests/ui/productCommerceViewModel.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit and post diary**

```bash
git add src/ui/pages/products/app.ts src/ui/pages/products/index.html src/ui/pages/products/viewModel.ts tests/ui/productCommercePageScript.test.mjs tests/ui/productCommerceViewModel.test.mjs
git commit -m "feat: add products publish ui"
```

Post a development diary with `metabot-post-buzz`.

---

## Task 6: Add Owned Listings And Product Orders UI

**Files:**

- Modify: `src/ui/pages/products/app.ts`
- Modify: `src/ui/pages/products/index.html`
- Modify: `src/ui/pages/products/viewModel.ts`
- Test: `tests/ui/productCommerceViewModel.test.mjs`
- Test: `tests/ui/productCommercePageScript.test.mjs`

- [ ] **Step 1: Write failing owned-listing tests**

Assert:

- Sell tab loads `/api/products/owned?from=<seller>&page=1&pageSize=20`;
- when no seller actor is selected, owned listings can load `/api/products/owned?all=true&page=1&pageSize=20`;
- selecting a seller actor removes `all=true` and sends `from=<seller>`;
- refresh adds `refresh=true`;
- owned listings render title, listing pin id, SKU count, fulfillment skills, and available/revoked state;
- owned listings expose inspect/copy actions only;
- no modify/revoke action is rendered.

- [ ] **Step 2: Write failing order-list tests**

Assert:

- Orders tab loads `/api/products/orders?from=<actor>&role=buyer&page=1&pageSize=20` by default;
- when no actor is selected, Orders tab loads `/api/products/orders?all=true&role=buyer&page=1&pageSize=20`;
- selecting an actor removes `all=true` and sends `from=<actor>`;
- role filter switches between `buyer`, `seller`, and `all`;
- role `all` sends `role=all`; it does not replace the cross-profile `all=true` query flag;
- state filter is passed when selected;
- pagination passes page and page size;
- rows render role, state, listing pin id, SKU id, payment txid, product-order pin id, and delivery summary label.

- [ ] **Step 3: Write failing order-inspection tests**

Assert:

- clicking an order row calls `/api/products/orders/inspect` with the best selector;
- direct selector input supports product-order pin id, payment txid, order txid, and order id;
- detail renders payment verification, fulfillment skills, selected SKU, trace/session links, delivery pin id, and failure reason when present;
- detail does not render raw decrypted delivery payloads.

Run:

```bash
npm run build && node --test tests/ui/productCommerceViewModel.test.mjs tests/ui/productCommercePageScript.test.mjs
```

Expected: FAIL before implementation.

- [ ] **Step 4: Implement owned listings and orders state**

Keep state independent from marketplace/publish form state:

```js
{
  ownedListings: null,
  ownedListingsError: null,
  ordersPage: null,
  orderInspect: null,
  orderError: null,
  orderRole: 'buyer',
  orderState: '',
  orderPage: 1,
  orderPageSize: 20
}
```

- [ ] **Step 5: Implement order detail modal or side panel**

Use a modal on narrow screens and a detail panel on desktop only if it does not crowd the table. The detail must be scannable and copy-friendly.

- [ ] **Step 6: Verify**

Run:

```bash
npm run build && node --test tests/ui/productCommerceViewModel.test.mjs tests/ui/productCommercePageScript.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit and post diary**

```bash
git add src/ui/pages/products/app.ts src/ui/pages/products/index.html src/ui/pages/products/viewModel.ts tests/ui/productCommerceViewModel.test.mjs tests/ui/productCommercePageScript.test.mjs
git commit -m "feat: add products order inspection ui"
```

Post a development diary with `metabot-post-buzz`.

---

## Task 7: Polish Layout, Accessibility, And Browser Acceptance

**Files:**

- Modify: `src/ui/pages/products/index.html`
- Modify: `src/ui/pages/products/app.ts`
- Test: `tests/playwright/product-commerce-ui.spec.mjs`

- [ ] **Step 1: Write isolated Playwright smoke test**

Serve mocked endpoints locally, similar to `tests/playwright/loom-product-ui.spec.mjs`.

Cover:

- `/ui/products` loads without external chain/wallet calls;
- nav and tabs are visible;
- marketplace list renders at least one online product;
- product detail and SKU selection work;
- purchase preview opens a confirmation modal;
- sell tab loads skill catalog and renders JSON preview;
- orders tab renders buyer/seller order rows and inspection detail;
- desktop viewport has no incoherent overlap;
- mobile viewport can switch tabs and open modals without clipped buttons.

Run:

```bash
npm run build && node --test tests/playwright/product-commerce-ui.spec.mjs
```

Expected: FAIL before final polish.

- [ ] **Step 2: Apply layout polish**

Requirements:

- operational app surface, not a landing page;
- no decorative hero;
- no cards inside cards;
- product rows and SKU rows have stable dimensions;
- buttons do not resize when labels change;
- text does not overlap at desktop or mobile widths;
- selected states are visible without relying only on color;
- focus states are visible;
- modals trap enough focus for keyboard operation;
- destructive/paid actions remain visually distinct.

- [ ] **Step 3: Verify Playwright**

Run:

```bash
npm run build && node --test tests/playwright/product-commerce-ui.spec.mjs
```

Expected: PASS, or SKIP with a clear message only if Playwright is unavailable in the local environment. If skipped locally, a reviewer/test subagent must run equivalent browser acceptance where Playwright is available before final acceptance.

- [ ] **Step 4: Commit and post diary**

```bash
git add src/ui/pages/products/index.html src/ui/pages/products/app.ts tests/playwright/product-commerce-ui.spec.mjs
git commit -m "feat: polish products ui acceptance"
```

Post a development diary with `metabot-post-buzz`.

---

## Task 8: Update Skill Handoff And Acceptance Docs

**Files:**

- Modify: `SKILLs/metabot-product-commerce/SKILL.md`
- Modify: `tests/skillpacks/buildSkillpacks.test.mjs`
- Regenerate: `skillpacks/shared/skills/metabot-product-commerce/SKILL.md`
- Regenerate: `skillpacks/codex/runtime/shared-skills/metabot-product-commerce/SKILL.md`
- Regenerate: `skillpacks/claude-code/runtime/shared-skills/metabot-product-commerce/SKILL.md`
- Regenerate: `skillpacks/openclaw/runtime/shared-skills/metabot-product-commerce/SKILL.md`
- Create or modify: `docs/acceptance/product-commerce-v1-ui-smoke.md`

- [ ] **Step 1: Write failing skillpack assertion**

Assert the rendered Product Commerce skill includes:

```text
metabot ui open --page products
```

and still does not include:

```text
manual refund confirmation
```

Run:

```bash
npm run build && node --test tests/skillpacks/buildSkillpacks.test.mjs
```

Expected: FAIL before skill update.

- [ ] **Step 2: Update the Product Commerce skill**

Add UI handoff guidance:

- prefer CLI for agent workflows and automation;
- use `/ui/products` for human browsing, publish review, purchase confirmation, and order inspection;
- do not use UI wording to introduce product-review, refunds, physical logistics, or raw private delivery views.

- [ ] **Step 3: Add UI smoke runbook**

Create `docs/acceptance/product-commerce-v1-ui-smoke.md` with:

- prerequisites;
- mocked local UI smoke;
- real local daemon smoke;
- optional real chain smoke after CLI acceptance data exists;
- evidence fields to record.

- [ ] **Step 4: Regenerate skillpacks**

Run:

```bash
npm run build:skillpacks
```

- [ ] **Step 5: Verify**

Run:

```bash
npm run build
node --test tests/skillpacks/buildSkillpacks.test.mjs tests/npm/packageFiles.test.mjs
git diff --check
```

Expected: PASS.

- [ ] **Step 6: Commit and post diary**

```bash
git add SKILLs/metabot-product-commerce/SKILL.md tests/skillpacks/buildSkillpacks.test.mjs docs/acceptance/product-commerce-v1-ui-smoke.md skillpacks/shared/skills/metabot-product-commerce/SKILL.md skillpacks/codex/runtime/shared-skills/metabot-product-commerce/SKILL.md skillpacks/claude-code/runtime/shared-skills/metabot-product-commerce/SKILL.md skillpacks/openclaw/runtime/shared-skills/metabot-product-commerce/SKILL.md
git commit -m "docs: add product commerce ui handoff"
```

Post a development diary with `metabot-post-buzz`.

---

## Task 9: Final Product UI Review And Real Flow Acceptance

**Files:**

- No planned source edits unless review finds issues.

- [ ] **Step 1: Run final focused verification**

Run:

```bash
npm run build
node --test \
  tests/daemon/httpServer.test.mjs \
  tests/daemon/productRoutes.test.mjs \
  tests/daemon/productNetworkRoutes.test.mjs \
  tests/cli/doctor.test.mjs \
  tests/cli/help.test.mjs \
  tests/ui/productCommerceViewModel.test.mjs \
  tests/ui/productCommercePageScript.test.mjs \
  tests/playwright/product-commerce-ui.spec.mjs \
  tests/skillpacks/buildSkillpacks.test.mjs \
  tests/npm/packageFiles.test.mjs
npm run build:skillpacks
git diff --check
git status --short --branch
```

Expected: PASS and clean worktree.

- [ ] **Step 2: Spawn final code review subagent**

Use model `gpt-5.5`.

Review scope:

- `/ui/products` page behavior;
- no duplicated payment or fulfillment logic;
- no protocol drift;
- confirmation safety;
- accessibility/layout;
- tests and generated artifacts.

Expected: APPROVED before proceeding.

- [ ] **Step 3: Spawn real browser acceptance subagent**

Use model `gpt-5.5`.

Ask it to run the local UI with mocked endpoints or a real daemon, depending on environment availability, and verify:

- marketplace browsing;
- purchase preview/confirmation shape;
- seller publish preview shape;
- owned listing display;
- order inspection display;
- no raw private delivery dump;
- mobile and desktop screenshots.

Expected: APPROVED or concrete issues to fix.

- [ ] **Step 4: Optional real chain acceptance**

Only run after the CLI smoke environment has funded Alice/Bob bots and a known product scenario.

Use the existing CLI smoke runbook as the source of truth:

- publish listing through UI;
- confirm it appears in online product discovery;
- preview and confirm Bob purchase through UI;
- inspect Bob and Alice order views;
- verify delivery summary appears after seller fulfillment.

Do not run real chain writes without explicit human confirmation at the time of the test.

- [ ] **Step 5: Fix review or acceptance issues**

If either final subagent returns NOT APPROVED:

- verify the finding locally;
- send the relevant implementation subagent back for a focused fix;
- rerun targeted tests;
- commit and post buzz;
- rerun final review/acceptance.

## Final Acceptance Criteria

- `/ui/products` is registered, navigable, and openable through `metabot ui open --page products`.
- Marketplace discovery uses `/api/network/products?online=true` by default.
- Purchase preview calls `/api/products/buy` with `confirmed: false`.
- Confirmed purchase calls `/api/products/buy` with `confirmed: true` only after explicit confirmation.
- Seller publish loads `/api/products/skills?from=<seller>` before accepting fulfillment skills.
- Seller publish preview emits only V1 protocol fields.
- Product publish confirmation calls `/api/products/publish` only after explicit confirmation.
- Owned listings are read-only in V1.
- Buyer/seller order lists and inspection use `/api/products/orders*`.
- Private delivery bodies are not dumped.
- Product-review, refunds, shipping, and physical logistics are not introduced.
- Product Commerce skill points humans to `metabot ui open --page products` without weakening CLI-first semantics.
- Focused tests and browser acceptance pass.
- Every modification round has a commit and on-chain development diary buzz.
