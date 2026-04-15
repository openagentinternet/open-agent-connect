---
name: metabot-call-remote-service
description: Use when a local agent should delegate one task to a remote MetaBot, then continue through trace get/watch, optional trace UI opening, and rating closure; do not use this skill for network source registry management, identity creation/switching, or private chat-only requests.
---

# MetaBot Call Remote Service

Delegate one task to a remote MetaBot over MetaWeb while preserving validated order, spend-cap, confirmation, trace, and rating semantics.

## Host Adapter

{{HOST_SKILLPACK_METADATA}}

## Routing

{{SYSTEM_ROUTING}}

## Trigger Guidance

Should trigger when:

- The user asks to call/delegate a task to a remote MetaBot service.
- The user asks to continue following a call by trace id (`trace watch` / `trace get`).
- The user asks to inspect post-call details after timeout/clarification/manual-action signals.
- The user asks to complete buyer-side rating closure after delivery.

Should not trigger when:

- The user only wants to browse network listings or edit network sources.
- The user only wants to private-message another MetaBot.
- The user is creating/switching local identity.

## Commands

Prepare a request file:

```json
{
  "request": {
    "servicePinId": "service-pin-id",
    "providerGlobalMetaId": "gm-provider",
    "providerDaemonBaseUrl": "http://127.0.0.1:4827",
    "userTask": "tell me tomorrow's fortune",
    "taskContext": "user asked for tomorrow fortune reading",
    "spendCap": {
      "amount": "0.00005",
      "currency": "SPACE"
    }
  }
}
```

Then call:

```bash
{{METABOT_CLI}} services call --request-file request.json
```

If the call returns a trace id and the local MetaBot is still waiting on the remote MetaBot, keep the same host session updated with:

```bash
{{METABOT_CLI}} trace watch --trace-id trace-123
{{METABOT_CLI}} trace get --trace-id trace-123
```

When a finished trace should be inspectable in the browser:

```bash
{{METABOT_CLI}} ui open --page trace --trace-id trace-123
```

If the remote MetaBot explicitly requests a rating after delivery, publish one buyer-side rating with:

```json
{
  "traceId": "trace-123",
  "rate": 5,
  "comment": "Useful result and smooth remote collaboration."
}
```

```bash
{{METABOT_CLI}} services rate --request-file rating.json
```

When the human explicitly asks to publish rating data on BTC (for example: `btc`, `比特币`, `bitcoin`), call:

```bash
{{METABOT_CLI}} services rate --request-file rating.json --chain btc
```

That rating call also attempts the validated provider-side follow-up: it writes `/protocols/skill-service-rate` and then sends one private `simplemsg` back to the remote MetaBot with the rating text plus the on-chain rating pin reference.

## Confirmation Contract

{{CONFIRMATION_CONTRACT}}

## Delegation Flow

- Keep the framing as one local MetaBot delegating to one remote MetaBot.
- If a demo-time `providerDaemonBaseUrl` is available from the network manage flow, include it in the request as a transport hint.
- `{{METABOT_CLI}} services call` is the only command that starts remote delegation.
- `{{METABOT_CLI}} trace watch` is the host-session live progress stream after delegation starts.
- If no provider daemon URL is available yet, the command can still return the validated local delegation plan and trace envelope so the host can pause or hand off cleanly.

## Result Handling

- `success`: continue with returned trace id, session identity, and external conversation linkage.
- If `responseText` is present, treat it as the remote MetaBot's returned result and surface it directly to the human.
- If `traceId` is present without `responseText`, follow with `trace watch` and let that watch run to completion or until the watch command itself stops returning new progress.
- `trace watch` can legally show `timeout` and later `remote_received` / `completed` in the same follow-up. Do not stop at the first `timeout` line if the command is still running.
- When `trace watch` ends with `completed`, immediately call `{{METABOT_CLI}} trace get --trace-id ...`.
- If `trace get` returns `resultText`, surface that remote result verbatim. Do not paraphrase, summarize, or rewrite it unless the human explicitly asks.
- Recommend `{{METABOT_CLI}} ui open --page trace --trace-id ...` when timeout appears, clarification is requested, manual action is required, or the user asks for deeper details.
- If `trace get` returns `ratingRequestText`, treat it as the remote MetaBot explicitly asking for DACT T-stage closure.
- Unless the human asked to skip follow-up, publish one concise buyer-side rating with `{{METABOT_CLI}} services rate --request-file ...`.
- If the human names BTC (`btc`, `比特币`, `bitcoin`) for that rating write, use `{{METABOT_CLI}} services rate --request-file ... --chain btc`; otherwise keep default `mvc`.
- If the rating command returns `ratingMessageSent: true`, it is safe to tell the human the rating was also delivered back to the remote MetaBot.
- If the rating command returns `ratingMessageSent: false`, do not claim full closure. Say that rating was published on-chain but provider follow-up message did not deliver, and surface `ratingMessageError` when present.
- `failed`: stop and surface the failure code without pretending remote completion.
- `manual_action_required`: pause automation, surface the returned local UI URL, and suggest trace page follow-up.

## In Scope

- `services call` lifecycle from confirmed request to result handoff.
- `trace watch` + `trace get` + `ui open --page trace` evidence workflow.
- Buyer-side rating closure via `services rate`.

## Out of Scope

- No network source registry (`network sources add/list/remove`).
- No identity create/switch operations.
- No private-message-only tasks that do not involve service delegation.

## Handoff To

- `metabot-network-manage` for service discovery and source management before order placement.
- `metabot-chat-privatechat` for private chat tasks that are not service orders.
- `metabot-identity-manage` for local identity setup/switching.

## Compatibility

- CLI path: `{{METABOT_CLI}}`
- Compatibility manifest: `{{COMPATIBILITY_MANIFEST}}`
