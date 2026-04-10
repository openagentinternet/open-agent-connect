# MetaBot Evolution Network M2-C Remote Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a local MetaBot list imported remote evolution artifacts and manually adopt one imported remote artifact as the active runtime variant for `metabot-network-directory`, without copying it into the local self-evolution store.

**Architecture:** Upgrade the local active-variant reference to a source-aware record stored in the local evolution index, then teach the resolver and CLI/runtime to load active artifacts from either the local or remote store. Keep local and remote artifact stores separate, preserve rollback semantics, and expose imported-artifact inspection plus remote adopt through a narrow CLI surface.

**Tech Stack:** TypeScript, Node.js 20-24, existing `metabot` CLI/runtime/daemon wiring, local JSON-backed evolution stores under `~/.metabot`, Node test runner (`node --test`), TypeScript build output under `dist/`.

---

## File Structure Map

### Create

- `src/core/evolution/import/listImportedArtifacts.ts` — local-only imported-artifact listing orchestration, validation, sorting, and active-state annotation.
- `src/core/evolution/remoteAdoption.ts` — manual remote-adopt orchestration, scope recheck, verification recheck, and active-ref write.
- `tests/evolution/listImportedArtifacts.test.mjs` — imported-list projection, sorting, skip/fail rules, and active annotation.
- `tests/evolution/remoteAdoption.test.mjs` — remote adopt validation, scope mismatch handling, and active-ref persistence.

### Modify

- `src/core/evolution/types.ts` — source-aware active ref types and imported-list summary types.
- `src/core/evolution/localEvolutionStore.ts` — active-ref migration from legacy string values, active-ref writes, and canonical index normalization.
- `src/core/skills/skillContractTypes.ts` — resolved-contract active origin field.
- `src/core/skills/skillResolver.ts` — carry active variant source through JSON and markdown rendering.
- `src/cli/commands/evolution.ts` — `imported` subcommand parsing and `--source` support on `adopt`.
- `src/cli/types.ts` — `evolution.imported` dependency shape and `adopt` source input.
- `src/cli/runtime.ts` — source-aware active ref resolution, imported listing, remote adopt wiring, and backward-friendly `status` projection.
- `tests/evolution/localEvolutionStore.test.mjs` — legacy migration and source-aware active-ref coverage.
- `tests/evolution/skillResolver.test.mjs` — resolved contract origin coverage.
- `tests/cli/evolution.test.mjs` — CLI parsing coverage for `imported` and `adopt --source remote`.
- `tests/cli/runtime.test.mjs` — runtime integration coverage for imported listing, remote adopt, resolver-origin output, and status projection.
- `README.md` — document imported listing, remote adopt, and source-aware active runtime state.

### Leave Unchanged In M2-C

- `src/core/evolution/import/searchArtifacts.ts` — keep M2-B search behavior unchanged.
- `src/core/evolution/import/importArtifact.ts` — keep M2-B import behavior unchanged.
- `src/core/evolution/service.ts` — do not merge remote adopt into the M1 local self-repair loop.
- `src/core/evolution/publish/*` — no publish-path changes in this round.
- `skillpacks/*` and `SKILLs/*` — host packs remain stable runtime-resolve shims.

---

### Task 1: Introduce Source-Aware Active Variant Refs

**Files:**
- Modify: `src/core/evolution/types.ts`
- Modify: `src/core/evolution/localEvolutionStore.ts`
- Test: `tests/evolution/localEvolutionStore.test.mjs`
- Reference: `src/core/evolution/localEvolutionStore.ts`

- [ ] **Step 1: Write failing active-ref migration tests**

Cover:
- legacy index shape:

```json
{
  "schemaVersion": 1,
  "executions": [],
  "analyses": [],
  "artifacts": [],
  "activeVariants": {
    "metabot-network-directory": "variant-local-1"
  }
}
```

- read path normalizes legacy value to:

```json
{
  "source": "local",
  "variantId": "variant-local-1"
}
```

- malformed ref objects are dropped instead of crashing read
- store can persist a remote active ref:

```json
{
  "source": "remote",
  "variantId": "variant-remote-1"
}
```

- existing local `setActiveVariant()` behavior still works by writing a local ref

Run: `npm run build && node --test tests/evolution/localEvolutionStore.test.mjs`
Expected: FAIL because the index still assumes string-only active variants.

- [ ] **Step 2: Add source-aware active-ref types**

Add narrow shared types to `src/core/evolution/types.ts`:

```ts
export type SkillVariantSource = 'local' | 'remote';

export interface SkillActiveVariantRef {
  source: SkillVariantSource;
  variantId: string;
}
```

Update `SkillEvolutionIndex` so `activeVariants` becomes:

```ts
activeVariants: Record<string, SkillActiveVariantRef>;
```

- [ ] **Step 3: Implement legacy migration and active-ref writes**

Update local-store normalization to:
- accept legacy string values
- accept canonical ref objects
- drop malformed refs
- preserve deterministic key ordering

Keep a local convenience writer:

```ts
setActiveVariant(skillName: string, variantId: string): Promise<SkillEvolutionIndex>;
```

And add the source-aware writer:

```ts
setActiveVariantRef(
  skillName: string,
  ref: SkillActiveVariantRef
): Promise<SkillEvolutionIndex>;
```

Migration rule:
- treat legacy string values as `{ source: 'local', variantId }`
- keep `schemaVersion` at `1`; normalize active-ref shape in place

- [ ] **Step 4: Re-run focused store tests**

Run: `npm run build && node --test tests/evolution/localEvolutionStore.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/evolution/types.ts src/core/evolution/localEvolutionStore.ts tests/evolution/localEvolutionStore.test.mjs
git commit -m "feat: add source-aware active variant refs"
```

### Task 2: Expose Active Variant Origin In Skill Resolution

**Files:**
- Modify: `src/core/skills/skillContractTypes.ts`
- Modify: `src/core/skills/skillResolver.ts`
- Test: `tests/evolution/skillResolver.test.mjs`
- Reference: `src/core/skills/baseSkillRegistry.ts`

- [ ] **Step 1: Write failing resolver-origin tests**

Cover:
- base resolution returns:

```json
{
  "activeVariantId": null,
  "activeVariantSource": null
}
```

- merged local variant returns:

```json
{
  "activeVariantId": "variant-local-1",
  "activeVariantSource": "local"
}
```

- merged remote variant returns:

```json
{
  "activeVariantId": "variant-remote-1",
  "activeVariantSource": "remote"
}
```

- markdown render includes the active source line

Run: `npm run build && node --test tests/evolution/skillResolver.test.mjs`
Expected: FAIL because resolved contracts do not expose variant origin yet.

- [ ] **Step 2: Extend contract types**

Add:

```ts
export type ActiveVariantSource = 'local' | 'remote' | null;
```

Update resolved contract shape:

```ts
export interface ResolvedSkillContract extends BaseSkillContract {
  source: SkillResolutionSource;
  activeVariantId: string | null;
  activeVariantSource: ActiveVariantSource;
  scopeMetadata: SkillVariantScopeMetadata;
}
```

Allow resolver input to accept:

```ts
activeVariantSource?: 'local' | 'remote' | null;
```

- [ ] **Step 3: Implement resolver propagation**

Behavior:
- base contract => `activeVariantSource: null`
- merged local => `activeVariantSource: 'local'`
- merged remote => `activeVariantSource: 'remote'`

Do not change existing `source: 'base' | 'merged'` semantics in this round.

- [ ] **Step 4: Re-run focused resolver tests**

Run: `npm run build && node --test tests/evolution/skillResolver.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/skills/skillContractTypes.ts src/core/skills/skillResolver.ts tests/evolution/skillResolver.test.mjs
git commit -m "feat: expose active variant origin in resolver"
```

### Task 3: Add Imported Artifact Listing Orchestration

**Files:**
- Create: `src/core/evolution/import/listImportedArtifacts.ts`
- Modify: `src/core/evolution/types.ts`
- Test: `tests/evolution/listImportedArtifacts.test.mjs`
- Reference: `src/core/evolution/remoteEvolutionStore.ts`

- [ ] **Step 1: Write failing imported-list tests**

Cover:
- local-only listing reads imported remote index, sidecars, and artifact files
- only `metabot-network-directory` is supported in this round
- results include:

```json
{
  "variantId": "variant-remote-1",
  "pinId": "metadata-pin-1",
  "publishedAt": 1775701234567,
  "importedAt": 1775702345678,
  "scopeHash": "scope-hash-v1",
  "verificationPassed": true,
  "replayValid": true,
  "notWorseThanBase": true,
  "active": false
}
```

- results sort by `importedAt` descending then `variantId` ascending
- active remote ref marks the matching result as `active: true`
- missing imported files are skipped if other valid results remain
- malformed sidecar or malformed artifact body returns `evolution_imported_artifact_invalid`

Run: `npm run build && node --test tests/evolution/listImportedArtifacts.test.mjs`
Expected: FAIL because imported-list orchestration does not exist yet.

- [ ] **Step 2: Add imported-list summary types**

Add a summary row type to `src/core/evolution/types.ts` for imported-list results.

Recommended shape:

```ts
export interface ImportedEvolutionArtifactSummaryRow {
  variantId: string;
  pinId: string;
  skillName: string;
  publisherGlobalMetaId: string;
  artifactUri: string;
  publishedAt: number;
  importedAt: number;
  scopeHash: string;
  verificationPassed: boolean;
  replayValid: boolean;
  notWorseThanBase: boolean;
  active: boolean;
}
```

- [ ] **Step 3: Implement local imported-list orchestration**

Create:

```ts
export async function listImportedEvolutionArtifacts(input: {
  skillName: string;
  activeRef: SkillActiveVariantRef | null;
  remoteStore: Pick<RemoteEvolutionStore, 'readIndex' | 'readArtifact' | 'readSidecar'>;
}): Promise<{
  skillName: string;
  count: number;
  results: ImportedEvolutionArtifactSummaryRow[];
}>;
```

Rules:
- enforce supported skill
- read only local remote-store files
- derive verification fields from the imported artifact body
- annotate `active` only when active ref matches `{ source: 'remote', variantId }`
- skip missing file pairs only when listing can still continue safely
- fail on malformed sidecars or malformed artifact bodies

- [ ] **Step 4: Re-run focused imported-list tests**

Run: `npm run build && node --test tests/evolution/listImportedArtifacts.test.mjs tests/evolution/remoteEvolutionStore.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/evolution/types.ts src/core/evolution/import/listImportedArtifacts.ts tests/evolution/listImportedArtifacts.test.mjs
git commit -m "feat: add imported evolution artifact listing"
```

### Task 4: Add Manual Remote Adoption Orchestration

**Files:**
- Create: `src/core/evolution/remoteAdoption.ts`
- Test: `tests/evolution/remoteAdoption.test.mjs`
- Reference: `src/core/evolution/import/importArtifact.ts`
- Reference: `src/core/evolution/adoptionPolicy.ts`

- [ ] **Step 1: Write failing remote-adopt tests**

Cover:
- successful remote adopt writes:

```json
{
  "source": "remote",
  "variantId": "variant-remote-1"
}
```

into the local active ref for the target skill
- unsupported skill returns `evolution_remote_adopt_not_supported`
- missing imported artifact or sidecar returns `evolution_remote_variant_not_found`
- skill mismatch returns `evolution_remote_variant_skill_mismatch`
- sidecar scope hash mismatch against current resolved scope hash returns `evolution_remote_variant_scope_mismatch`
- imported artifact with failed verification tuple returns `evolution_remote_variant_invalid`
- remote adopt does not write into the local self-evolution artifact directory

Run: `npm run build && node --test tests/evolution/remoteAdoption.test.mjs`
Expected: FAIL because remote-adopt orchestration does not exist yet.

- [ ] **Step 2: Implement remote-adopt orchestration**

Create:

```ts
export async function adoptRemoteEvolutionArtifact(input: {
  skillName: string;
  variantId: string;
  resolvedScopeHash: string;
  remoteStore: Pick<RemoteEvolutionStore, 'readArtifact' | 'readSidecar'>;
  evolutionStore: Pick<LocalEvolutionStore, 'setActiveVariantRef'>;
}): Promise<{
  skillName: string;
  variantId: string;
  source: 'remote';
  active: true;
}>;
```

Validation order:
1. enforce supported skill
2. read imported artifact + sidecar
3. verify both exist
4. verify artifact skill matches requested skill
5. verify sidecar scope hash matches current resolved scope hash
6. verify imported artifact tuple:
   - `verification.passed === true`
   - `verification.replayValid === true`
   - `verification.notWorseThanBase === true`
7. write `{ source: 'remote', variantId }` to local active refs

- [ ] **Step 3: Re-run focused remote-adopt tests**

Run: `npm run build && node --test tests/evolution/remoteAdoption.test.mjs tests/evolution/localEvolutionStore.test.mjs`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/core/evolution/remoteAdoption.ts tests/evolution/remoteAdoption.test.mjs
git commit -m "feat: add remote evolution adoption"
```

### Task 5: Wire CLI And Runtime For Imported Listing And Remote Adopt

**Files:**
- Modify: `src/cli/commands/evolution.ts`
- Modify: `src/cli/types.ts`
- Modify: `src/cli/runtime.ts`
- Test: `tests/cli/evolution.test.mjs`
- Test: `tests/cli/runtime.test.mjs`
- Reference: `src/core/evolution/import/listImportedArtifacts.ts`
- Reference: `src/core/evolution/remoteAdoption.ts`

- [ ] **Step 1: Write failing CLI/runtime tests**

Cover CLI parsing:
- `metabot evolution imported --skill metabot-network-directory`
- `metabot evolution adopt --skill metabot-network-directory --variant-id variant-remote-1 --source remote`
- `adopt --source local` still works through the existing path
- `adopt` defaults to local when `--source` is omitted

Cover runtime behavior:
- `status` now returns both:

```json
"activeVariants": {
  "metabot-network-directory": "variant-remote-1"
},
"activeVariantRefs": {
  "metabot-network-directory": {
    "source": "remote",
    "variantId": "variant-remote-1"
  }
}
```

- `skills resolve --format json` exposes `activeVariantSource`
- `imported` returns local imported rows without querying chain
- remote adopt writes a remote active ref and later `skills resolve` uses the remote artifact body
- unsupported imported skill returns `evolution_imported_not_supported`
- unsupported remote adopt source/skill returns `evolution_remote_adopt_not_supported`
- disabled evolution network returns `evolution_network_disabled` for imported listing and remote adopt

Run: `npm run build && node --test tests/cli/evolution.test.mjs tests/cli/runtime.test.mjs`
Expected: FAIL because the CLI/runtime does not yet support M2-C surfaces.

- [ ] **Step 2: Extend command parsing**

Add:

```ts
if (subcommand === 'imported') {
  // require --skill
}
```

Extend adopt parsing:

```ts
const source = readFlagValue(args, '--source') ?? 'local';
return handler({ skill, variantId, source });
```

- [ ] **Step 3: Extend runtime dependency shapes**

Update `src/cli/types.ts`:

```ts
adopt?: (input: { skill: string; variantId: string; source?: 'local' | 'remote' }) => Awaitable<MetabotCommandResult<unknown>>;
imported?: (input: { skill: string }) => Awaitable<MetabotCommandResult<unknown>>;
```

- [ ] **Step 4: Implement source-aware runtime wiring**

Update runtime helpers to:
- resolve active refs from the local evolution index
- load active artifacts from the correct store
- pass `activeVariantSource` through to skill resolution
- project backward-friendly `activeVariants` for `status`
- add `activeVariantRefs` to `status`

Wire imported listing through `listImportedEvolutionArtifacts()`.

Wire remote adopt through `adoptRemoteEvolutionArtifact()`.

Keep local adopt behavior on the existing path when `source !== 'remote'`.

- [ ] **Step 5: Re-run focused CLI/runtime tests**

Run: `npm run build && node --test tests/cli/evolution.test.mjs tests/cli/runtime.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/evolution.ts src/cli/types.ts src/cli/runtime.ts tests/cli/evolution.test.mjs tests/cli/runtime.test.mjs
git commit -m "feat: wire remote evolution adoption cli"
```

### Task 6: Document M2-C And Run Final Verification

**Files:**
- Modify: `README.md`
- Reference: `docs/superpowers/specs/2026-04-10-metabot-evolution-network-m2c-remote-adoption-design.md`

- [ ] **Step 1: Update README for M2-C**

Document:
- imported remote artifacts can now be listed locally
- remote adopt is manual and uses `--source remote`
- active runtime state is now source-aware
- local and remote stores remain separate
- imported remote artifacts still do not auto-adopt

Current command surface:

```bash
metabot evolution imported --skill metabot-network-directory
metabot evolution adopt --skill metabot-network-directory --variant-id <variantId> --source remote
metabot evolution rollback --skill metabot-network-directory
```

- [ ] **Step 2: Run focused M2-C verification**

Run:

```bash
npm run build
node --test tests/evolution/localEvolutionStore.test.mjs tests/evolution/skillResolver.test.mjs tests/evolution/listImportedArtifacts.test.mjs tests/evolution/remoteAdoption.test.mjs tests/cli/evolution.test.mjs tests/cli/runtime.test.mjs
```

Expected:
- all new M2-C tests PASS
- existing M1/M2-A/M2-B evolution coverage still PASS

- [ ] **Step 3: Run broad repo verification**

Run:

```bash
npm test
```

Expected: PASS across the repo’s existing Node test suite.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document remote evolution adoption"
```

## Notes For The Implementer

- Keep M2-C local-first. Imported listing and remote adopt must not trigger chain reads.
- Preserve the separation between local self-evolution artifacts and remote imported artifacts. Do not copy remote artifacts into the local store during adopt.
- Keep rollback semantics simple: clear the active ref and return to base behavior.
- Treat malformed active refs as recoverable local-state issues. Resolver fallback to base is safer than host failure.
- Preserve backward compatibility where cheap:
  - omitted `--source` on `adopt` keeps local behavior
  - `status.activeVariants` remains a string projection
- Do not add recommendation, ranking, trust scoring, or auto-adopt logic in this round.
