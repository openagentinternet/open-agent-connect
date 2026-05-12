# Ask Master Release Runbook

Historical note: this is a feature-specific Ask Master acceptance runbook. It
is not the current public launch posture for Open Agent Connect. The current
public surface should be validated through identity creation, online Bot
discovery, private Bot-to-Bot messaging, remote Skill-Service calls, trace
inspection, and rating closure. Use
[`cross-host-demo-runbook.md`](cross-host-demo-runbook.md) for the public
network smoke path.

Use this runbook only when explicitly validating the Ask Master feature path.

It verifies the Ask Master feature posture for dedicated Ask Master work:

- `manual` lane is supported
- `suggest` lane is supported
- the global Ask Master switch is supported through `askMaster.enabled`
- the public trigger-mode switch is supported through `askMaster.triggerMode`
- preview/confirm remains the required public contract before dispatch

This runbook is intentionally different from the DACT cross-host demo. It validates the Ask Master feature path, not the current public Open Agent Connect surface.

## Preconditions

Before starting the acceptance flow:

1. Install or refresh the Codex host pack by following [docs/hosts/codex-agent-install.md](../hosts/codex-agent-install.md).
2. Keep one provider online with a published Debug Master fixture.
3. Start from a fresh caller session after the install smoke is green.

## Public Controls

Verify the public Ask Master controls first:

```bash
metabot config get askMaster.enabled
metabot config get askMaster.triggerMode
```

Release expectation:

- `askMaster.enabled` returns `true`
- `askMaster.triggerMode` returns `suggest`

Optional switch checks:

```bash
metabot config set askMaster.enabled false
metabot config get askMaster.enabled
metabot config set askMaster.enabled true
metabot config set askMaster.triggerMode manual
metabot config get askMaster.triggerMode
metabot config set askMaster.triggerMode suggest
```

Release expectation:

- `askMaster.enabled` can be toggled off and back on
- `askMaster.triggerMode` accepts `manual` and `suggest`
- the public CLI should reject `askMaster.triggerMode auto`

## Provider Setup

Provider terminal:

```bash
metabot identity create --name "Debug Master Provider"
metabot master publish --payload-file e2e/fixtures/master-service-debug.json
metabot daemon start
```

Capture the provider base URL shown by the daemon.

## Caller Setup

Caller terminal:

```bash
metabot identity create --name "Caller Bot"
metabot network sources add --base-url <provider-base-url>
metabot master list --online
cp e2e/fixtures/master-ask-request.json /tmp/master-request.json
```

Before sending, edit `/tmp/master-request.json` so `target.servicePinId` and `target.providerGlobalMetaId` match one row from `metabot master list --online`.

## Manual Lane

Run:

```bash
metabot master ask --request-file /tmp/master-request.json
metabot master ask --trace-id <preview-trace-id> --confirm
metabot master trace --id <real-trace-id>
```

Pass criteria:

- the first command returns a preview and `awaiting_confirmation`
- the preview stays on Ask Master semantics
- the flow does not degrade into private chat, `/protocols/simplemsg`, or old advisor commands
- confirm dispatches the request and returns a real Ask Master trace
- `metabot master trace --id ...` shows the Ask Master result path

## Suggest Lane

Start from a fresh Codex session with:

- `askMaster.enabled = true`
- `askMaster.triggerMode = suggest`

Prepare a suggest input that reflects a stuck or risky situation:

```bash
cp e2e/fixtures/master-suggest-request.json /tmp/master-suggest-request.json
metabot master suggest --request-file /tmp/master-suggest-request.json > /tmp/master-suggest-result.json
```

Then accept the suggestion and continue through the normal Ask Master preview/confirm path:

```bash
SUGGEST_TRACE_ID="$(jq -r '.data.suggestion.traceId' /tmp/master-suggest-result.json)"
SUGGESTION_ID="$(jq -r '.data.suggestion.suggestionId' /tmp/master-suggest-result.json)"
cat >/tmp/master-accept-suggest.json <<EOF
{
  "action": {
    "kind": "accept_suggest",
    "traceId": "${SUGGEST_TRACE_ID}",
    "suggestionId": "${SUGGESTION_ID}"
  }
}
EOF
metabot master host-action --request-file /tmp/master-accept-suggest.json
metabot master ask --trace-id <preview-trace-id> --confirm
```

Pass criteria:

- the host surfaces an Ask Master suggestion first
- the suggest lane is induced through `metabot master suggest --request-file ...`, not a manual ask
- the operator can accept that suggestion with `accept_suggest` through `metabot master host-action --request-file ...`
- accepted `suggest` enters the same preview/confirm path as `manual`
- the host does not fall back to private chat, `/protocols/simplemsg`, or stale `advisor` commands
- after confirmation, the trace remains an Ask Master trace

## Release Verdict

The release acceptance is green only if all of the following are true:

- install smoke is green
- manual lane is green
- suggest lane is green
- the global Ask Master switch is visible and works
- the public trigger-mode switch stays limited to `manual` and `suggest`
- the caller-facing flow always preserves preview/confirm before dispatch
