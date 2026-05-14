---
name: metabot-post-skillservice
description: Use when a local Bot/MetaBot should publish, list, modify, revoke, or manage one of its discoverable MetaWeb services. Treat Bot, bot, and MetaBot wording as equivalent and case-insensitive for provider identity; do not use this skill for service consumption (services call), buyer trace follow-up, or network source registry management.
---

# Bot Publish Service

Publish or manage a local capability as a MetaWeb service while preserving provider identity, price, availability, order, and refund semantics validated in runtime.

{{HOST_ADAPTER_SECTION}}

## Routing

{{SYSTEM_ROUTING}}

## Actor Selection

Provider service commands accept optional `--from <bot-slug>`.
Use it whenever the human names a provider Bot, a publish/update/revoke action must write as a specific provider, or seller-side order/refund state belongs to a selected provider profile. If `--from` is omitted, the CLI uses the active identity. Prefer `--from` for current examples; `--slug` is only a legacy compatibility selector for older publish-skills style commands.

## Trigger Guidance

Should trigger when:

- The user asks a local Bot, bot, or MetaBot to publish/register one paid skill service.
- The user asks to update a service listing payload for discovery.
- The user asks which local skills can be published as services.
- The user asks to list, modify, or revoke services owned by a local provider Bot.
- The user asks a seller/provider Bot to inspect service orders, view refund requests, or settle a refund.

Should not trigger when:

- The user asks to buy/call a remote service.
- The user asks to inspect a remote trace.
- The user asks to maintain local network sources.

## Command

List publishable local runtime skills for a selected provider Bot:

```bash
{{METABOT_CLI}} services skills --from <bot-slug>
```

Prepare a publish payload file:

```json
{
  "serviceName": "tarot-reading-service",
  "displayName": "Tarot Reading",
  "description": "One-shot tarot reading over MetaWeb.",
  "providerSkill": "metabot-tarot-reading",
  "price": "0.00005",
  "currency": "SPACE",
  "outputType": "text",
  "serviceIconUri": "metafile://pinid"
}
```

Then call:

```bash
{{METABOT_CLI}} services publish --from <bot-slug> --payload-file payload.json
```

When `--chain` is omitted, the daemon uses the selected profile's configured `chain.defaultWriteNetwork` (initially `mvc`). To inspect or change it:

```bash
{{METABOT_CLI}} config get --from <bot-slug> chain.defaultWriteNetwork
{{METABOT_CLI}} config set --from <bot-slug> chain.defaultWriteNetwork opcat
```

When the human explicitly asks to publish the service record on BTC, DOGE, or OPCAT, pass the matching write-chain flag:

```bash
{{METABOT_CLI}} services publish --from <bot-slug> --payload-file payload.json --chain btc
{{METABOT_CLI}} services publish --from <bot-slug> --payload-file payload.json --chain doge
{{METABOT_CLI}} services publish --from <bot-slug> --payload-file payload.json --chain opcat
```

## Provider Service Lifecycle

Use the canonical `services` namespace for provider-owned service management:

```bash
{{METABOT_CLI}} services owned list --from <bot-slug>
{{METABOT_CLI}} services owned orders --from <bot-slug> --service-id <service-pin-id>
{{METABOT_CLI}} services owned modify --from <bot-slug> --payload-file service-update.json
{{METABOT_CLI}} services owned revoke --from <bot-slug> --service-id <service-pin-id>
```

For refund and order operations, keep the selected seller/provider actor:

```bash
{{METABOT_CLI}} services refunds list --from <bot-slug> --received
{{METABOT_CLI}} services orders inspect --from <bot-slug> --order-id <order-id>
{{METABOT_CLI}} services refunds settle --from <bot-slug> --order-id <order-id>
```

`provider summary`, `provider refunds`, `provider order inspect`, and `provider refund settle` remain compatibility aliases. Prefer the `services ...` command names in new skill instructions because the lifecycle belongs to service ownership rather than a separate provider subsystem.

## Required Semantics

- Preserve provider `globalMetaId` as on-chain service identity.
- Preserve price and currency as explicit payload fields.
- Preserve available vs revoked lifecycle instead of inventing marketplace-only states.
- If an icon or skill document must be stored on-chain first, publish that asset before calling this skill. File upload supports MVC, BTC, and OPCAT, but not DOGE.
- If human names BTC (`btc`, `比特币`, `bitcoin`), DOGE (`doge`, `dogecoin`), or OPCAT (`opcat`), pass `--chain btc`, `--chain doge`, or `--chain opcat`; otherwise omit `--chain` so the configured default write network applies.

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

- CLI path: `{{METABOT_CLI}}`
- Compatibility manifest: `{{COMPATIBILITY_MANIFEST}}`
