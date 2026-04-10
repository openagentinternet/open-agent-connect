# MetaBot Evolution Network M2-C Remote Adoption Design

**Date:** 2026-04-10

## Goal

Add the first shared-execution bridge for the evolution network by letting a local MetaBot:

- inspect imported remote evolution artifacts already stored under `~/.metabot/evolution/remote`
- manually adopt one imported remote artifact as the active runtime variant for a skill
- keep provenance explicit so the runtime knows whether the active variant came from the local store or the remote imported store

This round should make the user-facing truth become:

> A host that has already imported a compatible remote artifact can manually activate it for runtime resolution without copying it into the local self-evolution store.

## Why This Scope

M2-B proved inbound retrieval:

- search recent compatible published artifacts
- import one publication into a separate remote store
- preserve remote provenance without changing the runtime

But the network is still incomplete. Imported remote artifacts exist on disk, yet the host still cannot actually benefit from them.

M2-C should solve the next smallest truth:

> An imported remote artifact can become the active runtime contract for the target skill.

It should still not solve:

- automatic recommendation or ranking
- trust scores or publisher reputation
- background synchronization
- remote auto-adopt
- multi-skill remote adoption
- chain reads during adopt

That keeps this round focused on local runtime activation, not network intelligence.

## Locked Product Decisions

The following boundaries are chosen for M2-C:

- M2-C adds imported-artifact inspection plus manual remote adoption
- imported remote artifacts remain stored only under `~/.metabot/evolution/remote`
- remote adoption does **not** copy the imported artifact into the local self-evolution artifact directory
- there is still exactly one active runtime variant per skill
- active runtime selection becomes source-aware:
  - `local`
  - `remote`
- `rollback` keeps its current meaning:
  - clear the active selection
  - return runtime resolution to base behavior
  - do **not** restore an older previously active variant automatically
- this round still supports only:
  - `metabot-network-directory`
- remote adoption is still manually initiated through CLI only
- the evolution feature flag still gates the entire evolution surface:
  - local evolution
  - publish
  - search
  - import
  - imported listing
  - remote adopt

## Architectural Decision

For M2-C we choose:

> Keep remote artifacts in the remote store and upgrade the active runtime selection to a source-aware reference.

We explicitly do **not** copy imported remote artifacts into the local store during adoption.

This is the correct architecture because:

- provenance stays explicit
- local self-evolved artifacts remain distinct from imported remote artifacts
- later trust and recommendation work can reason about origin without reconstructing it from mutated local files
- later sync work can continue to treat local and remote stores as separate sources of truth

## What Changes In M2-C

### Before M2-C

- active runtime state is effectively local-only
- `activeVariants` assumes a `variantId` string in the local store
- imported remote artifacts are inspectable only through files and indirect search output
- the resolver cannot activate a remote artifact directly

### After M2-C

- active runtime state becomes source-aware
- the resolver can load the active artifact from:
  - the local evolution store
  - the remote imported evolution store
- the CLI can list imported remote artifacts for the supported skill
- the CLI can manually adopt an imported remote artifact into runtime

## Active Runtime Reference Model

M2-C introduces a source-aware active selection record:

```json
{
  "source": "remote",
  "variantId": "variant-remote-1"
}
```

Allowed values:

- `source === "local"`
- `source === "remote"`

This active reference becomes the runtime source of truth for skill resolution.

### Storage Decision

The active reference is stored in the local evolution index, not in the remote store.

Rationale:

- runtime selection is a machine-local decision
- the remote store should remain a provenance/cache layer, not a machine-policy layer
- local rollback should remain local-only

## Evolution Index Migration

The local evolution index currently stores:

```json
{
  "activeVariants": {
    "metabot-network-directory": "variant-local-1"
  }
}
```

M2-C upgrades this to a source-aware shape:

```json
{
  "activeVariants": {
    "metabot-network-directory": {
      "source": "remote",
      "variantId": "variant-remote-1"
    }
  }
}
```

Migration rules:

- existing string values are treated as legacy local refs
- on first read/write, legacy string entries must normalize to:

```json
{
  "source": "local",
  "variantId": "<old string value>"
}
```

- migration must be idempotent
- malformed active refs are dropped rather than crashing runtime resolution
- keep the local evolution index `schemaVersion` at `1` in this round; normalize shape in place rather than turning M2-C into a broader index-version migration

## Resolver Behavior

The runtime resolver keeps the same high-level job:

1. load the base skill contract
2. load current evolution config
3. check whether the evolution network is enabled
4. resolve the active selection for the skill
5. load the active artifact from the correct store
6. merge base contract plus active variant patch
7. render the contract for the requested host format

New M2-C behavior:

- if the active ref source is `local`, read from `~/.metabot/evolution/artifacts`
- if the active ref source is `remote`, read from `~/.metabot/evolution/remote/artifacts`
- if the active ref points to a missing or invalid artifact, fall back to the base contract instead of breaking host resolution

M2-C should also expose the active variant origin in resolved contract output.

## Resolved Contract Surface

The resolved skill contract should retain the current machine-first behavior and add explicit origin:

- `activeVariantId`
- `activeVariantSource`

Expected values:

- `null` when base contract is active
- `"local"` when the merged active artifact came from the local store
- `"remote"` when the merged active artifact came from the remote imported store

This applies to both JSON and markdown rendering.

## Imported Listing Surface

M2-C adds:

```bash
metabot evolution imported --skill metabot-network-directory
```

This command:

1. reads the imported remote index
2. loads imported remote sidecars and artifacts for the requested skill
3. filters results to the supported skill
4. annotates whether each imported remote variant is currently active
5. returns a machine-first JSON envelope

This command reads local files only. It must not query chain state.

### Imported Listing Result Shape

The response may include:

```json
{
  "skillName": "metabot-network-directory",
  "count": 1,
  "results": [
    {
      "variantId": "variant-remote-1",
      "pinId": "metadata-pin-1",
      "publisherGlobalMetaId": "idqpublisher",
      "artifactUri": "metafile://artifact-pin-1",
      "publishedAt": 1775701234567,
      "importedAt": 1775702345678,
      "scopeHash": "scope-hash-v1",
      "verificationPassed": true,
      "replayValid": true,
      "notWorseThanBase": true,
      "active": true
    }
  ]
}
```

Sort order:

1. `importedAt` descending
2. `variantId` ascending

## Remote Adopt Surface

M2-C extends the existing command:

```bash
metabot evolution adopt --skill metabot-network-directory --variant-id <variantId> --source remote
```

Rules:

- `--source` is optional for backward compatibility
- omitted `--source` means:
  - `local`
- remote adoption in M2-C requires:
  - `--source remote`

This command:

1. verifies the evolution network is enabled
2. verifies the requested skill is supported in this round
3. reads the imported remote artifact and sidecar by `variantId`
4. verifies the imported artifact still matches the requested skill
5. re-resolves the current local scope hash for the target skill
6. verifies the imported remote sidecar scope hash still matches the current local scope hash
7. verifies the imported artifact still carries a passing verification tuple
8. writes the active runtime reference as `{ source: "remote", variantId }`
9. returns a machine-first success envelope

Remote adopt does **not**:

- copy the artifact into the local self-evolution store
- mutate the remote artifact body
- mutate remote sidecar provenance
- hit MetaWeb
- auto-adopt future remote imports

## Why Recheck Scope At Adopt Time

Import already validated the remote artifact against the local scope hash at import time.

But the local skill contract may change later because of:

- local rollback
- local re-adoption
- local publish/import churn in future rounds

So M2-C must re-check compatibility at adopt time.

This keeps remote adoption aligned with the current local runtime boundary instead of the historical import-time boundary.

## Status Surface

`metabot evolution status` should stay backward-friendly while exposing the new source-aware truth.

It should continue returning:

- `enabled`
- `executions`
- `analyses`
- `artifacts`
- `activeVariants`

And add:

- `activeVariantRefs`

Example:

```json
{
  "enabled": true,
  "executions": 3,
  "analyses": 2,
  "artifacts": 1,
  "activeVariants": {
    "metabot-network-directory": "variant-remote-1"
  },
  "activeVariantRefs": {
    "metabot-network-directory": {
      "source": "remote",
      "variantId": "variant-remote-1"
    }
  }
}
```

Compatibility rule:

- `activeVariants` remains a projection of `skillName -> variantId`
- `activeVariantRefs` becomes the precise machine-first provenance surface

## Rollback Behavior

`metabot evolution rollback --skill <skill>` keeps the current semantics:

- clear the active runtime reference for the skill
- return runtime resolution to base contract behavior

Rollback does **not**:

- delete local artifacts
- delete remote imported artifacts
- restore a previously active local or remote variant automatically

This keeps rollback deterministic and aligned with M1.

## Error Model

### Imported Listing Errors

- `evolution_imported_not_supported`
- `evolution_imported_artifact_invalid`
- `evolution_network_disabled`

Mapping rules:

- unsupported imported-list skill returns `evolution_imported_not_supported`
- malformed local imported files or sidecars that break result projection return `evolution_imported_artifact_invalid`
- missing individual imported artifacts should be skipped only if the remote index still has other valid entries; otherwise the command may still succeed with fewer results

### Remote Adopt Errors

- `evolution_remote_adopt_not_supported`
- `evolution_remote_variant_not_found`
- `evolution_remote_variant_skill_mismatch`
- `evolution_remote_variant_scope_mismatch`
- `evolution_remote_variant_invalid`
- `evolution_network_disabled`

Mapping rules:

- unsupported skill or unsupported source returns `evolution_remote_adopt_not_supported`
- missing imported artifact or sidecar returns `evolution_remote_variant_not_found`
- imported artifact skill mismatch returns `evolution_remote_variant_skill_mismatch`
- imported sidecar scope hash mismatch against current local scope hash returns `evolution_remote_variant_scope_mismatch`
- malformed imported artifact, malformed sidecar, or failed verification tuple returns `evolution_remote_variant_invalid`

## Acceptance Criteria

M2-C is complete when all of the following are true:

- imported remote artifacts can be listed locally through CLI without querying chain
- a remote imported artifact can be manually adopted with `--source remote`
- the active runtime reference records whether the selection is local or remote
- the skill resolver can render from a remote imported active artifact
- rollback clears both local and remote active selections through the same surface
- local and remote stores remain separate
- legacy local active variant mappings migrate safely
- the feature flag disables imported listing and remote adopt along with the rest of the evolution surface

## Non-Goals For M2-C

M2-C intentionally does **not** add:

- chain search ranking
- recommendation UI
- automatic remote adopt
- trust or publisher reputation
- automatic rollback on remote artifact corruption
- background sync loops
- support for additional skills

Those belong to later M3, M4, and M5 work.
