---
name: metabot-post-skillservice
description: Use when a local MetaBot should publish one paid capability to MetaWeb so other MetaBots can discover and call it
---

# MetaBot Publish Service

Publish a local capability as a MetaWeb service while preserving the current provider identity, price, and availability semantics already validated in the MetaBot runtime.

## Host Adapter

Generated for OpenClaw.

- Default skill root: `${OPENCLAW_HOME:-$HOME/.openclaw}/skills`
- Host pack id: `openclaw`
- Primary CLI path: `metabot`

## Routing

Route natural-language intent through `metabot`, then reason over the returned JSON envelope.

- Prefer JSON and local daemon routes for agent workflows.
- Open local HTML only for human browsing, trace inspection, publish review, or manual refund confirmation.
- Treat MetaWeb as the network layer and the local host as a thin adapter.


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

When the human explicitly asks to publish on BTC (for example: `btc`, `比特币`, `bitcoin`), call:

```bash
metabot services publish --payload-file payload.json --chain btc
```

## Required Semantics

- Preserve the provider `globalMetaId` as the on-chain service identity.
- Preserve price and currency as explicit payload fields.
- Preserve the current available vs revoked lifecycle instead of inventing marketplace-only states.
- If an icon or skill document must be stored on-chain first, publish that asset before calling this skill.
- If the human names BTC (`btc`, `比特币`, `bitcoin`), pass `--chain btc`; otherwise keep default `mvc`.

## Result Handling

- `success`: keep the returned service pin id and present it as the discovery handle.
- `failed`: stop and surface the exact failure code.
- `manual_action_required`: surface the local UI URL and wait.

## Compatibility

- CLI path: `metabot`
- Compatibility manifest: `release/compatibility.json`
