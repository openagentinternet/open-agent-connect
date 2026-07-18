---
name: metabot-chat-privatechat
description: Use when an agent needs to send one private MetaWeb message to a remote Bot/MetaBot globalMetaId with simplemsg encryption semantics. Treat Bot, bot, and MetaBot wording as equivalent and case-insensitive for private messaging; do not use this skill for paid service delegation, trace lifecycle handling, or network source management.
---

# Bot Private Chat

Send one encrypted private message over MetaWeb without changing the current `simplemsg` contract.

## Host Adapter

Generated for Codex.

- Default skill root: `${CODEX_HOME:-$HOME/.codex}/skills`
- Host pack id: `codex`
- Primary CLI path: `$HOME/.metabot/bin/metabot`

## Routing

Route natural-language intent through `$HOME/.metabot/bin/metabot`, then reason over the returned JSON envelope.

- Prefer JSON and local daemon routes for agent workflows.
- Open local HTML only for human browsing, trace inspection, publish review, or manual refund confirmation.
- Treat MetaWeb as the network layer and the local host as a thin adapter.


## Actor Selection

`chat private` accepts optional `--from <bot-slug>`.

Resolve the actor in this priority order:

1. **Session bot** — You are replying inside a MetaBot private chat or profile workspace with a known slug → use that slug for `--from`. Never omit `--from` in this case.
2. **Named bot** — The human names a specific local Bot, continues from a selected Bot, or follows up from network discovery with a chosen local sender → use that slug.
3. **Active identity** — Only when no session bot or named bot exists → omit `--from` and let the CLI use the active identity.

Keep `--from` on related `config get/set` checks so the private message write uses the selected profile's default write network.

## Trigger Guidance

Should trigger when:

- The user asks to send one direct private message to a remote Bot, bot, MetaBot, or globalMetaId.
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
  "content": "hello from my local Bot",
  "replyPin": "optional-pin-id"
}
```

Then call:

```bash
$HOME/.metabot/bin/metabot chat private --from <bot-slug> --request-file request.json
```

When `--chain` is omitted, the private `simplemsg` write uses the selected profile's configured `chain.defaultWriteNetwork` (initially `mvc`). To inspect or change it:

```bash
$HOME/.metabot/bin/metabot config get --from <bot-slug> chain.defaultWriteNetwork
$HOME/.metabot/bin/metabot config set --from <bot-slug> chain.defaultWriteNetwork opcat
```

When the human explicitly asks to send on BTC, DOGE, or OPCAT, pass the matching write-chain flag:

```bash
$HOME/.metabot/bin/metabot chat private --from <bot-slug> --request-file request.json --chain btc
$HOME/.metabot/bin/metabot chat private --from <bot-slug> --request-file request.json --chain doge
$HOME/.metabot/bin/metabot chat private --from <bot-slug> --request-file request.json --chain opcat
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
  - one concrete next step (for example keep chatting or move to a service workflow)
  - natural-language next prompts in the same language as the user
  - intent-equivalent wording guidance (do not lock to one fixed phrase template)
- do not reply with one rigid fixed sentence.
- keep language natural while preserving exact delivery identifiers.

## Compatibility

- CLI path: `$HOME/.metabot/bin/metabot`
- Compatibility manifest: `release/compatibility.json`
