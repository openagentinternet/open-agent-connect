# MetaBot Evolution Network M2-A Publish Design

**Date:** 2026-04-09

## Goal

Add the first MetaWeb-native sharing path for the evolution network by letting a local MetaBot publish one locally verified evolution artifact to chain as a searchable metadata pin plus a separately uploaded full artifact body.

The immediate user-facing outcome is narrow and deliberate:

- a locally verified `metabot-network-directory` FIX artifact can be published to MetaWeb
- the published record is machine-readable and future-searchable
- the full artifact is preserved as a referenced JSON body
- local adoption state does not change as a side effect of publication

This round is only about outbound publication. It does not attempt shared discovery or shared adoption yet.

## Problem

M1 proves the local self-repair loop:

- record execution
- classify failures
- generate a FIX candidate
- validate it
- adopt or roll it back locally

That proves the runtime kernel, but it does not yet prove the network value proposition. A repaired skill that only exists under one machine's `~/.metabot/evolution` directory cannot benefit other hosts or other users.

We need the smallest chain-native publication model that preserves:

- machine-readability
- lineage
- verification evidence
- future searchability
- local-first safety

without prematurely adding:

- auto publish
- chain search/import
- trust scores
- recommendation ranking
- auto-adopt of remote artifacts

## Why This Scope

This round should solve exactly one product truth:

> A verified local evolution artifact can leave one machine and become a public MetaWeb object that other hosts can later discover.

That is the minimum required to move from "local self-repair" to "shared evolution network."

If this round succeeds:

- M1 output becomes publishable instead of machine-local only
- M2-B search can target a stable protocol immediately
- M2-C import/adopt can rely on a stable published object shape

## First-Round Scope

Included:

- define one chain protocol for published evolution artifact metadata
- upload one full artifact body as a JSON file
- publish one metadata pin that references that uploaded body
- add one manual CLI command to publish one local artifact
- restrict publication to locally verified artifacts
- restrict implementation support to `metabot-network-directory` and `FIX`

Excluded:

- chain search
- chain import
- remote adopt
- trust/reputation
- background sync
- multi-skill generalization in implementation
- auto publish
- de-duplication of repeated publications

## Source Of Truth

This round should reuse existing `be-metabot` patterns instead of inventing a parallel publication stack.

Primary references:

- `src/core/buzz/postBuzz.ts` for MetaWeb content publication via existing signer/write flows
- `src/core/files/uploadFile.ts` for uploading structured content as a `metafile://...` reference
- `src/core/evolution/types.ts` for local artifact shape and lineage semantics
- `docs/superpowers/specs/2026-04-09-metabot-evolution-network-design.md` for the M1/M2 evolution model
- `docs/superpowers/specs/2026-04-07-chain-service-discovery-design.md` for protocol-path and machine-first documentation style

The protocol should feel like a normal MetaWeb protocol, not a special private registry.

## Protocol Design

### Metadata Protocol Path

Published metadata pins use:

- `/protocols/metabot-evolution-artifact-v1`

This path is intentionally generic rather than skill-specific.

Rationale:

- M2-A implementation only supports `metabot-network-directory`, but the protocol should not hardcode one skill forever
- later skills can reuse the same protocol path without path proliferation
- search can filter by payload fields such as `skillName`, `scopeHash`, and `evolutionType`

### Two-Layer Published Object

Each published artifact has two layers:

1. **metadata pin**
   - small
   - chain-searchable
   - machine-readable JSON payload
   - written to `/protocols/metabot-evolution-artifact-v1`
2. **artifact body**
   - full shareable artifact JSON
   - uploaded first through the existing file-upload path
   - referenced from metadata as `artifactUri: "metafile://..."`

This split keeps metadata easy to query while preserving the full artifact for later import and inspection.

## Publication Eligibility

An artifact is publishable in M2-A only if all of the following are true:

- the artifact exists in local evolution storage
- `artifact.skillName` matches the requested `--skill`
- `artifact.skillName === "metabot-network-directory"`
- the linked analysis record referenced by `artifact.lineage.analysisId` exists
- the linked analysis record reports `evolutionType === "FIX"`
- `artifact.verification.passed === true`

The artifact does **not** need to be the currently active local variant.

This allows sharing:

- verified-but-not-adopted artifacts
- verified artifacts that were manually reviewed

while excluding:

- draft or failed artifacts
- unverified local experiments
- non-target skills in this round

## Metadata Payload

The metadata pin payload is JSON with content type `application/json`.

Required payload fields:

```json
{
  "protocolVersion": "1",
  "skillName": "metabot-network-directory",
  "variantId": "variant-xxx",
  "artifactUri": "metafile://artifact-body-pin.json",
  "evolutionType": "FIX",
  "triggerSource": "hard_failure",
  "scopeHash": "scope-hash-v1",
  "sameSkill": true,
  "sameScope": true,
  "verificationPassed": true,
  "replayValid": true,
  "notWorseThanBase": true,
  "lineage": {
    "lineageId": "lineage-xxx",
    "parentVariantId": null,
    "rootVariantId": "variant-xxx",
    "executionId": "execution-xxx",
    "analysisId": "analysis-xxx"
  },
  "publisherGlobalMetaId": "idq...",
  "artifactCreatedAt": 1775700000000,
  "artifactUpdatedAt": 1775700000000,
  "publishedAt": 1775701234567
}
```

Field semantics:

- `protocolVersion`: version marker for future readers
- `skillName`: target base skill
- `variantId`: local variant identifier that also acts as the shared object identity
- `artifactUri`: uploaded JSON body reference
- `evolutionType`: M2-A supports only `FIX`
- `triggerSource`: the trigger type that led to the artifact
- `scopeHash`: compatibility key for future search/import filtering
- `sameSkill`: explicit compatibility signal
- `sameScope`: explicit compatibility signal
- `verificationPassed`, `replayValid`, `notWorseThanBase`: minimal verification summary for future trust decisions
- `lineage`: parent/root/execution/analysis references
- `publisherGlobalMetaId`: the identity that published the artifact
- `artifactCreatedAt`, `artifactUpdatedAt`: timestamps copied from the local artifact object
- `publishedAt`: timestamp of the specific metadata publication record written to chain

Derivation rule:

- `evolutionType` and `triggerSource` are not guessed from the artifact itself
- they are loaded from the linked local analysis record referenced by `artifact.lineage.analysisId`
- publication must fail if that linked analysis record is missing or malformed

Publication identity rule:

- `variantId` identifies the logical evolution artifact
- the metadata `pinId` identifies one specific publication record of that artifact
- repeated publication of the same `variantId` is allowed in M2-A
- future search/import layers must treat `variantId` and `pinId` as different identities

## Artifact Body JSON

The artifact body is a shareable JSON representation of the local `SkillVariantArtifact`.

It should preserve the protocol-relevant fields needed for later import:

- `variantId`
- `skillName`
- `scope`
- `metadata`
- `patch`
- `lineage`
- `verification`
- `createdAt`
- `updatedAt`

It must **not** include machine-private state such as:

- local filesystem paths
- local daemon URLs
- host-specific installation paths
- mutable local runtime cache fields
- local activation state such as `status`
- local adoption state such as `adoption`

The body is the content layer. The metadata pin is the index layer.

## CLI Surface

Add one narrow command:

```bash
metabot evolution publish --skill metabot-network-directory --variant-id <variantId>
```

This command is intentionally manual.

It is also gated by the existing evolution subsystem flag:

- when `evolution_network.enabled === false`, `metabot evolution publish` must fail
- publication must not bypass the global evolution gate

M2-A does not add:

- auto publish hooks
- background publication
- batch publication
- remote search flags

## Publish Flow

The publish flow is:

1. read the local artifact from `~/.metabot/evolution/artifacts/<variantId>.json`
2. read the linked local analysis from `~/.metabot/evolution/analyses/<analysisId>.json`
3. validate publish eligibility
4. build the shareable artifact body JSON
5. upload that JSON through the existing file-upload path and receive `artifactUri`
6. build the metadata payload JSON using the uploaded `artifactUri` plus the linked analysis fields
7. write the metadata pin to `/protocols/metabot-evolution-artifact-v1`
8. return a machine-first success envelope

The flow order matters:

- body upload happens first
- metadata pin is only written if body upload succeeds

This guarantees that every successful metadata pin references a real body object.

Publish-time coherence checks must also pass before upload begins:

- `analysis.analysisId === artifact.lineage.analysisId`
- `analysis.skillName === artifact.skillName`
- `analysis.executionId === artifact.lineage.executionId`

If any coherence check fails, publication fails instead of mixing one artifact with another analysis summary.

## Success Envelope

Publish success should return:

```json
{
  "pinId": "915c...i0",
  "txids": ["915c..."],
  "skillName": "metabot-network-directory",
  "variantId": "variant-xxx",
  "artifactUri": "metafile://artifact-body-pin.json",
  "scopeHash": "scope-hash-v1",
  "publisherGlobalMetaId": "idq...",
  "publishedAt": 1775701234567
}
```

This keeps the result useful for:

- logging
- future local record linkage
- later search/import tests

## Error Handling

Failures must stay machine-first and explicit.

Required failure categories:

- `evolution_variant_not_found`
- `evolution_variant_skill_mismatch`
- `evolution_variant_not_verified`
- `evolution_variant_analysis_mismatch`
- `evolution_variant_scope_hash_missing`
- `evolution_publish_not_supported`
- `evolution_network_disabled`
- body upload failure via existing upload failure semantics
- metadata chain-write failure via existing chain-write failure semantics

M2-A should not silently downgrade or partially succeed.

If metadata pin creation fails after body upload succeeds, return a failure and surface the exact error code. Cleanup of orphaned uploaded bodies is explicitly out of scope for this round.

## Local State Semantics

Publication must not change local activation state.

Publishing an artifact must **not**:

- mark it active
- mark it inactive
- mutate `activeVariants`
- auto-adopt it
- write shared-state sync metadata into the local store

This round is publication only. Shared discovery and shared adoption come later.

## Scope Hash Rule

`scopeHash` is treated as a stable compatibility/search key in published metadata.

M2-A must not recompute it.

Rule:

- copy `artifact.metadata.scopeHash` verbatim into published metadata
- publication fails if `artifact.metadata.scopeHash` is missing or empty

This keeps M2-A compatible with the current local artifact generator and avoids introducing a second competing scope-hash derivation rule during the publish round.

## Implementation Shape

Keep M2-A separate from the M1 local repair loop.

Suggested units:

- a pure artifact-sharing transformer that turns local artifacts into:
  - shareable body JSON
  - metadata payload JSON
- a publish orchestration module that performs:
  - read
  - validate
  - upload body
  - write metadata pin
  - return result
- a narrow CLI binding under `evolution publish`

Do **not** fold M2-A into:

- `src/core/evolution/service.ts`
- the M1 observation/classification loop

Publication is a separate outbound sharing action, not part of local execution observation.

## Testing

Required coverage:

- publish succeeds for a verified `metabot-network-directory` FIX artifact
- publish rejects a missing artifact
- publish rejects a skill mismatch
- publish rejects an unverified artifact
- publish uploads body before writing metadata pin
- metadata pin uses `/protocols/metabot-evolution-artifact-v1`
- metadata payload includes the expected compatibility and lineage fields
- CLI command returns the machine-first success envelope

Keep tests narrow and local:

- no chain search tests in this round
- no import tests in this round
- no trust-policy tests in this round

## Non-Goals Reconfirmed

M2-A does not define:

- how remote artifacts are searched
- how remote artifacts are imported
- how chain-published artifacts are ranked
- how publisher trust is measured
- when remote artifacts are auto-adopted

Those belong to later M2-B, M2-C, and M4 work.

## Why This Design

This is the smallest defensible MetaWeb-native sharing step.

It is better than a centralized registry because:

- publication is permissionless
- lineage is publicly attributable
- metadata is tamper-resistant once written
- content is durable enough to be referenced by future hosts

It is safer than immediate sync/import because:

- publication is manual
- only verified artifacts can be published
- local runtime state is unchanged by publication

This keeps M2-A aligned with the core product direction:

> shared, permissionless, verifiable skill evolution without giving up local control
