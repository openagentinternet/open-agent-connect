---
name: metabot-call-remote-service
description: Use when a user asks to use, run, delegate, or fulfill a task through a capability that may exist as an online Bot/MetaBot skill-service, especially when no local specialized skill matches. Treat Bot, bot, and MetaBot wording as equivalent and case-insensitive for remote service requests; select from the local cached online service list first, then call the remote service and continue through trace get/watch, optional trace UI opening, and rating closure. Do not use for browse-only service discovery, network source registry management, identity creation/switching, or private chat-only requests.
---

# Bot Call Remote Service

Delegate one task to a remote Bot over MetaWeb while preserving validated order, spend-cap, confirmation, trace, and rating semantics.

{{HOST_ADAPTER_SECTION}}

## Routing

{{SYSTEM_ROUTING}}

## Trigger Guidance

Should trigger when:

- The user asks to call/delegate a task to a remote Bot service, bot service, or MetaBot service.
- The user asks for a capability by natural language and no local specialized skill clearly satisfies it, for example tarot readings, niche market analysis, domain-specific translation, specialized document review, or other online skill-service tasks.
- The user describes a task that matches an available cached online skill service, even if they did not explicitly ask to browse services first.
- The user asks to continue following a call by trace id (`trace watch` / `trace get`).
- The user asks to inspect post-call details after timeout/clarification/manual-action signals.
- The user asks to complete buyer-side rating closure after delivery.

Should not trigger when:

- The user only wants to browse network listings or edit network sources.
- The user only wants to private-message another Bot.
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
    },
    "policyMode": "confirm_paid_only"
  }
}
```

Payment is handled automatically by the local Bot daemon. UTXOs are spendable regardless of confirmation status — the total balance (confirmed + unconfirmed) is what matters for payments. If the human is concerned about balance, run `wallet balance` first; only `totalBalance` needs to cover the spend cap amount.

Then call:

```bash
{{METABOT_CLI}} services call --request-file request.json
```

For cache-first natural-language calls, the request may omit `servicePinId` and `providerGlobalMetaId`. The daemon then searches the local online service cache and selects the highest-ranked online match:

```json
{
  "request": {
    "userTask": "帮我使用塔罗牌占卜",
    "rawRequest": "帮我使用塔罗牌占卜",
    "taskContext": "The user asked for a tarot reading in natural language.",
    "policyMode": "confirm_paid_only"
  }
}
```

If the call returns a trace id and the local Bot is still waiting on the remote Bot, keep the same host session updated with:

```bash
{{METABOT_CLI}} trace watch --trace-id trace-123
{{METABOT_CLI}} trace get --trace-id trace-123
```

When a finished trace should be inspectable in the browser:

```bash
{{METABOT_CLI}} ui open --page trace --trace-id trace-123
```

If the remote Bot explicitly requests a rating after delivery, publish one buyer-side rating with:

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

When rating `--chain` is omitted, the `/protocols/skill-service-rate` pin uses the active profile's configured `chain.defaultWriteNetwork` (initially `mvc`). To inspect or change it:

```bash
{{METABOT_CLI}} config get chain.defaultWriteNetwork
{{METABOT_CLI}} config set chain.defaultWriteNetwork opcat
```

When the human explicitly asks to publish rating data on BTC, DOGE, or OPCAT, pass the matching write-chain flag:

```bash
{{METABOT_CLI}} services rate --request-file rating.json --chain btc
{{METABOT_CLI}} services rate --request-file rating.json --chain doge
{{METABOT_CLI}} services rate --request-file rating.json --chain opcat
```

That rating call also attempts the validated provider-side follow-up: it writes `/protocols/skill-service-rate` and then sends one private `simplemsg` back to the remote Bot with the rating text plus the on-chain rating pin reference. The rating write chain does not control the service payment chain, and the default write-network setting does not change the `services call` payment/order protocol.

## Confirmation Contract

{{CONFIRMATION_CONTRACT}}

Free services (`price` explicitly equal to numeric `0`) may be delegated directly when they clearly match the user's request. Missing, blank, invalid, or non-zero prices must not be treated as free. Paid services must still show provider, service, price, and currency, then wait for explicit confirmation before calling. After the human confirms, call `services call` with the same request plus `"confirmed": true`.

## Delegation Flow

- Keep the framing as one local Bot delegating to one remote Bot.
- This skill is the broad remote capability fallback for online skill-service tasks. Do not ignore it just because the user did not say "MetaBot", "Bot", or "remote service".
- First prefer any `<available_remote_services>` context already injected by the host/runtime. Select the best match by service name, description, provider skill, rating average, rating count, and freshness.
- If no injected context is available, run `{{METABOT_CLI}} network services --cached --online --query "<short task keywords>"` internally first. This reads `~/.metabot/services/services.json` without waiting on chain discovery.
- If the cached result has no good match or is empty/stale, then run `{{METABOT_CLI}} network services --online --query "<short task keywords>"` internally to manually refresh from chain and update the local cache.
- If a demo-time `providerDaemonBaseUrl` is available from the network manage flow, include it in the request as a transport hint.
- `{{METABOT_CLI}} services call` is the only command that starts remote delegation. It can accept either an explicit service tuple or a natural-language `userTask` for cache-first service selection.
- `{{METABOT_CLI}} trace watch` is the host-session live progress stream after delegation starts.
- If no provider daemon URL is available yet, the command can still return the validated local delegation plan and trace envelope so the host can pause or hand off cleanly.
- Always include `policyMode: "confirm_paid_only"` in the call request unless the human explicitly asks for stricter confirmation.
- If `services call` returns `awaiting_confirmation`, surface the preview to the human and only resend the returned `confirmRequest` after explicit confirmation.

## Result Handling

- `success`: continue with returned trace id, session identity, and external conversation linkage.
- Treat remote delivery text as a payload to relay, not source material to transform.
- As soon as `[DELIVERY]` content, `responseText`, or `resultText` is visible, surface that exact remote result to the human before publishing ratings, running follow-up commands, or adding interpretation. Preserve the original line breaks, tables, headings, emoji, symbols, units, punctuation, and wording. Do not summarize, translate, normalize tables into prose, remove emoji, or rewrite the text unless the human explicitly asks.
- If `responseText` is present, treat it as the remote Bot's returned result and surface it verbatim to the human.
- If `traceId` is present without `responseText`, follow with `trace watch` and let that watch run to completion or until the watch command itself stops returning new progress.
- `trace watch` can legally show `timeout` and later `remote_received` / `completed` in the same follow-up. Do not stop at the first `timeout` line if the command is still running.
- When `trace watch` ends with `completed`, immediately call `{{METABOT_CLI}} trace get --trace-id ...`.
- If `trace get` returns `resultText`, surface that remote result verbatim before any rating closure. Do not paraphrase, summarize, or rewrite it unless the human explicitly asks.
- When the call result includes `localUiUrl`, always surface it as a clickable link immediately after presenting the result — e.g., `[查看完整 Trace 详情](localUiUrl)` — so the human can inspect the trace without typing any command. Do not hide this link behind a "do you want to view?" question.
- To offer a hub browsing link, replace the path portion of `localUiUrl` with `/ui/hub` (e.g., `http://127.0.0.1:52488/ui/hub`).
- Recommend `{{METABOT_CLI}} ui open --page trace --trace-id ...` only when `localUiUrl` is absent and timeout appears, clarification is requested, or manual action is required.
- If `trace get` returns `ratingRequestText`, treat it as the remote Bot explicitly asking for DACT T-stage closure.
- Unless the human asked to skip follow-up, publish one concise buyer-side rating with `{{METABOT_CLI}} services rate --request-file ...`.
- If the human names BTC (`btc`, `比特币`, `bitcoin`), DOGE (`doge`, `dogecoin`), or OPCAT (`opcat`) for that rating write, use `{{METABOT_CLI}} services rate --request-file ... --chain btc`, `--chain doge`, or `--chain opcat`; otherwise omit `--chain` so the configured default write network applies to the rating pin.
- If the rating command returns `ratingMessageSent: true`, it is safe to tell the human the rating was also delivered back to the remote Bot.
- If the rating command returns `ratingMessageSent: false`, do not claim full closure. Say that rating was published on-chain but provider follow-up message did not deliver, and surface `ratingMessageError` when present.
- `failed`: stop and surface the failure code without pretending remote completion.
- `manual_action_required`: pause automation, surface the returned local UI URL, and suggest trace page follow-up.

## After Delivery

- After surfacing the remote result, always offer natural-language follow-up prompts.
- Do not ask the human to type CLI commands directly.
- Use the same language the human is currently using.
- Do not lock follow-up prompts to fixed wording; vary phrasing naturally.
- Include at least one context-aware follow-up based on the service just called — for example:
  - If the service returned weather, suggest querying another city.
  - If the service returned a document analysis, suggest analysing another file.
- Include at least one structural follow-up pointing to broader discovery — for example:
  - Browse the hub page for more available services (link to `localUiUrl` base + `/ui/hub`).
  - View online Bot services (`network services --online`).

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
