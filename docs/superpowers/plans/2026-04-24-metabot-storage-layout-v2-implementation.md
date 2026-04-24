# MetaBot Storage Layout v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy `.metabot/hot` storage model with the approved profile-first v2 layout across the CLI, daemon, bootstrap flow, runtime stores, tests, skillpacks, and active documentation.

**Architecture:** Introduce one central v2 path graph rooted at `HOME/.metabot`, then route every profile operation through the manager index plus validated active-profile resolution. Identity bootstrap becomes a durable profile-registration flow: create the profile workspace, derive and persist identity/runtime data inside `profile/.runtime`, write the manager index atomically, and only then update the active-profile pointer.

**Tech Stack:** TypeScript, Node.js `fs/path/os`, existing CLI/daemon/bootstrap modules, `node:test`, repository Markdown docs and skillpacks.

---

## Execution Rules

- Use `@superpowers:test-driven-development` task-by-task.
- Treat any new `\.metabot/hot`, `hotRoot`, or system-home-as-profile fallback as a regression.
- Do not implement a compatibility shim or migration path; this is a full pre-release cut-over.
- End every completed task with exactly one commit, then publish the task diary with `@metabot-post-buzz` to satisfy `AGENTS.md`.

## Implementation Map

### Path graph and home-selection layer

- Modify: `src/core/state/paths.ts`
- Create: `src/core/state/homeSelection.ts`
- Modify: `src/daemon/index.ts`
- Modify: `src/cli/runtime.ts`
- Modify: `tests/state/stateLayout.test.mjs`
- Modify: `tests/cli/runtime.test.mjs`
- Modify: `tests/cli/doctor.test.mjs`

Responsibility:

- expose `systemHomeDir`, `metabotRoot`, `managerRoot`, `skillsRoot`, `profilesRoot`, `profileRoot`, `workspaceRoot`, `runtimeRoot`, `sessionsRoot`, `exportsRoot`, `evolutionRoot`, `stateRoot`, and `locksRoot`
- expose concrete file paths for `manager/identity-profiles.json`, `manager/active-home.json`, `.runtime/config.json`, `.runtime/identity-secrets.json`, `.runtime/provider-secrets.json`, `.runtime/runtime-state.json`, `.runtime/daemon.json`, `.runtime/runtime.sqlite`, `.runtime/sessions/a2a-session-state.json`, `.runtime/state/*.json`, `.runtime/exports/*`, `.runtime/evolution/*`, and `.runtime/locks/daemon.lock`
- validate `METABOT_HOME` against the manager index and reject legacy-only layouts before runtime code touches state

### Identity metadata, slugs, and workspace bootstrap

- Modify: `src/core/identity/identityProfiles.ts`
- Create: `src/core/identity/profileNameResolution.ts`
- Create: `src/core/identity/profileWorkspace.ts`
- Modify: `src/core/bootstrap/localIdentityBootstrap.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `src/cli/runtime.ts`
- Create: `tests/identity/profileNameResolution.test.mjs`
- Create: `tests/identity/identityProfiles.test.mjs`
- Modify: `tests/bootstrap/localIdentityBootstrap.test.mjs`
- Modify: `tests/cli/runtime.test.mjs`

Responsibility:

- generate stable ASCII profile slugs and alias lists from human names
- store v2 profile metadata records with `name`, `slug`, `aliases`, `homeDir`, `createdAt`, `updatedAt`, and derived identity fields when available
- resolve `identity assign --name` through deterministic best-match ranking instead of exact raw-name equality
- materialize the required workspace files plus eager runtime scaffold during `identity create`
- make index and active-pointer writes durable, ordered, and non-best-effort

### Runtime store relocation into `.runtime`

- Modify: `src/core/config/configStore.ts`
- Modify: `src/core/secrets/fileSecretStore.ts`
- Modify: `src/core/state/runtimeStateStore.ts`
- Modify: `src/core/state/exportStore.ts`
- Delete: `src/core/state/hotStateStore.ts`
- Modify: `src/core/provider/providerPresenceState.ts`
- Modify: `src/core/ratings/ratingDetailState.ts`
- Modify: `src/core/master/masterPublishedState.ts`
- Modify: `src/core/master/masterPendingAskState.ts`
- Modify: `src/core/master/masterSuggestState.ts`
- Modify: `src/core/master/masterAutoFeedbackState.ts`
- Modify: `src/core/a2a/sessionStateStore.ts`
- Modify: `tests/state/secretStore.test.mjs`
- Modify: `tests/state/runtimeStateStore.test.mjs`
- Modify: `tests/state/exportStore.test.mjs`
- Delete or replace: `tests/state/hotStateStore.test.mjs`
- Modify: `tests/config/configStore.test.mjs`
- Modify: `tests/a2a/sessionStateStore.test.mjs`

Responsibility:

- move all runtime JSON, lock, export, session, and database files into `profile/.runtime/*`
- keep `config.json` and `identity-secrets.json` eagerly materialized, with `provider-secrets.json` lazy
- write secret files with owner-only permissions on supported platforms
- remove the last legacy `hot`-named store wrapper so the new layout is visible in the API surface too

### Daemon, trace, and evolution integration

- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `src/core/chat/sessionTrace.ts`
- Modify: `src/core/evolution/localEvolutionStore.ts`
- Modify: `src/core/evolution/remoteEvolutionStore.ts`
- Modify: `tests/chat/sessionTrace.test.mjs`
- Modify: `tests/chat/transcriptExport.test.mjs`
- Modify: `tests/master/masterTraceMetadata.test.mjs`
- Modify: `tests/master/masterTraceCommand.test.mjs`
- Modify: `tests/evolution/remoteEvolutionStore.test.mjs`
- Modify: `tests/e2e/masterAskHappyPath.test.mjs`
- Modify: `tests/e2e/masterAskHostFlow.test.mjs`

Responsibility:

- move daemon lock handling to `.runtime/locks/daemon.lock`
- move directory-seed, provider, rating, and master closure state into `.runtime/state/`
- move transcript/trace exports into `.runtime/exports/chats/` and `.runtime/exports/traces/`
- move evolution indexes and artifacts into `.runtime/evolution/`
- keep all route handlers and trace flows operating from the new path graph only

### Skills, runbooks, fixtures, and final regression sweep

- Modify: `SKILLs/metabot-identity-manage/SKILL.md`
- Modify: `docs/hosts/codex-agent-install.md`
- Modify: `docs/hosts/codex-agent-identity-runbook.md`
- Modify: `docs/hosts/codex-dev-test-runbook.md`
- Modify: `tests/docs/codexInstallDocs.test.mjs`
- Modify: `tests/skillpacks/buildSkillpacks.test.mjs`
- Modify: any remaining fixtures or docs that still assume `.metabot/hot` or manual slug shell scripts

Responsibility:

- document the new manager/profile split and `~/.metabot/profiles/<slug>/` ownership model
- stop telling humans or host skills to hand-compute `PROFILE_SLUG` or patch runtime JSON directly
- verify repo-visible guidance now treats `identity create --name` plus `identity assign --name` as the supported UX

---

### Task 1: Build the Central v2 Path Graph and Home Resolver

**Files:**
- Modify: `src/core/state/paths.ts`
- Create: `src/core/state/homeSelection.ts`
- Modify: `src/daemon/index.ts`
- Modify: `src/cli/runtime.ts`
- Test: `tests/state/stateLayout.test.mjs`
- Test: `tests/cli/runtime.test.mjs`
- Test: `tests/cli/doctor.test.mjs`

- [ ] **Step 1: Write the failing layout and resolution tests**

Cover at least these cases:

- `resolveMetabotPaths('/tmp/system-home/.metabot/profiles/charles-zhang')` returns `managerRoot`, `skillsRoot`, `profilesRoot`, `profileRoot`, `runtimeRoot`, `stateRoot`, `sessionsRoot`, `exportsRoot`, `locksRoot`, `identitySecretsPath`, `providerSecretsPath`, and the new `.runtime/*` descendants.
- runtime resolution rejects `METABOT_HOME=/tmp/arbitrary-dir` and `METABOT_HOME=/tmp/system-home`.
- runtime resolution rejects a legacy-only `.metabot/hot` layout when the manager/profile structure is missing.
- runtime resolution reports “no active profile initialized” instead of silently falling back to raw `HOME`.

- [ ] **Step 2: Run the targeted tests and confirm they fail for the right reasons**

Run:

```bash
npm run build
node --test tests/state/stateLayout.test.mjs tests/cli/runtime.test.mjs tests/cli/doctor.test.mjs
```

Expected: failures mentioning the missing v2 path fields, old `hot` expectations, and the current fallback to system home.

- [ ] **Step 3: Implement the new path graph and validated home-selection helpers**

Required code shape:

- `src/core/state/paths.ts` must stop returning `hotRoot` and instead return the full v2 graph rooted at `profile/.runtime`.
- `src/core/state/homeSelection.ts` must centralize: system-home normalization, manager-path resolution, `METABOT_HOME` validation, active-home lookup, and legacy-layout detection.
- `src/cli/runtime.ts` and `src/daemon/index.ts` must compile against the new path names instead of assembling `.metabot/...` strings manually.

- [ ] **Step 4: Re-run the targeted tests until they pass**

Run the same commands from Step 2.

Expected: PASS, with path assertions matching the v2 spec and no fallback to raw system home.

- [ ] **Step 5: Commit and publish the task diary**

Run:

```bash
git add src/core/state/paths.ts src/core/state/homeSelection.ts src/daemon/index.ts src/cli/runtime.ts tests/state/stateLayout.test.mjs tests/cli/runtime.test.mjs tests/cli/doctor.test.mjs
git commit -m "refactor: add metabot storage layout v2 path model"
```

Then use `@metabot-post-buzz` to post a development diary covering the new path graph, validation rules, and failing cases removed.

### Task 2: Add Slugging, Alias, and Best-Match Profile Resolution

**Files:**
- Create: `src/core/identity/profileNameResolution.ts`
- Modify: `src/core/identity/identityProfiles.ts`
- Create: `tests/identity/profileNameResolution.test.mjs`
- Create: `tests/identity/identityProfiles.test.mjs`
- Modify: `tests/cli/runtime.test.mjs`

- [ ] **Step 1: Write the failing slug and best-match tests**

Cover at least these cases:

- `Charles Zhang`, `Charles_Zhang`, `Chärles Zhang`, and `Charles Zhang 🤖` all normalize to the same lookup key and slug `charles-zhang`.
- empty-or-punctuation-only names fall back to `mb-<stable-short-hash>`.
- profile records persist `slug` and `aliases` in `manager/identity-profiles.json`.
- `identity assign --name "Charles Zhang"` can resolve a profile whose directory name is `charles-zhang`.
- two near-tied candidates produce an explicit ambiguity error instead of silent selection.

- [ ] **Step 2: Run the targeted tests and confirm they fail**

Run:

```bash
npm run build
node --test tests/identity/profileNameResolution.test.mjs tests/identity/identityProfiles.test.mjs tests/cli/runtime.test.mjs
```

Expected: failures because the repo currently has no slug/alias resolver and still uses exact lower-case name matching.

- [ ] **Step 3: Implement deterministic slugging and manager-record normalization**

Required code shape:

- `src/core/identity/profileNameResolution.ts` should export the slug generator, alias builder, lookup-key normalizer, best-match scorer, and deterministic tie detection.
- `src/core/identity/identityProfiles.ts` should persist the v2 record shape, normalize `homeDir` under `~/.metabot/profiles/<slug>`, and validate the active pointer against indexed profiles.
- keep the best-match ordering from the spec: exact slug, exact normalized display name, exact normalized alias, then deterministic ranked search.

- [ ] **Step 4: Re-run the targeted tests until they pass**

Run the same commands from Step 2.

Expected: PASS, with deterministic slug generation, alias persistence, and ambiguity protection.

- [ ] **Step 5: Commit and publish the task diary**

Run:

```bash
git add src/core/identity/profileNameResolution.ts src/core/identity/identityProfiles.ts tests/identity/profileNameResolution.test.mjs tests/identity/identityProfiles.test.mjs tests/cli/runtime.test.mjs
git commit -m "feat: add metabot profile slug and match resolution"
```

Then use `@metabot-post-buzz` to publish what changed in slugging, aliases, duplicate protection, and name resolution.

### Task 3: Make `identity create/list/assign/who` Follow the Manager/Profile Contract

**Files:**
- Create: `src/core/identity/profileWorkspace.ts`
- Modify: `src/core/bootstrap/localIdentityBootstrap.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `src/cli/runtime.ts`
- Modify: `tests/bootstrap/localIdentityBootstrap.test.mjs`
- Modify: `tests/cli/runtime.test.mjs`
- Modify: `tests/cli/doctor.test.mjs`
- Modify: `tests/bootstrap/bootstrapFlow.test.mjs`

- [ ] **Step 1: Write the failing bootstrap and identity-flow tests**

Cover at least these cases:

- `identity create --name "Charles Zhang"` automatically creates `~/.metabot/profiles/charles-zhang/` without requiring the caller to precompute a slug.
- the profile root eagerly contains `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md`, `memory/`, `.runtime/`, `.runtime/sessions/`, `.runtime/evolution/`, `.runtime/exports/`, `.runtime/state/`, `.runtime/locks/`, `.runtime/config.json`, and `.runtime/identity-secrets.json`.
- `identity create` refuses likely duplicates before auto-suffixing a slug.
- `identity list` reads only from `manager/identity-profiles.json`.
- `identity who` fails explicitly when `active-home.json` is missing, invalid, or points at a non-indexed profile.

- [ ] **Step 2: Run the targeted tests and confirm they fail**

Run:

```bash
npm run build
node --test tests/bootstrap/localIdentityBootstrap.test.mjs tests/bootstrap/bootstrapFlow.test.mjs tests/cli/runtime.test.mjs tests/cli/doctor.test.mjs
```

Expected: failures because profile creation is currently best-effort, profile files are not scaffolded, and `who/list` still infer state from the active runtime home.

- [ ] **Step 3: Implement durable profile registration and eager workspace scaffolding**

Required code shape:

- `src/core/identity/profileWorkspace.ts` should create the required workspace files with minimal English starter content plus the eager runtime directories/files from the spec.
- `src/core/bootstrap/localIdentityBootstrap.ts` should continue deriving identity state but now write secrets/runtime under `.runtime`.
- `src/daemon/defaultHandlers.ts` must replace the current best-effort `trackActiveIdentityProfile()` behavior with required ordered writes: profile-local files first, manager index second, active pointer third.
- `src/cli/runtime.ts` must use the new best-match resolver for `identity assign --name` and return explicit errors when no active profile is initialized.

- [ ] **Step 4: Re-run the targeted tests until they pass**

Run the same commands from Step 2.

Expected: PASS, with automatic slug-owned profile creation, durable manager writes, and no system-home fallback.

- [ ] **Step 5: Commit and publish the task diary**

Run:

```bash
git add src/core/identity/profileWorkspace.ts src/core/bootstrap/localIdentityBootstrap.ts src/daemon/defaultHandlers.ts src/cli/runtime.ts tests/bootstrap/localIdentityBootstrap.test.mjs tests/bootstrap/bootstrapFlow.test.mjs tests/cli/runtime.test.mjs tests/cli/doctor.test.mjs
git commit -m "feat: enforce manager-backed metabot identity profiles"
```

Then use `@metabot-post-buzz` to document the new bootstrap contract and active-profile semantics.

### Task 4: Move Local Stores and Secrets into `profile/.runtime`

**Files:**
- Modify: `src/core/config/configStore.ts`
- Modify: `src/core/secrets/fileSecretStore.ts`
- Modify: `src/core/state/runtimeStateStore.ts`
- Modify: `src/core/state/exportStore.ts`
- Delete: `src/core/state/hotStateStore.ts`
- Modify: `src/core/provider/providerPresenceState.ts`
- Modify: `src/core/ratings/ratingDetailState.ts`
- Modify: `src/core/master/masterPublishedState.ts`
- Modify: `src/core/master/masterPendingAskState.ts`
- Modify: `src/core/master/masterSuggestState.ts`
- Modify: `src/core/master/masterAutoFeedbackState.ts`
- Modify: `src/core/a2a/sessionStateStore.ts`
- Modify: `tests/state/secretStore.test.mjs`
- Modify: `tests/state/runtimeStateStore.test.mjs`
- Modify: `tests/state/exportStore.test.mjs`
- Delete or replace: `tests/state/hotStateStore.test.mjs`
- Modify: `tests/config/configStore.test.mjs`
- Modify: `tests/a2a/sessionStateStore.test.mjs`

- [ ] **Step 1: Write the failing store-layout and permissions tests**

Cover at least these cases:

- `config.json` lives at `profile/.runtime/config.json`.
- identity secrets live at `profile/.runtime/identity-secrets.json` and are not stored under exports or any `hot` path.
- provider/rating/master state files live under `profile/.runtime/state/`.
- session state lives at `profile/.runtime/sessions/a2a-session-state.json`.
- transcript exports land under `profile/.runtime/exports/`.
- POSIX secret files are written with owner-only permissions where the platform supports mode assertions.

- [ ] **Step 2: Run the targeted tests and confirm they fail**

Run:

```bash
npm run build
node --test tests/state/secretStore.test.mjs tests/state/runtimeStateStore.test.mjs tests/state/exportStore.test.mjs tests/config/configStore.test.mjs tests/a2a/sessionStateStore.test.mjs
```

Expected: failures because the repo still writes secrets/state into `.metabot/hot` and exports into `.metabot/exports`.

- [ ] **Step 3: Implement the `.runtime` relocation and secret split**

Required code shape:

- `src/core/secrets/fileSecretStore.ts` must write `identity-secrets.json` with owner-only permissions and stop using the old generic `secrets.json` filename.
- `src/core/config/configStore.ts` must default to the validated active profile home instead of `process.env.METABOT_HOME ?? os.homedir()`.
- `src/core/state/runtimeStateStore.ts`, `src/core/provider/providerPresenceState.ts`, `src/core/ratings/ratingDetailState.ts`, and the master state stores must use `.runtime/state/` and `.runtime/runtime-state.json` / `.runtime/daemon.json` exactly as specified.
- `src/core/a2a/sessionStateStore.ts` must move its lock and state file under `.runtime/sessions/`.
- remove `src/core/state/hotStateStore.ts` once nothing imports it.

- [ ] **Step 4: Re-run the targeted tests until they pass**

Run the same commands from Step 2.

Expected: PASS, with all state files under `.runtime` and no runtime code depending on a `hot` directory.

- [ ] **Step 5: Commit and publish the task diary**

Run:

```bash
git add src/core/config/configStore.ts src/core/secrets/fileSecretStore.ts src/core/state/runtimeStateStore.ts src/core/state/exportStore.ts src/core/provider/providerPresenceState.ts src/core/ratings/ratingDetailState.ts src/core/master/masterPublishedState.ts src/core/master/masterPendingAskState.ts src/core/master/masterSuggestState.ts src/core/master/masterAutoFeedbackState.ts src/core/a2a/sessionStateStore.ts tests/state/secretStore.test.mjs tests/state/runtimeStateStore.test.mjs tests/state/exportStore.test.mjs tests/config/configStore.test.mjs tests/a2a/sessionStateStore.test.mjs
git rm -f src/core/state/hotStateStore.ts tests/state/hotStateStore.test.mjs || true
git commit -m "refactor: move metabot runtime stores into profile runtime"
```

Then use `@metabot-post-buzz` to publish the store relocation and permissions work.

### Task 5: Rewire Daemon, Trace, and Evolution Flows to the New Layout

**Files:**
- Modify: `src/daemon/index.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `src/core/chat/sessionTrace.ts`
- Modify: `src/core/evolution/localEvolutionStore.ts`
- Modify: `src/core/evolution/remoteEvolutionStore.ts`
- Modify: `tests/chat/sessionTrace.test.mjs`
- Modify: `tests/chat/transcriptExport.test.mjs`
- Modify: `tests/master/masterTraceMetadata.test.mjs`
- Modify: `tests/master/masterTraceCommand.test.mjs`
- Modify: `tests/evolution/remoteEvolutionStore.test.mjs`
- Modify: `tests/e2e/masterAskHappyPath.test.mjs`
- Modify: `tests/e2e/masterAskHostFlow.test.mjs`

- [ ] **Step 1: Write the failing daemon, export, and evolution tests**

Cover at least these cases:

- daemon lock file is `profile/.runtime/locks/daemon.lock`.
- directory-seed state is stored under `profile/.runtime/state/directory-seeds.json`.
- trace markdown/json exports write into `profile/.runtime/exports/chats/` and `profile/.runtime/exports/traces/`.
- local evolution uses `profile/.runtime/evolution/` and remote evolution uses `profile/.runtime/evolution/remote/`.
- representative e2e flows still pass when the active profile home is `~/.metabot/profiles/<slug>` instead of a raw temp home.

- [ ] **Step 2: Run the targeted tests and confirm they fail**

Run:

```bash
npm run build
node --test tests/chat/sessionTrace.test.mjs tests/chat/transcriptExport.test.mjs tests/master/masterTraceMetadata.test.mjs tests/master/masterTraceCommand.test.mjs tests/evolution/remoteEvolutionStore.test.mjs tests/e2e/masterAskHappyPath.test.mjs tests/e2e/masterAskHostFlow.test.mjs
```

Expected: failures because daemon locks, directory seeds, exports, and evolution artifacts still point at legacy directories.

- [ ] **Step 3: Implement the new daemon/export/evolution wiring**

Required code shape:

- `src/daemon/index.ts` must acquire its lock under `.runtime/locks/`.
- `src/daemon/defaultHandlers.ts` must stop reading/writing `hotRoot`-based paths and instead use the concrete v2 file paths from `MetabotPaths`.
- `src/core/chat/sessionTrace.ts` must write exports into the new `chats/` and `traces/` subdirectories under `.runtime/exports/`.
- `src/core/evolution/localEvolutionStore.ts` and `src/core/evolution/remoteEvolutionStore.ts` must use `.runtime/evolution/*` exclusively.

- [ ] **Step 4: Re-run the targeted tests until they pass**

Run the same commands from Step 2.

Expected: PASS, with daemon, trace, and evolution flows fully sourced from the v2 path graph.

- [ ] **Step 5: Commit and publish the task diary**

Run:

```bash
git add src/daemon/index.ts src/daemon/defaultHandlers.ts src/core/chat/sessionTrace.ts src/core/evolution/localEvolutionStore.ts src/core/evolution/remoteEvolutionStore.ts tests/chat/sessionTrace.test.mjs tests/chat/transcriptExport.test.mjs tests/master/masterTraceMetadata.test.mjs tests/master/masterTraceCommand.test.mjs tests/evolution/remoteEvolutionStore.test.mjs tests/e2e/masterAskHappyPath.test.mjs tests/e2e/masterAskHostFlow.test.mjs
git commit -m "refactor: wire daemon and trace flows to metabot storage v2"
```

Then use `@metabot-post-buzz` to publish the daemon/export/evolution integration notes.

### Task 6: Update Skills, Runbooks, Fixtures, and Run the Final Sweep

**Files:**
- Modify: `SKILLs/metabot-identity-manage/SKILL.md`
- Modify: `docs/hosts/codex-agent-install.md`
- Modify: `docs/hosts/codex-agent-identity-runbook.md`
- Modify: `docs/hosts/codex-dev-test-runbook.md`
- Modify: `tests/docs/codexInstallDocs.test.mjs`
- Modify: `tests/skillpacks/buildSkillpacks.test.mjs`
- Modify: any remaining fixture or documentation files surfaced by the final `rg` sweep

- [ ] **Step 1: Write the failing docs and skillpack tests**

Cover at least these cases:

- active runbooks describe the v2 storage layout and stop instructing users to edit `~/.metabot/hot/*.json`.
- active identity docs and skills no longer tell callers to hand-compute `PROFILE_SLUG` before `identity create --name`.
- generated skillpacks still expose the correct create/switch guidance after the doc changes.

- [ ] **Step 2: Run the targeted docs tests and confirm they fail**

Run:

```bash
npm run build
npm run build:skillpacks
node --test tests/docs/codexInstallDocs.test.mjs tests/skillpacks/buildSkillpacks.test.mjs
```

Expected: failures because the current docs and generated skillpacks still mention `.metabot/hot` and manual slug shell snippets.

- [ ] **Step 3: Update the active docs and skill sources**

Required content changes:

- `SKILLs/metabot-identity-manage/SKILL.md` should treat `identity create --name` as the supported create path and `identity assign --name` as the supported switch path.
- `docs/hosts/codex-agent-install.md`, `docs/hosts/codex-agent-identity-runbook.md`, and `docs/hosts/codex-dev-test-runbook.md` must describe the new manager/profile layout and explicitly forbid patching `.runtime` files.
- keep historical plan/spec docs untouched unless they are being updated specifically as history.

- [ ] **Step 4: Run the full regression sweep**

Run:

```bash
npm run verify
rg -n "\\.metabot/hot|hotRoot|createHotStateStore|secrets\\.json" src tests docs/hosts SKILLs scripts
```

Expected:

- `npm run verify` passes.
- `rg` returns no matches in active source/tests/runbooks/skills. If a match is historical and intentionally retained, move it out of the searched set or rewrite the active doc.

- [ ] **Step 5: Commit and publish the task diary**

Run:

```bash
git add SKILLs/metabot-identity-manage/SKILL.md docs/hosts/codex-agent-install.md docs/hosts/codex-agent-identity-runbook.md docs/hosts/codex-dev-test-runbook.md tests/docs/codexInstallDocs.test.mjs tests/skillpacks/buildSkillpacks.test.mjs
git commit -m "docs: align metabot guides with storage layout v2"
```

Then use `@metabot-post-buzz` to post the closing diary entry for the documentation and final verification pass.

---

## Definition of Done

The v2 storage cut-over is complete only when all of the following are true:

- every runtime store resolves through the new central path graph
- `identity create/list/assign/who` operate on manager-indexed profiles only
- the active profile never falls back to raw system `HOME`
- no active code, active tests, or active runbooks depend on `.metabot/hot`
- `npm run verify` passes on the v2 layout
- each implementation task landed as one commit plus one `@metabot-post-buzz` diary post
