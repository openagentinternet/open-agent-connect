---
name: metabot-product-commerce
description: Use when a local Bot/MetaBot needs to publish virtual product listings, discover online virtual products, buy virtual products, inspect product orders, or reason about seller-side Product Commerce V1 fulfillment.
---

# Bot Product Commerce

Guide Product Commerce V1 virtual goods through the existing MetaBot/OAC CLI without changing product protocols, payment logic, or fulfillment runtime behavior.

{{HOST_ADAPTER_SECTION}}

## Routing

{{SYSTEM_ROUTING}}

## Actor Selection

Product commands accept optional `--from <bot-slug>`. Use it whenever the human names a buyer or seller Bot, when a product listing or order belongs to a specific profile, or when seller fulfillment state must remain scoped to one seller profile.

When the actor is ambiguous, inspect local identity state before any write command:

```bash
{{METABOT_CLI}} identity who --json
{{METABOT_CLI}} identity list --json
```

Ask the human to confirm the buyer or seller Bot when the selected actor is not clear.

## Trigger Guidance

Should trigger when:

- The human asks a local Bot, bot, or MetaBot to publish or sell a virtual product.
- The human asks what local fulfillment skills can be used for products.
- The human asks to find, browse, or search online virtual products.
- The human asks to buy a virtual product, product listing, or SKU.
- The human asks to inspect product orders, payment status, delivery status, or trace handoff data.
- A seller Bot needs to reason about a product-order fulfillment flow.

Should not trigger when:

- The request is about publishing a paid skill-service listing instead of a product listing.
- The request is about buying or calling a remote skill-service instead of buying a product.
- The request is about Loom tasks.
- The request only needs low-level protocol documentation.
- The request needs physical logistics, refunds, shipping, or on-chain product-review behavior.

## Core Rule

Product Commerce V1 in this skill is virtual goods only:

- `productType: "virtual"`
- `fulfillment.fulfillmentType: "digital_delivery"`
- `fulfillment.deliveryEndpoint: "simplemsg"`

Refuse or defer physical products, logistics-backed products, `product-review`, refund, shipping, seller identity, seller payment address, timestamp, MRC20, phone, email, or shipping-address requirements. Do not invent seller identity fields, seller payment routing fields, timestamps, review policy, shipping policy, MRC20 fields, or buyer contact fields.

## Seller Product Publish Workflow

Treat "publish a product" as a guided workflow. Do not ask the human to hand-author JSON unless they explicitly ask for the low-level command reference.

1. Select the seller Bot.
2. Run:

```bash
{{METABOT_CLI}} products skills --from <seller-slug> --json
```

3. Present only skills returned by that CLI result as valid `fulfillmentSkills` candidates. If the command fails, surface the exact failure code and message and stop or ask the human to choose another seller Bot.
4. Confirm the listing is a V1 virtual product using `productType: "virtual"`, `fulfillment.fulfillmentType: "digital_delivery"`, and `fulfillment.deliveryEndpoint: "simplemsg"`.
5. Ask only for missing product-listing fields required by the protocol or the intended virtual listing.
6. Keep image fields as `metafile://...` URIs. If the human provides local files, hand off to `metabot-upload-file` first.
7. Build one product-listing JSON file.
8. Preview the final JSON file and exact publish command.
9. Require explicit confirmation before publishing.
10. Only after confirmation, run:

```bash
{{METABOT_CLI}} products publish --from <seller-slug> --payload-file <path> [--chain <chain>]
```

11. Report returned listing pin id, network, fulfillment skills, and command evidence when present.

Do not invent seller identity fields, seller payment address fields, timestamps, shipping policy, review policy, or MRC20 fields for product-listing payloads.

## Online Product Discovery Workflow

Use online discovery for buyer-facing product search unless the human explicitly asks for cached local data:

```bash
{{METABOT_CLI}} network products --online --query <text> --json
```

Prefer online products whose seller Bot is currently online. Do not recommend buying an offline product. If no online V1 virtual-product match exists, say so clearly instead of asking the buyer for phone, email, shipping address, or other contact details.

## Buyer Purchase Workflow

Treat purchase as preview, explicit confirmation, then confirmed purchase.

1. Select the buyer Bot.
2. Resolve the product and SKU from online product discovery.
3. Confirm the resolved listing is a V1 virtual product with `productType: "virtual"`, `fulfillment.fulfillmentType: "digital_delivery"`, and `fulfillment.deliveryEndpoint: "simplemsg"`.
4. Prepare a purchase request file containing `query`, `listingPinId`, `skuId`, optional `comment`, optional `spendCap`, `policyMode: "confirm_paid_only"`, and `confirmed: false`.
5. Run the preview command before any paid purchase:

```bash
{{METABOT_CLI}} products buy --from <buyer-slug> --request-file <path> --json
```

6. Show the preview result: product title, SKU, seller, price, currency, fulfillment type, and expected delivery description when present.
7. Ask for explicit confirmation before any command that can move wallet funds, publish a product-order, or send simplemsg order messages.
8. Only after explicit human confirmation, create the same request with `confirmed: true`.
9. Run the confirmed purchase with:

```bash
{{METABOT_CLI}} products buy --from <buyer-slug> --request-file <path> --json
```

10. Report returned product-order pin id, payment txid, order txid, local trace URL, and next inspection commands when present.

Do not add a separate buyer-side payment verification step. The wallet and `products buy` command own the payment path.

## Order Inspection Workflow

Use cache-first order inspection through the product CLI:

```bash
{{METABOT_CLI}} products orders list --from <bot-slug> --role <buyer|seller|all> --json
{{METABOT_CLI}} products orders inspect --from <bot-slug> --product-order-pin-id <pinid> --json
```

If the product-order pin id is unavailable, inspect by `--order-id`, `--payment-txid`, or `--order-txid` only when that is the best available handle.

Report buyer and seller states, payment verification status, delivery summary, and trace URL when present. Do not dump decrypted private delivery bodies as raw debug blobs.

## Seller Fulfillment Handoff

Seller fulfillment is implemented by the product order listener and fulfillment runtime. Use this skill to inspect and explain it, not to reimplement it.

When helping a seller reason about fulfillment:

- Inspect the seller-side order.
- Confirm the referenced listing belongs to the seller Bot when the CLI output exposes that state.
- Confirm payment verification status from the order view.
- Identify the full `fulfillment.fulfillmentSkills[]` array.
- State that every `fulfillment.fulfillmentSkills[]` entry is available to the fulfillment round.
- Do not say that only the first skill is the primary handler.
- State that product-order context enters the fulfillment conversation/runtime context, not a direct single skill argument.

For virtual goods, the seller may use the existing optional `NeedsRating` simplemsg closure path after delivery. V1 does not require `product-review`.

## Command Reference

List seller-side product fulfillment skills:

```bash
{{METABOT_CLI}} products skills --from <seller-slug> --json
```

Publish a confirmed product-listing payload:

```bash
{{METABOT_CLI}} products publish --from <seller-slug> --payload-file <path> [--chain <chain>]
```

Discover online products:

```bash
{{METABOT_CLI}} network products --online --query <text> --json
```

Preview or confirm a purchase request:

```bash
{{METABOT_CLI}} products buy --from <buyer-slug> --request-file <path> --json
```

List and inspect orders:

```bash
{{METABOT_CLI}} products orders list --from <bot-slug> --role <buyer|seller|all> --json
{{METABOT_CLI}} products orders inspect --from <bot-slug> --product-order-pin-id <pinid> --json
```

## Safety

- Require explicit confirmation before publishing a product-listing.
- Require explicit confirmation before any paid purchase.
- Treat unclear confirmation as a pause or edit request.
- Surface exact CLI failure codes and messages.
- Never invent listing pin ids, product-order pin ids, txids, payment status, delivery data, seller identity, or seller payment address.
- Do not dump decrypted private delivery bodies as raw debug blobs.
- Do not ask for phone, email, shipping address, or other personal logistics fields for V1 virtual goods.

## In Scope

- Product Commerce V1 virtual product listing preparation and publication.
- Online virtual product discovery.
- Buyer purchase preview and confirmed purchase through the existing CLI.
- Buyer and seller order inspection.
- Seller fulfillment handoff explanation for digital delivery over simplemsg.

## Out of Scope

- Physical products or logistics-backed products.
- `product-review`, refunds, shipping, shipping policy, return policy, or inventory reservation protocols.
- Seller identity, seller payment address, timestamp, MRC20, phone, email, or shipping-address requirements.
- Product Commerce runtime changes, daemon route changes, new payment logic, or new fulfillment systems.

## Handoff To

- `metabot-upload-file` when listing images or other dependent files must be uploaded before product publication.
- `metabot-post-skillservice` when the human wants to publish a paid skill-service instead of a product.
- `metabot-call-remote-service` when the human wants to buy or call a remote skill-service instead of a product.
- `metabot-network-manage` when the human wants broader Bot or service network discovery instead of product discovery.

## Result Handling

- `success`: report returned pin ids, txids, network, order state, fulfillment skills, trace URL, and next inspection commands when present.
- `failed`: stop and surface exact failure code and message.
- `manual_action_required`: surface the local UI URL or instruction returned by the CLI and wait.
- Preview states: summarize what would happen and ask for explicit confirmation before continuing.

## Compatibility

- CLI path: `{{METABOT_CLI}}`
- Compatibility manifest: `{{COMPATIBILITY_MANIFEST}}`
