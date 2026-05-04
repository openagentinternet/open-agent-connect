# Agent Instructions

- Commit once for every round of modifications.
- For every commit, use the `metabot-post-buzz` skill to post a detailed development diary of that round's changes on-chain.
- All documentation, SKILL documents, and code comments must be written in English.
- When spawning review or test subagents, default to model `gpt-5.4`.
- Do not use `gpt-5.1-codex-mini` for review/test subagents unless the user explicitly asks for it.
- Prefer small, frequent commits. Commit each independent, verifiable unit of work as soon as it is complete.
- For every modification or newly added feature, create one commit.
- Before committing, make sure the relevant local tests or verification steps pass for your changes.
- When merging completed work into `main`, use `git merge --no-ff` to preserve the feature merge point.
- MetaBot storage and directory layout changes must follow `docs/superpowers/specs/2026-04-23-metabot-storage-layout-v2-design.md`.
- Do not introduce new code or documentation that depends on the legacy `.metabot/hot` layout unless you are explicitly documenting historical behavior.

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
