# dsh-plugin upgrade plan: DSH kernel 0.1.0-rc.6 → 0.1.2-alpha.2

Date: 2026-08-31
Branch: `dsh-kernel-upgrade` (worktree `../open-agent-connect-dsh-kernel-upgrade`)
Scope: `dsh-plugin/` package only (`open-agent-connect-dsh`). No OAC core changes expected.

## 1. Situation

`open-agent-connect-dsh` 0.3.6 was built and typechecked against `@deepseek-ai/*@0.1.0-rc.6`.
The kernel shipped `dsh-v0.1.2-alpha.2` (2026-08-30; all packages published to npm under
the `alpha` dist-tag). Two forces make an adapter round mandatory:

1. **Semver**: our peer ranges `^0.1.0-rc.6` match at most `0.1.0-rc.7/rc.8` (npm
   prerelease rules) — they can never resolve against `0.1.1+` or `0.1.2-alpha.x` hosts.
2. **`@deepseek-ai/dsh-client-runtime` was deleted** in 0.1.2-alpha.1
   (harness commit `be531688f3`); we import it on the client side.

Everything was verified symbol-by-symbol against the kernel source at
`/Users/tusm/Documents/MetaID_Projects/deepseek-harness` (master == release merge
`0a53fb55be`) versus the installed rc.6 tarballs in `dsh-plugin/node_modules`.

## 2. Verified compatible — no action needed

| Dependency surface we use | Status in 0.1.2-alpha.2 (source-verified) |
|---|---|
| `webServer.register({ kind:'prefix', path, handler })` (src/index.ts:264) | unchanged; host-webserver only gained compression/index-injection additions |
| `agentPresets.copy/remove/list/composedPreset/mount` (src/preset.ts, twin-tools.ts) | all retained (`packages/preset/agent-presets/src/index.ts:540,577,248`; `deletePreset` at :602 is only a new `@Remote` wrapper) |
| `llm.listProviders/listModels/stream` (src/bots.ts, llm-generate.ts) | retained; now `TypertRemoteService`-backed, wire-compatible |
| `approval` gate `request(...)` + `approval/policy` session events (browser-tools.ts:155-190, skill-tools.ts:143) | `ApprovalService.request` intact (`packages/interaction/user-approval/src/index.ts:222`); `approval/policy` in `core/session/src/known-event-types.ts` |
| Events `agent/pre-step`, `session/event`, `agent/created` | all still emitted (tmux-context, agent-instructions, schedule, webhook consumers) |
| `agents` registry `create/followup/inject/whenIdle/cancel` (twin-tools.ts) | intact (`core/agent-loop/src/index.ts:652` + schedule/webhook consumers) |
| `ctx.effect(fn, label)`, `ctx.get`, scoped `ctx.inject([...])` | unchanged; cordis 4.0.1→4.0.2 has zero `.d.ts` delta |
| `tools.register`, `systemPrompt.section` | unchanged (`core/tools`, agent-loop) |
| `cordis-plugin-include` `entryListSchema` (preset.ts:11) | no API change in 1.0.7 |
| Slots API `ctx.slots.inject/register` + module augmentation | SlotCore register overloads unchanged (`client/ui-slots`) |
| `settings.section` slot contract (5 registrations in client/index.ts) | unchanged (`client/ui-settings/src/client/contract/slots.ts`) |
| Slots we render into: `conversation.hero.agentPreset`, `sidebar.footer.action` | both still rendered (`client/ui-conversation/src/client/skeleton/ConversationRoot.tsx`, `client/ui-sidebar`) |
| `ctx.locale.register(NS, { zh, en })` + `bind` | works; typed overload narrowed to `Record<BuiltInLocaleId, …>` — `{zh,en}` still satisfies it |
| Web bundle banner `window.__ModuleLoader__.load({id, factory})` (tsdown.config.ts) | still the required registration format (`client/modules/src/client/manifest.ts:10`) |
| `dsh.client` package manifest mechanism | kept; `inject` rows now mean boot-graph package edges, new `external` field for module-table requests (`client/modules/src/index.ts:211`) |
| Our own `/oac/api/*` HTTP + SSE surface | rides `webServer.register` — unaffected |
| `dsh plugin --profile <p> add <spec>` CLI (scripts/install.sh) | `apps/cli/src/plugin.ts` intact |

The server plugin (`src/index.ts` + tool modules) needs **zero code changes**.

## 3. Breaking changes we must adapt to

### B1. `@deepseek-ai/dsh-client-runtime` deleted (alpha.1)
New homes of what we import:
- `type ClientContext` (client/index.ts:8) → `import type { Context as ClientContext } from '@deepseek-ai/cordis'` (exactly what `ui-agent-preset` does now).
- `createSnapshotStore`, `type SnapshotStore` (preset-seat-store.ts:10, BotPresetSeat.tsx:8) → `@deepseek-ai/dsh-client-store`.
- It must be removed from `dsh.client.inject` (dead package row) and from peerDependencies.

### B2. Client RPC: `connection.api` envelope → typed `ctx.remote` faces
Old: `ctx.get('connection') as { api: SeatApi }` with locally-mirrored wire envelope
`{ result: { ok, value|error } }` and method names `agentPresets.list/select`,
`sessions.models/selectModel` (preset-seat-store.ts:21-42).
New: the browser cordis exposes `ctx.remote` (`@deepseek-ai/dsh-api-remotes/client`;
type merge via `import type {}`). Official call shape (ui-agent-preset `seat-store.ts:160`):
`await ctx.remote.agentPresets.select(session.id, staged)` — positional args, typed
return, failures throw `RemoteError` (unified wrapper; discriminate with
`remoteErrorOf(err)` / read `err.code`).
Method mapping for our `SeatApi`:
- `agentPresets.list({})` → `ctx.remote.agentPresets.list()` (returns typed preset rows).
- `agentPresets.select({sessionId, agentPreset})` → `ctx.remote.agentPresets.select(sessionId, agentPreset)`.
- `sessions.models({sessionId})` → `ctx.remote.session.modelCatalog(...)` (`@Remote('modelCatalog')`, session-controller index.ts:248 — confirm namespace `session` vs `commands` at implementation).
- `sessions.selectModel({sessionId, provider, model})` → `ctx.remote.session.selectModel(request)`; `SessionSelectModelRequest = { sessionId } & ModelSelection` (session-controller types.ts:269) — same fields we send today.
Consequently: rewrite `SeatApi` from the envelope mirror to thin typed aliases over
`ctx.remote`; replace `RpcResponse` unwrapping with try/catch + `RemoteError` message
extraction (feed `messageOf`). Client `inject` list changes `['slots','locale','connection']`
→ `['slots','locale','remote']`.

### B3. `sessions.noteAgentPreset` removed
`noteAgentPreset` survives only in stale build artifacts; the official seat dropped the
notion. Session rows already carry `agentPreset?` (session-controller types.ts:259) and the
seat refreshes from `sessions.list` snapshots + `connection/reset`. Our call site
(client/index.ts:275 `scope.sessions.noteAgentPreset(sessionId, agentPreset)`) must be
dropped; chip state should re-derive from the session-list snapshot like the official
`AgentPresetSeatController` does. Also verify the `blank` field still exists on the list
state rows we read (`SeatSessionSummary`).

### B4. Peer/dev dependency + manifest rework (package.json)
- peerDependencies: remove `@deepseek-ai/dsh-client-runtime`; bump the seven surviving
  dsh peers to `^0.1.2-alpha.2` (this range also matches the future `0.1.2` final);
  `@deepseek-ai/cordis ^4.0.1` stays (4.0.2 is a no-op patch).
- dependency: `@deepseek-ai/cordis-plugin-include` `1.0.6` → `1.0.7` (align with the
  vendored host copy; no API change).
- devDependencies: move all `@deepseek-ai/dsh-*` to exact `0.1.2-alpha.2`; add
  `@deepseek-ai/dsh-client-store` and `@deepseek-ai/dsh-api-remotes` (type-only);
  keep `dsh-client-ui-primitives` + `dsh-client-ui-agent-preset` at alpha.2.
- `dsh.client.inject`: remove the `dsh-client-runtime` row; keep
  `dsh-client-locale`, `dsh-client-ui-slots`, `dsh-client-ui-settings`,
  `dsh-client-ui-conversation` as package-row edges.
- add `dsh.client.external: ["@deepseek-ai/dsh-client-ui-primitives", "@deepseek-ai/dsh-client-store"]`
  — explicit module-table requests for our runtime-value externals instead of relying on
  the implicit baseline (confirm at implementation whether the baseline already covers
  them; declaring is safe either way).

### B5. Build config (tsdown.config.ts)
- Replace the `@deepseek-ai/dsh-client-runtime/client` external with
  `@deepseek-ai/dsh-client-store`.
- Drop the `@deepseek-ai/dsh-client-web-react` external (never imported; package no
  longer exists in the client tree).
- Banner format unchanged.

### B6. Tests
- `tests/preset-chip.test.mjs`: currently asserts `dsh.client.inject` contains
  `dsh-client-ui-conversation` — still true; extend to assert no `dsh-client-runtime`
  row and the new `external` list.
- `tests/plugin-shape.test.mjs`: server `inject` array unchanged; if it snapshots the
  client inject list, update `connection` → `remote`.
- Envelope-shaped fixtures inside chip/seat tests must move to typed-face fixtures.

## 4. Version strategy

- Plugin version: `0.3.6` → `0.4.0` (host-compat breaking change).
- Support matrix: this line requires DSH ≥ 0.1.2-alpha.2. The `0.3.x` line remains the
  answer for rc.6-era hosts; do not try to dual-support both kernels in one build (the
  client imports are mutually exclusive).
- Kernel 0.1.2 is an **alpha** channel: `alpha` dist-tag, prerelease semver. Until DSH
  cuts `0.1.2-rc`/final, treat this branch as a staging line; re-run the diff scan when
  the next tag drops (the restore of `SessionEvent.ignorable` in alpha.2 shows the
  alpha line can still move underneath us).

## 5. Implementation phases

Each phase is one scoped commit + eric buzz, per repo DoD.

1. **Deps & types**: B1 imports + B4 package.json + B5 tsdown. Done when
   `npm install && npm run typecheck` is clean against alpha.2 — expect remaining
   errors only in the client RPC area (B2/B3), which is the next phase.
2. **Client RPC migration**: B2 + B3 (SeatApi rewrite, inject list, noteAgentPreset
   removal, RemoteError handling, session-face adaptation).
3. **Tests & docs**: B6 + README host-requirements section.
4. **Live smoke**: on a host running kernel 0.1.2-alpha.2
   (`scripts/install.sh` → `dsh plugin --profile <p> add open-agent-connect-dsh@0.4.0`
   or `link:`): verify Settings shows the four OAC sections, the hero chip lists and
   selects presets, model pick applies, `/oac/api/health` answers, browser/A2A panel
   loads. Then the usual merge `--no-ff` back to `main`.

Scoped verification set for phases 1-3 (dsh-plugin is a standalone package):

```bash
cd dsh-plugin && npm install && npm run typecheck && npm test
```

Root OAC core is untouched; `npm run test:fast` on the worktree baseline already passes
and needs no re-run unless root files change.

## 6. Open items to confirm during implementation (not blockers)

- Exact remote namespace for `modelCatalog`/`selectModel` (`session` vs `commands`) —
  read the generated `@deepseek-ai/dsh-api-session-controller/remote` face.
- `SessionListState` row shape: `blank` and `agentPreset` fields on the snapshot we read
  in the scoped `sessions` service.
- Whether the client baseline already provides `dsh-client-store`/`ui-primitives`
  modules (decides if `dsh.client.external` rows are redundant but harmless).
- Whether `dsh-api-remotes` needs an `inject` row for third-party plugins or is
  app-baseline (the web app itself mounts the remotes assembly before plugin rows).
