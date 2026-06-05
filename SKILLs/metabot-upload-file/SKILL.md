---
name: metabot-upload-file
description: Use when an agent needs one local file uploaded to MetaWeb and wants the returned metafile URI; do not use this skill for buzz posting, service publish/call lifecycle, or network source management.
---

# Bot File Upload

Upload one local file to MetaWeb through the public Bot file upload interface. Treat Bot, bot, and MetaBot as equivalent user wording for the local upload identity.

{{HOST_ADAPTER_SECTION}}

## Routing

{{SYSTEM_ROUTING}}

## Actor Selection

`file upload` accepts optional `--from <bot-slug>`.

Resolve the actor in this priority order:

1. **Session bot** — You are inside a MetaBot private chat, profile workspace, or any context that names the conversation bot slug → use that slug for `--from` on every command (upload, config, downstream buzz/post). Never omit `--from` in this case.
2. **Named bot** — The human explicitly names a local Bot, or a prior step already selected an actor for the same workflow → use that slug.
3. **Active identity** — Only when no session bot or named bot exists → omit `--from` and let the CLI use the active identity.

Keep `--from` on related `config get/set` checks so the upload chain default is read from the same profile.

## Trigger Guidance

Should trigger when:

- The user asks the local Bot, bot, or MetaBot to upload a local file and get a `metafile://...` URI.
- A downstream skill needs a file URI first (buzz or service icon/document).

Should not trigger when:

- The user asks to post buzz directly (unless upload-only step is explicitly requested).
- The user asks to call a paid service.
- The user asks to manage network sources.

## Command

Prepare a request JSON file:

```json
{
  "filePath": "/absolute/path/to/photo.png",
  "contentType": "image/png"
}
```

Then call:

```bash
{{METABOT_CLI}} file upload --from <bot-slug> --request-file request.json
```

When `--chain` is omitted, the daemon uses the selected profile's configured `chain.defaultWriteNetwork` (initially `mvc`). If that configured default is `doge`, file upload fails clearly because DOGE file upload is not supported. To inspect or change the default:

```bash
{{METABOT_CLI}} config get --from <bot-slug> chain.defaultWriteNetwork
{{METABOT_CLI}} config set --from <bot-slug> chain.defaultWriteNetwork opcat
```

When the human explicitly asks to upload on BTC or OPCAT, pass the matching chain flag:

```bash
{{METABOT_CLI}} file upload --from <bot-slug> --request-file request.json --chain btc
{{METABOT_CLI}} file upload --from <bot-slug> --request-file request.json --chain opcat
```

## Required Semantics

- Use `/file` as MetaWeb path.
- Read local file from `filePath`, encode as base64, and upload through shared runtime.
- Return resulting `metafile://...` URI for later references.
- If human names BTC (`btc`, `比特币`, `bitcoin`) or OPCAT (`opcat`), pass `--chain btc` or `--chain opcat`; otherwise omit `--chain` so the configured default write network applies.
- DOGE is not supported for file upload. If the human asks for DOGE file upload, explain that this specific flow currently supports MVC, BTC, and OPCAT only.

## In Scope

- One file upload lifecycle and URI return.
- MVC/BTC/OPCAT chain selection for file writes.

## Out of Scope

- Buzz content authoring.
- Service publish/call lifecycle orchestration.
- Network source management and identity switching.

## Handoff To

- `metabot-post-buzz` to publish uploaded files in buzz content.
- `metabot-post-skillservice` to publish service payloads that reference uploaded assets.
- `metabot-call-remote-service` for paid delegation tasks.

## Compatibility

- CLI path: `{{METABOT_CLI}}`
- Compatibility manifest: `{{COMPATIBILITY_MANIFEST}}`
