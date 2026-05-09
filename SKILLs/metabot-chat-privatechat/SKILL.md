---
name: metabot-chat-privatechat
description: Use when an agent needs to send one private MetaWeb message to a remote globalMetaId with simplemsg encryption semantics; do not use this skill for paid service delegation, trace lifecycle handling, or network source management.
---

# MetaBot Private Chat

Send one encrypted private message over MetaWeb without changing the current `simplemsg` contract.

{{HOST_ADAPTER_SECTION}}

## Routing

{{SYSTEM_ROUTING}}

## Trigger Guidance

Should trigger when:

- The user asks to send one direct private message to a remote globalMetaId.
- The user asks to reply to an existing pin thread through private chat.

Should not trigger when:

- The user asks to place a paid order (`services call`).
- The user asks to inspect trace progress or publish service ratings.
- The user asks to add/list/remove network sources.

## Command

Prepare a request JSON file:

```json
{
  "to": "gm-target",
  "content": "hello from MetaBot",
  "replyPin": "optional-pin-id"
}
```

Then call:

```bash
{{METABOT_CLI}} chat private --request-file request.json
```

When `--chain` is omitted, the private `simplemsg` write uses the active profile's configured `chain.defaultWriteNetwork` (initially `mvc`). To inspect or change it:

```bash
{{METABOT_CLI}} config get chain.defaultWriteNetwork
{{METABOT_CLI}} config set chain.defaultWriteNetwork opcat
```

When the human explicitly asks to send on BTC, DOGE, or OPCAT, pass the matching write-chain flag:

```bash
{{METABOT_CLI}} chat private --request-file request.json --chain btc
{{METABOT_CLI}} chat private --request-file request.json --chain doge
{{METABOT_CLI}} chat private --request-file request.json --chain opcat
```

## Required Semantics

- Use `/protocols/simplemsg` as the outer MetaWeb path.
- Resolve the peer chat public key before encryption.
- Encrypt the content with the shared ECDH secret.
- Stop with an error if `to`, `content`, or remote chat public key is missing.
- If the human names BTC (`btc`, `比特币`, `bitcoin`), DOGE (`doge`, `dogecoin`), or OPCAT (`opcat`), pass `--chain btc`, `--chain doge`, or `--chain opcat`; otherwise omit `--chain` so the configured default write network applies.
- If the successful result includes `localUiUrl`, surface it as the local unified A2A trace link so the human can inspect history and live replies.

## In Scope

- One private message send with optional reply pin context.
- Protocol-safe encryption and on-chain delivery reporting (`pinId`, `txids`).
- MVC/BTC/DOGE/OPCAT chain selection for the private message write.

## Out of Scope

- Remote paid service order and trace workflow.
- Network directory/source maintenance.
- Identity create/switch operations.

## Handoff To

- `metabot-call-remote-service` for service delegation and trace/rating lifecycle.
- `metabot-network-manage` when the user first needs provider discovery.

## Result Handling

- `success`: report returned `pinId` and `txids`; when `localUiUrl` is present, include it as the unified A2A trace link, then continue conversation.
- Do not surface encrypted transport payloads, encrypted content, peer chat public keys, shared secrets, or private keys in the human-facing response.
- `failed`: stop and surface the error code instead of inventing a delivery result.
- `manual_action_required`: open the returned local UI only if runtime explicitly asks.

## Response Shape

- For success responses, include:
  - delivery proof (`pinId`, `txids`)
  - who the message was sent to (`to`)
  - unified A2A trace URL (`localUiUrl`) when returned by the runtime
  - one concrete next step (for example keep chatting or move to service/master workflow)
  - natural-language next prompts in the same language as the user
  - intent-equivalent wording guidance (do not lock to one fixed phrase template)
- do not reply with one rigid fixed sentence.
- keep language natural while preserving exact delivery identifiers.

## Compatibility

- CLI path: `{{METABOT_CLI}}`
- Compatibility manifest: `{{COMPATIBILITY_MANIFEST}}`
