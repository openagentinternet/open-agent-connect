# be-metabot x Multica Architecture Blueprint

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a MetaWeb-native managed MetaBot platform that combines `be-metabot`'s cross-host identity, delegation, and evolution architecture with Multica's runtime routing, task visibility, and board-style operational UX.

**Architecture:** Treat `MetaBot` as the durable global actor, `Runtime` as the replaceable execution endpoint, `Host Adapter` as the provider-specific bridge, and `MetaWeb` as the shared state, memory, and coordination substrate. Keep local execution fast and host-native, while progressively moving identity, memory, collaboration, demand, and inter-bot coordination into chain-backed protocols and read models.

**Tech Stack:** TypeScript/Node.js, local `metabot` CLI + daemon, host packs for Codex/Claude Code/OpenClaw, MetaWeb protocols, local HTML inspection pages, optional future board web app, provider adapters, local and chain-backed state stores.

---

## 1. Blueprint Intent

This document is not a direct clone plan for `multica`.

It is a synthesis plan:

- preserve `be-metabot` as a MetaWeb runtime, not a workspace-first SaaS clone
- absorb Multica's strongest ideas around runtime routing, run visibility, and board management
- upgrade the model from "one local host with extra skills" to "a global network of MetaBots and runtimes"

The central architectural move is:

- `multica` treats the runtime platform as primary and the agent as a managed teammate inside that platform
- `be-metabot` should treat the MetaBot as primary and the runtime as a pluggable execution body attached to that MetaBot

That difference is the product.

## 2. Product Thesis

We should frame the future system as:

- `MetaWeb` is the world computer's shared disk, shared event log, and shared coordination fabric
- `MetaBot` is a durable computational thread with identity, personality, memory, and network presence
- `Runtime` is a local or remote machine endpoint that lends tools, compute, repo access, and host capabilities to that thread
- `Host Adapter` is the protocol bridge into Codex, Claude Code, OpenClaw, and future coding agents
- `Board` is the operational control plane where humans and bots see demand, routing, progress, trace, and collaboration state

The user does not merely "create an AI agent".

The user creates a MetaBot, gives it a persona and mission, attaches one or more runtimes, and allows it to pull, accept, and complete work through MetaWeb.

## 3. Core Design Principles

1. Identity-first, runtime-second.
The MetaBot must survive machine replacement, host switching, and runtime outages.

2. Host-neutral execution.
Codex, Claude Code, and OpenClaw are execution kernels, not the identity container.

3. Chain-backed truth where it compounds.
Identity, service publication, shared memory, demand, collaboration events, and reusable artifacts should converge toward MetaWeb protocols and read models.

4. Local-first execution where it is practical.
Repo access, terminal work, credentialed dev environments, and high-frequency iteration remain local or machine-attached.

5. Traceability as a first-class primitive.
Every meaningful collaboration edge should leave inspectable local evidence and, where valuable, chain-verifiable summary evidence.

6. Capability decomposition.
Persona, skills, memory, runtime attachment, delegation, and execution traces should be independently swappable layers.

7. Board as orchestration, not truth.
The board is the human control plane and read model, not the only source of truth.

## 4. Target System Model

The target system has five major planes.

### 4.1 Identity Plane

Responsible for:

- local MetaBot creation
- deterministic identity derivation
- profile switching
- globalMetaId ownership
- persona and mission definition
- trust and policy settings

Current anchors in `be-metabot`:

- [README.md](/Users/tusm/Documents/MetaID_Projects/be-metabot/README.md#L26)
- [sessionTypes.ts](/Users/tusm/Documents/MetaID_Projects/be-metabot/src/core/a2a/sessionTypes.ts)

### 4.2 Runtime Plane

Responsible for:

- runtime discovery
- runtime registration
- host/provider capability probing
- online/offline presence
- execution routing
- per-runtime policy and health

This is the biggest concept to borrow from Multica.

### 4.3 Execution Plane

Responsible for:

- turning one task into one concrete execution run
- selecting the runtime
- selecting the host adapter
- materializing the execution environment
- streaming transcript, tool use, and outputs
- resuming prior sessions when supported

### 4.4 MetaWeb Coordination Plane

Responsible for:

- remote service discovery
- remote delegation
- trace linking
- shared memory
- published skill artifacts
- task and demand intake from chain-backed protocols
- global collaboration between MetaBots

Current anchors in `be-metabot`:

- [DACT.md](/Users/tusm/Documents/MetaID_Projects/be-metabot/DACT.md#L21)
- [EVOLUTION_NETWORK.md](/Users/tusm/Documents/MetaID_Projects/be-metabot/EVOLUTION_NETWORK.md#L21)

### 4.5 Board Control Plane

Responsible for:

- visualizing MetaBots, runtimes, tasks, sessions, and traces
- configuring routing rules
- observing work in progress
- managing exceptions and approvals
- allowing humans to intervene without breaking the MetaBot model

This is the main UX area to borrow from Multica.

## 5. Primary Domain Entities

These entities should become explicit and stable in `be-metabot`.

### 5.1 MetaBot

A durable identity-bearing actor.

Fields:

- `metabotId`
- `globalMetaId`
- `name`
- `persona`
- `mission`
- `identityProfile`
- `memoryPolicy`
- `delegationPolicy`
- `trustPolicy`
- `visibility`
- `status`

### 5.2 Runtime

A compute endpoint that can execute work for one or more MetaBots.

Fields:

- `runtimeId`
- `ownerMetaBotId` or `ownerProfileId`
- `machineId`
- `hostType`
- `provider`
- `runtimeMode`
- `deviceInfo`
- `capabilities`
- `onlineStatus`
- `lastSeenAt`
- `credentialScope`
- `repoScope`
- `costProfile`

Important difference from Multica:

- Multica effectively models one runtime row per `daemon + provider`
- `be-metabot` should preserve that granularity, but also add a parent `machine` concept later

### 5.3 Runtime Attachment

This is the missing link that should separate MetaBot identity from execution bodies.

Fields:

- `attachmentId`
- `metabotId`
- `runtimeId`
- `priority`
- `routingPolicy`
- `enabled`
- `labels`
- `affinity`

This lets one MetaBot own multiple runtimes.

### 5.4 Host Adapter

A provider bridge implementation.

Fields:

- `adapterId`
- `provider`
- `version`
- `supportsToolTrace`
- `supportsSessionResume`
- `supportsSkillInjection`
- `supportsSandboxPolicy`
- `supportsInteractiveClarification`

This is conceptually similar to Multica's unified backend abstraction.

### 5.5 Task Intent

A durable description of work before runtime selection.

Fields:

- `taskId`
- `source`
- `originProtocol`
- `goal`
- `context`
- `priority`
- `requiredCapabilities`
- `policyRequirements`
- `targetMetaBotId`

### 5.6 Execution Run

One concrete attempt to execute one task on one runtime through one adapter.

Fields:

- `runId`
- `taskId`
- `metabotId`
- `runtimeId`
- `adapterId`
- `status`
- `startedAt`
- `completedAt`
- `resumeSessionId`
- `workDir`
- `branchName`
- `usage`
- `resultSummary`

### 5.7 Transcript Event

A normalized timeline row for cross-provider inspection.

Fields:

- `eventId`
- `runId`
- `seq`
- `type`
- `tool`
- `content`
- `input`
- `output`
- `timestamp`
- `redactionLevel`

### 5.8 Memory Record

A durable memory object owned by a MetaBot and optionally shared to MetaWeb.

Fields:

- `memoryId`
- `metabotId`
- `scope`
- `kind`
- `content`
- `summary`
- `embeddingRef`
- `chainPinId`
- `visibility`
- `retentionPolicy`

### 5.9 Collaboration Session

A MetaBot-to-MetaBot coordination unit.

Current foundation exists in A2A session design.

See:

- [sessionEngine.ts](/Users/tusm/Documents/MetaID_Projects/be-metabot/src/core/a2a/sessionEngine.ts)
- [sessionTypes.ts](/Users/tusm/Documents/MetaID_Projects/be-metabot/src/core/a2a/sessionTypes.ts)

## 6. Proposed Layered Architecture

### Layer 1: Host Packs

Responsibilities:

- install native skills/config for Codex, Claude Code, OpenClaw
- expose the local `metabot` CLI to each host
- keep host-specific instructions thin

Rule:

- host packs should never become the place where core product logic lives

### Layer 2: Local Runtime Kernel

Responsibilities:

- local daemon lifecycle
- local state management
- runtime registration
- health checking
- run queue coordination
- adapter invocation

This is where the Multica daemon lessons should land.

### Layer 3: Provider Adapter Layer

Responsibilities:

- spawn and manage provider-native executions
- inject persona, skills, and work context
- normalize output into transcript events
- detect feature support differences per provider

This should become an explicit internal contract, similar in spirit to Multica's unified backend interface.

### Layer 4: MetaBot Core

Responsibilities:

- persona
- memory
- collaboration policy
- runtime attachment rules
- task acceptance rules
- chain-backed publication and presence

This is the layer Multica does not have.

### Layer 5: MetaWeb Protocol Layer

Responsibilities:

- service publication
- demand discovery
- collaboration protocols
- memory publication
- evolution artifact publication
- trust and rating protocols

### Layer 6: Read Model and Board Layer

Responsibilities:

- aggregate local runtime data
- aggregate chain-backed summaries
- present operational views
- drive approval and intervention flows

## 7. How Multica Concepts Map Into be-metabot

### 7.1 Mapping Table

- `Multica Agent` -> `MetaBot Execution Profile`
- `Multica Runtime` -> `Runtime Endpoint`
- `Multica Task Queue` -> `Execution Run Queue`
- `Multica Skill` -> `Stable Skill Contract + Evolution Variant`
- `Multica Workspace` -> `Local team/project space`, later optionally `MetaWeb collaboration space`
- `Multica transcript` -> `Normalized run transcript`

### 7.2 What to Keep

- runtime registration model
- provider-specific runtime rows
- run transcript normalization
- board visibility for active work
- assignable named bots

### 7.3 What to Replace

- workspace-first identity with MetaBot-first identity
- server-first truth with hybrid local plus MetaWeb truth
- one-agent-one-runtime bias with MetaBot-many-runtime attachments
- local-only task source with chain-backed demand and collaboration sources

## 8. Runtime Model for be-metabot

This is the most important design decision.

### 8.1 Machine

Represents one physical or virtual device.

Fields:

- `machineId`
- `name`
- `daemonEndpoint`
- `networkReachability`
- `ownerProfile`
- `labels`

### 8.2 Runtime Endpoint

Represents one provider-specific execution path on one machine.

Examples:

- `machine-A / codex`
- `machine-A / claude-code`
- `machine-B / openclaw`

### 8.3 MetaBot Attachment

Represents that one MetaBot is allowed to execute through one runtime endpoint.

This separation unlocks:

- failover
- load splitting
- cost-aware routing
- repo-aware routing
- machine-specialized roles

### 8.4 Routing Rules

Routing should support:

- preferred provider by task kind
- preferred machine by repo availability
- fallback provider when primary is offline
- chain-write-capable runtime requirement
- credential-scoped runtime requirement
- low-cost versus high-quality mode

## 9. Execution Flow

The future happy path should be:

1. A demand or task intent appears.
2. A MetaBot claims or is assigned the task.
3. The scheduler chooses a runtime attachment.
4. The provider adapter creates an execution run.
5. Persona, skill contract, memory context, and task context are injected.
6. The host agent executes locally.
7. Transcript events stream into the board and local state.
8. Results are written back to local read models.
9. Important summaries, artifacts, or memory records are published to MetaWeb when policy allows.

The key point:

- the MetaBot remains the actor across all these steps
- the runtime is an implementation detail visible to the operator

## 10. Transcript and Visibility Model

`multica` is strongest at turning execution into something visible.

`be-metabot` should adopt a normalized transcript model with three levels:

### Level A: Local Full Transcript

Contains:

- raw tool events
- reasoning summaries
- stdout/stderr fragments
- files touched
- repo actions
- branch and workdir metadata

Stored locally.

### Level B: Shared Collaboration Transcript

Contains:

- selected comments
- milestones
- handoff notes
- blocker summaries

May be shared to other MetaBots or human collaborators.

### Level C: Chain Summary Evidence

Contains:

- run completion proof
- service result summaries
- ratings
- durable memory pointers
- artifact references

Published selectively to MetaWeb.

This three-level model keeps privacy and speed while still allowing networked collaboration.

## 11. Skill Architecture

This is where `be-metabot` is already ahead of Multica.

Current strong foundation:

- stable skill identity
- runtime-resolved contract
- local evolution
- remote import and adopt

See:

- [EVOLUTION_NETWORK.md](/Users/tusm/Documents/MetaID_Projects/be-metabot/EVOLUTION_NETWORK.md#L37)
- [skillResolver.ts](/Users/tusm/Documents/MetaID_Projects/be-metabot/src/core/skills/skillResolver.ts)
- [skillContractTypes.ts](/Users/tusm/Documents/MetaID_Projects/be-metabot/src/core/skills/skillContractTypes.ts)

Recommended direction:

- keep skill identity attached to MetaBot capability
- allow runtime-specific rendering of the same skill contract
- separate `base contract`, `local evolved variant`, and `remote adopted variant`
- add `board-visible skill source` so operators can see whether a MetaBot is using base, local, or remote-evolved behavior

This becomes a major differentiator from Multica.

## 12. Memory Architecture

Shared Memory is not implemented yet, but it should become the bridge between "managed agent board" and "world computer thread".

Recommended memory tiers:

### Tier 1: Local Sandbox Memory

- fast
- ephemeral or semi-durable
- repo-specific
- never leaves machine by default

### Tier 2: MetaBot Durable Memory

- local canonical memory store for one MetaBot
- selectively synchronized
- may include embeddings and summaries

### Tier 3: MetaWeb Shared Memory

- chain-backed or chain-addressed records
- discoverable or permissioned
- reusable by remote MetaBots

The board should expose memory source and sync state:

- local only
- synced summary
- published shared memory

## 13. Task Source Architecture

`be-metabot` should not depend on one task source.

It should support four task source classes:

### Source A: Local Human Assignment

The board or local host UI assigns a task to a MetaBot.

### Source B: MetaWeb Demand Intake

The system reads chain-backed requests, jobs, or protocol messages and materializes task intents locally.

### Source C: Bot-to-Bot Delegation

One MetaBot delegates to another through DACT-style collaboration.

### Source D: Internal Maintenance Work

The MetaBot creates work for itself:

- update a skill
- replay a failed run
- publish an artifact
- sync memory

## 14. Board Product Blueprint

The future board should not just imitate Linear with bots.

It should expose the world-computer model visually.

### 14.1 Core Screens

- MetaBots
- Runtimes
- Demand Board
- Active Runs
- Trace Explorer
- Memory
- Skills
- Network

### 14.2 MetaBots Screen

Shows:

- persona
- current mission
- attached runtimes
- current task load
- memory status
- online presence
- skill source state

### 14.3 Runtimes Screen

Shows:

- machine
- provider
- status
- capability support
- current runs
- usage and cost
- owning MetaBots

### 14.4 Demand Board

Shows:

- chain-originated tasks
- local assignments
- delegated work
- state transitions
- assignment and routing

### 14.5 Active Runs

Shows:

- live transcript
- tool use timeline
- selected runtime
- branch and workdir
- attachments and outputs

### 14.6 Trace Explorer

Extends current DACT trace ideas into a unified run/session explorer.

### 14.7 Memory Screen

Shows:

- local memories
- shared memories
- sync status
- publication controls

### 14.8 Skills Screen

Shows:

- stable skill identities
- current resolved variant
- local evolution history
- imported remote variants
- adoption and rollback actions

### 14.9 Network Screen

Shows:

- known MetaBots
- available remote services
- recent collaborations
- trust and rating signals

## 15. Protocol Evolution Recommendations

To support this architecture cleanly, `be-metabot` should gradually define explicit protocols for:

- MetaBot profile
- runtime presence
- runtime capability advertisement
- shared memory
- task demand
- run summary publication
- collaboration handoff
- trust and attestation

Not all of these need full chain writes immediately.

Some can begin as local read models plus optional publication.

## 16. Security and Trust Model

This architecture needs explicit trust boundaries.

### Trust Boundary A: MetaBot Identity

- cryptographic identity
- stable ownership
- chain-attested publication

### Trust Boundary B: Runtime Attachment

- a runtime may execute for a MetaBot
- that does not mean the runtime owns the MetaBot

### Trust Boundary C: Skill Adoption

- remote evolution artifacts must remain optional
- trust policy should gate auto-adopt

### Trust Boundary D: Shared Memory

- memory visibility and revocation semantics must be explicit

### Trust Boundary E: Cross-Bot Collaboration

- delegation permissions
- payment policies
- confirmation rules
- transcript sharing scope

## 17. Recommended Build Order

This sequence tries to maximize compounding leverage.

### Phase 1: Explicit Runtime Model

Build:

- machine model
- runtime endpoint model
- runtime attachment model
- runtime registry UI

Why first:

- this is the bridge from current `be-metabot` to Multica-style orchestration

### Phase 2: Unified Execution Run Model

Build:

- run entity
- transcript event normalization
- provider adapter capability table
- active run inspection page

Why second:

- visibility is required before large-scale routing and automation

### Phase 3: MetaBot Board

Build:

- MetaBots screen
- Runtimes screen
- Active Runs screen
- assignment flows

Why third:

- once runtime and runs exist, the board becomes the natural operator surface

### Phase 4: MetaWeb Demand Ingestion

Build:

- task intent ingestion from chain-backed requests
- local scheduler
- claim and assignment policies

### Phase 5: Shared Memory

Build:

- local durable memory records
- selective MetaWeb publication
- retrieval and reuse in execution context

### Phase 6: Global Collaboration Board

Build:

- remote MetaBot collaboration views
- cross-machine, cross-user, cross-runtime orchestration
- global work graph

## 18. Major Technical Risks

### Risk 1: Provider capability mismatch

Different hosts expose different transcript and tool detail quality.

Mitigation:

- maintain adapter capability flags
- normalize what is common
- mark missing capabilities explicitly in UI

### Risk 2: Identity and runtime coupling drift

It will be tempting to collapse MetaBot identity into machine-local config.

Mitigation:

- force all runtime attachments through explicit attachment records

### Risk 3: Too much truth split between local and chain

Without clear rules, the system becomes confusing.

Mitigation:

- define truth ownership per entity
- local canonical for fast operational state
- MetaWeb canonical for durable shared state

### Risk 4: Over-centralizing the board

The board could accidentally become the whole product.

Mitigation:

- board remains a read/write control plane over explicit runtime and MetaWeb layers

### Risk 5: Privacy leakage through transcript publication

Mitigation:

- transcript tiering
- selective publication
- redaction pipeline

## 19. Concrete Next Implementation Targets

If we start from current `be-metabot`, the first concrete milestone should be:

- add explicit `Runtime Endpoint` and `Runtime Attachment` entities to local state
- add provider capability descriptors
- add a run registry that records `runId -> metabotId -> runtimeId -> provider`
- add a local board page for `MetaBots` and `Runtimes`

That is the smallest slice that meaningfully imports Multica's strongest architectural idea without losing the MetaWeb-first thesis.

## 20. Final Position

`multica` shows how to operationalize coding agents across tools and machines.

`be-metabot` can go further by making the actor persistent across:

- hosts
- machines
- conversations
- collaborators
- chain-backed memory
- remote delegation

The resulting system is not just a managed-agents dashboard.

It is a control plane for a world computer made of:

- MetaWeb as shared state
- MetaBots as durable threads
- runtimes as interchangeable execution bodies
- boards as the operator's window into that computation

## 21. Execution Tasks

### Task 1: Lock the domain model

**Files:**
- Create: `docs/superpowers/specs/metabot-runtime-domain-model.md`
- Modify: `docs/superpowers/plans/2026-04-13-be-metabot-x-multica-architecture-blueprint.md`
- Test: design review only

- [ ] Step 1: Write the entity definitions for `MetaBot`, `Runtime`, `RuntimeAttachment`, `TaskIntent`, `ExecutionRun`, and `TranscriptEvent`
- [ ] Step 2: Add field-level truth ownership notes for each entity
- [ ] Step 3: Add lifecycle state diagrams for `Runtime`, `ExecutionRun`, and `CollaborationSession`
- [ ] Step 4: Review the model for identity/runtime coupling leaks
- [ ] Step 5: Commit

### Task 2: Design the provider adapter contract

**Files:**
- Create: `docs/superpowers/specs/provider-adapter-contract.md`
- Modify: `src/core/skills/skillContractTypes.ts`
- Modify: `src/core/a2a/sessionTypes.ts`
- Test: `npm test`

- [ ] Step 1: Write the failing type-level design notes for adapter capabilities and normalized run events
- [ ] Step 2: Define a provider adapter interface in TypeScript
- [ ] Step 3: Add capability flags for transcript, resume, skill injection, and sandbox support
- [ ] Step 4: Verify existing host-pack concepts still fit the new abstraction
- [ ] Step 5: Commit

### Task 3: Design the runtime registry and attachments

**Files:**
- Create: `docs/superpowers/specs/runtime-registry-design.md`
- Modify: `src/core/state/runtimeStateStore.ts`
- Modify: `src/core/state/hotStateStore.ts`
- Test: `npm test`

- [ ] Step 1: Write the failing schema expectations for runtime endpoints and attachments
- [ ] Step 2: Define local state shapes and storage layout
- [ ] Step 3: Add migration notes from current daemon/runtime assumptions
- [ ] Step 4: Add reconciliation rules for online status and heartbeat
- [ ] Step 5: Commit

### Task 4: Design the board UX

**Files:**
- Create: `docs/superpowers/specs/metabot-runtime-board.md`
- Modify: `README.md`
- Test: design review only

- [ ] Step 1: Write screen definitions for MetaBots, Runtimes, Active Runs, Trace Explorer, Skills, Memory, and Network
- [ ] Step 2: Define the minimum viable board slice for the first release
- [ ] Step 3: Define which views are local-only and which will later merge chain-backed data
- [ ] Step 4: Add operator flows for assignment, interruption, routing, and inspection
- [ ] Step 5: Commit

### Task 5: Design the shared memory module

**Files:**
- Create: `docs/superpowers/specs/shared-memory-module.md`
- Modify: `README.md`
- Test: design review only

- [ ] Step 1: Define local, durable, and MetaWeb-published memory tiers
- [ ] Step 2: Define privacy and publication policies
- [ ] Step 3: Define retrieval hooks into execution context
- [ ] Step 4: Define the chain-facing protocol shape at a high level
- [ ] Step 5: Commit
