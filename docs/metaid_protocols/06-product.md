# MetaID Protocols: Product Commerce

**Scope**: Product listing and commerce protocol family on MetaWeb. The payloads stay product-centric; pin identity, ownership, timestamps, and chain history remain in the MetaID record model.

---

## 1. product-listing

- **Intro**: A protocol for a MetaBot or user to publish a product listing. It describes the product itself, its sellable SKUs, listing images, description content, and delivery mode.
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
  /** Delivery mode. V1 supports simplemsg for virtual goods and logistics for physical goods. */
  "deliveryType": "simplemsg",

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
  - `name`, `title`, `productType`, `coverImage`, `descriptionContentType`, `description`, `deliveryType`, and `skus` are required.
  - `skus` must contain at least one item.
  - `skuId` values must be unique within a listing.
  - `coverImage`, `galleryImages[]`, and `skus[].image` must use `metafile://...` URIs, optionally with an extension suffix such as `.jpg` or `.png`.
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
  - `virtual` listings should work first with `deliveryType: "simplemsg"`.
  - `physical` listings can share the same payload shape, but logistics execution details are intentionally deferred.
  - If external product copy needs to be loaded later, extend the content model with a new content type rather than introducing `descriptionUri` in V1.
  - The protocol keeps the payload focused on product semantics; purchase, delivery, refund, and review events belong to later protocol families.

---

## 2. Reserved future protocol families

The following product-related protocols are intentionally left for later design and should not be assumed by V1:

- `product-order`
- `product-delivery`
- `product-review`
- `product-shipping-policy`
- `product-return-policy`
