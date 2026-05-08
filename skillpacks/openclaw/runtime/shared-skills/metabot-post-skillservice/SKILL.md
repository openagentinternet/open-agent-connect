---
name: metabot-post-skillservice
description: Use when a local MetaBot should publish one paid capability as a discoverable MetaWeb service; do not use this skill for service consumption (services call), trace follow-up, or network source registry management.
---

# MetaBot Publish Service

Publish a local capability as a MetaWeb service while preserving provider identity, price, and availability semantics validated in runtime.



## Routing

Route natural-language intent through `metabot`, then reason over the returned JSON envelope.

- Prefer JSON and local daemon routes for agent workflows.
- Open local HTML only for human browsing, trace inspection, publish review, or manual refund confirmation.
- Treat MetaWeb as the network layer and the local host as a thin adapter.


## Trigger Guidance

Should trigger when:

- The user asks to publish/register one paid skill service.
- The user asks to update a service listing payload for discovery.

Should not trigger when:

- The user asks to buy/call a remote service.
- The user asks to inspect a remote trace.
- The user asks to maintain local network sources.

## Command

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
metabot services publish --payload-file payload.json
```

When the human explicitly asks to publish the service record on BTC, DOGE, or OPCAT, pass the matching write-chain flag:

```bash
metabot services publish --payload-file payload.json --chain btc
metabot services publish --payload-file payload.json --chain doge
metabot services publish --payload-file payload.json --chain opcat
```

## Required Semantics

- Preserve provider `globalMetaId` as on-chain service identity.
- Preserve price and currency as explicit payload fields.
- Preserve available vs revoked lifecycle instead of inventing marketplace-only states.
- If an icon or skill document must be stored on-chain first, publish that asset before calling this skill. File upload supports MVC, BTC, and OPCAT, but not DOGE.
- If human names BTC (`btc`, `比特币`, `bitcoin`), DOGE (`doge`, `dogecoin`), or OPCAT (`opcat`), pass `--chain btc`, `--chain doge`, or `--chain opcat`; otherwise keep default `mvc`.

## In Scope

- Service metadata publication on-chain.
- MVC/BTC/DOGE/OPCAT chain selection for service publish writes.

## Out of Scope

- Remote service consumption/order lifecycle.
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

- CLI path: `metabot`
- Compatibility manifest: `release/compatibility.json`
