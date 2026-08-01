# Agent Instructions

## Scope

- Work only in this workspace unless the user explicitly says otherwise.
- Keep every branch based directly on `main`. Do not stack feature branches.
- Publish releases and production updates only from `main`.

## Runtime Facts

- Project: Open Agent Connect (OAC).
- Runtime entrypoints: `metabot` -> `dist/cli/main.js`, `oac` -> `dist/oac/main.js`.
- Supported Node.js: `>=20 <25`.
- TypeScript strict mode is the lint. Build output goes to `dist/`.
- For deeper architecture, read `CLAUDE.md`. Do not duplicate it here.

## Non-Negotiable Rules

- Do not guess. Read the relevant code, spec, or test first. If a boundary is still unclear, stop and ask.
- Keep changes surgical. No unrelated refactors, formatting churn, or drive-by fixes.
- Every changed line must trace back to the current task.
- All documentation, SKILL documents, and code comments must be in English.
- Route local UI copy through i18n and keep English plus Simplified Chinese coverage in sync.
- Do not introduce new code or docs that depend on the legacy `.metabot/hot` layout.
- MetaBot storage changes must follow `docs/superpowers/specs/2026-04-23-metabot-storage-layout-v2-design.md`.
- When merging completed work back to `main`, use `git merge --no-ff`.

## Build And Test

```bash
npm run build
npm run build:skillpacks
npm run test:fast          # fast tier: ~95% of subtests, minutes
npm run test:integration   # integration tier: the slow daemon/build-heavy files
npm run test               # full suite = fast + integration
npm run verify
npm run test:contracts
```

Single test file:

```bash
npm run build && node --test tests/<dir>/<name>.test.mjs
```

Test rules:

- Build before running tests.
- Tests run with `--test-concurrency=1`.
- `tests/cli/runtime.test.mjs` must run last; the npm scripts already enforce that.
- Test tiers are defined in `scripts/run-test-suite.mjs`. The integration tier is a small allowlist of slow process/daemon/build-heavy files (runtime, skillpacks build, LLM discovery, cross-host e2e, npm package). Keep new slow files out of the fast tier: if a test file boots real daemons, runs full builds, or sleeps on timeouts, add it to `INTEGRATION_FILES` there instead.
- If your shell defaults to an unsupported Node version, switch to a supported Node 20-24 runtime explicitly for verification.
- Create test temp directories only through `tests/helpers/tempRoots.mjs` (`mkdtempTempRoot`/`mkdtempTempRootSync`). Raw `fs.mkdtemp(os.tmpdir(), ...)` in tests or e2e scripts is not allowed. The helper registers teardown that stops test daemons (whole process group, waited) and removes the root on success, failure, or timeout.
- `npm test`, `npm run test:fast`, `npm run test:integration`, and `npm run verify` run through `scripts/run-tests-with-leak-guard.mjs`, which fails the run if new `metabot-*`/`oac-*`/`loom-*` temp roots remain under `os.tmpdir()` afterwards. The `*:raw` variants run without the guard.

## Verification Policy

- Start with the smallest meaningful verification set for the files you changed.
- Do not run full `npm test` by default.
- For everyday development and pre-merge checks, `npm run test:fast` is the default suite.
- Full `npm test` (or `test:fast` + `test:integration`) is required for shared runtime behavior, wallet or chain writes, persistence format changes, release artifacts, package or build plumbing, broad skillpack output, before releases, or when the user explicitly asks for it.
- For narrow docs, prompts, SKILLs, scripts, or UI copy changes, scoped checks plus `git diff --check` are usually enough.

## Merge And Closeout

A merge is a git operation that takes seconds; it only balloons when verification is mis-scoped. The full suite (`npm test`) is slow (tens of minutes) and contains a few flaky build-heavy integration tests that can fail under concurrency. Do **not** treat the merge step as a trigger to re-run the full suite. Keep closeout fast:

- **Baseline the workspace up front.** After `git worktree add`, run `npm install && npm run build` before writing any code. A worktree with no `node_modules` produces spurious failures (missing deps) later that cost a full round-trip to diagnose.
- **Verify on the merge result with the same scoped set, not the full suite.** Run the scoped commands already used during development (see Verification Policy) on `main` after the `--no-ff` merge. The merge step's job is to confirm the branch still builds/tests clean when combined with `main`, not to re-certify the whole repo.
- **Check for overlap before merging.** When `main` advanced while the branch was in flight, confirm the two change sets do not touch the same files:
  ```bash
  fork=$(git merge-base main HEAD)
  comm -12 <(git diff --name-only "$fork"..main | sort) <(git diff --name-only "$fork"..HEAD | sort)
  ```
  Empty output means a clean merge is expected; non-empty files are the only real conflict candidates.
- **Never re-run the full suite to diagnose one failure.** If a test fails in a suite run, isolate it: run that single file on the branch and on plain `main`. A failure that reproduces on plain `main` (or passes in isolation) is pre-existing flakiness or an environment gap, not a regression to block the merge.
- **Do not poll long-running tasks.** Background commands notify on completion. Do not chain `sleep` calls to wait for them; do other work or stop and let the completion event drive the next step.

## Definition Of Done

A change round is not done until all of these are true:

1. The scoped verification commands passed.
2. `git diff --check` passed for the scoped files.
3. A scoped commit exists for this round.
4. An `eric` development-journal buzz exists for this round, with a real pinId.

Use the default closeout path:

```bash
npm run closeout:eric -- --message "type: summary" --journal "What changed and why." --verify "<scoped verification command>" --stage <file> --stage <file>
```

The script runs verification, stages only the files you name, commits them, posts the `eric` buzz, and prints the commit hash plus pinId.

## Release Rules

- Releases are automated by GitHub Actions. Do not run manual `npm publish`, `gh release create`, or release-pack commands unless you are explicitly recovering a failed release.
- The canonical release workflow is [`.github/workflows/release.yml`](./.github/workflows/release.yml) for `openagentinternet/open-agent-connect`. It uses GitHub Trusted Publisher and publishes the same version to npm from the same Git tag.
- To cut a release:
  1. Bump `package.json` and `release/compatibility.json`.
  2. Run `npm run build && npm run build:skillpacks`.
  3. Run `npm test`.
  4. Run `node scripts/verify-release-version.mjs v{version}`.
  5. Commit and push the release commit to `main`.
  6. Run `git tag v{version}`.
  7. Run `git push origin v{version}`.
