# Agent Instructions

## Project

Open Agent Connect (OAC) — an open-source connector that gives local AI agents a blockchain-backed network layer (identity, discovery, encrypted messaging, remote service calls, traces, payments). Two runtime entrypoints:

- `metabot` (CLI + daemon) — the full Bot runtime: `dist/cli/main.ts`
- `oac` — the installer CLI: `dist/oac/main.ts`

Node.js `>=20 <25`, CommonJS source compiled via TypeScript strict mode (`strict: true`, target ES2022). Compiled output lands in `dist/`. There is no separate lint command — TypeScript strict is the lint.

## Build & Test

```bash
npm run build              # rimraf dist && tsc (always required before tests)
npm run build:skillpacks   # regenerate host-specific skillpacks into skillpacks/
npm run test               # build + all tests (concurrency=1, runtime.test.mjs last)
npm run verify             # build + build:skillpacks + full test suite
npm run test:contracts     # build + only contract tests
```

Run a single test file:
```bash
npm run build && node --test tests/<dir>/<name>.test.mjs
```

Key test rules:
- Test files are ESM (`.test.mjs`), source is CommonJS-compiled. Must build first.
- All tests run with `--test-concurrency=1` (shared daemon/module state).
- `tests/cli/runtime.test.mjs` must always run last (the npm scripts enforce this).
- `tests/helpers/profileHome.mjs` provides `createProfileHome()` for isolated test profile homes under `~/.metabot/profiles/<slug>/`.

## Architecture

### Source layout (`src/`)

| Dir | Role |
|---|---|
| `src/cli/` | `metabot` binary, commands in `commands/` (one file per domain: identity, chat, network, services, etc.) |
| `src/core/` | Domain logic — 32 modules: `identity/`, `discovery/`, `a2a/`, `master/`, `evolution/`, `secrets/`, `signing/`, `buzz/`, `chat/`, `files/`, `orders/`, `ratings/`, `contracts/`, `state/`, etc. |
| `src/daemon/` | HTTP server (REST + SSE), one route file per domain, file-lock guarded (one instance per `~/.metabot`) |
| `src/oac/` | `oac` installer CLI entrypoint |
| `src/ui/` | Local HTML inspection pages (hub, trace, my-services, publish, refund, metaapps) |

### Storage layout (v2)

All paths resolved centrally by `resolveMetabotPaths()` in `src/core/state/paths.ts`. Profile home must live under `~/.metabot/profiles/<slug>/`. The legacy `.metabot/hot` layout must not be used in new code.

Key paths from a profile home (`~/.metabot/profiles/<slug>/`):
- `.runtime/` — runtime state (config, secrets, daemon, sessions, A2A, evolution, LLM, locks)
- `.runtime/state/` — domain state JSON files (provider-presence, rating-detail, private-chat, master-*, etc.)
- `~/.metabot/skills/` — installed host skills
- `~/.metabot/manager/` — identity profiles, active home pointer

### Key patterns

- All CLI commands return `MetabotCommandResult<T>` (`success | awaiting_confirmation | waiting | manual_action_required | failed`) — see `src/core/contracts/commandResult.ts`.
- Daemon uses a file lock (`locks/daemon.lock`) to ensure one instance per home.
- Bootstrap flow: create identity → request subsidy → sync to chain.
- A2A session engine manages the full delegation lifecycle with persistent state.
- Skills source lives in `SKILLs/` (each has a `SKILL.md`), built per-host into `skillpacks/` (codex, claude-code, openclaw, common, shared).

### Major reference docs

- `CLAUDE.md` — deeper architecture, source layout, behavioral guidelines
- `DACT.md` — remote service discovery → delegation → trace/watch → rating closure
- `EVOLUTION_NETWORK.md` — chain-backed skill co-evolution
- `docs/superpowers/specs/` — design docs
- `docs/superpowers/plans/` — implementation plans

## Behavioral Guidelines

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

### 5. No Guessing, No Drive-By Fixes

**Verify boundaries before acting. Don't fix bugs you didn't create.**

- Never guess. When writing a plan or code, if anything is unclear or any scope boundary is ambiguous, either read the relevant code or discuss with the user — keep going until every boundary is clear.
- Don't opportunistically fix pre-existing bugs that fall outside the current task. Surface them to the user and let them decide; never silently change behavior you weren't asked to change.

## Communication

- Communicate concisely, directly, and with focus.
- Develop carefully — quality is more important than speed. Don't push the user forward; just clearly state what you did.

## Conventions

- Commit once for every round of modifications.
- For every commit, use the `metabot-post-buzz` skill to post a detailed development diary of that round's changes on-chain.
- All documentation, SKILL documents, and code comments must be written in English.
- When spawning review or test subagents, default to model `gpt-5.5`.
- Prefer small, frequent commits. Commit each independent, verifiable unit of work as soon as it is complete.
- For every modification or newly added feature, create one commit.
- Before committing, make sure the relevant local verification steps pass for your changes. Prefer the smallest meaningful verification set instead of defaulting to the full suite.
- When merging completed work into `main`, use `git merge --no-ff` to preserve the feature merge point.
- MetaBot storage and directory layout changes must follow `docs/superpowers/specs/2026-04-23-metabot-storage-layout-v2-design.md`.
- Do not introduce new code or documentation that depends on the legacy `.metabot/hot` layout unless you are explicitly documenting historical behavior.

## Local Verification Policy

- When creating a new branch or worktree, do not run the full `npm test` as a baseline by default. Use lightweight baseline checks such as `git status`, dependency availability, and only the task-relevant smoke/build command if the next change needs it.
- For focused documentation, prompt, SKILL, UI copy, or narrowly scoped code changes, targeted tests plus `npm run build` or an equivalent static check are sufficient before committing.
- Run the full `npm test` locally only when the change touches shared runtime behavior, wallet/chain writes, persistence formats, release artifacts, package/build plumbing, broad cross-host skillpack output, or when the user explicitly asks for full verification.
- After merging a completed branch into `main`, do not automatically run the full `npm test` for every low-risk branch. Re-run the same targeted checks on the merged result unless the merge combines high-risk areas, resolves conflicts, or changes release/build artifacts.
- Treat CI as the default full-suite gate for ordinary development merges. Local full-suite runs are still required before releases and when CI is unavailable or unsuitable for the risk involved.

## Releasing a New Version

Releases are automated via GitHub Actions. Do not run `npm run build:packs`, `gh release create`, or `npm publish` manually unless you are explicitly recovering a failed release.

The release workflow also publishes the npm package through npm Trusted Publisher. The npm package settings must trust `openagentinternet/open-agent-connect` with workflow file `release.yml`, and `.github/workflows/release.yml` must keep `id-token: write`.

To cut a release:
1. Bump `"version"` in `package.json` and all fields in `release/compatibility.json` to the new version.
2. Run `npm run build && npm run build:skillpacks` to rebuild all artifacts.
3. Run `npm test` and confirm it passes.
4. Run `node scripts/verify-release-version.mjs v{version}` and confirm it passes.
5. Commit the version bump and regenerated artifacts, push to `main`.
6. Push the version tag from the same commit: `git tag v{version} && git push origin v{version}`.

Pushing the tag triggers CI (`.github/workflows/release.yml`) which verifies the tag matches `package.json` and `release/compatibility.json`, builds `release/packs/oac-{host}.tar.gz`, publishes the GitHub Release, and publishes the same version to npm. The install guide at `docs/install/open-agent-connect.md` always points to `releases/latest/download/`, so no doc update is needed for version bumps.
