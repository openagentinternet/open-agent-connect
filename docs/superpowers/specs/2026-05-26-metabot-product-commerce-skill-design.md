# MetaBot Product Commerce Skill Design

Date: 2026-05-26
Status: Draft for implementation planning

## Context

Product Commerce V1 already has protocol, CLI, daemon, A2A, fulfillment, and smoke-test coverage:

- Protocol source: `docs/metaid_protocols/06-product.md`
- Business flow: `docs/superpowers/specs/2026-05-25-product-commerce-v1-business-flow.md`
- CLI implementation plan: `docs/superpowers/plans/2026-05-25-product-commerce-cli-implementation.md`
- CLI smoke runbook: `docs/acceptance/product-commerce-v1-cli-smoke.md`

The missing layer is a built-in shared skill that lets a host agent operate the product-commerce CLI naturally, without asking the human to hand-author every JSON payload or remember every command flag.

## Goal

Add a shared built-in skill named `metabot-product-commerce`.

The skill should guide a human and local Bot through Product Commerce V1 operations:

- seller-side product publish preparation;
- online product discovery;
- buyer-side purchase preview and confirmation;
- buyer and seller order inspection;
- seller-side virtual-goods fulfillment handoff guidance.

The skill is a conversational workflow guide over existing CLI surfaces. It must not add product protocol fields, payment logic, UI state, or a second fulfillment system.

## V1 Scope Rule

`metabot-product-commerce` should handle Product Commerce V1 virtual goods only:

- `productType: "virtual"`;
- `fulfillment.fulfillmentType: "digital_delivery"`;
- `fulfillment.deliveryEndpoint: "simplemsg"`.

When the human asks to publish or buy a physical product, logistics-backed product, refund flow, or on-chain product review, the skill should explain that the request is outside the V1 skill scope and defer it to future Product Commerce work. It should not try to approximate physical shipping with ad hoc buyer phone, email, address, or private per-order fields.

## Non-Goals

This change should not:

- change `/protocols/product-listing` or `/protocols/product-order`;
- implement `product-review`, refunds, physical logistics, or inventory reservation;
- add new daemon routes or product CLI commands;
- implement Product UI;
- bypass wallet confirmation, product purchase confirmation, or seller payment verification;
- introduce phone, email, shipping address, or sensitive per-order input into the V1 virtual-goods flow;
- dump decrypted private delivery message bodies as raw debug output.

## Skill Identity

The canonical source should be:

```text
SKILLs/metabot-product-commerce/SKILL.md
```

The skill frontmatter should use:

```yaml
---
name: metabot-product-commerce
description: Use when a local Bot/MetaBot needs to publish, discover, buy, inspect, or fulfill Product Commerce V1 product listings and product orders through MetaBot/OAC.
---
```

The description should stay trigger-focused. It should not summarize the internal workflow because skill discovery may otherwise shortcut the full instructions.

## Trigger Guidance

The skill should trigger when:

- the human asks a local Bot to publish or sell a virtual product;
- the human asks what local fulfillment skills can be used for products;
- the human asks to find, browse, or search online virtual products;
- the human asks to buy a virtual product or a specific SKU;
- the human asks to inspect product orders, payment status, delivery status, or trace handoff data;
- the seller Bot receives or needs to reason about a product-order fulfillment flow.

The skill should not trigger when:

- the request is about publishing a paid skill-service listing rather than a product listing;
- the request is about buying a remote skill-service rather than a product;
- the request is about Loom tasks;
- the request is only low-level protocol documentation;
- the request needs future `product-review`, refund, or physical logistics flows that V1 intentionally does not implement.

## Actor Selection

Product commands accept optional `--from <bot-slug>`.

The skill should use `--from` whenever:

- the human names a buyer or seller Bot;
- a publish operation belongs to a specific seller profile;
- a purchase operation belongs to a specific buyer profile;
- an order inspection should read one profile's local cache;
- seller-side fulfillment status must stay scoped to the seller profile.

When the actor is ambiguous, inspect local identity state:

```bash
{{METABOT_CLI}} identity who --json
{{METABOT_CLI}} identity list --json
```

Then ask the human to confirm the buyer or seller Bot before running a write command.

## Workflow Design

### Seller Product Publish

The skill should treat "publish a product" as a guided workflow, not as a request for the human to write JSON manually.

The workflow should:

1. Select the seller Bot.
2. Run `{{METABOT_CLI}} products skills --from <seller-slug> --json`.
3. Present only returned local runtime skills as valid `fulfillment.fulfillmentSkills` candidates.
4. Confirm the listing is a V1 virtual product using `productType: "virtual"`, `fulfillment.fulfillmentType: "digital_delivery"`, and `fulfillment.deliveryEndpoint: "simplemsg"`.
5. Ask only for missing product-listing fields that are required by the protocol or the intended virtual listing.
6. Keep images as `metafile://...` URIs. If the human provides local files, hand off to `metabot-upload-file`.
7. Build one product-listing JSON payload.
8. Preview the final JSON and exact publish command.
9. Require explicit human confirmation before publishing.
10. Run `{{METABOT_CLI}} products publish --from <seller-slug> --payload-file <path> [--chain <chain>]` only after confirmation.
11. Report returned listing pin id, network, fulfillment skills, and command evidence.

The skill should refuse or defer physical or logistics-backed product publish requests in V1. It should not invent seller identity fields, payment address fields, timestamps, shipping policy, review policy, or MRC20 fields.

### Online Product Discovery

The skill should use:

```bash
{{METABOT_CLI}} network products --online --query <text> --json
```

for buyer-facing discovery unless the human explicitly asks to inspect cached data with `--cached`.

The skill should prefer online discovery for purchasable V1 virtual goods and should not recommend buying an offline product. When no online virtual-product match exists, it should report that clearly instead of asking the buyer for extra contact details.

### Buyer Purchase

The skill should guide a purchase as a preview and confirmation workflow:

1. Select the buyer Bot.
2. Resolve the desired product and SKU from the online product list.
3. Confirm the resolved listing is a V1 virtual product using digital delivery over simplemsg.
4. Prepare a purchase request file containing `query`, `listingPinId`, `skuId`, optional `comment`, `spendCap`, `policyMode: "confirm_paid_only"`, and `confirmed: false`.
5. Run `{{METABOT_CLI}} products buy --from <buyer-slug> --request-file <path> --json`.
6. Show the preview: product title, SKU, seller, price, currency, fulfillment type, and expected delivery description when present.
7. Ask for explicit confirmation before any paid purchase.
8. Only after confirmation, create the same request with `confirmed: true`.
9. Run the confirmed `products buy` command.
10. Report product-order pin id, payment txid, order txid, local trace URL, and next inspection commands when present.

The skill should not add a separate buyer-side payment verification step. The wallet and product buy command own the payment path.

### Order Inspection

The skill should use cache-first order inspection:

```bash
{{METABOT_CLI}} products orders list --from <bot-slug> --role <buyer|seller|all> --json
{{METABOT_CLI}} products orders inspect --from <bot-slug> --product-order-pin-id <pinid> --json
```

It may also inspect by `--order-id`, `--payment-txid`, or `--order-txid` when those are the only handles available.

The skill should report buyer and seller states, payment verification status, delivery summary, and trace URL when present. It should not expose raw decrypted private delivery blobs.

### Seller Fulfillment Handoff

Seller-side fulfillment is implemented in the product order listener and fulfillment runtime, not in the skill. The skill should explain and inspect it, not reimplement it.

When helping a seller reason about fulfillment, the skill should:

- inspect the seller-side order;
- confirm the referenced listing belongs to the seller Bot when the CLI output exposes that state;
- confirm payment verification status from the order view;
- identify the full `fulfillment.fulfillmentSkills` array;
- explain that all listed skills are made available to the fulfillment round;
- avoid saying that the first skill is the primary handler;
- explain that product-order context enters the fulfillment conversation/runtime context, not a single direct skill argument.

For virtual goods, the skill may describe the existing optional `NeedsRating` simplemsg closure path. It must not require `product-review` for V1.

## Safety And Confirmation

The skill should require explicit confirmation before any command that may:

- publish a product-listing;
- move wallet funds;
- publish a product-order;
- send simplemsg order or delivery messages through the purchase flow.

Unclear confirmation should be treated as a pause or edit request.

The skill should surface exact CLI failure codes and messages. It should not invent pin ids, txids, delivery data, or payment status.

## Skillpack Integration

`metabot-product-commerce` should be a shared built-in MetaBot skill:

- add the canonical source under `SKILLs/`;
- add the skill to the skillpack builder allowlist;
- ensure npm packaging includes the source skill and related tests cover it;
- regenerate `skillpacks/shared/skills/...` and host-wrapper copies under `skillpacks/*/runtime/shared-skills/...`;
- sync the installed local copy from the rendered shared skill for immediate testing.

## Verification

Focused verification should include:

1. A failing skillpack regression test before the source and builder integration exist.
2. The new source skill frontmatter and actor-selection guidance passing existing skillpack invariants.
3. Assertions that the rendered shared skill contains product publish, discovery, buy, order inspect, explicit confirmation, and V1 non-goal guidance.
4. `npm run build:skillpacks`.
5. `node --test tests/skillpacks/buildSkillpacks.test.mjs tests/npm/packageFiles.test.mjs`.
6. `git diff --check`.
7. A prompt pressure test with a fresh subagent after the installed local skill is synchronized.
