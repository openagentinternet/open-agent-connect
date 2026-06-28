# Product Commerce V1 Business Flow

Date: 2026-05-25
Status: Business flow draft for CLI design

## Context

Product commerce V1 should prove one real virtual-goods purchase flow end to end before expanding into physical goods, refund handling, or a dedicated on-chain review system.

The implementation should reuse the existing `skill-service` order infrastructure wherever the semantics match:

- `/protocols/simplemsg` remains the encrypted A2A transport.
- Buyer and seller order state should be projected into the existing A2A/session style of local cache.
- Follow-up simplemsg protocol tags should stay compatible with the existing `[ORDER]`, `[ORDER_STATUS:<orderTxid>]`, `[DELIVERY:<orderTxid>]`, `[NeedsRating:<orderTxid>]`, and `[ORDER_END:<orderTxid> ...]` model when possible.
- Seller-side payment verification should reuse the existing native payment verification path instead of inventing a product-specific payment verifier.

The product-specific chain facts are defined in `docs/metaid_protocols/06-product.md`:

- `/protocols/product-listing` publishes a product with SKUs and fulfillment policy.
- `/protocols/product-order` records the completed purchase fact after payment.

## V1 Goal

V1 must support this acceptance scenario:

1. Bot Alice owns a virtual product named "mobile top-up card".
2. Alice publishes one `product-listing` with two SKUs:
   - SKU1 costs `0.00001 SPACE`.
   - SKU2 costs `0.00005 SPACE`.
3. The listing has `productType: "virtual"`, `fulfillment.fulfillmentType: "digital_delivery"`, `fulfillment.deliveryEndpoint: "simplemsg"`, and `fulfillment.fulfillmentSkills: ["S1"]`.
4. Skill `S1` is a local seller-side fulfillment skill. It runs Alice's own business logic and returns the virtual deliverable, such as the matching top-up card number.
5. Bot Bob can discover Alice's product only while Alice is online.
6. Bob buys SKU2, pays `0.00005 SPACE` to Alice's seller address, publishes `product-order`, and sends the order reference to Alice over simplemsg.
7. Alice verifies the order and payment, starts the fulfillment round with all listing `fulfillmentSkills`, receives the S1 result, and sends the result back to Bob over simplemsg.
8. Bob receives the card number in the same A2A/order trace. Virtual goods may then use the existing `NeedsRating` simplemsg prompt to close the experience, but no on-chain `product-review` is required for V1.

## Non-Goals

- Do not implement physical logistics.
- Do not implement `product-review` yet.
- Do not implement refunds yet.
- Do not add buyer phone, email, address, or per-order sensitive input to the normal virtual-goods purchase flow.
- Do not add seller identity, seller payment address, timestamps, payment chain, or review policy fields to `product-listing` or `product-order`.
- Do not create a separate encrypted transport. `simplemsg` already provides the private A2A channel.

## Protocol Roles

### product-listing

`product-listing` is the public, discoverable product catalog record.

The seller is the pin creator or owner. The protocol payload does not repeat `sellerName`, `sellerMetaBot`, or payment address fields. Payment address is derived from the seller bot identity and the currency chain used by the SKU.

For V1, virtual listings should use:

```json5
{
  "productType": "virtual",
  "fulfillment": {
    "fulfillmentType": "digital_delivery",
    "deliveryEndpoint": "simplemsg",
    "fulfillmentSkills": ["S1"]
  }
}
```

`fulfillmentSkills` is the full required skill set for the seller-side fulfillment round. The runtime must not reduce the array to a single selected skill. If the listing contains multiple skill names, all of them are made available to the same fulfillment conversation, following the existing skill-service execution approach for skill-enabled provider rounds.

### product-order

`product-order` is the buyer's immutable on-chain purchase fact after payment:

```json5
{
  "listingPinId": "<product-listing-pinid>",
  "skuId": "sku2",
  "settlementKind": "native",
  "paymentTxid": "<payment-txid>",
  "comment": "optional buyer note"
}
```

It does not repeat listing price, currency, payment chain, seller address, buyer identity, seller identity, fulfillment state, or review state. Readers resolve those values from the referenced listing, the pin owner, local runtime state, and chain payment evidence.

## Discovery Flow

Online product discovery should mirror online skill-service discovery:

1. Read local cached product listings first.
2. Refresh chain-backed `/protocols/product-listing` records when the cache is stale or explicitly refreshed.
3. Derive seller identity from each listing pin owner or creator.
4. Decorate each listing with socket presence using the same online MetaBot presence source used by `network services --online`.
5. When `onlineOnly` is true, return only products whose seller bot is currently online.
6. Buyer-side purchase commands and UI must reject offline products instead of allowing a best-effort purchase.

The online catalog may display seller name, avatar, and online status from the directory and pin metadata, but these are presentation fields, not protocol payload fields.

## Buyer Flow

Bob's local OAC should handle a natural request such as "buy Alice's 0.00005 SPACE mobile top-up card" as follows:

1. Search the cached online product list, similar to how skill-service matching searches online services.
2. Match the best `product-listing` and SKU.
3. If no suitable online product exists, return a clear no-match result. Do not ask the buyer for phone, email, shipping address, or sensitive per-order input for the normal virtual flow.
4. Show a confirmation preview containing product title, SKU name, price, currency, seller display info, and fulfillment type.
5. On confirmation, call the local wallet payment path. For the V1 acceptance scenario this is native SPACE payment to Alice's MVC payment address derived from Alice's bot identity.
6. After payment succeeds, publish `/protocols/product-order`.
7. Send a simplemsg order notification to Alice containing the product-order pin id and enough scoped order text for the existing A2A order machinery to track the order.
8. Persist buyer-side local order state and the outbound simplemsg message txid. The simplemsg txid is the `orderTxid` used to scope follow-up `[DELIVERY:<orderTxid>]`, `[NeedsRating:<orderTxid>]`, and `[ORDER_END:<orderTxid> ...]` messages.

Buyer-side local reads should be cache-first. The UI or CLI should read the local order/session cache before fetching chain records again.

## Seller Flow

Alice's local OAC should process inbound product orders through the same shape as skill-service provider order processing:

1. The simplemsg listener receives an order notification.
2. The listener classifies it as a product order, extracts the `product-order` pin id, and resolves or creates the local seller order session.
3. The seller reads `product-order` from local cache first. On cache miss, it fetches the chain pin, validates the protocol path, and persists it locally.
4. The seller resolves `listingPinId` and `skuId` against the referenced `product-listing`, again cache-first with chain fallback.
5. The seller verifies that the referenced listing belongs to the local seller bot.
6. The seller verifies `paymentTxid` against the seller payment address and the SKU price from the listing. This should reuse the existing native payment verification path used by skill-service.
7. The seller starts a fulfillment conversation or execution round. The context for that round contains:
   - the full `product-order` payload and pin metadata;
   - the resolved `product-listing` payload and pin metadata;
   - the selected SKU;
   - buyer identity and order A2A metadata;
   - payment verification evidence;
   - the full `fulfillment.fulfillmentSkills` array.
8. The fulfillment round receives the order context as conversation/runtime context, not as a raw function argument passed directly into one skill. The runtime makes every listed fulfillment skill available for that round.
9. The seller sends `[ORDER_STATUS:<orderTxid>]` messages for accepted, running, or failure states when useful.
10. On success, the seller sends `[DELIVERY:<orderTxid>]` with the virtual deliverable result.
11. For virtual goods, the seller may send `[NeedsRating:<orderTxid>]` after delivery. Physical goods should not require seller-initiated `NeedsRating` in V1.

## Delivery Shape

V1 does not need a chain `product-delivery` protocol. Delivery is an encrypted simplemsg event stored in local A2A state.

The delivery payload should be product-specific while staying compatible with the existing delivery parser style:

```json5
{
  "productOrderPinId": "<product-order-pinid>",
  "listingPinId": "<product-listing-pinid>",
  "skuId": "sku2",
  "paymentTxid": "<payment-txid>",
  "result": "Top-up card: XXXX-XXXX-XXXX",
  "deliveredAt": 1770000000000
}
```

The trace UI and CLI should render `result` as the seller's fulfillment output. If the result contains `metafile://` URIs, existing A2A media rendering rules should apply.

## Rating And Closure

`product-review` is deferred. V1 purchase completion must not depend on publishing an on-chain product review.

For virtual goods only, the seller may reuse the existing `NeedsRating` simplemsg prompt after delivery. Buyer-side OAC can answer with `[ORDER_END:<orderTxid> rated]` to close the A2A session. Until `product-review` exists, this is a private-session closure signal rather than an on-chain product rating.

## Local State And Caching

The implementation should follow the existing A2A and service-order storage direction:

- Product listing cache: chain-derived listings plus seller identity and online decoration.
- Buyer product order cache: product-order pin id, listing pin id, SKU id, payment txid, order simplemsg txid, seller identity, state, and delivery summary.
- Seller product order cache: inbound product-order pin id, buyer identity, payment verification result, selected SKU, fulfillment state, delivery pin id, and failure reason when applicable.
- A2A transcript cache: all simplemsg order, status, delivery, NeedsRating, and ORDER_END messages in the per-peer conversation/session projection.

Every chain object read should be cache-first, chain fallback on miss, then local persistence.

## Failure Handling

- If the product is offline at purchase time, fail before payment.
- If the SKU no longer exists in the latest listing, fail before payment when detected by the buyer, or reject on seller verification if the buyer had stale cache.
- If payment fails, do not publish `product-order`.
- If seller payment verification fails, the seller should reject the order and send an order status failure. Refund automation is out of scope for V1.
- If the fulfillment skill round fails, the seller should send a failure status and mark the seller-side order failed locally. Refund automation is still out of scope.
- `initialStock` is a listing declaration, not a chain-level reservation protocol. For V1, real stock enforcement should live in seller-side fulfillment/business logic such as S1.

## CLI-First Implications

The next CLI design should cover these command groups:

- Product listing publish and local validation.
- Online product discovery with `--online`, `--cached`, `--query`, and pagination behavior aligned with `network services`.
- Product purchase by listing pin id or query match, with confirmation preview and wallet payment.
- Buyer order inspection and trace opening.
- Seller order inspection and fulfillment state inspection.

The UI and companion skills should be frontends over these CLI surfaces, not separate business implementations.

## V1 Acceptance Gates

1. Alice can publish the mobile top-up product listing with SKU1, SKU2, and `fulfillmentSkills: ["S1"]`.
2. Product discovery shows Alice's listing only while Alice is online.
3. Bob cannot purchase Alice's listing while Alice is offline.
4. Bob can purchase SKU2 while Alice is online and pays exactly `0.00005 SPACE`.
5. Bob publishes a valid `product-order` and sends the order reference to Alice through simplemsg.
6. Alice resolves and caches the product order and listing, verifies payment, and starts the fulfillment round with all configured fulfillment skills.
7. S1 returns the SKU2 virtual deliverable, and Alice sends it back through `[DELIVERY:<orderTxid>]`.
8. Bob's local trace/order view shows the delivered card number.
9. Optional virtual-goods `NeedsRating` and `[ORDER_END:<orderTxid> rated]` close the A2A session without requiring `product-review`.
