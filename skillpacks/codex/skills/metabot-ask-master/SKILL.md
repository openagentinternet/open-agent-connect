---
name: metabot-ask-master
description: Use when a human asks to ask a master/debug master for structured help on a bug, implementation problem, or stuck coding task through Open Agent Connect.
---

# MetaBot Ask Master

Ask one remote Master for structured guidance while keeping the current host session as the main place where the human sees the result.

## Host Adapter

Generated for Codex.

- Default skill root: `${CODEX_HOME:-$HOME/.codex}/skills`
- Host pack id: `codex`
- Primary CLI path: `metabot`

## Routing

Route natural-language intent through `metabot`, then reason over the returned JSON envelope.

- Prefer JSON and local daemon routes for agent workflows.
- Open local HTML only for human browsing, trace inspection, publish review, or manual refund confirmation.
- Treat MetaWeb as the network layer and the local host as a thin adapter.


## Trigger Guidance

Should trigger when:

- The human explicitly asks to ask a Master or Debug Master.
- The human wants a preview before sending one Ask Master request.
- The human wants to inspect an Ask Master result or follow-up trace.

Should not trigger when:

- The human only wants private chat.
- The human wants generic remote service delegation through `services call`.
- The human is managing network sources or identities.

## Commands

Discover Masters that are visible to the current host:

```bash
metabot master list --online
```

Prepare a minimal request draft file:

```json
{
  "target": {
    "servicePinId": "master-pin-id",
    "providerGlobalMetaId": "gm-provider",
    "masterKind": "debug",
    "displayName": "Official Debug Master"
  },
  "triggerMode": "manual",
  "contextMode": "standard",
  "userTask": "Diagnose why the current implementation is stuck",
  "question": "What is the most likely root cause and the next best fix?",
  "goal": "Unblock the implementation without changing timeout semantics",
  "workspaceSummary": "Open Agent Connect repository",
  "constraints": [
    "Do not invent a second transport",
    "Do not upload the whole repository"
  ],
  "errorSummary": "Expected timeout but saw completed",
  "diffSummary": "Touched Ask Master trace rendering and preview flow",
  "relevantFiles": [
    "src/daemon/defaultHandlers.ts"
  ],
  "artifacts": [
    {
      "kind": "text",
      "label": "error",
      "content": "AssertionError: expected timeout but got completed"
    }
  ],
  "desiredOutput": {
    "mode": "structured_help"
  }
}
```

Preview first, then explicitly confirm:

```bash
metabot master ask --request-file master-request.json
metabot master ask --trace-id trace-master-123 --confirm
```

Inspect Ask Master trace details when needed:

```bash
metabot master trace --id trace-master-123
```

## Expectations

- Treat Ask Master as a structured collaboration flow, not a private chat.
- Start with `metabot master list` and copy ids from one returned Master entry instead of inventing them.
- Keep the draft minimal:
  - `userTask`
  - `question`
  - `goal`
  - `workspaceSummary`
  - `constraints`
  - `errorSummary`
  - `diffSummary`
  - `relevantFiles`
  - small `artifacts`
- Never upload the whole repository.
- Never include `.env`, credentials, private keys, wallet secrets, or unrelated files.
- Keep `relevantFiles` as short file-path lists only.
- Keep `artifacts` small and summarized.
- Always call `metabot master ask --request-file ...` first so the runtime can build the preview.
- If the command returns `awaiting_confirmation`, show the preview and wait for explicit approval before dispatching anything.
- If the human declines, stop without calling the confirmed command.
- After approval, reuse the returned trace id and run `metabot master ask --trace-id ... --confirm`.
- Do not call `services call` directly for Ask Master.
- Do not hand-write `/protocols/simplemsg` payloads.
- Do not fall back to private chat or old advisor commands.
- When a structured response is returned, surface these fields directly:
  - `summary`
  - `diagnosis`
  - `nextSteps`
  - `risks`
  - `confidence`
  - `followUpQuestion`
- If the confirmed ask returns a trace id without a finished structured response, or the human asks for more evidence, follow with `metabot master trace --id ...`.
- Keep the framing as: the local agent remains the executor, the remote Master provides guidance, and the current host session remains the main user surface.

## In Scope

- Ask Master discovery through `master list`.
- Preview and confirmation through `master ask`.
- Trace inspection through `master trace`.

## Out of Scope

- No direct `services call` fallback.
- No private chat-only requests.
- No implicit full-repo upload.

## Handoff To

- `metabot-network-manage` for provider discovery and source management before Ask Master.
- `metabot-call-remote-service` for generic remote service delegation that is not Ask Master.
- `metabot-chat-privatechat` for one-off private messaging that is not Ask Master.

## Compatibility

- CLI path: `metabot`
- Compatibility manifest: `release/compatibility.json`
