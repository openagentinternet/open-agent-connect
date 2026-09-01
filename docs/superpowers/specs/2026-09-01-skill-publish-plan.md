# Skill publish plan: DSH-side bots publish metabot-skill packages

Date: 2026-09-01
Branch: `skill-publish` (worktree `../open-agent-connect-skill-publish`)
Goal: complete the learn/publish loop — after the install round (f0824eb6), port
the IDBots `metabot-post-skill` capability so any OAC-hosted bot (DSH included)
can package a local skill directory and publish it on-chain for others to learn.

Out of scope: `metabot-post-skillservice` (paid service marketplace listings at
`/protocols/skill-service`) — a separate marketplace concern, not needed for
"publish a skill others can install".

## 1. Protocol contract (extracted from IDBots, must not drift)

- Package: the skill directory zipped (installer tolerates SKILL.md at root,
  one wrapping dir, or shallowest match). Cap **4 MB** (matches
  `MAX_SKILL_PACKAGE_BYTES` in skillInstall.ts).
- Pin: `signer.writePin({ operation: 'create', path: '/protocols/metabot-skill',
  contentType: 'application/json', payload: JSON.stringify({
    name, description?, version, 'skill-file': 'metafile://<zipPinId>.zip' }) })`.
  Exactly the canonical spellings OAC's `extractSkillPinDescriptor` reads; the
  `skill-file` URI carries the `.zip` extension.
- Upload: zip as `/file` pin, `contentType: 'application/zip'` →
  `metafileUri` (or `metafileUriFromPinId(pinId, '.zip')`).
- Publisher identity comes from pin authorship, never the payload.
- Discovery is indexer-side over the protocol path — no extra index pin.
- Gaps to close vs IDBots (install-side strictness): enforce
  `normalizeSkillName` on publish; require `version` (flag or frontmatter, no
  default — consumers dedupe by name and pick the highest version); derive the
  pinned metadata from the zip's SKILL.md frontmatter so frontmatter and payload
  cannot disagree (flags may override, final values must validate).

## 2. Implementation phases (CLI-first, mirroring the install round)

### Phase 1 — core `src/core/skills/skillPublish.ts`
Dependency-injected like `src/core/metaapp/publish.ts` (deps: `uploadFile`,
`writeChain`, `now`, `makeTempDir`):
- `SKILL_PROTOCOL_PATH`, `SkillPublishError` (`invalid_project` |
  `package_too_large` | `invalid_metadata` | `publish_failed`).
- `previewSkillProject({ skillDir, name?, version?, description?, network? })`:
  inspect dir, locate SKILL.md (reuse the same tolerance rules as install),
  parse frontmatter, merge flag overrides, validate name/version, build the
  archive (real bytes via `writeMetaAppZipArchive` into a temp dir) so the
  confirmation plan shows actual size + sha256.
- `publishSkill(input, deps)`: without `confirm` → `commandAwaitingConfirmation`
  with the plan; with it → archive → 4 MB cap → `uploadFile({filePath,
  contentType:'application/zip', network})` → payload build → `writeChain`
  → success `{ pinId, skillFileUri, archive: {bytes, sha256}, upload,
  chainWrite, formatted }` (formatted = model-ready string, per repo envelope
  convention).
- Tests `tests/core/skillPublish.test.mjs`: preview/confirm gate, cap
  enforcement, name/version validation, frontmatter-vs-flag merge, and the
  **round-trip test**: capture the archive + payload via fake deps, then feed
  them through `installSkillArchive` + `extractSkillPinDescriptor` — publish
  output must install cleanly (this pins the whole protocol contract).

### Phase 2 — daemon route + CLI verb
- Daemon: `POST /api/skills/publish` (`src/daemon/routes/skills.ts`, new file
  following routes/metaapp.ts shape) → defaultHandlers `skills.publish`:
  `resolveActorWriteContext(from)`, real deps `uploadLargeFileToChain` +
  `actor.signer.writePin`, mirroring `metaapp.publishProject` (daemon/defaultHandlers.ts:12867).
- CLI: `metabot skills publish --from <dir> [--name --version --description]
  [--network mvc] [--confirm]` — subcommand in `src/cli/commands/skills.ts`,
  handler type in `src/cli/types.ts`, runtime wiring + daemon call via
  `requestJsonForSelectedActor` in `src/cli/runtime.ts`, help nodes in
  `src/cli/commandHelp.ts` (group + `['skills','publish']` leaf).
- Tests: extend `tests/cli/skillsCommand.test.mjs` — confirm_required preview,
  mocked-daemon publish success envelope, flag pass-through; help enumeration.

### Phase 3 — DSH plugin `skill_tool` publish action
- `dsh-plugin/src/skill-tools.ts`: action `publish_skill` (params `from`,
  optional `name/version/description`), approval-gated exactly like
  `install_skill`, maps to `['skills','publish','--from', dir, '--confirm', …]`.
- Extend the `oac:metaweb-learning-loop` prompt text: after demonstrating a
  learned skill, offer to publish the bot's own improved/new skill back
  (share-the-loop SOP).
- Tests: extend `dsh-plugin/tests/skill-tools.test.mjs` (argv mapping, gate,
  refusal, unknown-dir validation).

### Phase 4 — SOP + skillpacks + live round-trip
- `SKILLs/metabot-metaweb/SKILL.md`: new "Publish a Skill for Others to Learn"
  section (frontmatter requirements, name rules, 4 MB cap, version-bump
  guidance, `--confirm` semantics); `npm run build:skillpacks` regenerates all
  five hosts (stage the dist trees — known commit trap).
- CHANGELOG `## Unreleased` entry.
- Live round-trip (real chain, minimal SPACE/MVC fees, from a disposable
  publisher bot): `skills publish` a small temp skill → read the new pin via
  `metaweb read` → `skills install --pin <newPinId> --confirm` from a clean
  skills root → verify installed record provenance. Then the DSH-side smoke:
  publish through `skill_tool` on the 3080 host (needs plugin rebuild + web
  restart after merge).
- Merge `--no-ff` to main, scoped verification per round (core/CLI/plugin
  tests, not the full suite).

## 3. Risks / notes

- Real-chain live test writes two pins (file + protocol) — trivial cost,
  consistent with prior live verification practice.
- Plugin version stays 0.4.0 on the branch; version bumps happen at release
  time per release rules.
- After merge, the live 3080 profile needs a web restart to load the new
  plugin build (link target is the main workspace).
