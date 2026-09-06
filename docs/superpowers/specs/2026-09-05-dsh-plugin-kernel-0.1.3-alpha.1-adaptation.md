# dsh-plugin adaptation: DSH kernel 0.1.2-alpha.3 → 0.1.3-alpha.1

Date: 2026-09-05
Branch: `dsh-version-adapt` (worktree `.worktrees/dsh-version-adapt`)
Scope: `dsh-plugin/` package only (`open-agent-connect-dsh`). No OAC core changes.

## 1. Situation

`open-agent-connect-dsh` 0.4.0 declares peer ranges `^0.1.2-alpha.2` and dev-deps pinned
`0.1.2-alpha.3`. The kernel shipped `dsh-v0.1.3-alpha.1` (2026-09-04, merge `d347e70390`;
633 commits over `dsh-v0.1.2-alpha.3`, spanning 0.1.2-alpha.4, 0.1.2-alpha.5, 0.1.2-rc.1,
0.1.3-alpha.1). Two forces make an adapter round mandatory:

1. **Semver**: npm prerelease rules — `^0.1.2-alpha.2` matches only `0.1.2-alpha.x/rc.x`
   and the `0.1.2` final; it can never resolve against `0.1.3-alpha.1` hosts.
2. **Verification**: the kernel surface must be re-verified symbol-by-symbol; this round
   proves the plugin against the 0.1.3-alpha.1 source tree.

Publishing caveat: **0.1.3-alpha.1 is not on npm yet** (dist-tags at scan time:
`alpha = 0.1.2-alpha.5`, `next = 0.1.2-rc.1`). The live `web` profile resolves the kernel
through `link:/Users/tusm/Documents/MetaID_Projects/deepseek-harness`, so the
source-of-truth for compatibility is the checkout, not the registry. The 0.1.3-alpha.1
type gate therefore runs against an overlay of the checkout's built packages (§4);
committed dev-deps calibrate to the closest published line (`0.1.2-rc.1`).

## 2. Verified compatible — no action needed

Verified against the kernel source at `/Users/tusm/Documents/MetaID_Projects/deepseek-harness`
(HEAD == `dsh-v0.1.3-alpha.1`):

| Dependency surface we use | Status in 0.1.3-alpha.1 (source-verified) |
|---|---|
| cordis 4.0.2 + `cordis-plugin-include` 1.0.7 | vendored `vendor/` tree byte-identical between the tags — zero drift |
| `webServer.register({kind:'prefix',…})`, `webRuntime.trustedHosts` | host-webserver unchanged (`src/index.ts`, `src/injections.ts` identical) |
| `agentPresets.copy/remove/list/mount/composedPreset`, `standard` preset | all retained (`packages/preset/agent-presets/src/index.ts:414,475,540,577`) |
| `llm.listProviders/listModels/stream` + `text-delta`/`finish` chunks | additive only (`packages/llm/llm/src/index.ts`) |
| `approval` service, `approval/policy` events | intact (`packages/interaction/user-approval/src/index.ts:148`, known-event-types) |
| Events `agent/pre-step`, `session/event`, `agent/created/disposed` | all still emitted (context/*, schedule, webhook consumers) |
| Persisted event types `agent-preset/selected`, `turn/start|end`, `user/message`, `assistant/message` | all in `packages/core/session/src/known-event-types.ts` |
| `session.snapshotEvents()` | retained (`packages/core/session/src/index.ts:630`) — we already ride it since 0.1.2-alpha.4 dropped the `events` getter |
| `agents` registry, `agentDefaultModel`, `dshHomePath` services | intact (`packages/subagent/subagent/src/index.ts:203`, webhook, app-boot) |
| Slots we render into: `settings.section`, `sidebar.footer.action`, `conversation.hero.agentPreset` | all still rendered; the re-parenting wave moved only `conversation.input.*` + `conversation.composer.dock`, which we do not touch |
| Primitives: `Button/Input/Modal/Menu/MarkdownText/writeClipboard` + all 23 icons | all still exported (`packages/client/ui-primitives/src/index.ts`); only `MessageText` was removed — never imported by us |
| `createSnapshotStore` (dsh-client-store), ui-slots registration API | unchanged (slots additive: `keyedHooks` compartment) |
| Remote faces `remote.agentPresets.list/select`, `remote.session.modelCatalog/selectModel` | unchanged in `dsh-api-remotes`/`dsh-api-session-controller` (only a new `fileUploadsRemote` mount) |
| `sessions.list` snapshot fields we read (`blank`, `projectionValues.agentPreset`) | retained (`packages/api/session-controller/src/client/`) |
| `dsh.bundle.patch` / `dsh.client.inject|external|platform` manifest schema | byte-identical handling (app-boot profile.ts, client modules manifest.ts, PLATFORM_MODULES externals seed) |
| `window.__ModuleLoader__.load` client bundle banner | still the required registration format (`packages/client/web/src/boot.ts`) |
| `dsh plugin --profile <p> add <spec>` CLI (scripts/install.sh) | intact |

The host plugin and the client bundle need **zero code changes**.

## 3. Breaking changes in 0.1.3-alpha.1 that do NOT reach us

For the record — the release's breaking wave and why each misses this plugin:

- **Attachments rename** (`a1144c4950`, `bbb2ca7c9b`, PR #3109): `addImages`→`addFiles`,
  `draftImages`→`resolveDraftAttachments`, `PendingSubmission.images`→`.attachments`,
  `SubmitImageAttachment`→`SubmitAttachment`, `InputState.imageIds`→`attachmentIds`.
  We never touch the composer/input attachment API. Repo-wide grep over `src/` + `tests/`
  finds zero occurrences of any renamed symbol.
- **New `fileUpload`/`fileUploads`/`connection` injects** on DSH's own
  conversation/session-controller client plugins: DSH-internal rows; our client inject
  list (`slots, locale, remote, remote.agentPresets, remote.session`) resolves services
  that all still exist in the web-app composition.
- **Session log format v2** (`f99b06eaed`, `27bf1039db`): removed `ChunkRowEvent`/`'chunks'`
  live entries; live assistant deltas moved to `agent/assistant-stream`. We consume only
  persisted event types through `snapshotEvents()`.
- **`tool-subagent-report` base patch row removed** (`b91e7ce366`, already in alpha.4):
  our `cordis.patch.yml` inserts only the `oac-dsh` row — no overlays on kernel rows.
- **`./invariant` subpath exports dropped everywhere** (`15f2997bcb`, already in alpha.4):
  we import no invariant subpaths.
- **`MessageText` removed from ui-primitives**: we import `MarkdownText` (kept).
- **`tool-web` `fetch` now defaults `true`; PTC preset disables `tool-workflow`**: we copy
  the `standard` preset and never patch those rows.

## 4. What must change

1. **peerDependencies** (package.json): the seven `@deepseek-ai/dsh-*` peers move from
   `^0.1.2-alpha.2` to the dual range `^0.1.2-alpha.2 || ^0.1.3-alpha.1` — this build is
   a compatibility superset (zero code changes), so 0.1.2-alpha.2+ hosts stay supported
   and 0.1.3-alpha.1+ hosts become resolvable. `@deepseek-ai/cordis ^4.0.1` unchanged.
2. **devDependencies**: the ten `@deepseek-ai/dsh-*` pins calibrate `0.1.2-alpha.3` →
   `0.1.2-rc.1` (the newest npm-published line; its only deltas over alpha.3 are the two
   no-op changes listed in §3). The 0.1.3-alpha.1 surface is additionally type-gated via
   a local overlay (below), recorded in the README.
3. **0.1.3-alpha.1 overlay gate** (verification-only, nothing committed): temporarily
   replace the ten packages in `dsh-plugin/node_modules/@deepseek-ai/` with the checkout's
   built packages (`packages/client/*`, `packages/api/*`), then run
   `npm run typecheck && npm test`. Restores the npm-installed state afterwards.
4. **README** host-kernel-requirement paragraph: state the 0.4.1 contract — built against
   the 0.1.2-alpha.2 client surface, verified through 0.1.2-rc.1 (npm) and 0.1.3-alpha.1
   (source checkout overlay; npm publication pending).
5. **Plugin version**: `0.4.0` → `0.4.1` (superset peer widening, no code changes).

## 5. Verification

`dsh-plugin` is a standalone package; scoped set per repo policy:

```bash
cd dsh-plugin && npm install && npm run typecheck && npm test   # committed deps (0.1.2-rc.1)
# then the §4.3 overlay gate for 0.1.3-alpha.1, then restore node_modules
```

Root OAC core is untouched (`npm run test:fast` on the worktree baseline already passed;
no re-run needed). Live smoke on the `web` profile (Settings sections, hero chip,
`/oac/api/health`, A2A panel) follows the user's manual `pnpm dsh web` restart, per the
agent-etiquette rule (agents never start daemons or dsh web).

## 6. Rollout notes

- The live profile already `link:`s this plugin, so picking the branch up is a
  re-link/restart on the user side; no `dsh plugin add` needed.
- When DSH publishes 0.1.3-alpha.1+ to npm, dev-deps can be re-pinned exactly; until
  then the overlay gate is the recorded 0.1.3-alpha.1 verification.
