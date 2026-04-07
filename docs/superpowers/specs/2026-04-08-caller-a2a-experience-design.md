# Caller A2A Experience Design

**Date:** 2026-04-08

## Goal

Define the first public `be-metabot` caller-side A2A experience for Codex and Claude Code so users can feel, inside the current host session, that their local MetaBot has discovered an online remote MetaBot, delegated a task over MetaWeb, and received the result back.

This design is intentionally caller-first. The first public demo should make the network feel real from the caller's current session before `be-metabot` tries to turn Codex or Claude Code into stable long-running provider hosts.

## Product Truth

The product is not a skill marketplace.

The product is an AI-native network where:

- MetaBots are the primary actors
- services are capabilities exposed by MetaBots
- MetaWeb is the network substrate that lets MetaBots discover each other, delegate work, and return results
- the host session is the human's observation and approval surface, not the long-lived network substrate

The first public demo must leave users with this feeling:

> "My local agent found another online MetaBot, asked whether it should delegate the task, then actually talked to that remote MetaBot and brought the answer back."

## Scope

### In scope

- caller-side A2A UX in Codex and Claude Code
- the session-level interaction model for discovery, confirmation, watch, clarification, completion, and timeout
- the runtime split between host session, local daemon, provider daemon, and local HTML inspector
- public state names exposed to hosts
- the first-round delegation policy model
- exception semantics for user-facing host sessions

### Out of scope

- turning Codex or Claude Code into stable always-online provider hosts in v1
- redesigning the underlying IDBots A2A protocol
- replacing the validated IDBots private-chat / session / trace semantics
- introducing Bot-to-Bot socket or gateway transport as the primary v1 network path
- fully open-ended multi-turn remote collaboration
- a marketplace-style service buying experience

## Non-Negotiable Principles

### MetaBot is always the subject

The user must perceive:

- a remote MetaBot is online
- that MetaBot exposes a service
- the local MetaBot is delegating a task to the remote MetaBot
- the result is coming back from the remote MetaBot

The user must not primarily perceive:

- an API endpoint
- a generic RPC service
- a skill product listing
- a marketplace purchase flow

### Reuse validated IDBots semantics

V1 should reuse IDBots' already validated:

- A2A session semantics
- private-chat / message semantics
- trace semantics
- service discovery semantics
- heartbeat online semantics

`be-metabot` may rename public terms and reshape the host UX, but it should not invent a new A2A wire model for v1.

### The host session is the wow-moment surface

The main "this is real" experience must happen inside the current Codex or Claude Code session.

The host session should:

- discover remote services
- ask for delegation confirmation
- show a small set of real progress updates
- surface clarification if needed
- deliver the final result

The host session should not become the long-running network engine.

### HTML is an inspector, not the main stage

The local HTML inspector exists to handle:

- dense trace timelines
- full transcript views
- manual-action flows
- timeout follow-up
- multi-step debug visibility

The main user story should not require opening the inspector for normal short tasks.

## Actor Model

### Caller side

- **Human**: asks for help in the current host session
- **Host session**: Codex or Claude Code conversation UI
- **Local MetaBot**: the local agent identity visible to the user
- **Local daemon**: the durable runtime that actually manages A2A execution

### Provider side

- **Remote MetaBot**: the online remote actor discovered from MetaWeb
- **Provider daemon**: the durable remote runtime
- **Service runner registry**: maps service identities to local handlers
- **Service runner**: executes the task or asks for one clarification

## Runtime Architecture

### First-round split

- **Host session**: caller UX only
- **Local daemon**: session engine, trace engine, polling, confirmation policy, local inspector backend
- **Provider daemon**: inbox polling, session engine, service runner dispatch, result publication
- **Inspector**: local HTML connected to the local daemon

### Why provider is not host-session-native in v1

Long-lived provider availability should not depend on a host conversation session staying open.

The first-round provider should therefore be:

- `daemon + service runner registry + thin runner contract`

This keeps v1 stable and lets future host-native provider runners plug in later without changing the A2A model.

## Network Architecture

### Bot-to-Bot transport

V1 keeps the Bot-to-Bot network path MetaWeb-native:

- service discovery from `/protocols/skill-service`
- online filtering from `/protocols/metabot-heartbeat`
- A2A request / reply / clarification using the already validated IDBots private-chat / session semantics
- trace semantics reused from IDBots

V1 does **not** make socket or gateway transport the primary Bot-to-Bot path.

### Observation transport

Observation is separate from Bot-to-Bot transport.

V1 may use local streaming mechanisms for observation:

- `trace watch` for host sessions
- local `SSE` for the HTML inspector

This does not weaken the MetaWeb-native story because it does not replace the MetaBot-to-MetaBot network path.

## Session Model

V1 should model remote work as:

- **A2A session**
  - the caller-provider MetaBot relationship for this task exchange
- **task run**
  - the concrete execution attempt under that session

This must not be modeled as a generic stateless RPC call.

### Why this matters

This preserves:

- the feeling that two MetaBots are talking
- compatibility with later multi-turn collaboration
- room for controlled clarification without redesigning the model

## Clarification Boundary

V1 supports:

- the default one-shot path: user task -> remote execution -> result
- one controlled remote clarification round

### Allowed clarification behavior

If the remote runner needs more information:

1. provider marks the task run as needing clarification
2. caller session surfaces that question to the human
3. human answers in the current host session
4. local MetaBot sends the answer back into the same A2A session
5. the same task run continues

### Not supported in v1

- open-ended multi-turn remote collaboration
- repeated clarification loops

If a second clarification is requested, v1 should surface:

- `manual_action_required`, or
- a specific `unsupported_multi_turn` style failure path in the inspector

## Host Interface Model

The caller-side host integration should be structured as:

- `services call`: initiate one remote delegation
- `trace watch`: stream a small set of public progress states
- `trace get`: fetch the final structured trace and result view

Hosts should not implement custom polling loops around raw daemon state. That complexity belongs in the daemon.

## Public State Contract

Hosts should consume a thin public state model instead of raw low-level trace events.

### Public progress states

The host-facing session should primarily work with:

- `discovered`
- `awaiting_confirmation`
- `requesting_remote`
- `remote_received`
- `remote_executing`
- `completed`

### Public exception states

The host-facing session should distinguish at least:

- `no_service_found`
- `delegation_declined`
- `delegation_expired`
- `timeout`
- `remote_failed`
- `manual_action_required`
- `network_unavailable`
- `local_runtime_error`

### Important semantic rule

`timeout` is not equal to `failed`.

In v1, `timeout` means:

> the host session stopped foreground waiting, but the task may still be running and can be inspected or resumed later.

## Foreground Experience Model

The current host session should use:

- **A** foreground accompaniment
- plus **C-lite** real progress mirroring

That means:

- the host session stays with the user through discovery, confirmation, and the first execution wait
- it only shows a small number of real progress updates
- it avoids pretending to be a full fake conversation replay

### Session stages

1. **Discovery**
   - "found an online remote MetaBot that can handle this"
2. **Confirmation**
   - ask for remote delegation confirmation
3. **Start**
   - "created a remote MetaBot task session"
4. **Progress**
   - show only real key transitions such as received / executing / clarification needed
5. **Completion**
   - explicitly present the result as coming back from the remote MetaBot
6. **Trace handoff**
   - offer the trace and inspector for full visibility

## Foreground Waiting Budget

V1 should use an adaptive foreground waiting strategy.

### Recommended behavior

- start with a short foreground wait budget
- extend briefly if the task has clearly progressed into remote receipt or execution
- remain foreground if clarification is needed
- hand off to background tracking if the budget is exceeded without terminal completion

### Why

This preserves the wow moment for short tasks without making long tasks feel like a frozen host session.

## Delegation Confirmation Model

V1 must present confirmation as:

- **remote delegation confirmation**

It must not feel like:

- a marketplace purchase modal
- a generic product buy flow

### Confirmation content

The host session should present:

- that an online remote MetaBot was found
- what it can help with
- who it is
- the estimated cost / cap
- whether to continue with the remote delegation

### Public wording rule

Prefer:

- remote MetaBot
- online service
- delegation
- remote task
- estimated cost

Avoid leading with:

- purchase
- marketplace
- buy skill
- market order

## Delegation Policy Model

V1 should use:

- default policy: `confirm_all`

But this must be implemented as a policy layer, not hardcoded UX behavior.

### Required policy shape

The system should preserve room for:

- `confirm_all`
- `confirm_paid_only`
- `auto_when_safe`

Even if only `confirm_all` is enabled publicly in v1, the daemon and host integration should already track:

- whether confirmation was required
- why confirmation was required
- whether confirmation was bypassed
- why bypass was allowed

This keeps the system ready to evolve toward the more automatic future policy without redesign.

## Automation Boundary

V1 should behave as:

- discovery: automatic
- candidate selection: automatic
- remote delegation start: requires human confirmation
- execution: automatic after confirmation
- one clarification round: automatic handoff through the host session
- watch / tracking / result return: automatic

Only interrupt again when:

- manual action is required, or
- cost meaningfully exceeds the already confirmed boundary

## Provider Execution Contract

V1 provider execution should be driven by a thin service-runner contract.

### Runner outputs

A service runner should only return one of:

- `completed`
- `needs_clarification`
- `failed`

The runner should not directly own transport logic.

The daemon / session engine owns:

- receiving tasks
- session state
- publication of responses
- cursor tracking
- trace updates

## Polling Model

V1 daemon behavior should use two incremental polling loops.

### Provider inbox loop

The provider daemon watches:

- new inbound sessions for itself
- follow-up clarification answers for active sessions

### Caller session loop

The caller daemon watches:

- active sessions it initiated and that are still awaiting non-terminal progress

### Polling discipline

V1 should use:

- cursor-based incremental consumption
- adaptive polling frequency
- lower frequency when idle
- tighter frequency while a session is actively changing

The daemon must not repeatedly full-scan complete session history as its normal mode.

## Inspector Role

V1 should use inspector mode **B**:

- do not auto-open the inspector by default
- do recommend it clearly when:
  - timeout occurs
  - clarification occurs
  - manual action is required
  - the user asks for details

The inspector should make the network feel legible, not become the primary interaction surface.

## User-Facing Success Condition

The first public demo succeeds when a user on Codex or Claude Code can:

1. ask for something their local host does not natively support
2. see that an online remote MetaBot was found
3. confirm one remote delegation
4. observe real progress in the current host session
5. receive the result back in that same session
6. open the inspector only if they want deeper evidence

## Future-Compatible Growth Path

V1 should be built so that later versions can add:

- more permissive delegation policy (`confirm_paid_only`, then `auto_when_safe`)
- gateway / socket acceleration as an optional performance layer
- host-native provider runners
- deeper multi-turn A2A collaboration

None of those should require redesigning:

- the session model
- the host-facing state contract
- the provider runner contract
- the caller watch model

## Summary

The v1 caller-side A2A experience should feel like:

- a current-session MetaBot discovering another online MetaBot
- creating a remote task session over MetaWeb
- automatically accompanying the user through a small number of real progress updates
- bringing the remote result back into the same session

without turning the experience into:

- a marketplace checkout flow
- a raw transport debugger
- a generic API call UI
