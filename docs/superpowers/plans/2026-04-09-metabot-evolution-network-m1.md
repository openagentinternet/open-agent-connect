# MetaBot Evolution Network M1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first local self-repair loop for `metabot-network-directory`, gated by one persistent feature flag, using runtime-resolved skill contracts plus a local evolution registry under `~/.metabot`.

**Architecture:** Add a small config subsystem, a runtime skill resolver, and a local evolution kernel that records `metabot network services --online` executions, classifies failures, generates `FIX` variants, validates them, and activates same-skill same-scope variants locally. Keep all evolution state outside the repo and outside installed host pack files; installed host skills become stable shims that resolve the active runtime contract before use.

**Tech Stack:** TypeScript, Node.js 20-24, existing `metabot` CLI/daemon/runtime state stores, generated host skill packs, Node test runner (`node --test`).

---

## File Structure Map

### Create

- `src/core/config/configTypes.ts` — evolution feature-flag types and defaults.
- `src/core/config/configStore.ts` — read/write `~/.metabot/hot/config.json`.
- `src/core/skills/skillContractTypes.ts` — machine-readable base contract, scope, patch, and resolved contract types.
- `src/core/skills/baseSkillRegistry.ts` — canonical M1 base contract for `metabot-network-directory`.
- `src/core/skills/skillResolver.ts` — base contract + active variant merge logic plus host-format rendering.
- `src/core/evolution/types.ts` — execution record, analysis, artifact, lineage, verification, and adoption types.
- `src/core/evolution/localEvolutionStore.ts` — persistence for executions, analyses, artifacts, and index metadata under `~/.metabot/evolution`.
- `src/core/evolution/adoptionPolicy.ts` — same-skill same-scope auto-adopt policy.
- `src/core/evolution/service.ts` — orchestration entry point for record -> analyze -> generate -> validate -> adopt.
- `src/core/evolution/skills/networkDirectory/failureClassifier.ts` — `hard_failure` / `soft_failure` / `manual_recovery` rules for `metabot-network-directory`.
- `src/core/evolution/skills/networkDirectory/fixGenerator.ts` — deterministic `FIX` artifact creation for the M1 skill.
- `src/core/evolution/skills/networkDirectory/validator.ts` — replay/fixture validation for generated variants.
- `src/cli/commands/config.ts` — `metabot config get/set`.
- `src/cli/commands/skills.ts` — `metabot skills resolve`.
- `src/cli/commands/evolution.ts` — `metabot evolution status/replay/adopt/rollback`.
- `skillpacks/common/templates/runtime-resolve-shim.md` — host-pack shim template for runtime-resolved skills.
- `tests/config/configStore.test.mjs` — config persistence and defaults.
- `tests/evolution/skillResolver.test.mjs` — base+variant resolution tests.
- `tests/evolution/localEvolutionStore.test.mjs` — evolution file layout and round-trip persistence.
- `tests/evolution/networkDirectoryEvolution.test.mjs` — classifier, generator, validator, and adoption policy tests.
- `tests/cli/config.test.mjs` — CLI config command coverage.
- `tests/cli/skills.test.mjs` — CLI skills resolve command coverage.
- `tests/cli/evolution.test.mjs` — CLI evolution command coverage.

### Modify

- `src/core/state/paths.ts` — add config and evolution path helpers.
- `tests/state/stateLayout.test.mjs` — assert new `.metabot` layout.
- `src/cli/types.ts` — add `config`, `skills`, and `evolution` dependency groups.
- `src/cli/main.ts` — route new top-level commands.
- `src/cli/runtime.ts` — wire local stores/resolver/evolution service into default CLI dependencies and wrap network-service execution recording.
- `src/cli/commands/network.ts` — keep command parsing stable while allowing the runtime wrapper to observe `network services --online` executions.
- `scripts/build-metabot-skillpacks.mjs` — render `metabot-network-directory` as a runtime-resolve shim for all hosts.
- `tests/skillpacks/buildSkillpacks.test.mjs` — assert shim rendering and `metabot skills resolve` guidance.
- `README.md` — document the M1 feature flag and local-only evolution scope.
- `docs/hosts/codex.md` — explain the shim + resolve flow for Codex.
- `docs/hosts/claude-code.md` — explain the shim + resolve flow for Claude Code.
- `docs/hosts/openclaw.md` — explain the shim + resolve flow for OpenClaw.

### Leave Unchanged In M1

- `SKILLs/metabot-network-directory/SKILL.md` — keep the source skill readable; do not rewrite repo skill sources at runtime.
- `src/core/discovery/*` — do not auto-edit discovery engine internals in M1.
- `src/daemon/routes/*` — no new daemon API is required for M1; the CLI path is enough.

---

### Task 1: Add Config And State Layout Foundations

**Files:**
- Create: `src/core/config/configTypes.ts`
- Create: `src/core/config/configStore.ts`
- Modify: `src/core/state/paths.ts`
- Test: `tests/config/configStore.test.mjs`
- Test: `tests/state/stateLayout.test.mjs`

- [ ] **Step 1: Write failing tests for config defaults and expanded path layout**

Add tests that assert:
- `resolveMetabotPaths('/tmp/home')` now includes `configPath`, `evolutionRoot`, `evolutionExecutionsRoot`, `evolutionAnalysesRoot`, `evolutionArtifactsRoot`, and `evolutionIndexPath`
- `createConfigStore()` returns default config with `evolution_network.enabled === true`
- `configStore.set()` persists values across re-reads

Run: `node --test tests/config/configStore.test.mjs tests/state/stateLayout.test.mjs`
Expected: FAIL because the config store and new paths do not exist yet.

- [ ] **Step 2: Implement config types and store**

Add a compact config model similar to:

```ts
export interface EvolutionNetworkConfig {
  enabled: boolean;
  autoAdoptSameSkillSameScope: boolean;
  autoRecordExecutions: boolean;
}
```

Store it in `~/.metabot/hot/config.json` with safe defaults and idempotent writes.

- [ ] **Step 3: Extend the `.metabot` layout**

Update `resolveMetabotPaths()` to surface the evolution-specific paths without changing existing runtime-state, daemon, secrets, or exports semantics.

- [ ] **Step 4: Re-run focused tests**

Run: `node --test tests/config/configStore.test.mjs tests/state/stateLayout.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/config/configTypes.ts src/core/config/configStore.ts src/core/state/paths.ts tests/config/configStore.test.mjs tests/state/stateLayout.test.mjs
git commit -m "feat: add evolution config foundations"
```

### Task 2: Add Base Skill Contracts And Runtime Resolution

**Files:**
- Create: `src/core/skills/skillContractTypes.ts`
- Create: `src/core/skills/baseSkillRegistry.ts`
- Create: `src/core/skills/skillResolver.ts`
- Test: `tests/evolution/skillResolver.test.mjs`

- [ ] **Step 1: Write failing resolver tests**

Add tests that assert:
- base registry exposes `metabot-network-directory`
- resolver returns the base contract when the evolution network is disabled
- resolver returns a merged contract when an active variant exists
- same-scope metadata survives merge
- resolver can render both `json` and `markdown` outputs for host shims

Run: `node --test tests/evolution/skillResolver.test.mjs`
Expected: FAIL because no contract/resolver types exist yet.

- [ ] **Step 2: Define the skill contract types**

Model at least:
- base contract identity
- allowed commands
- structured permission scope
- patchable fields (`instructionsPatch`, `commandTemplatePatch`, `outputExpectationPatch`, `fallbackPolicyPatch`)
- rendered output shape for host consumption

- [ ] **Step 3: Implement the M1 base contract registry**

Hardcode the M1 canonical base contract for `metabot-network-directory` instead of over-generalizing skill generation in M1.

- [ ] **Step 4: Implement the runtime resolver**

Support:
- base-only resolution when disabled
- base + active variant merge when enabled
- host-targeted markdown rendering for `codex`, `claude-code`, and `openclaw`
- machine-readable JSON rendering for tests and future tooling

- [ ] **Step 5: Re-run focused tests**

Run: `node --test tests/evolution/skillResolver.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/skills/skillContractTypes.ts src/core/skills/baseSkillRegistry.ts src/core/skills/skillResolver.ts tests/evolution/skillResolver.test.mjs
git commit -m "feat: add runtime skill resolution"
```

### Task 3: Add Local Evolution Types, Store, And Adoption Policy

**Files:**
- Create: `src/core/evolution/types.ts`
- Create: `src/core/evolution/localEvolutionStore.ts`
- Create: `src/core/evolution/adoptionPolicy.ts`
- Test: `tests/evolution/localEvolutionStore.test.mjs`
- Test: `tests/evolution/networkDirectoryEvolution.test.mjs`

- [ ] **Step 1: Write failing tests for local evolution persistence and adoption rules**

Cover:
- execution, analysis, artifact, and index records persist in separate files under `~/.metabot/evolution`
- active variant mapping is maintained in the index
- same-skill same-scope candidates auto-adopt
- widened scope candidates do not auto-adopt

Run: `node --test tests/evolution/localEvolutionStore.test.mjs tests/evolution/networkDirectoryEvolution.test.mjs`
Expected: FAIL because the store and policy do not exist yet.

- [ ] **Step 2: Implement the evolution object model**

Add concrete types for:
- `SkillExecutionRecord`
- `SkillExecutionAnalysis`
- `SkillVariantArtifact`
- `SkillLineageRecord`
- `SkillVerificationSummary`
- `SkillAdoptionState`

- [ ] **Step 3: Implement the local evolution store**

Persist to:
- `executions/<executionId>.json`
- `analyses/<analysisId>.json`
- `artifacts/<variantId>.json`
- `index.json`

Keep the store append-safe and deterministic; no daemon dependency is needed in M1.

- [ ] **Step 4: Implement adoption policy**

Encode the agreed rule:
- auto-adopt only when `skillName` matches and permission scope is unchanged
- otherwise leave candidate in non-active state for manual adoption

- [ ] **Step 5: Re-run focused tests**

Run: `node --test tests/evolution/localEvolutionStore.test.mjs tests/evolution/networkDirectoryEvolution.test.mjs`
Expected: PASS for persistence and policy-only assertions; classifier/generator assertions may still fail until Task 4.

- [ ] **Step 6: Commit**

```bash
git add src/core/evolution/types.ts src/core/evolution/localEvolutionStore.ts src/core/evolution/adoptionPolicy.ts tests/evolution/localEvolutionStore.test.mjs tests/evolution/networkDirectoryEvolution.test.mjs
git commit -m "feat: add local evolution registry"
```

### Task 4: Implement `metabot-network-directory` Failure Classification, FIX Generation, And Validation

**Files:**
- Create: `src/core/evolution/skills/networkDirectory/failureClassifier.ts`
- Create: `src/core/evolution/skills/networkDirectory/fixGenerator.ts`
- Create: `src/core/evolution/skills/networkDirectory/validator.ts`
- Test: `tests/evolution/networkDirectoryEvolution.test.mjs`

- [ ] **Step 1: Expand the failing evolution test to cover M1 semantics**

Add cases for:
- `hard_failure` when `state = failed` or `data.services` is missing / invalid
- `soft_failure` when service rows are structurally unusable for downstream automation
- `manual_recovery` when UI fallback or repeated command repair is recorded
- `FIX` generator emits only allowed patch fields and preserves scope
- validator rejects widened-scope variants and accepts candidates that solve the triggering case

Run: `node --test tests/evolution/networkDirectoryEvolution.test.mjs`
Expected: FAIL because the skill-specific analyzer/generator/validator do not exist yet.

- [ ] **Step 2: Implement rule-based failure classification**

Make the classifier deterministic. Do not let M1 depend on an LLM. For this skill, classifier inputs should be enough to decide:
- completed vs not completed
- failure class
- whether the execution is an evolution candidate

- [ ] **Step 3: Implement deterministic `FIX` generation**

Create a narrow generator that can only change:
- instructions patch
- command template patch
- output expectation patch
- fallback policy patch

Do not allow it to:
- add commands
- widen scope
- create a new skill
- change discovery internals

- [ ] **Step 4: Implement replay/fixture validation**

Validate:
- protocol compatibility
- same skill identity
- no scope expansion
- no repeated trigger failure
- not worse than base behavior for the recorded case

- [ ] **Step 5: Re-run focused tests**

Run: `node --test tests/evolution/networkDirectoryEvolution.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/evolution/skills/networkDirectory/failureClassifier.ts src/core/evolution/skills/networkDirectory/fixGenerator.ts src/core/evolution/skills/networkDirectory/validator.ts tests/evolution/networkDirectoryEvolution.test.mjs
git commit -m "feat: add network-directory self-repair rules"
```

### Task 5: Add Evolution Service And Hook `network services --online`

**Files:**
- Create: `src/core/evolution/service.ts`
- Modify: `src/cli/runtime.ts`
- Modify: `src/cli/commands/network.ts`
- Modify: `tests/cli/network.test.mjs`
- Add to: `tests/evolution/networkDirectoryEvolution.test.mjs`

- [ ] **Step 1: Write failing tests for command observation and active variant updates**

Cover:
- when `evolution_network.enabled` is true, `metabot network services --online` writes an execution record
- triggering responses produce an analysis record
- a valid same-skill same-scope candidate becomes the active variant in the local index
- when the feature is disabled, no evolution side effects are written

Run: `node --test tests/cli/network.test.mjs tests/evolution/networkDirectoryEvolution.test.mjs`
Expected: FAIL because no orchestration hook exists yet.

- [ ] **Step 2: Implement the evolution orchestration service**

The service should:
- accept a normalized execution observation
- store execution
- classify failure
- generate candidate if needed
- validate candidate
- apply adoption policy
- update active variant mapping when auto-adopt applies

- [ ] **Step 3: Wrap the CLI network-services path**

Keep existing command parsing intact. Hook observation in `src/cli/runtime.ts` around the `network.listServices` dependency so host-driven CLI usage is captured without rewriting the discovery engine.

- [ ] **Step 4: Re-run focused tests**

Run: `node --test tests/cli/network.test.mjs tests/evolution/networkDirectoryEvolution.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/evolution/service.ts src/cli/runtime.ts src/cli/commands/network.ts tests/cli/network.test.mjs tests/evolution/networkDirectoryEvolution.test.mjs
git commit -m "feat: record network-directory self-repair runs"
```

### Task 6: Add CLI Control Surface For Config, Skills Resolve, And Evolution Operations

**Files:**
- Create: `src/cli/commands/config.ts`
- Create: `src/cli/commands/skills.ts`
- Create: `src/cli/commands/evolution.ts`
- Modify: `src/cli/main.ts`
- Modify: `src/cli/types.ts`
- Modify: `src/cli/runtime.ts`
- Test: `tests/cli/config.test.mjs`
- Test: `tests/cli/skills.test.mjs`
- Test: `tests/cli/evolution.test.mjs`

- [ ] **Step 1: Write failing CLI tests**

Cover:
- `metabot config get evolution_network.enabled`
- `metabot config set evolution_network.enabled false`
- `metabot skills resolve --skill metabot-network-directory --host codex --format markdown`
- `metabot skills resolve --skill metabot-network-directory --host codex --format json`
- `metabot evolution status`
- `metabot evolution adopt --skill metabot-network-directory --variant-id ...`
- `metabot evolution rollback --skill metabot-network-directory`

Run: `node --test tests/cli/config.test.mjs tests/cli/skills.test.mjs tests/cli/evolution.test.mjs`
Expected: FAIL because the new command groups do not exist yet.

- [ ] **Step 2: Implement CLI command parsing and dependency shapes**

Add new top-level routes in `src/cli/main.ts`, dependency interfaces in `src/cli/types.ts`, and default runtime implementations in `src/cli/runtime.ts`.

- [ ] **Step 3: Implement command outputs as machine-first envelopes**

Keep everything consistent with existing `MetabotCommandResult` semantics. `skills resolve --format markdown` may return the rendered contract as a string payload; `--format json` should return a structured object.

- [ ] **Step 4: Re-run focused tests**

Run: `node --test tests/cli/config.test.mjs tests/cli/skills.test.mjs tests/cli/evolution.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/config.ts src/cli/commands/skills.ts src/cli/commands/evolution.ts src/cli/main.ts src/cli/types.ts src/cli/runtime.ts tests/cli/config.test.mjs tests/cli/skills.test.mjs tests/cli/evolution.test.mjs
git commit -m "feat: add evolution cli controls"
```

### Task 7: Turn Host Skillpacks Into Runtime-Resolve Shims

**Files:**
- Create: `skillpacks/common/templates/runtime-resolve-shim.md`
- Modify: `scripts/build-metabot-skillpacks.mjs`
- Modify: `tests/skillpacks/buildSkillpacks.test.mjs`
- Optional doc note: `README.md`

- [ ] **Step 1: Write failing skillpack tests**

Update tests to assert that the generated `metabot-network-directory` skill now:
- instructs the host to call `metabot skills resolve`
- keeps the stable skill identity
- no longer hardcodes the full final contract in the host pack

Run: `node --test tests/skillpacks/buildSkillpacks.test.mjs`
Expected: FAIL because the host pack still renders the old static skill text.

- [ ] **Step 2: Implement the shim template and generation logic**

Special-case `metabot-network-directory` in the build script for M1. Do not generalize all skills yet. Make the generated skill a stable shim that resolves the runtime contract before use.

- [ ] **Step 3: Re-run focused tests**

Run: `node --test tests/skillpacks/buildSkillpacks.test.mjs`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add skillpacks/common/templates/runtime-resolve-shim.md scripts/build-metabot-skillpacks.mjs tests/skillpacks/buildSkillpacks.test.mjs
git commit -m "feat: render runtime-resolve host shim"
```

### Task 8: Update Developer-Facing Docs And Verify M1 End-To-End

**Files:**
- Modify: `README.md`
- Modify: `docs/hosts/codex.md`
- Modify: `docs/hosts/claude-code.md`
- Modify: `docs/hosts/openclaw.md`
- Reference: `docs/superpowers/specs/2026-04-09-metabot-evolution-network-design.md`

- [ ] **Step 1: Update docs to describe M1 clearly**

Document:
- what the local-only evolution network does in M1
- the total feature flag
- the new `config`, `skills resolve`, and `evolution` commands
- that installed host skills remain stable shims
- that no chain publication/search/import exists yet in M1

- [ ] **Step 2: Run focused command checks in the isolated worktree**

Run:
```bash
npm run build
node dist/cli/main.js config get evolution_network.enabled
node dist/cli/main.js skills resolve --skill metabot-network-directory --host codex --format json
```
Expected:
- build succeeds
- config command returns `true` by default
- skills resolve returns the base M1 contract when no local variant is active

- [ ] **Step 3: Run the full repo verification**

Run: `npm run verify`
Expected: PASS with the updated test count and zero failures.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/hosts/codex.md docs/hosts/claude-code.md docs/hosts/openclaw.md
git commit -m "docs: document local evolution network m1"
```

### Task 9: Final Acceptance Walkthrough

**Files:**
- No new source files; use the built CLI and local `.metabot` directory in the isolated worktree.

- [ ] **Step 1: Start from a clean local state**

Run:
```bash
rm -rf "$HOME/.metabot"
node dist/cli/main.js config get evolution_network.enabled
```
Expected: the command succeeds and returns `true` by default. If removing the real `$HOME/.metabot` is too risky in your environment, point `METABOT_HOME` at a temp directory instead.

- [ ] **Step 2: Exercise the target skill with the feature enabled**

Run:
```bash
METABOT_HOME="$(mktemp -d)" node dist/cli/main.js network services --online
```
Expected:
- the command returns a normal machine-first envelope
- evolution bookkeeping files are created under `~/.metabot/evolution` or the temp home override

- [ ] **Step 3: Confirm resolver + rollback behavior**

Run:
```bash
METABOT_HOME="$(mktemp -d)" node dist/cli/main.js skills resolve --skill metabot-network-directory --host codex --format markdown
METABOT_HOME="$(mktemp -d)" node dist/cli/main.js evolution status --skill metabot-network-directory
```
Expected:
- resolver returns a stable runtime contract
- status reports either base-only state or the current active variant
- rollback returns to base-only state cleanly when invoked

- [ ] **Step 4: Commit the acceptance-ready state**

```bash
git status --short
```
Expected: clean working tree before handoff.

---

## Implementation Notes

- Keep M1 local-only. Do not add `publish`, `search`, `import`, `sync`, `verify`, or `trust` implementations yet.
- Do not mutate repo `SKILLs/` or installed host packs at runtime.
- Do not hook evolution into daemon routes unless a CLI-only hook proves insufficient.
- Hardcode only the minimum M1 base contract and target-skill logic; do not generalize multi-skill evolution before M1 is green.
- Prefer deterministic rules over LLM-based analysis in M1.

## Recommended Order To Execute

1. Task 1
2. Task 2
3. Task 3
4. Task 4
5. Task 5
6. Task 6
7. Task 7
8. Task 8
9. Task 9

This order keeps the plan local-first, testable, and rollback-safe.
