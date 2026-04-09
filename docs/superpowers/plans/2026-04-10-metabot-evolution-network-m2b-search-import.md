# MetaBot Evolution Network M2-B Search And Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a local MetaBot search recent compatible M2-A evolution publications on MetaWeb and manually import one selected publication into a separate local remote-artifact store, without changing active runtime skill resolution.

**Architecture:** Add one narrow inbound path beside the existing M1 local kernel and M2-A publish path. The implementation should introduce: a dedicated remote evolution store under `~/.metabot/evolution/remote`, a small inbound protocol/reader layer for M2-A metadata rows plus artifact bodies, a bounded recent-window search pipeline, and a manual single-pin import pipeline. Wire both flows through new `metabot evolution search --skill` and `metabot evolution import --pin-id` CLI commands, still gated by `evolution_network.enabled`.

**Tech Stack:** TypeScript, Node.js 20-24, existing `metabot` CLI/runtime/daemon wiring, existing local evolution store conventions, public chain HTTP reads via the configured `METABOT_CHAIN_API_BASE_URL`, Node test runner (`node --test`), TypeScript build output under `dist/`.

---

## File Structure Map

### Create

- `src/core/evolution/remoteEvolutionStore.ts` — separate local storage for imported remote artifacts, including index repair and atomic writes.
- `src/core/evolution/import/publishedArtifactProtocol.ts` — pure inbound protocol helpers for validating M2-A metadata payloads, safe identifiers, and shareable artifact bodies.
- `src/core/evolution/import/searchArtifacts.ts` — bounded recent-window chain search orchestration, compatibility filtering, duplicate collapse, and imported-state annotation.
- `src/core/evolution/import/importArtifact.ts` — single-pin import orchestration for metadata lookup, artifact fetch, validation, duplicate protection, and store write.
- `src/core/evolution/import/chainEvolutionReader.ts` — narrow public-chain adapter for recent metadata rows, single-pin metadata lookup, and artifact-body fetch by `metafile://` URI.
- `tests/evolution/remoteEvolutionStore.test.mjs` — remote-store layout, repair, and atomic-write semantics.
- `tests/evolution/searchArtifacts.test.mjs` — bounded search behavior, row skipping, compatibility filtering, collapse, ordering, and import annotation.
- `tests/evolution/importArtifact.test.mjs` — import validation, fetch failure mapping, metadata/body coherence, and duplicate protection.

### Modify

- `src/core/state/paths.ts` — add resolved paths for `~/.metabot/evolution/remote`, remote artifact files, and remote index file.
- `src/core/evolution/types.ts` — add explicit types for remote imports, remote sidecar metadata, remote index rows, and search result summaries.
- `src/core/evolution/publish/shareableArtifact.ts` — export the M2-A protocol constants and any narrow reusable payload/body types needed by inbound validation.
- `src/cli/commands/evolution.ts` — add `search` and `import` subcommand parsing.
- `src/cli/types.ts` — add `evolution.search` and `evolution.import` dependency shapes.
- `src/cli/runtime.ts` — wire default runtime implementations for search/import, local scope-hash derivation, remote store access, and chain HTTP readers.
- `tests/cli/evolution.test.mjs` — CLI coverage for new subcommands and local-store side effects.
- `tests/cli/runtime.test.mjs` — runtime-level integration coverage against a fake chain API server for the default reader wiring.
- `README.md` — document M2-B scope, new commands, and the “import but not adopt” boundary.

### Leave Unchanged In M2-B

- `src/core/evolution/service.ts` — do not fold search/import into the M1 local observation/generation loop.
- `src/core/evolution/adoptionPolicy.ts` — no remote adoption work in this round.
- `skillpacks/*` and `SKILLs/*` — host packs remain stable shims and do not change for M2-B.
- `src/daemon/routes/*` — no new daemon route is required; CLI/runtime should reuse existing direct HTTP read patterns.

---

### Task 1: Add Remote Evolution Store And Path Layout

**Files:**
- Create: `src/core/evolution/remoteEvolutionStore.ts`
- Modify: `src/core/state/paths.ts`
- Modify: `src/core/evolution/types.ts`
- Test: `tests/evolution/remoteEvolutionStore.test.mjs`
- Reference: `src/core/evolution/localEvolutionStore.ts`

- [ ] **Step 1: Write failing remote-store tests**

Cover:
- resolved paths include:
  - `~/.metabot/evolution/remote`
  - `~/.metabot/evolution/remote/artifacts`
  - `~/.metabot/evolution/remote/index.json`
- empty store bootstraps to:

```json
{
  "schemaVersion": 1,
  "imports": [],
  "byVariantId": {}
}
```

- `writeImport()` writes:
  - `remote/artifacts/<variantId>.json`
  - `remote/artifacts/<variantId>.meta.json`
  - `remote/index.json`
- duplicate `variantId` is rejected before any overwrite
- `imports` is rebuilt from `byVariantId` when the stored index disagrees
- filename-unsafe `variantId` is rejected

Run: `npm run build && node --test tests/evolution/remoteEvolutionStore.test.mjs`
Expected: FAIL because the remote store module and remote path fields do not exist yet.

- [ ] **Step 2: Extend resolved paths and types**

Add remote evolution path fields to `MetabotPaths`:

```ts
evolutionRemoteRoot: string;
evolutionRemoteArtifactsRoot: string;
evolutionRemoteIndexPath: string;
```

Add narrow shared types to `src/core/evolution/types.ts` for:
- remote sidecar metadata
- remote index rows
- remote index shape
- search result summary rows

- [ ] **Step 3: Implement the remote store**

Build a dedicated store with a narrow API such as:

```ts
export interface RemoteEvolutionStore {
  ensureLayout(): Promise<void>;
  readIndex(): Promise<RemoteEvolutionIndex>;
  readArtifact(variantId: string): Promise<SkillVariantArtifact | null>;
  readSidecar(variantId: string): Promise<ImportedRemoteArtifactSidecar | null>;
  writeImport(input: {
    artifact: SkillVariantArtifact;
    sidecar: ImportedRemoteArtifactSidecar;
  }): Promise<{
    artifactPath: string;
    metadataPath: string;
    index: RemoteEvolutionIndex;
  }>;
}
```

Implementation rules:
- reuse the local store’s safe identifier regex
- make `byVariantId` canonical
- derive sorted `imports` from `Object.keys(byVariantId)`
- repair and atomically rewrite corrupt-but-recoverable indexes on read
- use temp-file-plus-rename writes for artifact, sidecar, and index files

- [ ] **Step 4: Re-run focused tests**

Run: `npm run build && node --test tests/evolution/remoteEvolutionStore.test.mjs tests/evolution/localEvolutionStore.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/state/paths.ts src/core/evolution/types.ts src/core/evolution/remoteEvolutionStore.ts tests/evolution/remoteEvolutionStore.test.mjs
git commit -m "feat: add remote evolution store"
```

### Task 2: Add Inbound Protocol Validation And Bounded Search

**Files:**
- Create: `src/core/evolution/import/publishedArtifactProtocol.ts`
- Create: `src/core/evolution/import/searchArtifacts.ts`
- Modify: `src/core/evolution/publish/shareableArtifact.ts`
- Test: `tests/evolution/searchArtifacts.test.mjs`
- Reference: `src/core/discovery/chainDirectoryReader.ts`
- Reference: `src/core/discovery/chainServiceDirectory.ts`

- [ ] **Step 1: Write failing search tests**

Cover:
- search derives local scope hash from:
  1. `resolved.scopeMetadata.scopeHash` when present
  2. fallback `JSON.stringify(resolved.scope)` when not present
- metadata payload extraction from `/pin/path/list` rows mirrors current chain-discovery parsing:
  - read `contentSummary` first
  - accept either an already-object payload or a JSON string payload
  - skip rows whose `contentSummary` is missing or not parseable as an object
- raw rows are skipped when missing any required metadata field:
  - `protocolVersion`
  - `variantId`
  - `artifactUri`
  - `lineage`
  - `publishedAt`
- only rows with:
  - same `skillName`
  - same `scopeHash`
  - `verificationPassed === true`
  survive filtering
- repeated publications collapse by `variantId` and keep newest `publishedAt`
- final results sort by `publishedAt` descending then `pinId` ascending
- already imported variants add:

```json
{
  "alreadyImported": true,
  "importedPinId": "older-or-current-pin"
}
```

- malformed individual rows are skipped without failing the full search
- transport/page-envelope failures return search-level errors
- search reads no more than `100` raw rows
- search never fetches artifact bodies; a body-fetch stub should remain unused even when valid rows are returned

Run: `npm run build && node --test tests/evolution/searchArtifacts.test.mjs`
Expected: FAIL because the inbound protocol/search modules do not exist yet.

- [ ] **Step 2: Implement pure inbound protocol helpers**

Add helpers for:

```ts
export const EVOLUTION_ARTIFACT_PROTOCOL_VERSION = '1';
export const EVOLUTION_SEARCH_MAX_RAW_ROWS = 100;

export function isSafeEvolutionIdentifier(value: unknown): value is string;
export function parseMetafilePinId(uri: string): string | null;
export function parsePublishedArtifactMetadata(value: unknown): PublishedEvolutionArtifactMetadata | null;
export function validateShareableArtifactBody(value: unknown): SkillVariantArtifact | null;
```

Rules:
- require `protocolVersion === "1"`
- require `evolutionType === "FIX"`
- require filename-safe `variantId`
- require boolean `verificationPassed`, `replayValid`, `notWorseThanBase`
- require lineage fields
- accept only `metafile://...` artifact URIs
- when parsing search-list rows, extract payload from `contentSummary` using the same object-or-JSON-string normalization pattern already used by `src/core/discovery/chainServiceDirectory.ts`

- [ ] **Step 3: Implement bounded search orchestration**

Build one search function with an injected transport:

```ts
export async function searchPublishedEvolutionArtifacts(input: {
  skillName: string;
  resolvedScopeHash: string;
  remoteStore: Pick<RemoteEvolutionStore, 'readIndex'>;
  fetchMetadataRows: () => Promise<Array<{ pinId: string; payload: unknown }>>;
}): Promise<{
  skillName: string;
  scopeHash: string;
  count: number;
  results: PublishedEvolutionArtifactSearchResult[];
}>;
```

Behavior:
1. fetch up to 100 recent metadata rows from `/pin/path/list?path=/protocols/metabot-evolution-artifact-v1`
2. parse rows with the protocol helper
3. skip invalid rows
4. filter for same skill + same scope + `verificationPassed`
5. collapse by `variantId`
6. sort deterministically
7. annotate `alreadyImported` and `importedPinId` from the remote store index

- [ ] **Step 4: Re-run focused tests**

Run: `npm run build && node --test tests/evolution/searchArtifacts.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/evolution/publish/shareableArtifact.ts src/core/evolution/import/publishedArtifactProtocol.ts src/core/evolution/import/searchArtifacts.ts tests/evolution/searchArtifacts.test.mjs
git commit -m "feat: add evolution artifact search"
```

### Task 3: Add Single-Pin Import Orchestration

**Files:**
- Create: `src/core/evolution/import/importArtifact.ts`
- Test: `tests/evolution/importArtifact.test.mjs`
- Reference: `src/core/evolution/remoteEvolutionStore.ts`
- Reference: `src/core/evolution/import/publishedArtifactProtocol.ts`

- [ ] **Step 1: Write failing import tests**

Cover:
- successful import by `pinId`:
  - reads metadata
  - validates protocol fields
  - fetches artifact body from `artifactUri`
  - writes remote artifact + sidecar + index entry
- unsupported `skillName` returns `evolution_import_not_supported`
- scope mismatch returns `evolution_import_scope_mismatch`
- malformed metadata returns `evolution_import_metadata_invalid`
- missing pin returns `evolution_import_pin_not_found`
- artifact fetch/JSON decode failure returns `evolution_import_artifact_fetch_failed`
- metadata/body mismatch returns `evolution_import_artifact_invalid`
- duplicate local `variantId` returns `evolution_import_variant_conflict`
- import leaves local self-evolution artifact store and `activeVariants` untouched

Run: `npm run build && node --test tests/evolution/importArtifact.test.mjs tests/evolution/remoteEvolutionStore.test.mjs`
Expected: FAIL because import orchestration does not exist yet.

- [ ] **Step 2: Implement import orchestration**

Build one narrow function:

```ts
export async function importPublishedEvolutionArtifact(input: {
  pinId: string;
  skillName: string;
  resolvedScopeHash: string;
  remoteStore: RemoteEvolutionStore;
  readMetadataPinById: (pinId: string) => Promise<unknown | null>;
  readArtifactBodyByUri: (artifactUri: string) => Promise<unknown>;
  now?: () => number;
}): Promise<{
  pinId: string;
  variantId: string;
  skillName: string;
  publisherGlobalMetaId: string;
  artifactUri: string;
  artifactPath: string;
  metadataPath: string;
  importedAt: number;
}>;
```

Validation sequence:
1. read metadata pin
2. parse metadata
3. enforce supported skill + scope match
4. reject duplicate `variantId` before write
5. read artifact body by `artifactUri`
6. validate body structure and metadata/body coherence
7. persist remote import and return machine-first result

- [ ] **Step 3: Add the sidecar payload shape**

Write sidecar files that minimally include:

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

Do not mutate the imported artifact body itself with import-only metadata.

- [ ] **Step 4: Re-run focused tests**

Run: `npm run build && node --test tests/evolution/importArtifact.test.mjs tests/evolution/remoteEvolutionStore.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/evolution/import/importArtifact.ts tests/evolution/importArtifact.test.mjs
git commit -m "feat: add evolution artifact import"
```

### Task 4: Wire Search And Import Through The CLI Runtime

**Files:**
- Create: `src/core/evolution/import/chainEvolutionReader.ts`
- Modify: `src/cli/commands/evolution.ts`
- Modify: `src/cli/types.ts`
- Modify: `src/cli/runtime.ts`
- Modify: `tests/cli/evolution.test.mjs`
- Modify: `tests/cli/runtime.test.mjs`
- Reference: `src/core/skills/skillResolver.ts`

- [ ] **Step 1: Write failing CLI and runtime tests**

Add CLI coverage for:
- `metabot evolution search --skill metabot-network-directory`
- `metabot evolution import --pin-id <pinId>`
- search requires `--skill`
- import requires `--pin-id`
- disabled `evolution_network.enabled` returns `evolution_network_disabled`
- search success returns JSON-only `MetabotCommandResult`
- import success returns artifact/metadata paths under `~/.metabot/evolution/remote/artifacts`

Add runtime integration coverage with a fake chain API server for:
- `/pin/path/list` search rows
- `/pin/<pinId>` metadata lookup
- `/content/<pinId>` artifact-body fetch after stripping `metafile://`

Run: `npm run build && node --test tests/cli/evolution.test.mjs tests/cli/runtime.test.mjs`
Expected: FAIL because the CLI subcommands and runtime readers do not exist yet.

- [ ] **Step 2: Extend CLI parsing and dependency shapes**

Add:

```ts
evolution.search?: (input: { skill: string }) => Awaitable<MetabotCommandResult<unknown>>;
evolution.import?: (input: { pinId: string }) => Awaitable<MetabotCommandResult<unknown>>;
```

Add command parsing branches:
- `metabot evolution search --skill ...`
- `metabot evolution import --pin-id ...`

Keep parsing consistent with current `publish`, `adopt`, and `rollback` branches.

- [ ] **Step 3: Verify and isolate the chain read transport**

Before wiring the default runtime reader, verify the actual manapi response shapes used for:
- protocol-path search rows
- single-pin metadata lookup
- artifact content fetch by stripped metafile pin id

Capture the result in one tiny adapter module or constants block rather than scattering endpoint strings through `src/cli/runtime.ts`.

Recommended shape:

```ts
// src/core/evolution/import/chainEvolutionReader.ts
export function createChainEvolutionReader(input: {
  chainApiBaseUrl?: string;
  fetchImpl?: typeof fetch;
}): {
  fetchMetadataRows(): Promise<Array<{ pinId: string; payload: unknown }>>;
  readMetadataPinById(pinId: string): Promise<unknown | null>;
  readArtifactBodyByUri(uri: string): Promise<unknown>;
};
```

The fake chain API server in `tests/cli/runtime.test.mjs` must mirror the same verified response shapes.

- [ ] **Step 4: Implement default runtime wiring**

In `src/cli/runtime.ts`:
- gate both commands behind `evolution_network.enabled`
- resolve the current local contract using the existing resolver
- derive scope hash by:
  1. using `scopeMetadata.scopeHash` when present
  2. falling back to `JSON.stringify(resolved.scope)`
- instantiate `createRemoteEvolutionStore(homeDir)`
- wire default chain readers against `METABOT_CHAIN_API_BASE_URL`:
  - search: `GET /pin/path/list`
  - metadata pin: `GET /pin/<pinId>`
  - artifact body: `GET /content/<stripped-metafile-pinId>`

Do not add table output or extra stdout; return only the normal JSON envelope.

- [ ] **Step 5: Re-run focused tests**

Run: `npm run build && node --test tests/cli/evolution.test.mjs tests/cli/runtime.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/evolution/import/chainEvolutionReader.ts src/cli/commands/evolution.ts src/cli/types.ts src/cli/runtime.ts tests/cli/evolution.test.mjs tests/cli/runtime.test.mjs
git commit -m "feat: add evolution search import cli"
```

### Task 5: Document M2-B And Run Final Verification

**Files:**
- Modify: `README.md`
- Reference: `docs/superpowers/specs/2026-04-09-metabot-evolution-network-m2b-search-import-design.md`

- [ ] **Step 1: Update README for M2-B**

Document:
- M2-B adds search + manual import only
- imported remote artifacts are stored separately from local self-evolved artifacts
- imported artifacts do not auto-adopt
- current command surface:

```bash
metabot evolution search --skill metabot-network-directory
metabot evolution import --pin-id <pinId>
```

- the feature flag still gates publish/search/import together

- [ ] **Step 2: Run focused M2-B verification**

Run:

```bash
npm run build
node --test tests/evolution/remoteEvolutionStore.test.mjs tests/evolution/searchArtifacts.test.mjs tests/evolution/importArtifact.test.mjs tests/cli/evolution.test.mjs tests/cli/runtime.test.mjs
```

Expected:
- all new M2-B tests PASS
- existing M2-A publish coverage still PASS

- [ ] **Step 3: Run broad repo verification**

Run:

```bash
npm test
```

Expected: PASS across the repo’s existing Node test suite.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document evolution search import"
```

## Notes For The Implementer

- This repo’s tests execute against `dist/`, so every focused test step must be preceded by `npm run build`.
- Keep M2-B recent-window search intentionally bounded. Do not turn this round into cursor-based history sync.
- Do not modify local `activeVariants` or the self-evolution artifact store anywhere in M2-B.
- Reuse the M2-A protocol shape exactly. Do not invent a second metadata path or a second artifact body schema.
- Keep remote import provenance in the sidecar file, not by mutating the shareable artifact body.
