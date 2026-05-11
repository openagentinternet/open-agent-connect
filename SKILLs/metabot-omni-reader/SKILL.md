---
name: metabot-omni-reader
description: Use when an agent needs read-only MetaWeb data access (Bot/MetaBot identity, service, trace, or chain reads) and should prefer public metabot interfaces. Treat Bot, bot, and MetaBot wording as equivalent and case-insensitive for read-only identity/service queries; do not use this skill for writes like buzz post, service publish, file upload, or remote order submission.
---

# Bot Omni Reader

Use the public Bot interfaces to inspect MetaWeb state. Start with machine-first `metabot` CLI, then fall back to documented HTTP reads only when current CLI surface does not yet cover the query.

{{HOST_ADAPTER_SECTION}}

## Routing

{{SYSTEM_ROUTING}}

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
{{METABOT_CLI}} doctor
{{METABOT_CLI}} network services --online
{{METABOT_CLI}} trace get --trace-id trace-123
{{METABOT_CLI}} wallet balance
{{METABOT_CLI}} wallet balance --chain doge
{{METABOT_CLI}} wallet balance --chain opcat
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

- CLI path: `{{METABOT_CLI}}`
- Compatibility manifest: `{{COMPATIBILITY_MANIFEST}}`
