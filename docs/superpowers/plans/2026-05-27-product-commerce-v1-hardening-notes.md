# Product Commerce V1 Hardening Notes

Date: 2026-05-27
Status: Next-iteration notes after real UI and real-chain acceptance

## Purpose

Use this note as the first reference for the next Product Commerce V1
iteration. The virtual-goods happy path is implemented and has passed a real UI
smoke on real chain data. The remaining work is hardening, cache consistency,
developer-environment reliability, and broader negative-path validation.

Do not treat this file as a replacement for the protocol, business-flow, CLI,
SKILL, or UI implementation plans. It records what the acceptance run proved
and what should be improved next.

## Verified Baseline

The following end-to-end flow was verified through the real `/ui/products`
workspace, local Bot profiles, real chain writes, and the local S1 fulfillment
skill:

1. Alice published a virtual `product-listing` from the Sell UI.
2. The listing appeared in the online product directory with `online=true`.
3. Bob selected SKU2 from the Marketplace UI and previewed the purchase.
4. Bob confirmed payment for `0.00005 SPACE`.
5. The buyer flow produced a payment txid, product-order pin id, and order
   simplemsg txid.
6. Alice received the product order, resolved the listing and SKU, verified the
   payment, invoked fulfillment skill `S1`, and delivered the result.
7. Bob and Alice local order caches both projected the order as `delivered`.
8. The Orders UI showed the delivered order row with listing, SKU, payment,
   product-order, and delivery pin evidence.

Acceptance evidence from the run:

```text
listingPinId: 550402fbc4d55585ef9f06a51ac3c009380c1e06676f177a28534dd5cbcc8687i0
skuId: sku2
paymentTxid: 84b19d98c06390cf1d7405a9587a9f337decad41d5c5ac902efea38071ca09dc
productOrderPinId: 8053e27dd9bad13bd41bbf171af1666dc2d87b0a303d9457873bb015e712ca47i0
orderTxid: 43e8395173e664b35de26654b5748a724d64beba6fe317a88141a8c0febcf581
deliveryPinId: 751a66a79fe8cf035a412d8937fc8d6eb82a3dadafc8d3f6fd70816357079a7ci0
fulfillmentSkills: ["S1"]
deliveryResult: SMOKE-SKU2-CARD-0001
finalState: delivered
```

The same round fixed a UI/API contract blocker where
`/api/products/skills?from=<seller>` returned `skillName`, but the Sell UI only
recognized `name`, `id`, or `slug`. The regression test now verifies that a
skill response such as `{ "skillName": "S1" }` renders a checkbox whose value
and `data-product-sell-skill` are both `S1`.

## Primary Hardening Backlog

### 1. Buyer-Scoped Product Cache Reconciliation

Observed issue:

- The Marketplace view can be served by one daemon/profile while the buyer
  selector points at another local Bot.
- `GET /api/network/products` refreshes and caches directory data in the daemon
  home that served the Marketplace request.
- `POST /api/products/buy` resolves the selected `from` actor and plans the
  purchase from that actor's local product directory cache.
- If the selected buyer's cache has not seen the listing, preview fails with:

```text
cached_product_match_not_found: No cached online product matched this purchase request.
```

Why it matters:

- A user can see an online product in the UI but fail purchase preview because
  the selected buyer's cache is stale.
- This is not a protocol issue. It is a local projection consistency issue
  between marketplace discovery and buyer-scoped purchase planning.

Recommended direction:

- Make purchase preview cache-reconcile the selected listing for the selected
  buyer before returning `cached_product_match_not_found`.
- Prefer a daemon-side fix so CLI, SKILL, and UI all benefit.
- When a purchase request contains `listingPinId`, the buy handler can attempt
  a non-cached `listProductDirectory` refresh for the actor's
  `ProductStateStore`, then re-run planning against the refreshed actor cache.
- Preserve the current rule that payment only happens after the refreshed plan
  still confirms the product is online, virtual, simplemsg-backed, SKU-matched,
  and within spend cap.
- Avoid adding listing snapshots to `product-order`; chain data is already the
  immutable source of truth.

Acceptance criteria:

- From an arbitrary local UI-serving profile, select buyer `bob` and a newly
  published Alice listing that Bob has not cached yet.
- Purchase preview succeeds after buyer-scoped reconciliation.
- Confirmed purchase still fails before payment if the refreshed listing is
  offline, unsupported, missing the SKU, or above spend cap.
- CLI `metabot products buy --from bob --request-file request.json --json`
  gets the same behavior as the UI.
- Add regression coverage for stale buyer cache plus selected `listingPinId`.

### 2. Worktree Daemon Ownership And Developer Startup

Observed issue:

- During acceptance, port `24885` was repeatedly taken by a globally installed
  `open-agent-connect` daemon instead of the current worktree build.
- This caused stale UI/API mismatches such as `/ui/products` serving an older
  page or `/api/products/publish` returning `not_found`.
- Running `$HOME/.metabot/bin/metabot` for unrelated actions, such as posting a
  development diary buzz, can restart the global daemon and retake the default
  local UI port.

Why it matters:

- Real UI acceptance becomes unreliable when the browser is pointed at a daemon
  that does not match the branch under test.
- Product UI and product API routes must be served by the same built artifact.

Recommended direction:

- Harden `scripts/dev-daemon.sh` or the daemon start path so development
  sessions can force the current worktree entrypoint.
- Consider a worktree-only dev mode that runs `node dist/cli/main.js daemon
  serve` directly on a caller-provided port rather than relying on a detached
  global CLI shim.
- Add a post-start assertion that inspects the listener command and fails if
  the active process is not the expected worktree `dist/cli/main.js`.
- Keep lock handling compatible with
  `docs/superpowers/specs/2026-04-23-metabot-storage-layout-v2-design.md`.

Acceptance criteria:

- `npm run dev:daemon` from a worktree starts a daemon whose process command
  points at that worktree's `dist/cli/main.js`.
- Starting or using a globally installed `metabot` does not silently replace the
  worktree daemon used for branch acceptance.
- A stale daemon lock is recovered or reported with an actionable message.
- Product UI smoke cannot accidentally pass against an older global install.

### 3. Seller Display Name Normalization

Observed issue:

- Some product cards and order views displayed seller name as a JSON string:

```text
{"name":"Alicee"}
```

Why it matters:

- It does not block the product flow, but it weakens the UI and acceptance
  readability.

Recommended direction:

- Normalize seller display names at the product directory projection boundary.
- If a name-like field is a JSON string with a `name` property, display the
  inner name.
- Keep the original protocol payload unchanged. This is presentation metadata,
  not a product protocol field.

Acceptance criteria:

- Marketplace product rows and detail panes display `Alicee`, not
  `{"name":"Alicee"}`.
- Buyer and seller order views display normalized names consistently.
- Existing non-JSON names are unchanged.

### 4. Broader Human And Automated Negative-Path Acceptance

The happy path is proven. The next round should expand coverage around failures
and edge conditions:

- seller offline before preview;
- seller offline between preview and confirm;
- buyer balance insufficient;
- SKU missing after cache refresh;
- spend cap below SKU price;
- S1 fulfillment failure;
- duplicate or repeated order notification;
- payment txid present but amount/address invalid;
- simplemsg temporary failure and retry behavior;
- Orders UI inspection by product-order pin, payment txid, order txid, and
  order id;
- product delivery result containing a `metafile://` URI.

Acceptance criteria:

- Each scenario fails before payment when payment should not happen.
- Seller-side failures are cached and visible as product order failures.
- Buyer-side UI surfaces command-envelope codes and messages without raw
  private payload dumps.
- The local trace remains useful for debugging without exposing secrets.

### 5. Deferred Product Features

These are still out of V1 hardening unless explicitly pulled into a new plan:

- `product-review` protocol and UI;
- refund automation;
- physical logistics;
- shipping and return policies;
- MRC20 pricing;
- browser upload UX for product images;
- chain-level stock reservation.

Stock note:

- `initialStock` is currently a listing declaration. Real stock enforcement for
  V1 should remain seller-side business logic, such as S1 or the seller's
  backing system, until a separate reservation or inventory protocol is
  designed.

## Suggested Next Iteration Order

1. Fix buyer-scoped product cache reconciliation.
2. Fix worktree daemon ownership for local acceptance.
3. Normalize seller display names.
4. Add targeted negative-path tests for purchase preview and confirm.
5. Run one full human UI acceptance round with Alice and Bob on real chain.

## Verification Commands To Prefer

For focused fixes, start with targeted checks:

```bash
npm run build
node --test tests/products/productPurchasePlanner.test.mjs
node --test tests/products/productDirectory.test.mjs
node --test tests/daemon/productRoutes.test.mjs
node --test tests/ui/productCommercePageScript.test.mjs
node --test tests/playwright/product-commerce-ui.spec.mjs
git diff --check
```

Run broader suites only when the change touches shared daemon startup,
persistence format, wallet/chain writes, or release/build plumbing.

## Notes For Future Agents

- Do not reintroduce product protocol fields that were intentionally excluded:
  seller identity, seller payment address, timestamps, shipping policy, review
  policy, or MRC20 fields.
- Do not add a separate encrypted transport. `simplemsg` is already the private
  A2A channel.
- Do not pass the product order as one direct skill argument. The seller
  fulfillment round receives the product-order context through the same
  conversation/runtime pattern used by skill-service.
- Preserve the CLI-first model. UI and SKILL surfaces should remain frontends
  over daemon/CLI business contracts.
