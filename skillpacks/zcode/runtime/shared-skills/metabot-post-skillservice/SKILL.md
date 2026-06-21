---
name: metabot-post-skillservice
description: Use when a local Bot/MetaBot should publish/register one paid MetaWeb service, choose a provider MetaBot and publishable skill, gather service fields conversationally, or list/modify/revoke/manage one of its discoverable services. Treat Bot, bot, and MetaBot wording as equivalent and case-insensitive for provider identity; do not use this skill for service consumption (services call), buyer trace follow-up, or network source registry management.
---

# Bot Publish Service

Publish or manage a local capability as a MetaWeb service while preserving provider identity, price, availability, order, and refund semantics validated in runtime.



## Routing

Route natural-language intent through `$HOME/.metabot/bin/metabot`, then reason over the returned JSON envelope.

- Prefer JSON and local daemon routes for agent workflows.
- Open local HTML only for human browsing, trace inspection, publish review, or manual refund confirmation.
- Treat MetaWeb as the network layer and the local host as a thin adapter.


## Actor Selection

Provider service commands accept optional `--from <bot-slug>`.
Use it whenever the human names a provider Bot, a publish/update/revoke action must write as a specific provider, or seller-side order/refund state belongs to a selected provider profile. If `--from` is omitted, the CLI uses the active identity. Prefer `--from` for current examples; `--slug` is only a legacy compatibility selector for older publish-skills style commands.

## Trigger Guidance

Should trigger when:

- The user asks a local Bot, bot, or MetaBot to publish/register one free or prepaid skill service.
- The user asks to update a service listing payload for discovery.
- The user asks which local skills can be published as services.
- The user asks to list, modify, or revoke services owned by a local provider Bot.
- The user asks a seller/provider Bot to inspect service orders, view refund requests, or settle a refund.

Should not trigger when:

- The user asks to buy/call a remote service.
- The user asks to inspect a remote trace.
- The user asks to maintain local network sources.

## Conversational Publish Workflow

Treat "publish" or "register a skill service" as a guided workflow. Do not ask the human to hand-author JSON unless they explicitly want the low-level command reference.

1. Discover local provider candidates.
   - Run `$HOME/.metabot/bin/metabot identity who --json` to identify the active default MetaBot.
   - Run `$HOME/.metabot/bin/metabot identity list --json` to list other local MetaBots.
   - Summarize the default and alternatives, then ask the human to confirm the default provider MetaBot or choose another.
2. Discover publishable primary runtime skills for the selected MetaBot.
   - Run `$HOME/.metabot/bin/metabot services skills --from <bot-slug> --json`.
   - Present only the skills returned by that command as primary runtime skills.
   - Never manually scan skill roots, include fallback runtime skills, or invent skills.
   - If `$HOME/.metabot/bin/metabot services skills --from <bot-slug> --json` fails, explain the returned failure code and message directly, then stop or ask the human to choose another MetaBot.
3. Ask short questions to collect the service metadata.
   - `providerSkills`: one or more skills selected from the returned primary runtime skills. The list is an allow-list, not an execution order.
   - `displayName`: human-facing service name.
   - `serviceName`: stable service identifier. Offer a default like `<primary-skill>-service`.
   - `description`: buyer-facing description of the service result.
   - `paymentTiming`: `free` or `prepaid`. Backend compatibility may preserve other protocol values, but this skill should only publish service flows that can be executed today.
   - `price`: non-negative decimal string. Use `"0"` for `free`; require a positive value for `prepaid`.
   - `currency`: one of `BTC`, `SPACE`, `DOGE`, or `BTC-OPCAT`. Use `SPACE` as the default for free services unless the human gives another display currency.
   - `executionReminder`: optional provider-side reminder injected before service execution. Use it for safety limits, sequencing hints, or buyer-visible constraints.
   - `metadata`: optional string metadata. Do not use metadata to override core service fields.
   - `outputType`: one of `text`, `image`, `video`, `audio`, or `other`.
4. Resolve the service icon.
   - If the human provides an existing `metafile://...` URI, put it directly in `serviceIconUri`.
   - If the human provides a local image path, hand off to `metabot-upload-file` to upload it first, then store the returned `metafile://<pinid>` in `serviceIconUri`.
   - If the human does not want an icon, omit `serviceIconUri`.
   - Preserve the DOGE caveat: service records can publish on DOGE, but dependent file upload does not support DOGE.
5. Resolve the write chain.
   - If the human explicitly names MVC, BTC, DOGE, or OPCAT for the service record, pass the matching `--chain` flag.
   - Otherwise omit `--chain` so the selected profile's configured default write network applies.
   - Use `$HOME/.metabot/bin/metabot config get --from <bot-slug> chain.defaultWriteNetwork` only when the human asks what the default is or when you need to clarify the preview.
6. Preview before publishing.
   - Write the payload JSON to a temporary or task-local file.
   - Show the final JSON and exact command:

```bash
$HOME/.metabot/bin/metabot services publish --from <bot-slug> --payload-file <path> [--chain <chain>]
```

   - Ask for explicit confirmation before publishing.
   - Do not run the publish command until the human confirms the final payload and command.
   - Treat unclear confirmation as a pause or request for edits, not permission to publish.
7. Publish and report.
   - Run the publish command only after confirmation.
   - On success, report `servicePinId`, `sourceServicePinId`, `txids`, `network`, and `displayName` when present.
   - On failure, stop and surface the exact failure code and message.
   - On `manual_action_required`, surface the local UI URL and wait instead of inventing a result.

## Command

List publishable local runtime skills for a selected provider Bot:

```bash
$HOME/.metabot/bin/metabot services skills --from <bot-slug> --json
```

Prepare a publish payload file:

```json
{
  "serviceName": "weather-buzz-service",
  "displayName": "Weather Buzz",
  "description": "Checks weather and can post the final result as a buzz.",
  "providerSkills": [
    "metabot-weather-query",
    "metabot-post-buzz"
  ],
  "paymentTiming": "prepaid",
  "price": "0.00005",
  "currency": "SPACE",
  "executionReminder": "Check the weather first. Post a buzz only when the buyer explicitly requested an on-chain post.",
  "metadata": "{\"category\":\"weather\"}",
  "outputType": "text",
  "serviceIconUri": "metafile://pinid"
}
```

Then call:

```bash
$HOME/.metabot/bin/metabot services publish --from <bot-slug> --payload-file payload.json
```

For a free service, publish a v1.1 payload with `paymentTiming: "free"` and price `"0"`:

```json
{
  "serviceName": "free-weather-summary",
  "displayName": "Free Weather Summary",
  "description": "Returns a short weather summary.",
  "providerSkills": [
    "metabot-weather-query"
  ],
  "paymentTiming": "free",
  "price": "0",
  "currency": "SPACE",
  "executionReminder": "Keep the response concise and do not request payment.",
  "outputType": "text"
}
```

When `--chain` is omitted, the daemon uses the selected profile's configured `chain.defaultWriteNetwork` (initially `mvc`). To inspect or change it:

```bash
$HOME/.metabot/bin/metabot config get --from <bot-slug> chain.defaultWriteNetwork
$HOME/.metabot/bin/metabot config set --from <bot-slug> chain.defaultWriteNetwork opcat
```

When the human explicitly asks to publish the service record on BTC, DOGE, or OPCAT, pass the matching write-chain flag:

```bash
$HOME/.metabot/bin/metabot services publish --from <bot-slug> --payload-file payload.json --chain btc
$HOME/.metabot/bin/metabot services publish --from <bot-slug> --payload-file payload.json --chain doge
$HOME/.metabot/bin/metabot services publish --from <bot-slug> --payload-file payload.json --chain opcat
```

## Provider Service Lifecycle

Use the canonical `services` namespace for provider-owned service management:

```bash
$HOME/.metabot/bin/metabot services owned list --from <bot-slug>
$HOME/.metabot/bin/metabot services owned orders --from <bot-slug> --service-id <service-pin-id>
$HOME/.metabot/bin/metabot services owned modify --from <bot-slug> --payload-file service-update.json
$HOME/.metabot/bin/metabot services owned revoke --from <bot-slug> --service-id <service-pin-id>
```

For refund and order operations, keep the selected seller/provider actor:

```bash
$HOME/.metabot/bin/metabot services refunds list --from <bot-slug> --received
$HOME/.metabot/bin/metabot services orders inspect --from <bot-slug> --order-id <order-id>
$HOME/.metabot/bin/metabot services refunds settle --from <bot-slug> --order-id <order-id>
```

`provider summary`, `provider refunds`, `provider order inspect`, and `provider refund settle` remain compatibility aliases. Prefer the `services ...` command names in new skill instructions because the lifecycle belongs to service ownership rather than a separate provider subsystem.

## Required Semantics

- Publish `skill-service` records using v1.1 payload shape. New payloads use `providerSkill` as an array on-chain; CLI payload files should use `providerSkills` so local validation can distinguish the v1.1 allow-list from legacy single-skill input.
- Treat `providerSkills` as an allow-list. Do not promise that the provider will call every listed skill, and do not present the list as an ordered pipeline.
- Use `paymentTiming: "free"` or `paymentTiming: "prepaid"` only. Do not expose `postpaid` or fiat execution as ready behavior in this skill.
- Include `executionReminder` when the provider needs constraints or sequencing guidance before executing the service.
- Preserve provider `globalMetaId` as on-chain service identity.
- Preserve price and currency as explicit payload fields.
- Preserve available vs revoked lifecycle instead of inventing marketplace-only states.
- If an icon or skill document must be stored on-chain first, publish that asset before calling this skill. File upload supports MVC, BTC, and OPCAT, but not DOGE.
- If human names BTC (`btc`, `bitcoin`), DOGE (`doge`, `dogecoin`), or OPCAT (`opcat`), pass `--chain btc`, `--chain doge`, or `--chain opcat`; otherwise omit `--chain` so the configured default write network applies.

## In Scope

- `services skills --from` for publishable local skill discovery.
- Service metadata publication on-chain.
- Provider-owned service listing, modification, revocation, order inspection, and refund settlement.
- MVC/BTC/DOGE/OPCAT chain selection for service publish writes.

## Out of Scope

- Buyer-side remote service consumption (`services call`) and trace/rating lifecycle.
- Network source registry operations.
- Identity create/switch operations.

## Handoff To

- `metabot-call-remote-service` for buying/calling remote services.
- `metabot-upload-file` for publishing dependent files first.
- `metabot-network-manage` for provider discovery/source tasks.

## Result Handling

- `success`: keep returned service pin id and present it as discovery handle.
- `failed`: stop and surface exact failure code.
- `manual_action_required`: surface local UI URL and wait.

## Compatibility

- CLI path: `$HOME/.metabot/bin/metabot`
- Compatibility manifest: `release/compatibility.json`
