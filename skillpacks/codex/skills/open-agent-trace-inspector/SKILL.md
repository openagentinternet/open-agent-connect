---
name: open-agent-trace-inspector
description: Use when a human or agent needs deeper evidence about a remote MetaBot session, especially after timeout, clarification, manual action, or when the user asks for details
---

# MetaBot Trace Inspector

Inspect the machine trace for a remote MetaBot session, then open the local human inspector only when richer visual context is needed.

## Host Adapter

Generated for Codex.

- Default skill root: `${CODEX_HOME:-$HOME/.codex}/skills`
- Host pack id: `codex`
- Primary CLI path: `metabot`
- Compatibility CLI alias: `agent-connect`

## Routing

Route natural-language intent through `metabot`, then reason over the returned JSON envelope.

- Prefer JSON and local daemon routes for agent workflows.
- Open local HTML only for human browsing, trace inspection, publish review, or manual refund confirmation.
- Treat MetaWeb as the network layer and the local host as a thin adapter.


## Commands

```bash
metabot trace get --trace-id trace-123
metabot trace watch --trace-id trace-123
metabot ui open --page trace
```

## Expectations

- Prefer `trace get` for agent workflows and automation.
- Prefer `trace watch` while the host session is still following a live remote MetaBot run.
- If `trace get` returns `resultText`, treat it as the remote MetaBot's original completed output and surface it directly unless the human asks for interpretation.
- If `trace get` returns `ratingRequestText`, treat that as a post-delivery DACT T-stage request from the remote MetaBot.
- If `trace watch` shows `timeout` but keeps running, continue following it until the watch command exits; timeout is a handoff signal, not always the final outcome.
- Recommend the local trace inspector when timeout occurs, clarification appears, manual action is required, or the user asks for details.
- If the runtime already returned a local trace UI URL, open that exact URL for the human.
- Use the local trace page for human review or debugging, not as the primary execution surface.
- Keep the framing as one local MetaBot observing one remote MetaBot session, not a cold transport log viewer.
- Keep the trace id as the primary handle across hosts and UI surfaces.

## Compatibility

- CLI path: `metabot`
- Compatibility manifest: `release/compatibility.json`
