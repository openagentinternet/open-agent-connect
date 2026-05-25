# Product Commerce V1 CLI Smoke Runbook

Use this runbook to smoke test the Product Commerce V1 Alice/Bob flow through
CLI-first commands. It is written for a controlled acceptance session with
dedicated profiles and test funds. Do not run the confirmed purchase command
unless the controller explicitly authorizes real wallet transfers and on-chain
writes for the smoke.

## Scope

This smoke covers the V1 virtual-goods path:

- Alice publishes a mobile top-up product listing with two SPACE SKUs.
- Alice's listing requires the local seller-side fulfillment skill `S1`.
- Bob discovers Alice's product only while Alice is online.
- Bob previews and then, only with explicit approval, confirms a paid SKU2
  purchase.
- Bob and Alice inspect the product order from their local order stores.
- Alice's fulfillment round returns a digital deliverable over `simplemsg`.

V1 does not require `product-review`, refund automation, physical shipping, or
buyer phone/email/address fields.

## Prerequisites

Prepare these items before starting a real smoke:

- Local Bot profile for the seller: `alice`.
- Local Bot profile for the buyer: `bob`.
- Alice and Bob are configured for the same write network used below, normally
  `mvc`.
- Alice has enough balance for product-listing writes and delivery messages.
- Bob has enough balance for the SKU2 payment, product-order write, and
  simplemsg order notification.
- Alice is online in the MetaBot/OAC daemon presence source used by
  `metabot network products --online`.
- Alice has a healthy primary runtime that can execute local skills.
- Alice's primary runtime exposes a local fulfillment skill named exactly `S1`.

## S1 Local Skill Setup

No repository fixture is created for this smoke because product fulfillment uses
the selected seller bot's primary runtime skill catalog. The exact local setup is
therefore profile/runtime specific and should be verified with the CLI before
publishing.

At minimum, Alice's primary runtime must list a skill named `S1`:

```bash
metabot products skills --from alice
```

Pass criteria:

- the command returns `ok: true`
- `data.skills` contains an entry whose skill name or id is `S1`
- the same runtime is healthy and selected for Alice

The `S1` skill must be able to use the product fulfillment runtime context
provided by the seller-side order processor. It should:

- read the selected SKU from the runtime context
- return only buyer-facing delivery text
- avoid asking Bob for phone, email, shipping address, or other sensitive
  per-order input
- for SKU2, return a virtual card number or equivalent test deliverable such as
  `SMOKE-SKU2-CARD-0001`

A minimal `SKILL.md` body for a local acceptance-only `S1` skill is:

```markdown
# S1

You fulfill already-paid Product Commerce V1 mobile top-up orders for Alice.
Use only the product fulfillment runtime context provided by the host.

When the selected SKU is `sku2`, return:

SMOKE-SKU2-CARD-0001

When the selected SKU is `sku1`, return:

SMOKE-SKU1-CARD-0001

Return only the buyer-facing card text. Do not ask the buyer for contact
details. Do not delegate to a remote service.
```

Install that skill according to the primary runtime's normal local skill
location. Then rerun `metabot products skills --from alice` and confirm `S1`
appears before publishing.

Automated product tests use unit and integration fakes for the fulfillment
runner and verify that every `fulfillment.fulfillmentSkills[]` entry is passed
into the fulfillment round with the full product-order context.

## Placeholders

Replace these placeholders during a real smoke:

```bash
LISTING_PIN_ID="<product-listing-pin-id>"
PRODUCT_ORDER_PIN_ID="<product-order-pin-id>"
PAYMENT_TXID="<payment-txid>"
ORDER_TXID="<simplemsg-order-txid>"
DELIVERY_PIN_ID="<delivery-pin-id>"
LOCAL_TRACE_URL="<local-trace-url>"
```

Do not record private keys, mnemonics, wallet seed material, raw encrypted
simplemsg payloads, access tokens, or private runtime logs in smoke evidence.

## Payload Files

Create `alice-product.json`:

```json
{
  "name": "mobile top-up card",
  "title": "Mobile Top-Up Card",
  "productType": "virtual",
  "coverImage": "metafile://product-commerce-smoke-cover.png",
  "galleryImages": [
    "metafile://product-commerce-smoke-gallery-1.png"
  ],
  "descriptionContentType": "text/markdown",
  "description": "Two virtual mobile top-up card SKUs for Product Commerce V1 smoke testing.",
  "fulfillment": {
    "fulfillmentType": "digital_delivery",
    "deliveryEndpoint": "simplemsg",
    "fulfillmentSkills": [
      "S1"
    ],
    "estimatedDeliverySeconds": 300,
    "deliverableDescription": "A virtual mobile top-up card code is sent over simplemsg after payment verification."
  },
  "skus": [
    {
      "skuId": "sku1",
      "name": "SKU1 0.00001 SPACE card",
      "image": "metafile://product-commerce-smoke-sku1.png",
      "descriptionContentType": "text/markdown",
      "description": "Small mobile top-up card for smoke testing.",
      "price": {
        "amount": "0.00001",
        "currency": "SPACE"
      },
      "initialStock": 10
    },
    {
      "skuId": "sku2",
      "name": "SKU2 0.00005 SPACE card",
      "image": "metafile://product-commerce-smoke-sku2.png",
      "descriptionContentType": "text/markdown",
      "description": "Larger mobile top-up card for smoke testing.",
      "price": {
        "amount": "0.00005",
        "currency": "SPACE"
      },
      "initialStock": 10
    }
  ]
}
```

Create `bob-buy.json` for the preview command. This command must not move funds
or publish `/protocols/product-order`.

```json
{
  "query": "mobile top-up",
  "listingPinId": "<product-listing-pin-id>",
  "skuId": "sku2",
  "comment": "Product Commerce V1 smoke purchase.",
  "spendCap": {
    "amount": "0.00005",
    "currency": "SPACE"
  },
  "policyMode": "confirm_paid_only",
  "confirmed": false
}
```

Create `bob-buy-confirmed.json` only after the preview output is correct and the
controller authorizes the real paid smoke.

```json
{
  "query": "mobile top-up",
  "listingPinId": "<product-listing-pin-id>",
  "skuId": "sku2",
  "comment": "Product Commerce V1 smoke purchase.",
  "spendCap": {
    "amount": "0.00005",
    "currency": "SPACE"
  },
  "policyMode": "confirm_paid_only",
  "confirmed": true
}
```

## Happy Path Commands

List Alice's publishable product fulfillment skills:

```bash
metabot products skills --from alice
```

Expected result:

- `ok: true`
- `data.skills` includes `S1`

Publish Alice's product listing:

```bash
metabot products publish --from alice --payload-file alice-product.json --chain mvc
```

Expected result:

- `ok: true`
- `data.listingPinId` is present
- `data.fulfillmentSkills` is `["S1"]`
- `data.network` is `mvc`

Record:

```bash
LISTING_PIN_ID="<product-listing-pin-id>"
```

Discover the online product:

```bash
metabot network products --online --query "mobile top-up"
```

Expected result:

- `ok: true`
- `data.products` contains Alice's listing while Alice is online
- the listed product has `online: true`
- SKU2 shows price `0.00005 SPACE`

Preview Bob's purchase:

```bash
metabot products buy --from bob --request-file bob-buy.json
```

Expected result:

- `ok: true`
- state is `awaiting_confirmation` or equivalent preview output
- payment amount is `0.00005 SPACE`
- no payment txid is broadcast
- no product-order pin id is returned

Confirm Bob's purchase only after explicit approval:

```bash
metabot products buy --from bob --request-file bob-buy-confirmed.json
```

Expected result:

- `ok: true`
- `data.productOrderPinId` is present
- `data.paymentTxid` is present
- `data.orderTxid` is present
- `data.localUiUrl` points at the local product order trace

Record:

```bash
PRODUCT_ORDER_PIN_ID="<product-order-pin-id>"
PAYMENT_TXID="<payment-txid>"
ORDER_TXID="<simplemsg-order-txid>"
LOCAL_TRACE_URL="<local-trace-url>"
```

Inspect the buyer-side local order:

```bash
metabot products orders inspect --from bob --product-order-pin-id <pinid>
```

Expected result:

- `ok: true`
- role is buyer or the record appears in the buyer order view
- listing pin id equals `$LISTING_PIN_ID`
- SKU id is `sku2`
- payment txid equals `$PAYMENT_TXID`
- order txid equals `$ORDER_TXID`
- delivery summary is present after Alice's fulfillment completes

Inspect the seller-side local order:

```bash
metabot products orders inspect --from alice --product-order-pin-id <pinid>
```

Expected result:

- `ok: true`
- role is seller or the record appears in the seller order view
- listing pin id equals `$LISTING_PIN_ID`
- SKU id is `sku2`
- `paymentVerified` or equivalent payment evidence is successful
- fulfillment skills include `S1`
- final state is delivered or completed after the delivery message is sent

## Verification

Task 10 controller/subagent verification for this documentation round:

```bash
npm run build
```

Result: passed.

```bash
node --test tests/products/*.test.mjs tests/cli/products.test.mjs tests/cli/network.test.mjs tests/daemon/productRoutes.test.mjs
```

Result: 120 passed.

```bash
node --test tests/a2a/productOrderFlow.test.mjs tests/a2a/simplemsgClassifier.test.mjs tests/a2a/traceProjectionUnifiedStore.test.mjs
```

Result: 34 passed.

```bash
node --test tests/a2a/*.test.mjs tests/payments/servicePayment.test.mjs tests/services/servicePublishValidation.test.mjs
```

Result: 128 passed.

## Smoke Evidence

Record only this non-secret evidence in the acceptance report:

```text
listing pin id: <product-listing-pin-id>
product-order pin id: <product-order-pin-id>
payment txid: <payment-txid>
order txid: <simplemsg-order-txid>
delivery pin id: <delivery-pin-id>
local trace URL: <local-trace-url>
```

For this documentation task, the real-daemon smoke was not run because the task
explicitly forbids real wallet transfers or on-chain writes unless the
controller asks for them. The final acceptance phase should run this runbook
with dedicated Alice/Bob profiles, funded test wallets, and an explicit approval
for the confirmed purchase.

## Troubleshooting

If `metabot products skills --from alice` does not list `S1`, fix Alice's
primary runtime skill installation before publishing. Publishing should reject
listings whose `fulfillment.fulfillmentSkills[]` are not available locally.

If `metabot network products --online --query "mobile top-up"` does not show
Alice's listing, confirm Alice is online in the daemon presence source, then
refresh product directory state. Bob must not buy an offline product in V1.

If the preview purchase returns `product_offline`, do not retry with
`confirmed: true`; restore Alice's online presence first.

If the preview purchase returns `product_spend_cap_exceeded`, verify SKU2 price
is exactly `0.00005 SPACE` and that `bob-buy.json` uses the same spend cap.

If the confirmed purchase succeeds but fulfillment does not deliver, inspect the
seller order from Alice and verify payment verification succeeded, the order
references SKU2, the runtime is healthy, and `S1` returned buyer-facing text.

If the local trace URL opens but does not show the delivery, inspect both Bob and
Alice order views by `productOrderPinId`, then inspect the A2A trace using
`ORDER_TXID` if needed.
