# MetaBot Evolution Network M2-B Search And Import Design

**Date:** 2026-04-09

## Goal

Add the first inbound path for the evolution network by letting a local MetaBot:

- search chain-published evolution artifacts through the M2-A protocol
- filter them down to artifacts that are compatible with the local skill contract
- manually import one selected remote artifact into a separate local remote-artifact store

This round still stops before adoption. The user-facing truth is:

> A host that already supports M2-A publication can now discover compatible published artifacts and pull them into a local remote store without changing the active runtime skill.

## Why This Scope

M2-A proved outbound publication:

- local verified artifact
- shareable artifact body
- searchable metadata pin
- manual publish command

But M2-A still leaves the network one-sided. The published artifact exists on MetaWeb, yet another host cannot meaningfully benefit from it.

M2-B should solve the next smallest truth:

> A host can find published compatible artifacts and import one into local storage.

It should not yet solve:

- remote artifact adoption
- automatic runtime merge
- ranking, reputation, or recommendation
- background synchronization
- trust scoring

That keeps this round focused on shared discovery and retrieval instead of shared execution.

## Locked Product Decisions

The following boundaries are already chosen for M2-B:

- M2-B includes `search` plus `import`
- imported remote artifacts do **not** auto-adopt
- imported remote artifacts are stored separately from local self-evolved artifacts
- default search filter is:
  - same `skillName`
  - same `scopeHash`
  - `verificationPassed === true`
- duplicate handling is by logical artifact identity:
  - only one imported copy per `variantId`
- import is keyed by publication identity:
  - the CLI imports by `pinId`
- remote source metadata is stored in a sidecar metadata file next to the imported artifact
- the first user-facing surface is CLI only:
  - `metabot evolution search`
  - `metabot evolution import --pin-id`
- when chain search sees multiple publication records for the same `variantId`, only the latest publication is shown

## Protocol Reuse

M2-B must reuse the existing M2-A protocol as-is:

- metadata path: `/protocols/metabot-evolution-artifact-v1`
- artifact body location: `artifactUri` pointing to `metafile://...`

M2-B must not invent a second inbound registry or a second artifact shape.

That means search/import reads exactly the objects produced by M2-A publication.

## Search Surface

M2-B adds:

```bash
metabot evolution search --skill metabot-network-directory
```

This command:

1. resolves the local target skill identity
2. derives the local compatibility scope hash from the current local skill contract
3. queries recent chain-published metadata pins under `/protocols/metabot-evolution-artifact-v1`
4. filters results to compatible records
5. collapses repeated publication records so only the latest publication for each `variantId` remains
6. annotates whether each logical artifact is already imported locally

This round only supports:

- `metabot-network-directory`

If another skill is requested, search fails with `evolution_search_not_supported`.

M2-B keeps the CLI surface narrow:

- only `--skill` is supported for search in this round
- stdout stays JSON-only through the existing CLI command envelope
- search does not add `--pretty`, `--cursor`, or `--limit` yet

To keep the command bounded and deterministic, M2-B search only inspects a recent protocol window:

- reuse the same chain API base URL configuration already used by existing chain readers
- read at most `100` raw metadata rows from the public path-list API in chain API page order
- sort and collapse locally after those rows are read
- never fetch full artifact bodies during search

This means M2-B search is intentionally a recent-window search, not a full-history crawler.

## Search Result Validation

Before compatibility filtering, each raw metadata row must parse as an M2-A metadata payload.

Required metadata fields for a row to be considered valid:

- chain row provides a non-empty `pinId`
- `protocolVersion === "1"`
- `skillName` is a non-empty string
- `variantId` is a non-empty filename-safe identifier matching `^[A-Za-z0-9._-]+$`
- `artifactUri` is a valid `metafile://...` URI
- `evolutionType === "FIX"`
- `triggerSource` is a non-empty string
- `scopeHash` is a non-empty string
- `verificationPassed` is a boolean
- `replayValid` is a boolean
- `notWorseThanBase` is a boolean
- `lineage` exists and includes non-empty `lineageId`, `rootVariantId`, `executionId`, and `analysisId`
- `lineage.parentVariantId` is either `null` or a non-empty string
- `publisherGlobalMetaId` is a non-empty string
- `publishedAt` is a finite number

Rows that fail row-level metadata validation are ignored during search rather than failing the entire command. Search should stay robust in a permissionless network. Only transport failures or malformed page envelopes fail the command.

## Search Filter Rules

Search returns only metadata records where all of the following are true:

- `skillName === requested skill`
- `scopeHash === local target scopeHash`
- `verificationPassed === true`

Compatibility in M2-B is intentionally only these three fields.

`replayValid` and `notWorseThanBase` are still required metadata fields and are preserved in the result summary, but they are not separate search predicates in this round because M1/M2-A already define `verificationPassed === true` only when replay validation and not-worse-than-base checks both pass.

It may additionally preserve these fields in the returned result summary:

- `pinId`
- `variantId`
- `skillName`
- `artifactUri`
- `publisherGlobalMetaId`
- `publishedAt`
- `scopeHash`
- `triggerSource`
- `verificationPassed`
- `replayValid`
- `notWorseThanBase`
- `alreadyImported`
- `importedPinId`

The search command must not fetch full artifact bodies just to list search results. Metadata is the listing surface. Body fetch happens only during import.

## Duplicate Collapse Rule

MetaWeb can contain multiple publication records for the same logical artifact:

- same `variantId`
- different `pinId`
- different `publishedAt`

M2-B should collapse these during listing:

- group by `variantId`
- keep the newest record by `publishedAt`
- if `publishedAt` ties, break ties deterministically with `pinId`

After collapse, sort the final result list by:

1. `publishedAt` descending
2. `pinId` ascending

When a collapsed result is already imported locally, search still shows the latest publication record, but it must also include `importedPinId` so the user can see which publication record is already present in the local remote store.

This keeps search output stable and avoids exposing publication churn as if it were multiple distinct artifacts.

## Import Surface

M2-B adds:

```bash
metabot evolution import --pin-id <pinId>
```

Import is manual and publication-specific.

This command:

1. fetches one metadata pin by `pinId`
2. validates that the metadata pin is compatible with the current local host constraints
3. fetches the referenced artifact body via `artifactUri`
4. validates metadata/body coherence
5. rejects duplicates if the local remote store already contains the same `variantId`
6. writes the imported body and remote sidecar metadata into the local remote store
7. updates the local remote index
8. returns a machine-first success envelope

Import does **not**:

- write into the local self-evolution artifact directory
- change `activeVariants`
- mark the imported artifact adopted
- make any host pack or runtime behavior change automatically

## Local Storage Shape

Imported remote artifacts live under a separate subtree:

- `~/.metabot/evolution/remote/index.json`
- `~/.metabot/evolution/remote/artifacts/<variantId>.json`
- `~/.metabot/evolution/remote/artifacts/<variantId>.meta.json`

Rationale:

- local self-evolution artifacts remain the source of truth for M1/M2-A local generation
- remote imports remain inspectable and reversible without blurring provenance
- later adoption work can explicitly bridge from remote store into active runtime state

## Remote Sidecar Metadata

Each imported remote artifact gets a sidecar file at:

- `remote/artifacts/<variantId>.meta.json`

Required fields:

```json
{
  "pinId": "....i0",
  "variantId": "variant-xxx",
  "publisherGlobalMetaId": "idq...",
  "artifactUri": "metafile://....json",
  "skillName": "metabot-network-directory",
  "scopeHash": "scope-hash-v1",
  "publishedAt": 1775701234567,
  "importedAt": 1775702345678
}
```

This file exists so imported provenance can be tracked without mutating the portable artifact body itself.

## Remote Index Shape

The remote import index should stay narrow:

```json
{
  "schemaVersion": 1,
  "imports": ["variant-xxx"],
  "byVariantId": {
    "variant-xxx": {
      "variantId": "variant-xxx",
      "pinId": "....i0"
    }
  }
}
```

This is intentionally not a chain-search cache.

Its job is only:

- local imported-artifact listing
- duplicate protection by `variantId`
- fast `alreadyImported` annotation for search results

Consistency rules:

- `byVariantId` is the canonical source of truth
- `imports` is a derived sorted list for quick enumeration
- if `imports` and `byVariantId` disagree on load, rebuild `imports` from `byVariantId` and rewrite the repaired index atomically
- index writes must use the same temp-file-plus-rename atomic write pattern already used by the local evolution store

## Scope Hash Rule

M2-B must keep using the same compatibility key that M2-A published:

- compare the local target skill scope hash to the remote metadata `scopeHash`
- do not invent a new derivation rule
- do not attempt fuzzy matching in this round

For M2-B, the local target scope hash is derived with the following exact rule:

1. resolve the current local skill contract using the existing resolver and current evolution-network flag
2. if the resolved contract already exposes a non-empty `scopeMetadata.scopeHash`, use it
3. otherwise compute the scope hash from the resolved contract scope using the same rule currently used by the M1 network-directory FIX generator: `JSON.stringify(scope)`

This keeps M2-B compatible with both:

- hosts that already have an active local variant with a stored `scopeHash`
- hosts that only have the packaged/base skill contract and therefore need deterministic local fallback derivation

Implementation may later extract this into a shared helper, but M2-B semantics are the rule above.

If the local target skill cannot provide a scope hash, search/import fail with `evolution_scope_hash_missing`.

## Import Validation Rules

Import must validate both layers.

### Metadata Pin Validation

The fetched metadata pin must satisfy:

- metadata pin exists and decodes to a JSON object
- `protocolVersion === "1"`
- `skillName` exists
- `skillName === "metabot-network-directory"` in this round
- `variantId` exists and matches `^[A-Za-z0-9._-]+$`
- `artifactUri` exists and is a valid `metafile://...` URI
- `evolutionType === "FIX"`
- `triggerSource` exists
- `scopeHash` exists and equals the local target scope hash
- `verificationPassed === true`
- `replayValid` is a boolean
- `notWorseThanBase` is a boolean
- `lineage` exists and includes non-empty `lineageId`, `rootVariantId`, `executionId`, and `analysisId`
- `lineage.parentVariantId` is either `null` or a non-empty string
- `publisherGlobalMetaId` exists
- `publishedAt` exists and is a finite number

Error mapping:

- unsupported `skillName` returns `evolution_import_not_supported`
- scope-hash mismatch returns `evolution_import_scope_mismatch`
- missing, malformed, protocol-invalid, or filename-unsafe metadata returns `evolution_import_metadata_invalid`

### Artifact Body Validation

After fetching the body JSON, import must validate:

- body structure is a valid shareable artifact body
- `body.variantId === metadata.variantId`
- `body.skillName === metadata.skillName`
- `body.metadata.scopeHash === metadata.scopeHash`
- `body.lineage` matches metadata `lineage`
- `body.verification.passed === metadata.verificationPassed`
- `body.verification.replayValid === metadata.replayValid`
- `body.verification.notWorseThanBase === metadata.notWorseThanBase`

If the artifact body cannot be fetched or decoded from `artifactUri`, import returns `evolution_import_artifact_fetch_failed`.

If the artifact body is fetched but fails body-level validation, import returns `evolution_import_artifact_invalid`.

### Duplicate Rule

If the local remote store already contains `variantId`, import fails with `evolution_import_variant_conflict`.

M2-B does not:

- overwrite existing remote imports
- upgrade to a newer publication for the same `variantId`
- keep multiple publication records for the same logical artifact

## CLI Result Shapes

M2-B keeps the existing CLI contract:

- stdout contains only the standard JSON `MetabotCommandResult` envelope
- successful commands return `{"ok":true,"state":"success","data":...}`
- M2-B does not add human-oriented logs or table output on stdout

### Search Success

Search should return:

```json
{
  "ok": true,
  "state": "success",
  "data": {
    "skillName": "metabot-network-directory",
    "scopeHash": "scope-hash-v1",
    "count": 3,
    "results": [
      {
        "pinId": "....i0",
        "variantId": "variant-xxx",
        "skillName": "metabot-network-directory",
        "artifactUri": "metafile://....json",
        "publisherGlobalMetaId": "idq...",
        "publishedAt": 1775701234567,
        "scopeHash": "scope-hash-v1",
        "triggerSource": "hard_failure",
        "verificationPassed": true,
        "replayValid": true,
        "notWorseThanBase": true,
        "alreadyImported": false,
        "importedPinId": null
      }
    ]
  }
}
```

`count` is `results.length`. M2-B does not return a separate `total`, `cursor`, or pagination token.

### Import Success

Import should return:

```json
{
  "ok": true,
  "state": "success",
  "data": {
    "pinId": "....i0",
    "variantId": "variant-xxx",
    "skillName": "metabot-network-directory",
    "publisherGlobalMetaId": "idq...",
    "artifactUri": "metafile://....json",
    "artifactPath": "/Users/.../.metabot/evolution/remote/artifacts/variant-xxx.json",
    "metadataPath": "/Users/.../.metabot/evolution/remote/artifacts/variant-xxx.meta.json",
    "importedAt": 1775702345678
  }
}
```

## Error Model

### Search Errors

- `evolution_search_not_supported`
- `evolution_scope_hash_missing`
- `evolution_chain_query_failed`
- `evolution_search_result_invalid`
- `evolution_network_disabled`

Mapping rules:

- unsupported search skill returns `evolution_search_not_supported`
- missing local scope hash returns `evolution_scope_hash_missing`
- chain HTTP/network failures while reading the recent search window return `evolution_chain_query_failed`
- malformed page envelopes or otherwise unparseable search-page payloads return `evolution_search_result_invalid`
- malformed individual metadata rows are skipped and do not fail search on their own

### Import Errors

- `evolution_import_not_supported`
- `evolution_import_pin_not_found`
- `evolution_import_metadata_invalid`
- `evolution_import_scope_mismatch`
- `evolution_import_variant_conflict`
- `evolution_import_artifact_fetch_failed`
- `evolution_import_artifact_invalid`
- `evolution_network_disabled`

Failures stay machine-first and explicit. M2-B should not silently degrade to partial import.

## Testing Scope

Required test coverage:

- search derives the local target scope hash from resolved contract metadata or the `JSON.stringify(scope)` fallback rule
- search validates `protocolVersion`, `evolutionType`, lineage fields, and identifier safety before considering a row eligible
- search returns only compatible metadata:
  - same `skillName`
  - same `scopeHash`
  - `verificationPassed === true`
- malformed individual search rows are skipped without failing the whole command
- search only reads the bounded recent metadata window for this round
- when multiple publications exist for one `variantId`, only the latest is returned
- search results are ordered by `publishedAt` descending then `pinId` ascending
- search marks already imported variants with `alreadyImported: true` and `importedPinId`
- import by `pinId` fetches metadata + artifact and writes:
  - imported artifact body
  - sidecar metadata file
  - remote index entry
- import rejects duplicate local `variantId`
- import rejects filename-unsafe `variantId`
- import rejects metadata/body mismatch
- import rejects scope mismatch
- import distinguishes artifact fetch failure from artifact validation failure
- remote index repair rebuilds `imports` from `byVariantId` when they disagree
- search and import are disabled when `evolution_network.enabled === false`
- import does not mutate:
  - local self-evolution artifact store
  - `activeVariants`

Out of scope for M2-B tests:

- adoption
- runtime auto-resolution against remote imports
- ranking
- trust scoring
- host-pack integration

## Non-Goals Reconfirmed

M2-B does not define:

- how imported remote artifacts become active
- whether imported remote artifacts can override local variants
- background sync
- trust/reputation
- publisher ranking
- automatic discovery inside host skill resolution

Those belong to later rounds after search/import is stable.

## Why This Design

This is the smallest defensible inbound step after M2-A:

- M2-A proves publication
- M2-B proves discovery and retrieval
- later rounds can prove activation and shared evolution

By separating local artifacts from remote imports and keeping import manual, M2-B preserves the local-first safety model while still making MetaWeb-native shared evolution real.
