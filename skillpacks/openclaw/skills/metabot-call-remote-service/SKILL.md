---
name: metabot-call-remote-service
description: Use when a local agent can satisfy a task by delegating it to an online remote MetaBot over MetaWeb and should keep the result in the current host session
---

# MetaBot Call Remote Service

Delegate one task to a remote MetaBot over MetaWeb while preserving the validated order, spend-cap, confirmation, and trace semantics.

## Host Adapter

Generated for OpenClaw.

- Default skill root: `${OPENCLAW_HOME:-$HOME/.openclaw}/skills`
- Host pack id: `openclaw`
- CLI path: `metabot`

## Routing

Route natural-language intent through `metabot`, then reason over the returned JSON envelope.

- Prefer JSON and local daemon routes for agent workflows.
- Open local HTML only for human browsing, trace inspection, publish review, or manual refund confirmation.
- Treat MetaWeb as the network layer and the local host as a thin adapter.


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
metabot services call --request-file request.json
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
metabot services rate --request-file rating.json
```

If the call returns a trace id and the local MetaBot is still waiting on the remote MetaBot, keep the same host session updated with:

```bash
metabot trace watch --trace-id trace-123
```

## Confirmation Contract

Before any paid remote call, show the provider, service, price, currency, and wait for explicit confirmation.

- If the human declines, do not call the remote MetaBot.
- If a spend cap is missing or ambiguous, ask for one before proceeding.
- If the runtime returns `manual_action_required`, surface the local UI URL and pause.


## Delegation Flow

- Keep the framing as one local MetaBot delegating to one remote MetaBot.
- If a demo-time `providerDaemonBaseUrl` is available from the service directory or local yellow-pages flow, include it in the request as a transport hint.
- `metabot services call` should be the only command that starts the remote delegation.
- `metabot trace watch` should be the host-session progress stream after delegation starts.
- If no provider daemon URL is available yet, the command can still return the validated local delegation plan and trace envelope so the host can pause or hand off cleanly.

## Result Handling

- `success`: continue with the returned trace id, session identity, and external conversation linkage.
- If `responseText` is present, treat it as the remote MetaBot's returned result and surface it directly to the human.
- If `traceId` is present without `responseText`, follow with `trace watch` and let that watch run to completion or until the watch command itself stops returning new progress.
- `trace watch` can legally show `timeout` and later `remote_received` / `completed` in the same follow-up. Do not stop at the first `timeout` line if the command is still running.
- When `trace watch` ends with `completed`, immediately call `metabot trace get --trace-id ...`.
- If `trace get` returns `resultText`, surface that remote result verbatim. Do not paraphrase, summarize, or rewrite it unless the human explicitly asks you to.
- If `trace get` returns `ratingRequestText`, treat it as the remote MetaBot explicitly asking for the DACT T-stage to finish.
- Unless the human asked to skip follow-up, publish one concise buyer-side rating with `metabot services rate --request-file ...`.
- The rating should be written in the local MetaBot's voice as the buyer. Prefer a factual 1-2 sentence comment tied to the actual result. If the human has not complained and the remote result appears usable, a positive 4-5 score is the default.
- Only explain timeout to the human when the full follow-up still ends without a later completion.
- If provider-side trace paths are present, keep them as evidence for later inspection.
- `failed`: stop and surface the failure code without pretending the remote MetaBot completed the task.
- `manual_action_required`: pause automation, surface the returned local UI URL, and recommend the trace inspector when deeper evidence is useful.

## Compatibility

- CLI path: `metabot`
- Compatibility manifest: `release/compatibility.json`
