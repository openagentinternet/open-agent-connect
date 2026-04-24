# Shared MetaBot Skill Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the shared MetaBot skill install model so MetaBot skills install once into `~/.metabot/skills`, hosts bind to that shared root, and `metabot skills resolve` no longer requires `--host` for the common path.

**Architecture:** Introduce a host-neutral shared skill rendering path, keep `--host` as a compatibility override in the resolver, add a new machine-first `metabot host bind-skills` CLI family for symlink projection into host-native skill roots, and extend the skillpack builder to emit one shared pack plus self-contained host wrapper packs. Then migrate install docs/tests so the unified shared install flow becomes the normative entrypoint.

**Tech Stack:** TypeScript/Node.js, existing MetaBot CLI/runtime, filesystem symlinks, generated skillpacks, Node test runner, Markdown docs/tests.

---

## File Map

### Existing files to modify

- `src/core/skills/skillContractTypes.ts`
- `src/core/skills/skillResolver.ts`
- `src/cli/types.ts`
- `src/cli/main.ts`
- `src/cli/commandHelp.ts`
- `src/cli/commands/skills.ts`
- `src/cli/runtime.ts`
- `scripts/build-metabot-skillpacks.mjs`
- `SKILLs/metabot-ask-master/SKILL.md`
- `SKILLs/metabot-identity-manage/SKILL.md`
- `SKILLs/metabot-network-manage/SKILL.md`
- `SKILLs/metabot-call-remote-service/SKILL.md`
- `SKILLs/metabot-chat-privatechat/SKILL.md`
- `SKILLs/metabot-omni-reader/SKILL.md`
- `SKILLs/metabot-post-buzz/SKILL.md`
- `SKILLs/metabot-post-skillservice/SKILL.md`
- `SKILLs/metabot-upload-file/SKILL.md`
- `SKILLs/metabot-wallet-manage/SKILL.md`
- `docs/hosts/codex-agent-install.md`
- `docs/hosts/codex.md`
- `docs/hosts/claude-code.md`
- `docs/hosts/openclaw.md`
- `README.md`
- `tests/cli/skills.test.mjs`
- `tests/cli/help.test.mjs`
- `tests/evolution/skillResolver.test.mjs`
- `tests/skillpacks/buildSkillpacks.test.mjs`
- `tests/docs/codexInstallDocs.test.mjs`
- `docs/hosts/codex-agent-update.md`
- `docs/hosts/codex-dev-test-runbook.md`

### New files to create

- `src/cli/commands/host.ts`
- `src/core/host/hostSkillBinding.ts`
- `tests/cli/hostCommand.test.mjs`
- `tests/skillpacks/hostBindSmoke.test.mjs`
- `docs/install/open-agent-connect.md`

### Generated files expected to change

- `skillpacks/shared/README.md`
- `skillpacks/shared/install.sh`
- `skillpacks/shared/runtime/compatibility.json`
- `skillpacks/shared/runtime/dist/cli/main.js`
- `skillpacks/shared/skills/metabot-*/SKILL.md`
- `skillpacks/codex/install.sh`
- `skillpacks/codex/runtime/shared-install.sh`
- `skillpacks/codex/runtime/shared-skills/metabot-*/SKILL.md`
- `skillpacks/claude-code/install.sh`
- `skillpacks/claude-code/runtime/shared-install.sh`
- `skillpacks/claude-code/runtime/shared-skills/metabot-*/SKILL.md`
- `skillpacks/openclaw/install.sh`
- `skillpacks/openclaw/runtime/shared-install.sh`
- `skillpacks/openclaw/runtime/shared-skills/metabot-*/SKILL.md`

## Task 1: Make `skills resolve` host-optional without breaking the current response contract

**Files:**
- Modify: `src/core/skills/skillContractTypes.ts`
- Modify: `src/core/skills/skillResolver.ts`
- Modify: `src/cli/types.ts`
- Modify: `src/cli/commands/skills.ts`
- Modify: `src/cli/runtime.ts`
- Modify: `src/cli/commandHelp.ts`
- Test: `tests/cli/skills.test.mjs`
- Test: `tests/evolution/skillResolver.test.mjs`

- [ ] **Step 1: Extend the skill host and render types for shared-default resolution**

Add a shared/default host mode that preserves compatibility instead of removing `host` from the output shape.

Target contract:

```ts
export type SkillHost = 'shared' | 'codex' | 'claude-code' | 'openclaw';

export interface RenderResolvedSkillContractInput extends ResolveSkillContractInput {
  host?: Exclude<SkillHost, 'shared'> | null;
  format: SkillRenderFormat;
}

export interface RenderedSkillContractJson {
  host: SkillHost;
  requestedHost?: Exclude<SkillHost, 'shared'> | null;
  format: 'json';
  resolutionMode: 'shared_default' | 'host_override';
  contract: ResolvedSkillContract;
}
```

- [ ] **Step 2: Write failing CLI tests for the no-`--host` path**

Add tests to `tests/cli/skills.test.mjs` for:

- `metabot skills resolve --skill metabot-network-manage --format markdown`
- `metabot skills resolve --skill metabot-network-manage --format json`
- the top-level JSON shape keeping `host`
- `host === "shared"` and `resolutionMode === "shared_default"` on no-host calls
- existing `--host codex` tests still passing unchanged

Also extend `tests/evolution/skillResolver.test.mjs` so the direct resolver surface proves:

- `renderResolvedSkillContract()` accepts no-host shared-default rendering
- JSON render returns `host === "shared"` and `resolutionMode === "shared_default"`
- explicit host override still returns `host === "<host>"` and `resolutionMode === "host_override"`

Keep `metabot-network-directory` as the direct resolver/evolution canary there. It remains a base-registry contract in this round, not a shared installed skillpack entry.

Run:

```bash
npm run build
node --test tests/cli/skills.test.mjs tests/evolution/skillResolver.test.mjs
```

Expected:

- new no-host tests fail before implementation
- existing host-specific tests still pass or fail only where the parser still requires `--host`

- [ ] **Step 3: Relax CLI parsing so `--host` becomes optional**

Update `src/cli/commands/skills.ts` so:

- `--skill` remains required
- `--format` remains required
- `--host` becomes optional
- if present, it still validates against concrete host ids only
- no-host calls pass `host: null` or `undefined` into runtime dependencies

Also add help coverage in `src/cli/commandHelp.ts` for:

- `metabot skills`
- `metabot skills resolve`

Use examples that show both forms:

```bash
metabot skills resolve --skill metabot-ask-master --format markdown
metabot skills resolve --skill metabot-ask-master --host codex --format markdown
```

- [ ] **Step 4: Make resolver rendering preserve shape while defaulting to shared**

Update `src/core/skills/skillResolver.ts` and `src/cli/runtime.ts` so:

- no-host calls render the same contract content but with `host: "shared"`
- explicit host calls keep `host: "<host>"`
- markdown rendering shows `Host: shared` for the shared-default case
- JSON output adds `requestedHost` only when appropriate
- `renderResolvedSkillContract()` remains the only rendering entrypoint

- [ ] **Step 5: Re-run the focused tests**

Run:

```bash
npm run build
node --test tests/cli/skills.test.mjs tests/evolution/skillResolver.test.mjs
```

Expected:

- all `skills.test.mjs` tests pass

- [ ] **Step 6: Commit Task 1**

```bash
git add src/core/skills/skillContractTypes.ts src/core/skills/skillResolver.ts src/cli/types.ts src/cli/commands/skills.ts src/cli/runtime.ts src/cli/commandHelp.ts tests/cli/skills.test.mjs tests/evolution/skillResolver.test.mjs
git commit -m "feat: support shared-default metabot skills resolve"
```

## Task 2: Add the new `metabot host bind-skills` command family

**Files:**
- Create: `src/core/host/hostSkillBinding.ts`
- Create: `src/cli/commands/host.ts`
- Modify: `src/cli/types.ts`
- Modify: `src/cli/main.ts`
- Modify: `src/cli/commandHelp.ts`
- Modify: `src/cli/runtime.ts`
- Test: `tests/cli/hostCommand.test.mjs`
- Test: `tests/cli/help.test.mjs`

- [ ] **Step 1: Add failing tests for host bind parsing, help, and filesystem semantics**

Create `tests/cli/hostCommand.test.mjs` with coverage for:

- `metabot host bind-skills --host codex`
- `metabot host bind-skills --host claude-code`
- `metabot host bind-skills --host openclaw`
- `metabot host --help`
- `metabot host bind-skills --help --json`
- invalid host value failure
- missing shared skills failure
- `host_skill_root_unresolved` failure includes the requested host and resolved host root path
- `host_skill_bind_failed` failure includes the source shared skill path and destination host path
- idempotent success envelope shape
- copied legacy `metabot-*` directories replaced by symlinks
- unrelated host-native skills preserved

Extend `tests/cli/help.test.mjs` if needed so the new `host` family appears in top-level help output and machine-readable help.

Expected success payload shape:

```json
{
  "host": "codex",
  "hostSkillRoot": "/tmp/.codex/skills",
  "sharedSkillRoot": "/tmp/.metabot/skills",
  "boundSkills": ["metabot-ask-master"],
  "replacedEntries": [],
  "unchangedEntries": []
}
```

Run:

```bash
npm run build
node --test tests/cli/hostCommand.test.mjs tests/cli/help.test.mjs
```

Expected:

- tests fail before the command exists

- [ ] **Step 2: Implement the filesystem binding service**

Create `src/core/host/hostSkillBinding.ts` with one focused responsibility:

- resolve the host-native skill root for `codex`, `claude-code`, or `openclaw`
- enumerate shared `metabot-*` skills in `~/.metabot/skills`
- create or refresh symlinks in the host-native root
- replace copied legacy `metabot-*` directories with symlinks
- leave unrelated non-MetaBot skills untouched

Suggested API:

```ts
export async function bindHostSkills(input: {
  systemHomeDir: string;
  host: 'codex' | 'claude-code' | 'openclaw';
}): Promise<{
  host: string;
  hostSkillRoot: string;
  sharedSkillRoot: string;
  boundSkills: string[];
  replacedEntries: string[];
  unchangedEntries: string[];
}>
```

- [ ] **Step 3: Wire the new CLI family**

Implement `src/cli/commands/host.ts` and wire it through:

- `src/cli/main.ts`
- `src/cli/types.ts`
- `src/cli/runtime.ts`
- `src/cli/commandHelp.ts`

Requirements:

- machine-first JSON envelope by default
- `--help` and `--help --json` support
- stable failures:
  - `shared_skills_missing`
  - `host_skill_root_unresolved`
  - `host_skill_bind_failed`
- failure payloads include the actionable path context required by the spec:
  - unresolved host root returns the exact attempted host root path
  - bind failure returns the source shared skill path plus destination host path

- [ ] **Step 4: Re-run the focused host command tests**

Run:

```bash
npm run build
node --test tests/cli/hostCommand.test.mjs tests/cli/help.test.mjs tests/cli/skills.test.mjs
```

Expected:

- new host command tests pass
- prior `skills resolve` tests still pass

- [ ] **Step 5: Commit Task 2**

```bash
git add src/core/host/hostSkillBinding.ts src/cli/commands/host.ts src/cli/types.ts src/cli/main.ts src/cli/commandHelp.ts src/cli/runtime.ts tests/cli/hostCommand.test.mjs tests/cli/help.test.mjs tests/cli/skills.test.mjs
git commit -m "feat: add host bind-skills command"
```

## Task 3: Generate shared skillpacks and self-contained host wrapper packs

**Files:**
- Modify: `scripts/build-metabot-skillpacks.mjs`
- Modify: `SKILLs/metabot-ask-master/SKILL.md`
- Modify: `SKILLs/metabot-identity-manage/SKILL.md`
- Modify: `SKILLs/metabot-network-manage/SKILL.md`
- Modify: `SKILLs/metabot-call-remote-service/SKILL.md`
- Modify: `SKILLs/metabot-chat-privatechat/SKILL.md`
- Modify: `SKILLs/metabot-omni-reader/SKILL.md`
- Modify: `SKILLs/metabot-post-buzz/SKILL.md`
- Modify: `SKILLs/metabot-post-skillservice/SKILL.md`
- Modify: `SKILLs/metabot-upload-file/SKILL.md`
- Modify: `SKILLs/metabot-wallet-manage/SKILL.md`
- Test: `tests/skillpacks/buildSkillpacks.test.mjs`
- Generate: `skillpacks/shared/**`
- Generate: `skillpacks/codex/**`
- Generate: `skillpacks/claude-code/**`
- Generate: `skillpacks/openclaw/**`

- [ ] **Step 1: Add failing build tests for shared pack output**

Extend `tests/skillpacks/buildSkillpacks.test.mjs` to assert:

- `skillpacks/shared/README.md`
- `skillpacks/shared/install.sh`
- `skillpacks/shared/runtime/compatibility.json`
- `skillpacks/shared/skills/metabot-*/SKILL.md`
- each host pack bundles:
  - `runtime/shared-install.sh`
  - `runtime/shared-skills/metabot-*/SKILL.md`

Add assertions that shared generated skills:

- do not contain `--host codex`
- do not contain `--host claude-code`
- do not contain `--host openclaw`

Run:

```bash
npm run build
node --test tests/skillpacks/buildSkillpacks.test.mjs
```

Expected:

- new shared-pack assertions fail before implementation

- [ ] **Step 2: Introduce explicit shared-vs-host render modes**

Refactor `scripts/build-metabot-skillpacks.mjs` so source skill rendering is explicit:

- `renderSharedSkill(...)`
- `renderHostSkill(...)`

Do not implement this as post-processing deletion of host text.
Instead, move current host metadata injection behind an explicit render path.

Practical minimum:

- add a `{{HOST_ADAPTER_SECTION}}` token or equivalent in every `SKILLs/metabot-*` source that currently injects host metadata
- render it to an empty string for shared skills
- render it with host metadata for host-only artifacts if still needed

The shared artifacts must be generated from a true neutral-render path.

- [ ] **Step 3: Emit one shared pack plus self-contained host wrappers**

Update `buildAgentConnectSkillpacks()` to generate:

- `skillpacks/shared`
- one host wrapper pack per host

Requirements:

- `skillpacks/shared/install.sh` installs to `~/.metabot/skills`
- `skillpacks/shared/install.sh` resolves the CLI from:
  - `METABOT_CLI_ENTRY`
  - `METABOT_SOURCE_ROOT`
  - bundled `runtime/dist/cli/main.js`
- each host pack stays standalone by bundling:
  - `runtime/shared-install.sh`
  - `runtime/shared-skills/*`
  - bundled runtime compatibility data
- host `install.sh` becomes:
  - install shared payload into `~/.metabot/skills`
  - install `~/.metabot/bin/metabot`
  - run `metabot host bind-skills --host <host>`

- [ ] **Step 4: Rebuild generated outputs and re-run build tests**

Run:

```bash
npm run build:skillpacks
node --test tests/skillpacks/buildSkillpacks.test.mjs
```

Expected:

- generated tracked `skillpacks/*` match a fresh build
- shared outputs exist and pass assertions

- [ ] **Step 5: Commit Task 3**

```bash
git add scripts/build-metabot-skillpacks.mjs SKILLs/metabot-ask-master/SKILL.md SKILLs/metabot-identity-manage/SKILL.md SKILLs/metabot-network-manage/SKILL.md SKILLs/metabot-call-remote-service/SKILL.md SKILLs/metabot-chat-privatechat/SKILL.md SKILLs/metabot-omni-reader/SKILL.md SKILLs/metabot-post-buzz/SKILL.md SKILLs/metabot-post-skillservice/SKILL.md SKILLs/metabot-upload-file/SKILL.md SKILLs/metabot-wallet-manage/SKILL.md tests/skillpacks/buildSkillpacks.test.mjs skillpacks
git commit -m "refactor: generate shared metabot skillpacks"
```

## Task 4: Add host compatibility smoke coverage for shared install plus bind flows

**Files:**
- Create: `tests/skillpacks/hostBindSmoke.test.mjs`
- Modify: `tests/cli/hostCommand.test.mjs`
- Modify: `tests/skillpacks/buildSkillpacks.test.mjs`

- [ ] **Step 1: Add failing symlink-based host smoke tests**

Create `tests/skillpacks/hostBindSmoke.test.mjs` to cover one install-plus-bind path per supported host:

- Codex
- Claude Code
- OpenClaw

Each smoke path should:

- build fresh skillpacks into a temp output root
- run the shared install flow into a temp `HOME`
- run `metabot host bind-skills --host <host>`
- assert `metabot-*` entries exist under the expected host-native skill root
- assert those entries are symlinks to `~/.metabot/skills/*`, not copied directories

If invoking the packaged installer directly is too heavy for the repository test budget, the fallback is:

- use the strongest automated filesystem smoke that exercises the built installer helper plus bind command
- keep the assertions at the symlink/install layer, not pure unit mocks

Run:

```bash
npm run build
npm run build:skillpacks
node --test tests/skillpacks/hostBindSmoke.test.mjs
```

Expected:

- new smoke tests fail before implementation

- [ ] **Step 2: Align existing host bind/build tests with the smoke path**

Update:

- `tests/cli/hostCommand.test.mjs`
- `tests/skillpacks/buildSkillpacks.test.mjs`

So they stay complementary:

- command tests cover parse/help/error/result semantics
- build tests cover generated artifact shape
- smoke tests cover symlink-based install-plus-bind behavior per host

Explicitly expand the existing host-pack installer test coverage in `tests/skillpacks/buildSkillpacks.test.mjs` so each wrapper:

- runs `skillpacks/<host>/install.sh` from a temp packaged output
- uses the bundled shared payload/runtime, not an adjacent checkout-local `skillpacks/shared`
- leaves shared skills under `~/.metabot/skills`
- leaves host-native `metabot-*` entries as symlinks into the shared root

- [ ] **Step 3: Re-run focused host smoke verification**

Run:

```bash
npm run build
npm run build:skillpacks
node --test tests/cli/hostCommand.test.mjs tests/skillpacks/buildSkillpacks.test.mjs tests/skillpacks/hostBindSmoke.test.mjs
```

Expected:

- smoke and supporting tests pass

- [ ] **Step 4: Commit Task 4**

```bash
git add tests/cli/hostCommand.test.mjs tests/skillpacks/buildSkillpacks.test.mjs tests/skillpacks/hostBindSmoke.test.mjs
git commit -m "test: add shared-skill host bind smoke coverage"
```

## Task 5: Migrate install/docs entrypoints to the unified shared install flow

**Files:**
- Create: `docs/install/open-agent-connect.md`
- Modify: `README.md`
- Modify: `docs/hosts/codex-agent-install.md`
- Modify: `docs/hosts/codex-agent-update.md`
- Modify: `docs/hosts/codex-dev-test-runbook.md`
- Modify: `docs/hosts/codex.md`
- Modify: `docs/hosts/claude-code.md`
- Modify: `docs/hosts/openclaw.md`
- Modify: `tests/skillpacks/buildSkillpacks.test.mjs`
- Test: `tests/docs/codexInstallDocs.test.mjs`

- [ ] **Step 1: Add failing doc assertions for the new unified entrypoint**

Extend `tests/docs/codexInstallDocs.test.mjs` to assert:

- `docs/install/open-agent-connect.md` exists and is referenced
- host docs point to the unified install doc
- Codex update/dev runbooks point back to the unified install doc instead of restating a separate install truth
- host docs describe bind/expose language instead of full independent installs
- canonical install verification references `~/.metabot/skills`
- docs/examples no longer treat `--host` as mandatory for common `skills resolve`

Also update the install-runbook assertions in `tests/skillpacks/buildSkillpacks.test.mjs` so repository migration checks stop expecting `~/.codex/skills/.../SKILL.md` as the normative install target.

Run:

```bash
npm run build
node --test tests/docs/codexInstallDocs.test.mjs tests/skillpacks/buildSkillpacks.test.mjs
```

Expected:

- new doc assertions fail before the docs are updated

- [ ] **Step 2: Write the unified install document**

Create `docs/install/open-agent-connect.md` as the single normative install guide.

It must cover:

- prerequisites
- shared install commands
- `PATH` setup for `~/.metabot/bin`
- one-host bind and multi-host bind flows
- post-install verification
- first-run identity handoff
- a manual host acceptance checklist for Codex, Claude Code, and OpenClaw release verification when live-host discovery is not automated in-repo

Use the new canonical flow:

```bash
npm install
npm run build
npm run build:skillpacks
cd skillpacks/shared
./install.sh
export PATH="$HOME/.metabot/bin:$PATH"
metabot host bind-skills --host codex
metabot doctor
```

- [ ] **Step 3: Convert host docs into thin wrappers**

Update:

- `docs/hosts/codex-agent-install.md`
- `docs/hosts/codex-agent-update.md`
- `docs/hosts/codex-dev-test-runbook.md`
- `docs/hosts/codex.md`
- `docs/hosts/claude-code.md`
- `docs/hosts/openclaw.md`
- `README.md`

Goals:

- unified install doc is the main install truth source
- host docs only keep host-specific bind notes and examples
- shared install root is `~/.metabot/skills`
- common `skills resolve` examples omit `--host`
- Codex update/dev runbooks stop instructing direct host-pack reinstall semantics that bypass the unified shared install flow

- [ ] **Step 4: Re-run documentation tests**

Run:

```bash
npm run build
node --test tests/docs/codexInstallDocs.test.mjs tests/skillpacks/buildSkillpacks.test.mjs
```

Expected:

- doc tests pass

- [ ] **Step 5: Commit Task 5**

```bash
git add docs/install/open-agent-connect.md README.md docs/hosts/codex-agent-install.md docs/hosts/codex-agent-update.md docs/hosts/codex-dev-test-runbook.md docs/hosts/codex.md docs/hosts/claude-code.md docs/hosts/openclaw.md tests/docs/codexInstallDocs.test.mjs tests/skillpacks/buildSkillpacks.test.mjs
git commit -m "docs: unify metabot install guidance"
```

## Task 6: Run the end-to-end verification batch and refresh all generated/tracked outputs

**Files:**
- Modify if needed: any files touched by failed verification fallout
- Verify: `tests/cli/skills.test.mjs`
- Verify: `tests/cli/hostCommand.test.mjs`
- Verify: `tests/cli/help.test.mjs`
- Verify: `tests/evolution/skillResolver.test.mjs`
- Verify: `tests/skillpacks/buildSkillpacks.test.mjs`
- Verify: `tests/skillpacks/hostBindSmoke.test.mjs`
- Verify: `tests/docs/codexInstallDocs.test.mjs`
- Verify: repo-wide `npm run verify`

- [ ] **Step 1: Run the focused verification batch first**

Run:

```bash
npm run build
npm run build:skillpacks
node --test tests/cli/skills.test.mjs tests/cli/hostCommand.test.mjs tests/cli/help.test.mjs tests/evolution/skillResolver.test.mjs tests/skillpacks/buildSkillpacks.test.mjs tests/skillpacks/hostBindSmoke.test.mjs tests/docs/codexInstallDocs.test.mjs
```

Expected:

- all focused tests pass

- [ ] **Step 2: Run full repository verification**

Run:

```bash
npm run verify
```

Expected:

- full verify passes

- [ ] **Step 3: Review generated artifacts and install smoke assumptions**

Manually confirm from the working tree that:

- `skillpacks/shared` is tracked
- each host pack includes bundled shared payloads
- no tracked shared skill contains host-required `--host ...` lines
- host wrapper `install.sh` scripts still resolve a runnable `metabot` shim path

- [ ] **Step 4: Commit Task 6**

```bash
git add skillpacks tests/cli/skills.test.mjs tests/cli/hostCommand.test.mjs tests/cli/help.test.mjs tests/evolution/skillResolver.test.mjs tests/skillpacks/buildSkillpacks.test.mjs tests/skillpacks/hostBindSmoke.test.mjs tests/docs/codexInstallDocs.test.mjs
git commit -m "test: verify shared metabot skill install flow"
```

## Execution Notes

- Keep commits task-scoped and verifiable.
- After each commit, post the required development diary with `metabot-post-buzz`.
- Do not manually edit generated skillpack outputs except through `npm run build:skillpacks`.
- Do not reintroduce host-specific copied skill roots as the source of truth.
- Preserve bundled/offline install capability while adding the new shared install path.
