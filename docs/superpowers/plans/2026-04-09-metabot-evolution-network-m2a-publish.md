# MetaBot Evolution Network M2-A Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a local MetaBot manually publish one locally verified `metabot-network-directory` evolution artifact to MetaWeb as a metadata pin plus a referenced artifact body, without changing local adoption state.

**Architecture:** Add one narrow evolution-publish path alongside the M1 local evolution kernel. The implementation should transform an existing local `SkillVariantArtifact` plus its linked analysis record into two publishable objects: a shareable artifact body uploaded through the existing `/file` flow, and a machine-readable metadata pin written to `/protocols/metabot-evolution-artifact-v1`. Wire this through a new `metabot evolution publish --skill --variant-id` CLI command, gated by the existing `evolution_network.enabled` flag.

**Tech Stack:** TypeScript, Node.js 20-24, existing `metabot` CLI/runtime/daemon handlers, local evolution store under `~/.metabot/evolution`, existing `/file` upload path, existing chain write path, Node test runner (`node --test`).

---

## File Structure Map

### Create

- `src/core/evolution/publish/shareableArtifact.ts` — pure transformers that build the shareable body JSON and metadata payload from a local artifact + linked analysis.
- `src/core/evolution/publish/publishArtifact.ts` — orchestration for read -> validate -> upload body -> write metadata pin -> return result.
- `tests/evolution/shareableArtifact.test.mjs` — transformer tests for metadata/body output and protocol semantics.
- `tests/evolution/publishArtifact.test.mjs` — orchestration tests for publish success/failure sequencing.

### Modify

- `src/cli/commands/evolution.ts` — add `publish` subcommand parsing and flags.
- `src/cli/types.ts` — add `evolution.publish` dependency shape.
- `src/cli/runtime.ts` — add the default runtime implementation for evolution publish, including feature-flag gating and real chain/file dependency reuse.
- `src/core/evolution/localEvolutionStore.ts` — add narrow read helpers for artifacts and analyses, or equivalent safe store access, instead of duplicating path logic in multiple places.
- `tests/cli/evolution.test.mjs` — add CLI-level coverage for `metabot evolution publish`.
- `README.md` — document the new manual publish command and M2-A scope boundary.

### Leave Unchanged In M2-A

- `src/core/evolution/service.ts` — do not fold publication into the M1 local observation/generation loop.
- `src/core/discovery/*` — no search/import work in this round.
- `src/daemon/routes/*` — no new daemon route is required; reuse existing file and chain write paths through current runtime dependencies.
- `skillpacks/*` and `SKILLs/*` — M2-A does not change host shims or installed skill packs.

---

### Task 1: Add Shareable Artifact Transformation

**Files:**
- Create: `src/core/evolution/publish/shareableArtifact.ts`
- Test: `tests/evolution/shareableArtifact.test.mjs`
- Reference: `src/core/evolution/types.ts`
- Reference: `src/core/skills/skillContractTypes.ts`

- [ ] **Step 1: Write failing transformer tests**

Cover:
- building a shareable body excludes local-only `status` and `adoption`
- metadata payload uses `/protocols/metabot-evolution-artifact-v1` semantics
- metadata payload copies `artifact.metadata.scopeHash` verbatim
- metadata payload derives `evolutionType` and `triggerSource` from the linked analysis record
- metadata payload splits `artifactCreatedAt`, `artifactUpdatedAt`, and `publishedAt`
- metadata write expectations require JSON payloads with `contentType = application/json`

Run: `node --test tests/evolution/shareableArtifact.test.mjs`
Expected: FAIL because the publish transformer module does not exist yet.

- [ ] **Step 2: Implement the shareable body builder**

Build a pure helper that accepts one local `SkillVariantArtifact` and returns a body object containing:
- `variantId`
- `skillName`
- `scope`
- `metadata`
- `patch`
- `lineage`
- `verification`
- `createdAt`
- `updatedAt`

Do not include:
- `status`
- `adoption`
- any local filesystem/runtime state

- [ ] **Step 3: Implement the metadata payload builder**

Build a pure helper that accepts:
- the local artifact
- the linked local analysis
- `artifactUri`
- `publisherGlobalMetaId`
- `publishedAt`

Return one machine-first JSON payload with:
- `protocolVersion`
- `skillName`
- `variantId`
- `artifactUri`
- `evolutionType`
- `triggerSource`
- `scopeHash`
- `sameSkill`
- `sameScope`
- `verificationPassed`
- `replayValid`
- `notWorseThanBase`
- `lineage`
- `publisherGlobalMetaId`
- `artifactCreatedAt`
- `artifactUpdatedAt`
- `publishedAt`

- [ ] **Step 4: Re-run focused tests**

Run: `node --test tests/evolution/shareableArtifact.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/evolution/publish/shareableArtifact.ts tests/evolution/shareableArtifact.test.mjs
git commit -m "feat: add evolution publish payload builders"
```

### Task 2: Add Publish Orchestration And Store Read Access

**Files:**
- Create: `src/core/evolution/publish/publishArtifact.ts`
- Modify: `src/core/evolution/localEvolutionStore.ts`
- Test: `tests/evolution/publishArtifact.test.mjs`
- Test: `tests/evolution/localEvolutionStore.test.mjs`

- [ ] **Step 1: Write failing publish orchestration tests**

Cover:
- verified artifact + coherent linked analysis publishes successfully
- body upload happens before metadata chain write
- metadata chain write uses `/protocols/metabot-evolution-artifact-v1` with `contentType = application/json`
- missing artifact fails with `evolution_variant_not_found`
- `artifact.skillName !== --skill` fails with `evolution_variant_skill_mismatch`
- missing linked analysis fails with `evolution_variant_analysis_mismatch`
- malformed linked analysis required fields fail with `evolution_variant_analysis_mismatch`
- linked analysis mismatch on `analysisId`, `skillName`, or `executionId` fails with `evolution_variant_analysis_mismatch`
- missing or empty `scopeHash` fails with `evolution_variant_scope_hash_missing`
- unverified artifact fails with `evolution_variant_not_verified`
- unsupported skill or non-`FIX` analysis fails with `evolution_publish_not_supported`
- body upload failure bubbles the exact failure and prevents any metadata write
- metadata chain-write failure bubbles the exact failure after a successful body upload
- publish leaves the artifact JSON and `index.json` unchanged before vs after the call

Run: `node --test tests/evolution/publishArtifact.test.mjs tests/evolution/localEvolutionStore.test.mjs`
Expected: FAIL because publish orchestration and store read helpers do not exist yet.

- [ ] **Step 2: Extend local evolution store with safe read access**

Add narrow helpers to load:
- one artifact by `variantId`
- one analysis by `analysisId`

They should:
- reuse existing path layout logic
- return `null` on missing files
- avoid duplicating file-path knowledge in publish orchestration

Scope note:
- these helpers are added for publish orchestration first
- do not broaden this task into refactoring all existing runtime readers unless a touched caller needs the helper immediately

- [ ] **Step 3: Implement publish orchestration**

Build one orchestration function that:
1. loads the artifact
2. loads the linked analysis
3. validates publish eligibility and coherence
4. builds the shareable body JSON
5. writes the body to a temp JSON file
6. uploads that temp file through core upload/write lambdas supplied as dependencies
7. builds metadata JSON
8. writes metadata to `/protocols/metabot-evolution-artifact-v1`
9. returns a machine-first publish result

The function must not:
- adopt the artifact
- mutate `activeVariants`
- write any new local “published” state in M2-A

Dependency rule:
- `publishArtifact.ts` should depend on narrow core lambdas such as `uploadArtifactBody(filePath) -> { artifactUri, ... }` and `writeMetadataPin(payload) -> { pinId, txids, ... }`
- it should not depend on CLI command handlers or daemon HTTP wrapper functions

- [ ] **Step 4: Re-run focused tests**

Run: `node --test tests/evolution/publishArtifact.test.mjs tests/evolution/localEvolutionStore.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/evolution/publish/publishArtifact.ts src/core/evolution/localEvolutionStore.ts tests/evolution/publishArtifact.test.mjs tests/evolution/localEvolutionStore.test.mjs
git commit -m "feat: add evolution publish orchestration"
```

### Task 3: Add `metabot evolution publish` CLI Surface

**Files:**
- Modify: `src/cli/commands/evolution.ts`
- Modify: `src/cli/types.ts`
- Modify: `src/cli/runtime.ts`
- Modify: `tests/cli/evolution.test.mjs`

- [ ] **Step 1: Write failing CLI tests**

Cover:
- `metabot evolution publish --skill metabot-network-directory --variant-id <id>` returns success for a verified local artifact
- the success envelope includes `pinId`, `txids`, `skillName`, `variantId`, `artifactUri`, `scopeHash`, `publisherGlobalMetaId`, and `publishedAt`
- missing `--skill` fails
- missing `--variant-id` fails
- `artifact.skillName !== --skill` fails with `evolution_variant_skill_mismatch`
- when `evolution_network.enabled` is false, publish fails with `evolution_network_disabled`
- publish leaves `activeVariants` and the target artifact file unchanged

Run: `node --test tests/cli/evolution.test.mjs`
Expected: FAIL because the CLI subcommand and dependency shape do not exist yet.

- [ ] **Step 2: Extend CLI command parsing**

Add one new `publish` branch under `runEvolutionCommand()` with required:
- `--skill`
- `--variant-id`

Keep parsing consistent with existing `adopt` / `rollback` style.

- [ ] **Step 3: Extend runtime dependency wiring**

Add `evolution.publish` to `CliDependencies` and wire a default runtime implementation that:
- reads `evolution_network.enabled`
- returns `evolution_network_disabled` when false
- delegates to the new publish orchestration with real local identity plus core upload/write lambdas built inside runtime

Do not add a new daemon route. Reuse the existing runtime surfaces.

- [ ] **Step 4: Re-run focused tests**

Run: `node --test tests/cli/evolution.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/evolution.ts src/cli/types.ts src/cli/runtime.ts tests/cli/evolution.test.mjs
git commit -m "feat: add evolution publish command"
```

### Task 4: Document M2-A And Verify Real Publish Behavior

**Files:**
- Modify: `README.md`
- Reference: `docs/superpowers/specs/2026-04-09-metabot-evolution-network-m2a-publish-design.md`

- [ ] **Step 1: Update README for M2-A**

Document:
- M2-A is manual publish only
- only verified local artifacts are publishable
- only `metabot-network-directory` is supported in this round
- the command surface: `metabot evolution publish --skill --variant-id`
- no search/import/trust yet

- [ ] **Step 2: Run focused automated verification**

Run:
```bash
npm run build
node --test tests/evolution/shareableArtifact.test.mjs tests/evolution/publishArtifact.test.mjs tests/cli/evolution.test.mjs
```
Expected:
- build succeeds
- new publish tests pass

- [ ] **Step 3: Run one real local acceptance publish**

Use the real default `metabot` chain path, not the fake debug daemon.

Use the already-configured default home for real acceptance so the existing daemon, identity, and evolution feature-flag gate are satisfied, then run:

```bash
node dist/cli/main.js doctor
```

Then create one reproducible verified fixture inside the default home with a one-off Node script that writes:
- one coherent `analysis` record
- one coherent verified `artifact` record linked to that analysis

Example setup shape:

```bash
node - <<'NODE'
const { createLocalEvolutionStore } = require('./dist/core/evolution/localEvolutionStore.js');
(async () => {
  const home = process.env.METABOT_HOME || process.env.HOME;
  const store = createLocalEvolutionStore(home);
  await store.writeAnalysis({
    analysisId: 'analysis-publish-1',
    executionId: 'execution-publish-1',
    skillName: 'metabot-network-directory',
    triggerSource: 'hard_failure',
    evolutionType: 'FIX',
    shouldGenerateCandidate: true,
    summary: 'fixture analysis',
    analyzedAt: 1775700000000,
  });
  await store.writeArtifact({
    variantId: 'variant-publish-1',
    skillName: 'metabot-network-directory',
    status: 'inactive',
    scope: {
      allowedCommands: ['metabot network services --online', 'metabot ui open --page hub'],
      chainRead: true,
      chainWrite: false,
      localUiOpen: true,
      remoteDelegation: false,
    },
    metadata: {
      sameSkill: true,
      sameScope: true,
      scopeHash: 'scope-hash-v1',
    },
    patch: {
      instructionsPatch: 'fixture publish patch',
    },
    lineage: {
      lineageId: 'lineage-publish-1',
      parentVariantId: null,
      rootVariantId: 'variant-publish-1',
      executionId: 'execution-publish-1',
      analysisId: 'analysis-publish-1',
      createdAt: 1775700000000,
    },
    verification: {
      passed: true,
      checkedAt: 1775700000500,
      protocolCompatible: true,
      replayValid: true,
      notWorseThanBase: true,
      notes: 'fixture verified',
    },
    adoption: 'manual',
    createdAt: 1775700000600,
    updatedAt: 1775700000600,
  });
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE

node dist/cli/main.js evolution publish --skill metabot-network-directory --variant-id variant-publish-1
```

Expected:
- `doctor` reports `daemon_reachable: true` and `identity_loaded: true`
- publish returns a real hex-like `pinId` and `txids`
- result includes a `metafile://...` `artifactUri`
- the returned `pinId` must not look like `/protocols/simplebuzz-pin-*` or any other fake-write fixture shape

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document evolution publish command"
```

### Task 5: Final M2-A Acceptance And Handoff

**Files:**
- No new source files; use the built CLI, local `~/.metabot`, and the real chain-connected daemon.

- [ ] **Step 1: Verify the working tree is clean before acceptance**

Run:
```bash
git status --short
```
Expected: clean except for intentional docs or test updates not yet committed.

- [ ] **Step 2: Re-run a clean publish from current head**

Run one end-to-end publish again from the accepted head:

```bash
npm run build
METABOT_HOME="<fixtureHome>" node dist/cli/main.js evolution publish --skill metabot-network-directory --variant-id variant-publish-1
```

Expected:
- build succeeds
- publish succeeds on current head
- returned `pinId` is a real chain pin id
- returned `artifactUri` is a real `metafile://...` URI

- [ ] **Step 3: Confirm clean handoff state**

Run:
```bash
git status --short
```
Expected: clean working tree before moving to M2-B.

---

## Implementation Notes

- Keep M2-A strictly outbound. Do not add search, import, recommendation, trust, or auto-adopt behavior.
- Copy `artifact.metadata.scopeHash` verbatim; do not invent a new scope-hash derivation rule in this round.
- Treat `variantId` as logical artifact identity and metadata `pinId` as publication record identity.
- Keep published body portable by excluding local-only `status` and `adoption`.
- Require `analysis.analysisId === artifact.lineage.analysisId`, `analysis.skillName === artifact.skillName`, and `analysis.executionId === artifact.lineage.executionId`.
- Feature-flag gating must match the M1 subsystem contract: disabled means publish is unavailable.
- For real-chain acceptance and any devlog process, use the default real daemon/identity path. Do not use fake-write debug daemons such as `127.0.0.1:51712`.
- Process note: after each completed implementation task, publish the development diary through the real default `metabot-post-buzz` chain path, but treat that as delivery hygiene rather than product acceptance scope.

## Recommended Order To Execute

1. Task 1
2. Task 2
3. Task 3
4. Task 4
5. Task 5
