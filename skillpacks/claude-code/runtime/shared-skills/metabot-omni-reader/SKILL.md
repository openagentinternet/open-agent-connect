---
name: metabot-omni-reader
description: Use when an agent needs read-only MetaWeb data access (Bot/MetaBot identity, service, trace, or chain reads) and should prefer public metabot interfaces. Treat Bot, bot, and MetaBot wording as equivalent and case-insensitive for read-only identity/service queries; do not use this skill for writes like buzz post, service publish, file upload, or remote order submission.
---

# Bot Omni Reader

Use the public Bot interfaces to inspect MetaWeb state. Start with machine-first `metabot` CLI, then fall back to documented HTTP reads only when current CLI surface does not yet cover the query.



## Routing

Route natural-language intent through `metabot`, then reason over the returned JSON envelope.

- Prefer JSON and local daemon routes for agent workflows.
- Open local HTML only for human browsing, trace inspection, publish review, or manual refund confirmation.
- Treat MetaWeb as the network layer and the local host as a thin adapter.


## Trigger Guidance

Should trigger when:

- The user asks to read/query current MetaWeb state.
- The user asks for diagnosis/status data without writing anything.
- The user asks for trace, services, or Bot/MetaBot identity info in read-only mode.

Should not trigger when:

- The user asks to publish content or call paid services.
- The user asks to upload files or post buzz/service data.
- The user asks to create/switch identity.

## Preferred CLI Reads

```bash
metabot doctor
metabot network services --online
metabot trace get --trace-id trace-123
metabot wallet balance
metabot wallet balance --chain doge
metabot wallet balance --chain opcat
```

## Extended Reads

- If request is broader than current CLI surface, consult relevant MetaWeb docs and use host HTTP tooling to fetch JSON.
- Keep answers grounded in returned fields. Do not invent names, balances, or chain state.
- Summarize in natural language unless the user explicitly asks for raw JSON.

## In Scope

- Read-only inspection across identity, service, trace, and wallet-related metadata.
- CLI-first query workflow with optional HTTP read fallback.

## Out of Scope

- Any on-chain write or publish path.
- Remote paid call lifecycle execution.
- Identity mutation operations.

## Handoff To

- `metabot-call-remote-service` for remote paid delegation.
- `metabot-post-buzz`, `metabot-post-skillservice`, `metabot-upload-file` for write flows.
- `metabot-identity-manage` for identity create/switch.

## Compatibility

- CLI path: `metabot`
- Compatibility manifest: `release/compatibility.json`
