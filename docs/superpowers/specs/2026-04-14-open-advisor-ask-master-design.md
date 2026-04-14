# Open Advisor / Ask Master Design

**Date:** 2026-04-14

## Goal

Define the first `Open Agent Connect` advisor experience so a local coding agent can ask a stronger remote master agent for targeted guidance over Open Agent Internet, receive a structured answer, and continue executing locally.

The immediate product outcome should feel simple:

- a local coding agent gets stuck
- the user or local agent asks a remote master for help
- the remote master returns diagnosis and next steps
- the local agent keeps working in the same host session

This round is intentionally **advisor-first**, not marketplace-first and not remote-executor-first.

## Background

`Open Agent Connect` already has the most important primitives needed for this round:

- local MetaBot identity and daemon
- remote service discovery
- caller-side `services call`
- provider-side service publish and presence
- trace watch / trace get
- local inspector pages
- validated remote request / response semantics through the current DACT path

What is still missing is a product surface that is:

- more frequent than full remote task outsourcing
- easier to understand than a general skill marketplace
- lighter-weight than handing repository execution to a remote agent
- clearly useful even before a large open network exists

`Ask Master` fits that gap.

## Product Truth

This round is not a generic marketplace.

This round is not a full remote execution platform.

This round is not "one more chat with another model."

This round is about one specific user feeling:

> "My local coding agent got stuck, asked a stronger master agent over the open network, received real guidance, and then kept working."

The product story should be:

- the local agent remains the executor
- the remote master provides judgment, diagnosis, and planning
- the host session remains the main user surface
- the open network remains visible through discovery, identity, trace, and optional pricing metadata

## Source Of Truth

This round should reuse the current `Open Agent Connect` remote-service path instead of inventing a second A2A transport stack.

Primary references in the current repo:

- `src/cli/commands/services.ts`
- `src/core/orders/orderLifecycle.ts`
- `src/core/orders/orderMessage.ts`
- `src/core/orders/serviceOrderProtocols.ts`
- `src/daemon/routes/services.ts`
- `src/daemon/routes/trace.ts`
- `src/daemon/routes/provider.ts`
- `tests/services/remoteCall.test.mjs`
- `docs/superpowers/specs/2026-04-08-caller-a2a-experience-design.md`
- `docs/superpowers/specs/2026-04-10-service-rating-closure-design.md`

### Design stance

`Ask Master` should be implemented as a **constrained advisor profile** on top of the current DACT / service-order model.

That means:

- discovery should continue to use the existing service directory path
- caller-side execution should continue to use the existing order / trace machinery
- provider-side handling should continue to use the existing service-runner direction
- new behavior should come from a constrained advisor contract, not from a second network protocol

## Scope

### In scope

- one user-facing `Ask Master` / `advisor` flow for coding-agent hosts
- official free masters as the first supply source
- structured advisor request payloads
- structured advisor response payloads
- caller-side confirmation before sending context
- trace-visible advisor activity
- host-session continuation after the response
- service discovery filtering for advisor-capable masters
- minimal price metadata in the model, even if settlement stays disabled in v1

### Out of scope

- remote master directly editing local files
- remote master running tools inside the caller's workspace
- generalized multi-turn chat between local and remote agents
- open-ended marketplace browsing UI
- automated settlement and payment broadcast in v1
- complex reputation systems
- broad human-to-human consultation workflows
- replacing the current DACT transport model

## Non-Negotiable Principles

### Master is advisor, not executor

The remote master should:

- diagnose
- critique
- propose next steps
- ask at most one focused follow-up question in a later round if needed

The remote master should not, in v1:

- take over the repo
- run arbitrary tools on the caller's machine
- submit code directly into the caller workspace

If this boundary is blurred too early, the product becomes much harder to trust, explain, and test.

### Reuse the current service-order path

V1 should not create a parallel "advisor transport."

Instead, it should reuse:

- current service discovery
- current caller confirmation model
- current trace model
- current provider execution direction

The new work should be a contract profile, not a new transport family.

### User-facing term can be "master", runtime term should be "advisor"

Recommended language split:

- user-facing action: `ask master`
- runtime and protocol term: `advisor`

This keeps the user intent intuitive while keeping the code and protocol neutral enough for future expansion.

### Minimal context, explicit consent

The caller must be able to see what is being sent before the advisor request leaves the machine.

The first round should prefer:

- task summary
- error summary
- diff summary
- selected file summaries
- optional small excerpts

It should not silently upload whole repositories or broad transcript histories.

### The host session is the wow-moment surface

The primary user story should happen in the active host session:

- ask
- confirm
- wait briefly
- receive guidance
- continue

Local HTML remains an inspector and debug surface, not the main stage.

## Desired User Experience

### Caller-side story

The user is working in Codex, Claude Code, or OpenClaw.

The local coding agent stalls on a debugging, architecture, or review-style task.

The user says something like:

- `ask master why this patch keeps failing`
- `ask master to review this design`
- `ask master what I should do next`

The local runtime then:

1. identifies candidate advisor masters
2. composes a minimal request package
3. shows the user what will be sent
4. asks for confirmation
5. sends one advisor request
6. waits for the structured answer
7. surfaces the answer back into the current host session
8. lets the local agent continue

The user should feel:

> "I did not switch products. My local agent just reached out to a stronger remote master and got unstuck."

### Provider-side story

The first providers are official free masters.

They should behave like stable remote service providers:

- discoverable from the network
- clearly typed as advisor masters
- able to return structured advice
- visible in trace and provider observation views

Third-party providers may come later, but v1 should not depend on them.

## First-Round Master Types

V1 should ship with a very small official set:

- `Debug Master`
- `Architecture Master`
- `Review Master`

If scope must be cut further, start with:

- `Debug Master`
- `Architecture Master`

These two are frequent enough and judgment-heavy enough to demonstrate the product clearly.

## Actor Model

### Caller side

- **Human**: decides when to ask and approves context sharing
- **Host session**: current Codex / Claude Code / OpenClaw conversation
- **Local MetaBot**: the local agent identity visible to the user
- **Local daemon**: packages context, dispatches the advisor order, watches trace

### Provider side

- **Remote master MetaBot**: the advisor-capable remote actor
- **Provider daemon**: receives advisor orders and dispatches the appropriate handler
- **Advisor handler**: produces a structured diagnosis / recommendation response

## Runtime Architecture

### Advisor is a service profile, not a new subsystem

The cleanest architecture is:

- existing service directory remains the discovery surface
- existing service order model remains the transport and trace surface
- advisor-specific request and response schemas constrain what can be sent and returned

This gives v1 speed and coherence.

### Recommended layering

- **CLI / host layer**
  - exposes `advisor` commands or host-pack routing
- **advisor application layer**
  - builds request payloads, validates advisor-specific fields, formats responses
- **existing orders / services layer**
  - dispatch, trace, provider delivery
- **existing daemon and network layer**
  - actual message movement and persistence

### Suggested implementation touchpoints

These are suggested, not mandatory:

- add `src/cli/commands/advisor.ts`
- add `src/core/advisor/` for request planning, payload validation, response formatting
- extend `src/daemon/routes/services.ts` or add `src/daemon/routes/advisor.ts`
- extend provider handler registration to recognize advisor-capable services
- add `tests/advisor/`
- add one e2e demo script for `ask master`

## Discovery Model

### Discovery path

V1 should continue using the existing service directory path:

- `/protocols/skill-service`

Advisor-capable services should be discoverable through metadata filters rather than a separate top-level protocol path.

### Required advisor discovery metadata

Advisor services should add structured metadata such as:

- `serviceKind: "advisor"`
- `advisorKind: "debug" | "architecture" | "review" | "general"`
- `hostModes: ["codex", "claude-code", "openclaw"]` when relevant
- `pricingMode: "free" | "fixed"`
- `price` and `currency` if applicable
- `responseMode: "structured_advice"`

This keeps discovery aligned with the existing service system while letting hosts filter for advisor-capable masters.

## Advisor Request Contract

The advisor request should be treated as a constrained remote order payload.

### Required fields

```json
{
  "type": "advisor_request",
  "masterServicePinId": "service-debug-master",
  "providerGlobalMetaId": "master-global-metaid",
  "advisorKind": "debug",
  "userTask": "Why does this patch still fail?",
  "question": "The test still fails after two attempts. What am I missing?",
  "host": "codex",
  "workspaceSummary": "Open Agent Connect CLI and daemon project",
  "goal": "Fix the failing remote advisor flow without changing transport semantics",
  "constraints": [
    "Prefer minimal patch",
    "Do not redesign the protocol shape"
  ],
  "errorSummary": "remoteCall test assertion mismatch after close transition",
  "diffSummary": "Touched trace closure timing and provider ack handling",
  "relevantFiles": [
    "src/core/orders/orderLifecycle.ts",
    "tests/services/remoteCall.test.mjs"
  ],
  "artifacts": [
    {
      "kind": "text",
      "label": "test_output_excerpt",
      "content": "AssertionError: expected completed but got remote_executing"
    }
  ],
  "desiredOutput": "diagnosis_and_next_steps"
}
```

### Field rules

- `type` must be `advisor_request`
- `masterServicePinId` and `providerGlobalMetaId` must identify one discoverable advisor service
- `advisorKind` must align with the service metadata
- `question` is the direct ask
- `workspaceSummary`, `goal`, `constraints`, `errorSummary`, and `diffSummary` should be short, caller-generated summaries
- `relevantFiles` should be file paths only in v1, not automatic full file uploads
- `artifacts` should stay small and explicit
- `desiredOutput` should default to `diagnosis_and_next_steps`

### Context budget rules

V1 should enforce hard guardrails:

- maximum file count in `relevantFiles`
- maximum artifact count
- maximum text length per artifact
- explicit user confirmation before any artifact leaves the machine

The caller should not silently degrade into "send everything."

## Advisor Response Contract

The remote master must return a structured response, not an unbounded prose blob.

### Required fields

```json
{
  "type": "advisor_response",
  "advisorKind": "debug",
  "summary": "The failure likely comes from closing the trace before provider acknowledgment is persisted.",
  "diagnosis": [
    "Order lifecycle emits completion before provider ack is visible to the caller trace model.",
    "The test expectation assumes the ack is durable before the close transition."
  ],
  "nextSteps": [
    "Inspect the close transition in orderLifecycle.ts.",
    "Delay final completion until provider ack persistence is confirmed.",
    "Re-run remoteCall and provider route tests together."
  ],
  "risks": [
    "Changing close timing may affect timeout semantics."
  ],
  "confidence": 0.82,
  "followUpQuestion": null
}
```

### Field rules

- `type` must be `advisor_response`
- `summary` is one concise statement
- `diagnosis` is an array of concrete observations
- `nextSteps` is an ordered action list
- `risks` is optional but preferred
- `confidence` should be numeric and bounded
- `followUpQuestion` should be `null` in the default one-shot path

### Response shape constraints

The response should not directly contain:

- full code patches in v1
- raw repository rewrites
- tool call transcripts
- instructions that assume remote execution already happened

If later rounds want patch suggestions, they should be added deliberately as a separate contract extension.

## Public State Contract

Host-facing progress should stay thin and legible.

### Public progress states

- `discovered`
- `awaiting_confirmation`
- `requesting_remote`
- `remote_received`
- `advisor_analyzing`
- `advisor_responded`
- `completed`

### Public exception states

- `blocked`
- `clarification_required`
- `timed_out`
- `failed`
- `manual_action_required`

### Important semantic note

`timed_out` should still mean "the caller stopped waiting," not "the remote master definitively failed."

That existing semantic should not be broken by the advisor profile.

## CLI Surface

Recommended first-round commands:

```bash
metabot advisor list
metabot advisor ask --request-file advisor-request.json
metabot advisor trace --id trace-123
```

### Command guidance

- `advisor list`
  - shows available advisor-capable masters from the current directory view
- `advisor ask`
  - validates advisor request shape, previews sendable context, asks for confirmation, then dispatches the remote order
- `advisor trace`
  - reads the final structured answer and important trace facts

### Compatibility guidance

Internally, `advisor ask` may delegate to the existing services-call machinery.

That is desirable.

The user-facing CLI should be specialized even if the lower layer remains shared.

## Provider Contract

### Advisor-capable service behavior

An advisor provider must:

- advertise `serviceKind: advisor`
- accept one `advisor_request`
- return one `advisor_response`
- avoid assuming repository write access
- avoid indefinite open-ended conversation in v1

### Official providers

The first round should support official free masters first.

That means v1 does not need to solve:

- open provider publishing UX
- public provider ranking
- payment settlement disputes

Those can come after the caller flow proves useful.

## Pricing And Settlement

### V1 rule

Pricing metadata may exist, but automatic settlement should stay off by default in the first public round.

Recommended v1 behavior:

- official masters are `free`
- third-party metadata may later declare `fixed`
- caller still sees price metadata if present
- dispatch should block or require a stronger confirmation path if priced masters are enabled later

This keeps the first wedge about usefulness, not payment friction.

## Safety And Privacy Constraints

V1 must be conservative.

### Required safety behaviors

- always show the request preview before send
- make artifacts explicit
- support redaction or user cancel
- do not implicitly include whole files
- do not implicitly include secrets or environment files
- do not send `.env`, credentials, keys, or token-bearing material

### Host behavior constraint

If a host pack cannot produce a clean summary automatically, it should ask the local agent to summarize first instead of over-capturing raw state.

## Testing Strategy

This round should be test-heavy because the contract is narrow and easy to regress.

### Unit tests

Add focused unit tests for:

- advisor request validation
- advisor response validation
- advisor discovery filtering
- context budget enforcement
- request preview formatting
- provider result parsing

### Integration tests

Add daemon / runtime integration tests for:

- `advisor ask` reusing the services-call path correctly
- trace state transitions for advisor requests
- official-free advisor flow without settlement
- timeout semantics remaining unchanged

### E2E tests

Add at least one host-to-host advisor demo:

- caller host prepares a debug request
- official debug master returns a structured response
- caller host receives the response and surfaces next steps

### Test constraints

- tests must not require live chain writes for the main contract checks
- tests should reuse local fixture-driven provider behavior wherever possible
- advisor tests must not depend on open-ended chat behavior
- the same request should produce deterministic trace-shape expectations in test fixtures
- response validation should fail loudly on malformed structured output

## Acceptance Criteria

This round is done when all of the following are true:

- a user can discover at least one official advisor master
- a user can send one advisor request from a supported host
- the user sees an explicit send preview before dispatch
- the remote provider returns a structured advisor response
- the response is surfaced back in the current host session
- trace inspection clearly shows that the request was advisory, not general execution
- timeout and manual-action semantics still behave consistently with the existing remote-service model
- the implementation does not require a new transport family

## Explicit Non-Goals For V1

Do not let this round grow into:

- a generalized agent marketplace
- a remote coding labor platform
- a full agent chat system
- a patch-generation exchange
- a reputation token economy
- a broad monetization system

If this round succeeds, it should succeed because:

- the ask is frequent
- the contract is narrow
- the value is obvious
- the local agent remains the main worker

## Why This Matters

`Ask Master` is a stronger first wedge than handoff and a lighter wedge than full remote execution.

It proves a useful part of the larger thesis:

- local agents are not enough by themselves
- stronger guidance can live on an open network
- agent-to-agent collaboration does not have to begin as full outsourcing

If this round works, it gives `Open Agent Connect` a product story that is:

- easier to explain
- easier to demo
- easier to dogfood
- easier to expand later into paid masters, third-party masters, and richer open-agent collaboration
