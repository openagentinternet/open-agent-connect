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
npm run test
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
- If your shell defaults to an unsupported Node version, switch to a supported Node 20-24 runtime explicitly for verification.
- Create test temp directories only through `tests/helpers/tempRoots.mjs` (`mkdtempTempRoot`/`mkdtempTempRootSync`). Raw `fs.mkdtemp(os.tmpdir(), ...)` in tests or e2e scripts is not allowed. The helper registers teardown that stops test daemons (whole process group, waited) and removes the root on success, failure, or timeout.
- `npm test` and `npm run verify` run the suite through `scripts/run-tests-with-leak-guard.mjs`, which fails the run if new `metabot-*`/`oac-*`/`loom-*` temp roots remain under `os.tmpdir()` afterwards. `npm run test:raw` runs the suite without the guard.

## Verification Policy

- Start with the smallest meaningful verification set for the files you changed.
- Do not run full `npm test` by default.
- Full `npm test` is required for shared runtime behavior, wallet or chain writes, persistence format changes, release artifacts, package or build plumbing, broad skillpack output, or when the user explicitly asks for it.
- For narrow docs, prompts, SKILLs, scripts, or UI copy changes, scoped checks plus `git diff --check` are usually enough.

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
