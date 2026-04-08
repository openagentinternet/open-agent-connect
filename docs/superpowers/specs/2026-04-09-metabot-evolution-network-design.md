# MetaBot Evolution Network Design

## Goal

Turn `be-metabot` into the host-facing runtime for a MetaWeb-native shared evolution network, starting with a conservative M1 that proves one local skill can observe failure, generate a repaired variant, validate it, and adopt it locally without modifying the source repo or installed host pack files.

The long-term product goal is:

> Any agent host with `be-metabot` installed can participate in a permissionless, shared, MetaWeb-native skill evolution network.

In this system, local agents do not just read and write MetaWeb data. They also gain the ability to benefit from improvements discovered by other agents, while keeping local control, clear lineage, and safe adoption rules.

## Why This Matters

Compared with a centralized cloud skill registry, a MetaWeb-native evolution network can offer:

- permissionless publication of evolved skill variants
- tamper-resistant lineage and attribution
- persistent public history of what changed and why
- host-agnostic distribution across Codex, Claude Code, OpenClaw, and future hosts
- local-first safety, where each machine still decides what to adopt

This is the differentiator we want to build around. The core value is not "skill marketplace". The core value is "shared, permissionless, verifiable skill evolution."

## Design References

This design deliberately combines three sources:

- `be-metabot` as the runtime and host integration foundation
- OpenSpace as the main reference for execution analysis, evolution types, and lineage thinking
- IDBots as a reference for local-first product philosophy and MetaWeb-native workflows

We are not embedding OpenSpace directly into `be-metabot` as the product architecture. Instead, we borrow its core semantic model:

- separate execution recording from execution analysis
- separate analysis from evolution artifacts
- treat lineage as a first-class object
- distinguish trigger source, evolution type, and adoption policy

## Non-Goals For M1

M1 is intentionally narrow. It does **not** try to:

- publish evolved variants to MetaWeb
- search or import remote variants from chain
- auto-sync the local machine with a shared registry
- support every existing `metabot-*` skill
- modify the source repo `SKILLs/` at runtime
- overwrite installed host skillpack files in place
- auto-rewrite deep runtime modules such as discovery internals

M1 is only about proving the local self-repair loop.

## Product Scope By Milestone

### M1: Local Self-Repair

M1 proves a single local skill can evolve in place without changing the source repo or installed host pack:

- target skill: `metabot-network-directory`
- trigger sources: `hard_failure`, `soft_failure`, `manual_recovery`
- evolution type: `FIX` only
- storage: local-only evolution registry under `~/.metabot`
- adoption policy: auto-adopt only when the new variant targets the same skill and keeps the same permission scope; otherwise require manual adoption
- global feature flag: `evolution_network.enabled`, default `true`

### M2: Chain Publication And Import

M2 adds the first MetaWeb-native sharing path:

- publish locally verified skill variants to MetaWeb
- define lineage metadata protocol for public publication
- import compatible remote variants into the local registry
- still keep sync and adoption conservative

### M3: Chain Discovery And Recommendation

M3 makes the local machine discover the network:

- search chain-published variants by skill, lineage, compatibility, and scope
- recommend better variants to the current host session
- allow different hosts using `be-metabot` to benefit from each other's improvements

### M4: Trust, Verification, And Safe Auto-Adopt

M4 adds the safety layer required for real shared evolution:

- verification attestations
- publisher and variant reputation inputs
- trust policies
- cautious auto-adopt of chain-imported variants when lineage, compatibility, replay validation, and scope all match local policy

### M5: Background Shared Evolution

M5 expands the system into a true shared evolution network:

- more skills
- more trigger types
- background search and recommendation
- stronger host-side "just works" experience without losing local control

## Architectural Decision

We choose **Option C**:

> Build a native evolution kernel inside `be-metabot`, and use OpenSpace as a reference architecture rather than a runtime dependency.

This is the correct product architecture because the end goal is not "support OpenSpace." The end goal is "make any `be-metabot`-enabled host participate in the same MetaWeb-native evolution network."

## Core System Model

The evolution network is a separate `be-metabot` subsystem with its own feature flag, storage, resolver, and control surface.

It consumes the existing `be-metabot` foundations:

- thin host skill packs
- shared `metabot` CLI
- local daemon
- local runtime state
- MetaWeb read/write capabilities

It does **not** redefine the semantics of other `be-metabot` features such as:

- `buzz post`
- `chain write`
- `services call`
- `trace watch`

Instead, it focuses on one job:

- observe skill executions
- classify failures
- generate repair candidates
- validate candidates
- adopt or reject variants
- later publish and import variants through MetaWeb

## Core Objects

### Base Skill Contract

A machine-readable representation of the canonical packaged skill behavior.

This is the stable reference point for:

- host shim resolution
- variant patch application
- compatibility checks

### Skill Variant Artifact

A structured, local-first representation of a modified version of a base skill.

A variant artifact is not just raw markdown. It includes:

- target skill name
- lineage information
- permission scope
- structured patches
- verification result
- adoption status
- source execution and analysis references

This is the core shared object of the future evolution network.

### Skill Execution Record

An immutable local record of one skill execution, including:

- which skill ran
- which variant was active
- what command was executed
- what envelope/stdout/stderr came back
- whether UI fallback or manual recovery happened

### Skill Execution Analysis

A structured interpretation of one execution record.

M1 keeps this mostly rule-based and uses it to determine:

- whether the execution completed successfully
- whether it should trigger evolution
- whether the issue was hard failure, soft failure, or manual recovery
- whether a `FIX` candidate should be generated

### Adoption Decision

An explicit record of whether a candidate became active, was rejected, or was rolled back.

## M1 Feature Flag

The evolution subsystem must be fully gated by a top-level flag:

- `evolution_network.enabled`

Default:

- `true`

When disabled, the system must:

- stop recording execution records for evolution
- stop generating analyses and candidates
- stop replay validation and adoption
- return only base skill contracts from the resolver
- later, also disable publish/search/import/sync behavior in M2+

When disabled, normal `be-metabot` capabilities must continue working.

## Host Integration Model

### Stable Host Skill Shim

Installed host skills remain stable entry points, for example:

- `metabot-network-directory`

But the packaged host skill becomes a shim instead of being the final contract.

The shim must first ask the runtime to resolve the active contract for the skill, for example through a future command like:

```bash
metabot skills resolve --skill metabot-network-directory --host codex --format markdown
```

The host then follows the resolved contract rather than assuming the packaged copy is the latest behavior.

### Runtime Skill Resolver

The runtime resolver is responsible for:

1. loading the base skill contract
2. reading current evolution config
3. checking whether the evolution network is enabled
4. loading the active local variant for that skill, if any
5. merging base contract + variant patches
6. rendering the result for the current host format

This is the key design choice that allows local evolution without modifying the source repo or overwriting installed host packs.

## M1 Target Skill

M1 targets exactly one skill:

- `metabot-network-directory`

We choose it because it is:

- low risk
- low side effect
- easy to replay
- easy to validate structurally
- representative enough to prove the full loop

## M1 Failure Taxonomy

M1 uses a conservative, mostly rule-based failure taxonomy inspired by OpenSpace.

### `hard_failure`

Use when the command failed at the protocol level, for example:

- command envelope is invalid
- command returns `state = failed`
- `data.services` is missing or not an array
- resolver produced an unusable command contract

### `soft_failure`

Use when the command technically succeeded, but the host cannot safely continue, for example:

- success envelope exists but the data is not usable for downstream selection
- expected machine-first output is replaced by UI or unstructured summary
- service entries are missing critical fields such as `servicePinId` or `providerGlobalMetaId`
- empty results contradict the local task context and prevent the next automation step

### `manual_recovery`

Use when the host had to compensate for poor skill guidance, for example:

- unnecessary UI fallback
- repeated command attempts to recover from unclear contract behavior
- manual interpretation or repair of the result before continuing

## M1 Evolution Type

M1 supports only one evolution type:

- `FIX`

Allowed repair surface:

- instructions patch
- command template patch
- output expectation patch
- fallback policy patch

Not allowed in M1:

- permission scope expansion
- creating a new skill
- modifying discovery engine internals automatically
- introducing chain publication logic into the local repair loop

## Permission Scope Model

Each skill variant carries a structured permission scope, for example:

- allowed CLI commands
- chain read / write
- local UI open
- remote delegation

For `metabot-network-directory`, M1 scope should remain limited to:

- machine-first `metabot network services --online`
- optional human-only `metabot ui open --page hub`
- chain read allowed
- chain write forbidden
- remote delegation forbidden

This structured scope is critical because M1 auto-adopt policy depends on it.

## M1 Adoption Policy

The agreed M1 policy is:

> Auto-adopt only when the new variant targets the same skill and keeps the same permission scope. Otherwise require manual confirmation.

This keeps the system locally useful without making early automation too aggressive.

## M1 Validation Rules

A candidate variant is not adoptable until it passes local validation.

### Protocol Compatibility Validation

The candidate must:

- keep the same stable skill identity
- keep the same permission scope
- remain machine-first
- preserve expected command envelope compatibility

### Replay And Fixture Validation

The candidate must show it is not worse than the base contract and that it addresses the triggering issue:

- for `hard_failure`: replay no longer produces the same structural failure
- for `soft_failure`: replay produces usable structured output or an explicit, valid terminal outcome
- for `manual_recovery`: replay reduces unnecessary fallback or hand-holding

M1 does not try to prove "smarter" behavior. It only proves:

- no repeated triggering failure
- protocol compatibility
- no scope expansion
- not worse than the base skill

## Local Storage Layout

M1 stores evolution state outside the repo and outside installed host packs.

Proposed layout:

- `~/.metabot/hot/config.json`
- `~/.metabot/evolution/executions/<executionId>.json`
- `~/.metabot/evolution/analyses/<analysisId>.json`
- `~/.metabot/evolution/artifacts/<variantId>.json`
- `~/.metabot/evolution/index.json`

Responsibilities:

- `config.json`: feature flags and policy
- `executions/`: raw execution observations
- `analyses/`: structured failure and evolution judgments
- `artifacts/`: local variant artifacts
- `index.json`: active variant mapping, lineage index, and summary state

## Proposed M1 Module Boundaries

### New config subsystem

- `src/core/config/configTypes.ts`
- `src/core/config/configStore.ts`

Responsibilities:

- evolution feature flags
- future evolution policy storage

### New evolution subsystem

- `src/core/evolution/`

Responsibilities:

- execution record types and store
- analysis types and store
- candidate generation
- validation
- adoption and rollback
- lineage bookkeeping

### Skill-specific adapter for M1

- `src/core/evolution/skills/networkDirectory/`

Responsibilities:

- normalize `metabot-network-directory` executions
- classify failure type
- generate `FIX` candidates
- replay and fixture validation

### New skill resolution subsystem

- `src/core/skills/baseSkillRegistry.ts`
- `src/core/skills/skillResolver.ts`

Responsibilities:

- load canonical base skill contract
- merge active variant patch
- render host-specific resolved contract

### CLI surface

- new config command group
- new skills resolve command
- new evolution command group

### Existing execution hook points

M1 should attach at the outer execution layer rather than changing discovery internals:

- after `network services` command completion
- after daemon route handling for directory reads, if needed
- during skillpack generation, so packaged skills become shims instead of final static contracts

## M1 Minimal CLI Surface

### Required in M1

```bash
metabot config get evolution_network.enabled
metabot config set evolution_network.enabled false
metabot skills resolve --skill metabot-network-directory --host codex --format markdown
metabot skills resolve --skill metabot-network-directory --host codex --format json
metabot evolution status
metabot evolution status --skill metabot-network-directory
metabot evolution replay --skill metabot-network-directory --execution-id <id>
metabot evolution adopt --skill metabot-network-directory --variant-id <id>
metabot evolution rollback --skill metabot-network-directory
```

### Reserved for M2+

```bash
metabot evolution publish
metabot evolution search
metabot evolution import
metabot evolution sync
metabot evolution verify
metabot evolution trust
```

These names should be reserved now so M1 grows into the later milestones without a control-plane rewrite.

## M1 Runtime Flow

1. Host triggers stable skill name `metabot-network-directory`
2. Host shim calls the runtime resolver
3. Resolver returns base contract or base+active-variant contract depending on config and local state
4. Host executes the returned contract
5. `be-metabot` records a `SkillExecutionRecord`
6. If the result matches one of the M1 trigger conditions, the system creates a `SkillExecutionAnalysis`
7. If analysis marks the run as a local repair candidate, the evolution subsystem generates a `FIX` variant artifact
8. Replay and fixture validation run locally
9. If validation passes and the variant is same-skill + same-scope, it is auto-adopted; otherwise it waits for manual adoption
10. The next host resolution for that skill uses the active local variant

## M2+ Protocol Direction

M1 does not implement chain publication, but it must be designed so the future chain object model is obvious.

Recommended split for M2+:

### On-chain

Store canonical metadata only:

- logical skill id
- variant id
- lineage references
- parent ids
- creator globalMetaId
- artifact hash
- compatibility manifest references
- verification summary digest
- publication metadata

### Off-chain / MetaWeb content layer

Store heavier artifacts and replayable assets:

- full skill variant artifact
- replay inputs
- verification logs
- change summaries and evidence bundles

### Local

Keep machine-local state and policy:

- adoption decisions
- trust preferences
- cached search indexes
- execution history
- imported-but-not-active variants

## Acceptance Criteria For M1

M1 is complete only if all of the following are true:

1. `be-metabot` can resolve a stable host skill into a runtime-generated contract
2. the evolution network can be disabled with one persistent config flag
3. `metabot-network-directory` executions are recorded when the feature is enabled
4. the system can classify failures into the agreed M1 taxonomy
5. the system can generate a local `FIX` variant artifact for this skill
6. the system can replay and validate the candidate locally
7. the system can auto-adopt same-skill, same-scope variants
8. the system can roll back to the base skill contract
9. no source repo `SKILLs/` files are modified at runtime
10. no installed host pack files are overwritten at runtime

## Open Questions Deferred Beyond M1

These are intentionally deferred:

- exact MetaWeb path naming for variant publication
- reputation model and trust scoring
- chain-side semantic search strategy
- whether some future variants should patch runtime behavior instead of only skill contracts
- multi-parent lineage for derived variants

Deferring them is correct. M1 only needs to prove the local self-repair loop cleanly.

## Recommendation

Proceed with M1 exactly as scoped above. Do not start with chain publication or generalized multi-skill evolution. A disciplined, local-first M1 gives us the cleanest path into M2, M3, and M4 without re-architecting the control plane later.
