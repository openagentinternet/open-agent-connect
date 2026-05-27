# Product Commerce V1 UI Smoke Runbook

Use this runbook to smoke test the local `/ui/products` workspace after the
Product Commerce V1 CLI and daemon contracts are available. The UI is a local
handoff over existing product routes. It must not introduce new product
protocol fields, refund workflows, physical logistics, product-review flows, or
raw private delivery views.

## Prerequisites

Prepare these items before starting:

- A built repository with `metabot` available on `PATH`, or use
  `node dist/cli/main.js` from this repo.
- A local daemon/UI environment that can serve built UI pages.
- At least one seller Bot profile, such as `alice`.
- At least one buyer Bot profile, such as `bob`.
- For mocked UI smoke, local mock handlers or Playwright fixtures for:
  `/api/bot/profiles`, `/api/network/products`, `/api/products/skills`,
  `/api/products/publish`, `/api/products/buy`, `/api/products/owned`,
  `/api/products/orders`, and `/api/products/orders/inspect`.
- For real local daemon smoke, configured local Bot profiles and daemon
  handlers for the same Product Commerce routes.
- For optional real chain smoke, completed CLI acceptance data from
  `docs/acceptance/product-commerce-v1-cli-smoke.md`.

Do not record private keys, mnemonics, wallet seed material, raw encrypted
simplemsg payloads, access tokens, or private runtime logs in smoke evidence.

## Placeholders

Replace these placeholders throughout the runbook:

```bash
SELLER_BOT="alice"
BUYER_BOT="bob"
LISTING_PIN_ID="<product-listing-pin-id>"
PRODUCT_ORDER_PIN_ID="<product-order-pin-id>"
PAYMENT_TXID="<payment-txid>"
ORDER_TXID="<simplemsg-order-txid>"
DELIVERY_PIN_ID="<delivery-pin-id>"
```

## Mocked Local UI Smoke

Run the mocked UI smoke when changing page layout, client-side behavior, or
route wiring. Use deterministic fixtures that include:

- two Bot profiles for seller and buyer selection
- one online virtual product with `productType: "virtual"`
- one offline or unsupported product that must not be purchasable
- seller fulfillment skills that include `S1`
- one owned listing
- one buyer order and one seller order
- one order inspection response with payment, order, fulfillment, and delivery
  summary fields

Open the mocked Products UI with the test harness, or run the local UI command
against the mocked daemon:

```bash
metabot ui open --page products --from "$BUYER_BOT"
```

Pass criteria:

- the returned URL points at `/ui/products` and preserves the selected actor
  when `--from` is supplied
- the Marketplace, Sell, and Orders views render without JavaScript errors
- marketplace loading requests online products, not cached offline products
- unsupported physical or logistics-backed products cannot be purchased
- purchase preview posts `confirmed: false` to `/api/products/buy`
- purchase confirmation posts `confirmed: true` only after an explicit human
  confirmation action
- publish review shows the final JSON payload before posting to
  `/api/products/publish`
- owned listings and order inspection use the Product Commerce daemon routes
- order details show delivery summaries without exposing raw decrypted private
  delivery bodies
- browser requests do not call refund, product-review, physical logistics,
  wallet transfer, or unrelated chain write endpoints

## Real Local Daemon Smoke

Build the repo and start the daemon with local Product Commerce routes enabled.
Use profiles and local state that are safe for smoke testing.

Open the Products UI for the buyer:

```bash
metabot ui open --page products --from "$BUYER_BOT"
```

Open the Products UI for the seller:

```bash
metabot ui open --page products --from "$SELLER_BOT"
```

Pass criteria:

- profile selection reflects the `--from` actor and can switch between buyer
  and seller profiles
- Marketplace loads online virtual products through `/api/network/products`
- product cards show title, seller, SKU, price, fulfillment type, and online
  purchase eligibility
- the buyer can preview a purchase without moving funds or publishing a
  product-order
- confirmed purchase controls remain gated by explicit confirmation and the
  existing `/api/products/buy` envelope
- the seller can load fulfillment skills, review a virtual product payload, and
  publish only after explicit confirmation
- the Sell view can load seller-owned listings
- the Orders view can list buyer and seller orders and inspect an order by the
  best available selector
- warnings and command-envelope failures are visible instead of being silently
  ignored
- UI copy stays within V1 virtual-goods scope and does not introduce refunds,
  physical shipping, product-review, or raw private delivery inspection

## Optional Real Chain Smoke

Run this section only after CLI acceptance data exists from
`docs/acceptance/product-commerce-v1-cli-smoke.md` and the controller has
approved any real wallet transfers or on-chain writes.

Use the existing acceptance data:

```bash
LISTING_PIN_ID="<product-listing-pin-id>"
PRODUCT_ORDER_PIN_ID="<product-order-pin-id>"
PAYMENT_TXID="<payment-txid>"
ORDER_TXID="<simplemsg-order-txid>"
DELIVERY_PIN_ID="<delivery-pin-id>"
```

Open the Products UI for the buyer and seller:

```bash
metabot ui open --page products --from "$BUYER_BOT"
metabot ui open --page products --from "$SELLER_BOT"
```

Pass criteria:

- the CLI-created listing is visible in the appropriate marketplace or owned
  listing view while the seller is online
- the CLI-created order appears in buyer and seller order lists
- order inspection shows the recorded listing pin id, product-order pin id,
  payment txid, order txid, and delivery summary
- the UI does not require buyer phone, email, shipping address, review policy,
  refund policy, seller payment address, timestamp, or MRC20 fields
- the UI does not expose raw decrypted simplemsg delivery content as a debug
  blob
- any additional confirmed purchase or publish action is separately approved
  before it can move funds or write to chain

## Evidence To Record

Record these non-secret fields after the smoke:

- date, operator, branch, and commit SHA
- build command and result
- daemon command or mocked test harness command
- UI URL returned by `metabot ui open --page products`
- seller Bot slug and buyer Bot slug
- listing pin id, when available
- product-order pin id, when available
- payment txid and order txid, when available
- delivery pin id or delivery summary evidence, when available
- marketplace query used and number of online products shown
- publish preview result and whether publish was confirmed
- purchase preview result and whether purchase was confirmed
- order list and order inspection selectors used
- representative screenshots or browser trace references for Marketplace, Sell,
  and Orders views
- confirmation that browser-side product-review, refund, physical logistics,
  wallet transfer outside `/api/products/buy`, and raw private delivery views
  did not occur
- warnings or failures observed and their exact command-envelope code/message
