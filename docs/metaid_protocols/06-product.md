# MetaID Protocols: Product Commerce

**Scope**: Product listing, order, and commerce protocol family on MetaWeb. The payloads stay product-centric; pin identity, ownership, timestamps, and chain history remain in the MetaID record model.

---

## 1. product-listing

- **Intro**: A protocol for a MetaBot or user to publish a product listing. It describes the product itself, its sellable SKUs, listing images, description content, and fulfillment policy.
- **Path**: `/protocols/product-listing`
- **Version**: `1.0.0`
- **Content-Type**: `application/json`
- **Payload Schema**:

```json5
{
  /** Canonical product family name. */
  "name": "电话充值卡",
  /** Sales-facing title shown in catalogs and UI. */
  "title": "AI Wallpaper Pack",
  /** Product kind. V1 supports virtual and physical. */
  "productType": "virtual",

  /** Primary listing cover image. */
  "coverImage": "metafile://cover_pinid.jpg",
  /** Optional additional listing images. */
  "galleryImages": [
    "metafile://pinid_1.png",
    "metafile://pinid_2.png"
  ],

  /** Description content type. V1 should start with text/markdown and text/html. */
  "descriptionContentType": "text/markdown",
  /** Inline description content. */
  "description": "## What's included\n\n...",
  /** Fulfillment policy for seller-side order processing. */
  "fulfillment": {
    /** Fulfillment mode. V1 supports digital_delivery and physical_shipping. */
    "fulfillmentType": "digital_delivery",
    /** Seller-side intake channel for product-order messages. V1 supports simplemsg and logistics. */
    "deliveryEndpoint": "simplemsg",
    /** Ordered seller-side skills made available to the fulfillment round. */
    "fulfillmentSkills": [
      "product-order-fulfill",
      "product-order-package"
    ],
    /** Estimated delivery time in seconds. */
    "estimatedDeliverySeconds": 300,
    /** Buyer-facing description of what will be delivered after payment verification. */
    "deliverableDescription": "A ZIP file or metafile link will be sent after payment verification."
  },

  /** Sellable product variants. */
  "skus": [
    {
      /** Stable SKU key within this listing. */
      "skuId": "standard-pack",
      /** SKU display name. */
      "name": "Standard Pack",
      /** SKU image URI. */
      "image": "metafile://sku_pinid.png",
      /** SKU description content type. */
      "descriptionContentType": "text/markdown",
      /** Inline SKU description. */
      "description": "...",
      /** Price amount as a decimal string. */
      "price": {
        "amount": "0.001",
        "currency": "SPACE"
      },
      /** Finite initial stock at publish time. */
      "initialStock": 100
    }
  ]
}
```

- **State notes**: A product listing is identified by the pin that published it. Later updates should publish new pins, and the latest visible chain record defines the current listing state, consistent with other MetaID listing-style protocols.

- **Validation notes**:
  - `name`, `title`, `productType`, `coverImage`, `descriptionContentType`, `description`, `fulfillment`, and `skus` are required.
  - `skus` must contain at least one item.
  - `skuId` values must be unique within a listing.
  - `coverImage`, `galleryImages[]`, and `skus[].image` must use `metafile://...` URIs, optionally with an extension suffix such as `.jpg` or `.png`.
  - `fulfillment.fulfillmentSkills` must contain at least one local skill name from the seller's active runtime.
  - `initialStock` must be a positive integer.
  - Sellers may use a large finite value such as `99999999` when they want practical headroom.

- **Explicit exclusions**:
  - seller identity fields such as `sellerMetaBot` or `sellerName`;
  - seller payment routing fields such as `sellerPaymentAddress`, `paymentChain`, or `settlementKind`;
  - MRC20 fields;
  - `descriptionUri`;
  - image `mimeType` or `alt` fields;
  - shipping policy;
  - review policy;
  - timestamps such as `createdAt` or `updatedAt`.

- **Compatibility notes**:
  - `virtual` listings should work first with `fulfillment.fulfillmentType: "digital_delivery"` and `fulfillment.deliveryEndpoint: "simplemsg"`.
  - `physical` listings can share the same payload shape, but logistics execution details are intentionally deferred.
  - `fulfillmentSkills` is an ordered list of local skill names used by the seller-side fulfillment round. The runtime must make every listed skill available to that fulfillment conversation and must not silently select only the first item.
  - If external product copy needs to be loaded later, extend the content model with a new content type rather than introducing `descriptionUri` in V1.
  - The protocol keeps the payload focused on product semantics; purchase, delivery, refund, and review events belong to later protocol families.
  - `simplemsg` is the existing ECDH/AES private-chat transport used by OAC and skill-service. V1 does not add a second encryption layer or a separate "encrypted simplemsg" concept.
  - Buyer-side payment confirmation remains the existing wallet/service-payment responsibility. `product-listing` does not define a second buyer-side txid validation step.
  - Seller-side order lookup should be cache-first: read the local order cache by order pin id or order txid first, fall back to chain pin fetch only on cache miss, and then persist the fetched order locally for later reads.
  - Virtual-product purchase flows should not request phone, email, shipping address, or similar personal fields during the normal path. If extra non-sensitive options are needed, model them as SKU selection or a future protocol family instead of ad hoc per-order input.

---

## 2. product-order

- **Intro**: A protocol for a buyer MetaBot or user to record one completed product purchase against a referenced listing and SKU. It is the minimal on-chain purchase fact; seller-side fulfillment, delivery, and review happen elsewhere.
- **Path**: `/protocols/product-order`
- **Version**: `1.0.0`
- **Content-Type**: `application/json`
- **Payload Schema**:

```json5
{
  /** PINID of the product-listing being purchased. */
  "listingPinId": "xxxxxxxx...i0",
  /** SKU key within the referenced product-listing. */
  "skuId": "standard-pack",
  /** Optional settlement kind. V1 paid orders use native. */
  "settlementKind": "native",
  /** Payment txid for the completed purchase. */
  "paymentTxid": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  /** Optional buyer note attached to the order. */
  "comment": "Please send the license to the default account."
}
```

- **State notes**: A product order is identified by the pin that published it. The payload is an immutable purchase snapshot, so corrections should be published as a new pin rather than mutating the old one.

- **Validation notes**:
  - `listingPinId`, `skuId`, and `paymentTxid` are required for the normal paid purchase flow.
  - `paymentTxid` must be a non-empty chain txid string.
  - `settlementKind` is optional and defaults to `native`.
  - `comment` is optional plain text.

- **Explicit exclusions**:
  - listing price, currency, payment chain, payment address, or other payment snapshot fields;
  - seller identity fields;
  - buyer identity fields such as phone, email, shipping address, or contact details;
  - delivery status, fulfillment status, review status, or refund status;
  - `orderReference`;
  - `NeedsRating`-style rating triggers.

- **Compatibility notes**:
  - The seller resolves `listingPinId` and `skuId` against the referenced `product-listing`, then verifies `paymentTxid` against the seller payment address and the SKU price stored in that listing.
  - The seller should cache the fetched order locally by order pin id, and only fall back to chain pin fetch on cache miss.
  - `simplemsg` remains the transport used to hand the order pin id to the seller, but the order payload itself stays on chain.
  - Post-delivery review is asynchronous and belongs to `product-review`, which carries the score.
  - Virtual goods may still use the existing `NeedsRating` simplemsg prompt after delivery; physical goods should not require a seller-initiated `NeedsRating` step in v1.

---

## 3. Reserved future protocol families

The following product-related protocols are intentionally left for later design and should not be assumed by V1:

- `product-review`
- `product-shipping-policy`
- `product-return-policy`
