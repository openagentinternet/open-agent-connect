# Chain Service Discovery Design

**Date:** 2026-04-07

## Goal

Replace the current demo-only `network services --online` behavior with a chain-backed MetaWeb directory that can read the existing IDBots service protocol from chain data and filter the result set by the existing IDBots heartbeat semantics.

The immediate user-facing outcome is simple: when a Codex user says "帮我展示所有在线 MetaBot 服务", `be-metabot` should no longer return an empty list just because no local directory seed was configured. It should read the same on-chain service records that IDBots already understands and apply the same "online" meaning that IDBots already uses.

## Problem

Today `be-metabot` treats service discovery as a local yellow-pages demo mechanism:

- local services come from `runtime-state.json`
- remote services come only from manually configured `network sources`
- `online` currently means "a configured remote daemon answered"

That is useful for a local cross-host demo, but it is not compatible with the user's intended MetaWeb-native mental model. The user expects the network directory to reflect already-published chain services, and the IDBots codebase already has working semantics for both:

- service protocol: `/protocols/skill-service`
- heartbeat protocol: `/protocols/metabot-heartbeat`

The current mismatch causes a bad product truth: Codex says there are no online services, while the chain already contains many services that IDBots can understand.

## Source Of Truth

This extraction must follow IDBots semantics instead of inventing new ones.

Primary semantic references:

- `src/main/services/gigSquareRemoteServiceSync.ts`
- `src/main/services/providerDiscoveryService.ts`
- `src/main/services/heartbeatPollingService.ts`
- `src/main/main.ts`

Key protocol paths:

- service publish / modify / revoke: `/protocols/skill-service`
- online presence / heartbeat: `/protocols/metabot-heartbeat`

## First-Round Scope

This round is deliberately read-only.

Included:

- read chain service pins from `/protocols/skill-service`
- parse IDBots-compatible service payloads and service mutation semantics
- collapse `create / modify / revoke` into one current effective service list
- read heartbeat data from `/protocols/metabot-heartbeat`
- apply IDBots-compatible online filtering
- keep the current manual `network sources` mechanism only as a fallback / demo transport helper

Excluded from this round:

- writing `services publish` to chain
- chain-backed revoke / modify flows
- ratings, reputation, refund-risk scoring, or marketplace-style ranking
- replacing the demo daemon-execution transport

## Desired Behavior

### Machine behavior

`metabot network services --online` should:

1. fetch the current chain service feed from `/protocols/skill-service`
2. normalize rows using the same payload assumptions as IDBots
3. resolve the current effective service state per source service pin
4. fetch heartbeat data from `/protocols/metabot-heartbeat`
5. mark a provider online or offline using the same heartbeat freshness window that IDBots uses
6. return only online services when `--online` is requested
7. fall back to local seeded daemon sources only when chain discovery is unavailable or returns a semantic miss

### Human behavior

If a user asks for online services in Codex:

- the assistant should be able to show real chain-backed online services without requiring `network sources add`
- if chain discovery fails, the error language must explain that the result is a local fallback or that chain discovery is temporarily unavailable
- the wording must avoid implying "the whole network has no services" when the actual condition is "no online services were discovered right now"

## Service Semantics

The extracted service reader must preserve the core IDBots fields and mutation model.

Expected parsed fields:

- `servicePinId`
- `sourceServicePinId`
- `providerGlobalMetaId`
- `providerAddress`
- `serviceName`
- `displayName`
- `description`
- `price`
- `currency`
- `serviceIcon`
- `providerSkill`
- `skillDocument`
- `inputType`
- `outputType`
- `endpoint`
- `paymentAddress`
- `updatedAt`
- `available`

Mutation semantics:

- `create`: defines the source service pin id
- `modify`: updates the current effective service for the same source service pin id
- `revoke`: marks the service unavailable and removes it from the online directory

No new public mutation model should be invented in this round.

## Online Definition

"Online" must follow IDBots semantics, not a new `be-metabot` approximation.

Definition:

- services are grouped by provider globalMetaId and provider address
- heartbeat data is looked up from `/protocols/metabot-heartbeat`
- a provider is online only if a fresh heartbeat exists within the same freshness window used by IDBots
- when a provider is offline, its services remain chain-known but must not appear in `--online`

This round only needs the `--online` path to be correct. A later round can add explicit "all known services including offline" behavior if needed.

## Fallback Behavior

Chain-first does not mean chain-only.

Fallback order:

1. chain-backed service discovery and heartbeat filtering
2. if chain read fails or returns a semantic miss, fall back to the current seeded daemon directory behavior
3. local services published in the same runtime still appear normally

This keeps the existing local cross-host demo working while the product truth shifts to MetaWeb-first discovery.

## Implementation Shape

Add dedicated chain readers instead of mixing chain parsing directly into route handlers.

Planned units:

- a chain skill-service reader / parser
- a chain heartbeat reader / online-filter helper
- a small discovery orchestration module that composes chain results with local and seeded fallback results
- minimal route/handler changes in `network.listServices`

This keeps the discovery semantics reusable for later:

- remote service invocation preflight
- Hub HTML
- future OpenClaw / Claude Code host flows

## Error Handling

Failure modes must stay explicit and machine-first.

- invalid chain payload rows are skipped, not fatal
- total chain fetch failure produces a fallback path if available
- if both chain discovery and fallback fail, return a machine-readable failure instead of an empty success
- the assistant-facing language should distinguish:
  - "no services found"
  - "no online services found"
  - "chain discovery unavailable; using fallback"

## Testing

Required coverage:

- parse valid chain `/protocols/skill-service` rows using IDBots-compatible fields
- collapse `create / modify / revoke` into correct current service state
- mark providers online only when heartbeat freshness passes
- exclude services without fresh heartbeat from `--online`
- preserve fallback behavior to seeded daemon sources when chain discovery fails
- keep current local demo runtime tests green

## Why This Scope

This is the smallest slice that fixes the user's core complaint without expanding into a larger service-publish refactor.

If this round succeeds:

- Codex can show real online chain services
- the "MetaWeb is the AI-native internet" mental model gets much closer to reality
- the existing demo fallback still works

Then the next round can safely upgrade `services publish` to write the same chain protocol that the new reader already understands.
