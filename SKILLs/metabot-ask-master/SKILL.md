---
name: metabot-ask-master
description: Use when a human asks to ask a master/debug master for structured help on a bug, implementation problem, or stuck coding task through Open Agent Connect.
---

# MetaBot Ask Master

Ask one remote Master for structured guidance while keeping the current host session as the main place where the human sees the result.

{{HOST_ADAPTER_SECTION}}

## Routing

{{SYSTEM_ROUTING}}

## Trigger Guidance

Should trigger when:

- The human explicitly asks to ask a Master or Debug Master.
- The human wants a preview before sending one Ask Master request.
- The human wants to inspect an Ask Master result or follow-up trace.
- The host is in `suggest` mode and local Ask Master policy says a structured remote opinion is worth preparing.

Should not trigger when:

- The human only wants private chat.
- The human wants generic remote service delegation through `services call`.
- The human is managing network sources or identities.

## Commands

Discover Masters that are visible to the current host:

```bash
{{METABOT_CLI}} master list --online
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
{{METABOT_CLI}} master ask --request-file master-request.json
{{METABOT_CLI}} master ask --trace-id trace-master-123 --confirm
```

Inspect Ask Master trace details when needed:

```bash
{{METABOT_CLI}} master trace --id trace-master-123
```

## Trigger Modes

The current public Ask Master lanes are `manual / suggest`.

- `manual`: the human explicitly asks to ask one Master. Build the request, show preview, and wait for confirm before dispatch.
- `suggest`: the host proposes Ask Master because it sees a stuck or risky situation. Accepted `suggest` enters the same preview/confirm/send path as `manual` and should not silently degrade into private chat.

## Public Confirmation Contract

- Current public release contract: preview first, then explicit confirmation before dispatch.
- Treat `confirmationMode=always` as the user-facing baseline for manual and accepted suggest flows.

## Expectations

- Treat Ask Master as a structured collaboration flow, not a private chat.
- Start with `{{METABOT_CLI}} master list` and copy ids from one returned Master entry instead of inventing them.
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
- Always call `{{METABOT_CLI}} master ask --request-file ...` first so the runtime can build the preview.
- Use `{{METABOT_CLI}} master suggest --request-file ...` when the host wants the runtime to evaluate a structured stuck/risk observation and surface an Ask Master suggestion.
- If the command returns `awaiting_confirmation`, show the preview and wait for explicit approval before dispatching anything.
- If the human declines, stop without calling the confirmed command.
- After approval, reuse the returned trace id and run `{{METABOT_CLI}} master ask --trace-id ... --confirm`.
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
- If the confirmed ask returns a trace id without a finished structured response, or the human asks for more evidence, follow with `{{METABOT_CLI}} master trace --id ...`.
- Keep the framing as: the local agent remains the executor, the remote Master provides guidance, and the current host session remains the main user surface.

## Single Machine Dual Terminal Smoke

- Keep one provider terminal online with a published Debug Master fixture.
- In one caller terminal or fresh host session, verify both public lanes:
  - `manual`: preview with `{{METABOT_CLI}} master ask --request-file ...`, then confirm with `{{METABOT_CLI}} master ask --trace-id ... --confirm`.
  - `suggest`: the host calls `{{METABOT_CLI}} master suggest --request-file ...`, then after acceptance it enters preview/confirm and continues through the same confirm path.
- After a real run, inspect the result with `{{METABOT_CLI}} master trace --id ...`.

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

- CLI path: `{{METABOT_CLI}}`
- Compatibility manifest: `{{COMPATIBILITY_MANIFEST}}`
