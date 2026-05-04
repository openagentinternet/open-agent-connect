# NPM Install Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the npm-first install path `npm i -g open-agent-connect` plus `oac install`, while preserving the GitHub install guide as an equivalent beginner-friendly path.

**Architecture:** Add a focused `oac` CLI that installs shared skills, writes the canonical `~/.metabot/bin/metabot` shim to the globally installed package, binds host skills, and verifies the final state. Keep `metabot` as the runtime CLI and reuse existing host binding logic. Control npm publishing with a `files` whitelist so the npm package contains runtime assets and install inputs but not generated release packs or tests.

**Tech Stack:** Node.js 20-24, TypeScript CommonJS CLI, `node:test`, npm package metadata, existing MetaBot storage layout under `~/.metabot`.

---

## File Structure

- Create `src/oac/main.ts`: `oac` binary entrypoint and command router.
- Create `src/core/system/npmInstall.ts`: install/doctor implementation used by `oac`.
- Create `tests/oac/install.test.mjs`: TDD coverage for install, ambiguous host detection, doctor, and CLI help.
- Create `tests/npm/packageFiles.test.mjs`: packaging dry-run assertions around npm package contents.
- Modify `package.json`: add `oac` bin, `files` whitelist, and package output controls.
- Modify `README.md`: make npm the primary terminal path while retaining the agent-readable guide prompt.
- Modify `docs/install/open-agent-connect.md`: prefer npm when available and keep the release-pack script as fallback.

### Task 1: Plan Document

**Files:**
- Create: `docs/superpowers/plans/2026-05-04-npm-install-entry.md`

- [ ] **Step 1: Verify the plan has no placeholders**

Run:

```bash
test -s docs/superpowers/plans/2026-05-04-npm-install-entry.md
for marker in TB''D TO''DO "Open Question"'s' PLACE''HOLDER; do
  ! rg -n "$marker" docs/superpowers/plans/2026-05-04-npm-install-entry.md
done
```

Expected: both commands succeed with no output.

- [ ] **Step 2: Commit the plan**

```bash
git add docs/superpowers/plans/2026-05-04-npm-install-entry.md
git diff --cached --check
git commit -m "docs: plan npm install entry implementation"
```

Expected: commit succeeds.

- [ ] **Step 3: Post development diary**

Use `metabot-post-buzz` to post a detailed diary for the plan commit.

Expected: buzz post returns `ok: true`.

### Task 2: `oac` Install And Doctor CLI

**Files:**
- Create: `src/oac/main.ts`
- Create: `src/core/system/npmInstall.ts`
- Create: `tests/oac/install.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests for explicit host install**

Add a test in `tests/oac/install.test.mjs` that creates a temporary `HOME`, runs
`runOac(['install', '--host', 'codex'])`, and asserts:

- exit code is `0`
- `~/.metabot/skills/metabot-ask-master/SKILL.md` exists
- `~/.metabot/bin/metabot` exists and points at `dist/cli/main.js`
- `~/.codex/skills/metabot-ask-master` is a symlink to the shared skill
- JSON payload includes `host: "codex"`, `installedSkills`, `boundSkills`, and `metabotShimPath`

Run:

```bash
npm run build
node --test tests/oac/install.test.mjs
```

Expected: fails because `dist/oac/main.js` does not exist or `runOac` is not exported.

- [ ] **Step 2: Add minimal `oac` entrypoint and installer**

Implement:

- `src/oac/main.ts` with `runOac(argv, context)` export, `install`, `doctor`, `--help`, and `--version`.
- `src/core/system/npmInstall.ts` with `runNpmInstall`, `runNpmDoctor`, host detection, shared skill copy, metabot shim write, host binding, and verification helpers.
- `package.json` bin entry `"oac": "dist/oac/main.js"`.

The installer must:

- resolve package root from `__dirname`
- read skills from `SKILLs/metabot-*`
- write to `${HOME}/.metabot/skills`
- write `${HOME}/.metabot/bin/metabot`
- bind host skills with existing `bindHostSkills`
- never overwrite identity profiles or secrets

Run:

```bash
npm run build
node --test tests/oac/install.test.mjs
```

Expected: explicit host install test passes.

- [ ] **Step 3: Add failing tests for host detection and doctor**

Extend `tests/oac/install.test.mjs` with tests that assert:

- `oac install` auto-detects Codex when `CODEX_HOME` is set.
- `oac install` fails with `install_host_ambiguous` when `CODEX_HOME` and `CLAUDE_HOME` are both set.
- `oac doctor --host codex` succeeds after install.
- `oac doctor --host codex` fails with a useful code when shared skills or host bindings are missing.

Run:

```bash
node --test tests/oac/install.test.mjs
```

Expected: new tests fail until the missing behavior is implemented.

- [ ] **Step 4: Complete host detection and doctor behavior**

Update `src/core/system/npmInstall.ts` so:

- explicit `--host` always wins
- supported hosts are `codex`, `claude-code`, and `openclaw`
- exactly one host environment signal auto-selects that host
- multiple host signals require explicit `--host`
- `runNpmDoctor` verifies shared skills, shim, and host symlinks without writing files

Run:

```bash
npm run build
node --test tests/oac/install.test.mjs
```

Expected: all `oac` tests pass.

- [ ] **Step 5: Commit the `oac` CLI feature**

```bash
git add src/oac/main.ts src/core/system/npmInstall.ts tests/oac/install.test.mjs package.json package-lock.json
git diff --cached --check
git commit -m "feat: add oac npm install command"
```

Expected: commit succeeds.

- [ ] **Step 6: Post development diary**

Use `metabot-post-buzz` to post a detailed diary for the `oac` CLI commit.

Expected: buzz post returns `ok: true`.

### Task 3: NPM Package Contents

**Files:**
- Create: `tests/npm/packageFiles.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing package-content test**

Create `tests/npm/packageFiles.test.mjs` that runs `npm pack --dry-run --json`
and asserts:

- included: `dist/cli/main.js`, `dist/oac/main.js`, `SKILLs/metabot-ask-master/SKILL.md`, `docs/install/open-agent-connect.md`, `README.md`, `LICENSE`, `release/compatibility.json`, and required UI static assets
- excluded: `tests/`, `release/packs/`, `skillpacks/codex/runtime/node_modules/`, and `.github/`
- packed size is below `20MB`

Run:

```bash
npm run build
node --test tests/npm/packageFiles.test.mjs
```

Expected: fails because the package currently includes the full repository and is larger than the threshold.

- [ ] **Step 2: Add package `files` whitelist**

Update `package.json` with a `files` whitelist that includes:

- `dist/`
- `SKILLs/`
- `src/ui/`
- `docs/install/open-agent-connect.md`
- `release/compatibility.json`
- `README.md`
- `README.zh-CN.md`
- `LICENSE`

Run:

```bash
npm run build
node --test tests/npm/packageFiles.test.mjs
```

Expected: package-content test passes.

- [ ] **Step 3: Commit package controls**

```bash
git add package.json package-lock.json tests/npm/packageFiles.test.mjs
git diff --cached --check
git commit -m "build: limit npm package contents"
```

Expected: commit succeeds.

- [ ] **Step 4: Post development diary**

Use `metabot-post-buzz` to post a detailed diary for the package-controls commit.

Expected: buzz post returns `ok: true`.

### Task 4: README And Install Guide

**Files:**
- Modify: `README.md`
- Modify: `docs/install/open-agent-connect.md`

- [ ] **Step 1: Update README**

Make the README Installation section lead with:

```bash
npm i -g open-agent-connect
oac install
```

Keep the agent-readable prompt and state that both paths are equivalent by final
installed state.

- [ ] **Step 2: Update install guide**

Update `docs/install/open-agent-connect.md` so the beginner-friendly guide:

- recommends npm when npm is available
- tells the local agent to run `npm i -g open-agent-connect` and `oac install`
- keeps the release-pack script as fallback or pinned-release path
- retains first-run identity handoff rules

- [ ] **Step 3: Verify docs**

Run:

```bash
rg -n "npm i -g open-agent-connect|oac install|releases/latest/download" README.md docs/install/open-agent-connect.md
npm run build
node --test tests/oac/install.test.mjs tests/npm/packageFiles.test.mjs
```

Expected: grep finds npm path and fallback path; build and focused tests pass.

- [ ] **Step 4: Commit docs**

```bash
git add README.md docs/install/open-agent-connect.md
git diff --cached --check
git commit -m "docs: make npm install path primary"
```

Expected: commit succeeds.

- [ ] **Step 5: Post development diary**

Use `metabot-post-buzz` to post a detailed diary for the docs commit.

Expected: buzz post returns `ok: true`.

### Task 5: Full Verification

**Files:**
- No intended source edits unless verification exposes a defect.

- [ ] **Step 1: Run full verification**

Run:

```bash
npm test
npm pack --dry-run --json
```

Expected: tests pass and package dry-run stays below the configured threshold.

- [ ] **Step 2: Run local tarball smoke**

Run:

```bash
PACK_JSON="$(npm pack --json)"
PACK_FILE="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(data[0].filename)' <<<"$PACK_JSON")"
SMOKE_HOME="$(mktemp -d)"
SMOKE_PREFIX="$(mktemp -d)"
npm install -g "$PWD/$PACK_FILE" --prefix "$SMOKE_PREFIX"
HOME="$SMOKE_HOME" CODEX_HOME="$SMOKE_HOME/.codex" "$SMOKE_PREFIX/bin/oac" install --host codex
HOME="$SMOKE_HOME" CODEX_HOME="$SMOKE_HOME/.codex" "$SMOKE_PREFIX/bin/oac" doctor --host codex
HOME="$SMOKE_HOME" "$SMOKE_HOME/.metabot/bin/metabot" --help >/dev/null
HOME="$SMOKE_HOME" "$SMOKE_HOME/.metabot/bin/metabot" identity --help >/dev/null
rm -f "$PACK_FILE"
```

Expected: every command succeeds.

- [ ] **Step 3: Check git status**

Run:

```bash
git status --short --branch
```

Expected: branch is ahead by the expected commits and has no unstaged changes.
