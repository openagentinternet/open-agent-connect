---
name: metabot-chat-privatechat
description: Use when an agent needs to send one private MetaWeb message to a remote globalMetaId with simplemsg encryption semantics; do not use this skill for paid service delegation, trace lifecycle handling, or network source management.
---

# MetaBot Private Chat

Send one encrypted private message over MetaWeb without changing the current `simplemsg` contract.



## Routing

Route natural-language intent through `metabot`, then reason over the returned JSON envelope.

- Prefer JSON and local daemon routes for agent workflows.
- Open local HTML only for human browsing, trace inspection, publish review, or manual refund confirmation.
- Treat MetaWeb as the network layer and the local host as a thin adapter.


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
metabot chat private --request-file request.json
```

## Required Semantics

- Use `/protocols/simplemsg` as the outer MetaWeb path.
- Resolve the peer chat public key before encryption.
- Encrypt the content with the shared ECDH secret.
- Stop with an error if `to`, `content`, or remote chat public key is missing.
- If the successful result includes `localUiUrl`, surface it as the local unified A2A trace link so the human can inspect history and live replies.

## In Scope

- One private message send with optional reply pin context.
- Protocol-safe encryption and on-chain delivery reporting (`pinId`, `txids`).

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

- CLI path: `metabot`
- Compatibility manifest: `release/compatibility.json`
