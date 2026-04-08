---
name: metabot-call-remote-service
description: Use when a local agent can satisfy a task by delegating it to an online remote MetaBot over MetaWeb and should keep the result in the current host session
---

# MetaBot Call Remote Service

Delegate one task to a remote MetaBot over MetaWeb while preserving the validated order, spend-cap, confirmation, and trace semantics.

## Host Adapter

{{HOST_SKILLPACK_METADATA}}

## Routing

{{SYSTEM_ROUTING}}

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
```

## Confirmation Contract

{{CONFIRMATION_CONTRACT}}

## Delegation Flow

- Keep the framing as one local MetaBot delegating to one remote MetaBot.
- If a demo-time `providerDaemonBaseUrl` is available from the service directory or local yellow-pages flow, include it in the request as a transport hint.
- `{{METABOT_CLI}} services call` should be the only command that starts the remote delegation.
- `{{METABOT_CLI}} trace watch` should be the host-session progress stream after delegation starts.
- If no provider daemon URL is available yet, the command can still return the validated local delegation plan and trace envelope so the host can pause or hand off cleanly.

## Result Handling

- `success`: continue with the returned trace id, session identity, and external conversation linkage.
- If `responseText` is present, treat it as the remote MetaBot's returned result and surface it directly to the human.
- If `traceId` is present without `responseText`, follow with `trace watch` so the human can see the remote MetaBot receive, execute, and complete the task.
- If `trace watch` reaches `timeout`, explain that the current host wait ended but the remote MetaBot may still continue processing.
- If provider-side trace paths are present, keep them as evidence for later inspection.
- `failed`: stop and surface the failure code without pretending the remote MetaBot completed the task.
- `manual_action_required`: pause automation, surface the returned local UI URL, and recommend the trace inspector when deeper evidence is useful.

## Compatibility

- CLI path: `{{METABOT_CLI}}`
- Compatibility manifest: `{{COMPATIBILITY_MANIFEST}}`
