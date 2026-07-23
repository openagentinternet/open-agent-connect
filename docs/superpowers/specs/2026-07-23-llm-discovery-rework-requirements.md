# LLM Discovery Rework — Development Requirements

Date: 2026-07-23
Status: Approved for implementation
Branch: `llm/discovery-rework`
Worktree: `/Users/tusm/Documents/MetaID_Projects/open-agent-connect/.worktrees/llm/discovery-rework`
Base commit: `f910bfb1` (main at branch creation)

## 1. Background and Problem Statement

A field report from a machine with WorkBuddy installed showed that a newly
created bot had no selectable LLM for a long time:

1. The Bot page "available LLM" dropdown only renders runtimes whose
   `health === 'healthy'`.
2. WorkBuddy's first readiness probe timed out after 30 s (the probe spawns
   the App-bundled CLI cold and performs a real LLM round trip), so the
   runtime was persisted as `detected` and became invisible everywhere.
3. Opening the Bot page only reads the cached `runtimes.json`; it never
   triggers rediscovery, so the stale `detected` state persists until the
   user manually clicks "Refresh Runtimes".
4. A full discovery sweep probes all 14 runtime platforms (concurrency 8,
   per-provider readiness up to 30–45 s), so even a manual refresh blocks
   for tens of seconds with no partial feedback.

The current state machine (verified against the base commit):

```text
(not found)                                  binary absent everywhere
    | version probe OK (5 s; cursor 20 s)
    v
detected -- readiness probe OK --> healthy   probe = real backend call,
    |  fail/timeout (30 s; 45 s for          "Reply exactly OK.",
    |  codex/cursor/claude-code/zcode)       healthy kept without re-probe
    |                                        for 30 min (skip window +
    v                                        preserve-on-upsert)
 stays detected (healthReason set)
    | version probe fail / binary gone at next sweep
    v
unavailable  <-- also forced by chat-execution failure (15-min cooldown)
```

Visibility gates that both require `healthy`:

- UI dropdown: `availableRuntimes()` in `src/ui/pages/bot/app.ts:252`
- Chat execution: `llmRuntimeResolver.ts` (`isSelectable` requires
  `health === 'healthy'`)

## 2. Goals and Non-Goals

### 2.1 Goals (in scope for this branch)

- **A. Discovery layer** (`src/core/llm/llmRuntimeDiscovery.ts`,
  `src/core/platform/platformRegistry.ts`)
  - A1. Move probe timing policy into the platform registry
    (`probeHints`); remove hardcoded provider lists from discovery.
    Give WorkBuddy the app-embedded (slow-start) probe profile.
  - A2. Harden probe termination: SIGTERM -> grace -> SIGKILL plus forced
    stream close, so a wedged probe cannot leak child processes.
  - A3. Make login-shell executable resolution lazy (only on miss) and
    re-verify shell-returned paths before use.
  - A4. Prioritize likely-present providers and persist each provider's
    result progressively during a sweep.
- **B. Daemon API layer** (`src/daemon/defaultHandlers.ts`,
  `src/daemon/routes/bot.ts`, `src/daemon/routes/llm.ts`)
  - B1. Non-blocking background discovery mode with single-flight
    coalescing, plus per-provider-subset refresh.
  - B2. Expose an in-memory discovery status so clients can poll
    deterministically.
- **C. Bot page UI** (`src/ui/pages/bot/app.ts`, `src/ui/i18n.ts`)
  - C1. Dropdown distinguishes `healthy` (selectable) from `detected`
    (visible, disabled, with reason).
  - C2. Auto background discovery on page load when nothing is healthy,
    with progress state and bounded polling; manual refresh also becomes
    non-blocking.
  - C3. Split the sidebar `NO LLM` label into "not bound" vs "bound but
    not ready" states.
  - C4. Empty-state copy distinguishes "nothing discovered" from
    "detected but not ready".

### 2.2 Non-Goals (explicitly out of scope)

Do not implement any of the following in this branch:

- Per-turn executor latency work: strict skill isolation cost, process
  reuse / warm pools, backend spawn strategy.
- Changing `resolveLoomRuntime` (`src/daemon/defaultHandlers.ts:11106`)
  which currently runs a full discovery before every Loom LLM call.
- Self-heal of vanished pinned binary paths; minimum-version gating;
  hooks-shadow exclusion; model catalog caching; Codex service tiers.
- New health states. The existing `degraded` value in
  `src/core/llm/llmTypes.ts:14` remains defined-but-unused.
- Windows/Linux `defaultExecutablePaths` for WorkBuddy (macOS-only today).
- A daemon-side periodic retry timer for timed-out runtimes.

## 3. Detailed Requirements

### 3.1 A1 — Registry-driven probe hints

**Current state:** `llmRuntimeDiscovery.ts:53-62` defines
`DEFAULT_READINESS_TIMEOUT_MS = 30_000`, `SLOW_START_READINESS_TIMEOUT_MS =
45_000`, `DEFAULT_VERSION_PROBE_TIMEOUT_MS = 5_000`,
`SLOW_START_VERSION_PROBE_TIMEOUT_MS = 20_000`,
`DEFAULT_READINESS_SEMANTIC_INACTIVITY_TIMEOUT_MS = 15_000`. The slow-start
provider list is hardcoded in `readinessTimeoutForProvider` (418-423),
`versionProbeTimeoutForProvider` (425-429), and
`readinessSemanticInactivityTimeoutForProvider` (431-438).

**Requirements:**

1. Add an optional `probeHints` field to the runtime section of
   `PlatformDefinition` in `src/core/platform/platformRegistry.ts`:

   ```ts
   probeHints?: {
     readinessTimeoutMs?: number;          // default 30_000
     versionProbeTimeoutMs?: number;       // default 5_000
     semanticInactivityTimeoutMs?: number; // default min(readinessTimeoutMs, 15_000)
   };
   ```

2. Populate `probeHints` so that effective behavior is exactly preserved
   for existing providers, and WorkBuddy receives the app-embedded profile:

   | provider    | readinessTimeoutMs | versionProbeTimeoutMs | semanticInactivityTimeoutMs |
   |-------------|--------------------|-----------------------|------------------------------|
   | codex       | 45_000             | (default 5_000)       | 45_000                       |
   | cursor      | 45_000             | 20_000                | 45_000                       |
   | claude-code | 45_000             | (default 5_000)       | 45_000                       |
   | zcode       | 45_000             | (default 5_000)       | 45_000                       |
   | workbuddy   | 45_000             | 20_000                | 45_000                       |
   | all others  | (defaults)         | (defaults)            | (defaults)                   |

3. `readinessTimeoutForProvider`, `versionProbeTimeoutForProvider`, and
   `readinessSemanticInactivityTimeoutForProvider` must resolve their
   values from the registry entry (look the platform definition up by
   provider id) instead of hardcoded arrays. Keep the exported signature
   of `readinessSemanticInactivityTimeoutForProvider(provider,
   readinessTimeoutMs)` stable — it is consumed by
   `src/core/llm/executor/backends/codex.ts:159`. The explicit
   `semanticInactivityTimeoutMs` hint, when present, wins over the
   `readinessTimeoutMs` argument fallback.

4. `SLOW_START_READINESS_TIMEOUT_MS` and `SLOW_START_VERSION_PROBE_TIMEOUT_MS`
   may be retained as the source of the registry values or inlined into
   the registry; the discovery module must not keep provider-name lists.

### 3.2 A2 — Probe termination hardening

**Current state:** `probeExecutableVersion` (`llmRuntimeDiscovery.ts:304-362`)
sends a single SIGTERM on timeout (325-328). A wedged node/bun shim can
ignore SIGTERM or keep stdout open via grandchildren, leaking the process.
`resolveExecutablesViaLoginShell` (164-209) already implements the correct
pattern: SIGTERM, then SIGKILL after `LOGIN_SHELL_RESOLVE_KILL_GRACE_MS =
2_000`.

**Requirements:**

1. In `probeExecutableVersion`, on timeout: send SIGTERM, start a 2 s
   grace timer, then send SIGKILL and destroy `child.stdout` /
   `child.stderr` so the `close` event cannot be held open by pipes. The
   promise must settle exactly once with the existing timeout message
   shape (`Version probe timed out after ${timeoutMs}ms.`).
2. Extract the TERM -> grace -> KILL + stream-destroy sequence into a
   small shared helper inside `llmRuntimeDiscovery.ts` and reuse it for
   the login-shell resolution path (behavior there must remain identical).
3. Audit `src/core/llm/executor/backends/jsonProcess.ts` timeout kills;
   if a timeout path sends SIGTERM without escalation, apply the same
   helper (or an equivalent local implementation). Do not refactor any
   other spawn call sites.

### 3.3 A3 — Lazy login-shell resolution with re-verification

**Current state:** `discoverLlmRuntimes` (695-751) eagerly calls
`resolveExecutablesViaLoginShell` for the `binaryNames` of every platform
on every sweep (706-709) — a `$SHELL -ilc` spawn touching user rc files,
bounded at 3 s + 2 s. Shell-returned paths are trusted verbatim
(`executableCandidatesForProvider`, 253-292; the shell candidate is added
at line 286 without an existence check).

**Requirements:**

1. Restructure candidate resolution so the login shell is only spawned
   when at least one provider found **no** candidate through the cheap
   sources, in this order per provider:
   - env override paths (`providerPathEnvNames`, added unconditionally as
     today);
   - PATH scan of `providerPathSearchBinaryNames(platform)`;
   - `defaultExecutablePaths` that pass `fs.access(X_OK)`.
2. For providers that missed, collect their
   `providerPathSearchBinaryNames(platform)` names, call
   `resolveExecutablesViaLoginShell(missedNames, env)` once, and re-run
   candidate collection for those providers with the shell results.
3. Re-verify every shell-returned path with `fs.access(X_OK)` before
   accepting it as a candidate (paths from fnm/nvm multishell dirs may
   vanish between resolution and use).
4. Preserve the `input.shellResolvedExecutables` injection point: when
   provided, use it exactly as today and skip the lazy shell resolution
   (existing tests depend on this).
5. Env-override-only providers (e.g. a provider configured purely via
   `OAC_*_PATH`) must never trigger a shell spawn.
6. Net behavior rule: a sweep where every provider resolves via env /
   PATH / default paths performs **zero** shell spawns.

### 3.4 A4 — Provider prioritization and progressive persistence

**Current state:** `discoverLlmRuntimes` iterates platforms in registry
order through `mapWithConcurrency` (concurrency 8) and returns one final
array. The bot discover handler (`defaultHandlers.ts:16043-16067`)
upserts only after the full sweep completes.

**Requirements:**

1. Add an optional `onRuntimeDiscovered?: (runtime: LlmRuntime) => void |
   Promise<void>` to `DiscoveryInput`. Invoke it with each provider's
   runtime as soon as that provider's `discoverProvider` settles (inside
   the worker loop, before the whole sweep finishes). Await the callback
   so persistence errors surface deterministically, but a callback
   failure must not abort the remaining providers — capture it into the
   returned `errors` array instead.
2. Order the platform list before fan-out:
   - tier 1: providers with an entry in `knownRuntimes`;
   - tier 2: providers without known runtimes whose
     `defaultExecutablePaths` exist on disk (best-effort `fs.access`);
   - tier 3: everything else, in registry order.
   Ordering must be deterministic; relative order within a tier follows
   registry order.
3. In the bot `discoverRuntimes` handler and the llm mirror, pass an
   `onRuntimeDiscovered` callback that upserts each runtime into the
   store immediately with the existing merge policy
   (`preserveRecentHealthyOnDetected: true`,
   `llmRuntimeStore.ts:81-136`). The end-of-sweep pass that marks
   previously-known-but-now-missing runtimes `unavailable` must still run
   after the sweep, not progressively.
4. The blocking response shape is unchanged; progressive upserts only
   affect what concurrent `GET .../runtimes` readers observe mid-sweep.

### 3.5 B1 — Background discovery mode and provider-subset refresh

**Current state:** `POST /api/bot/runtimes/discover`
(`src/daemon/routes/bot.ts:251-259`) reads only the `from` query param
and blocks until the sweep ends; the handler
(`defaultHandlers.ts:16043-16067`) is all-or-nothing. Mirror routes exist
at `src/daemon/routes/llm.ts:124-137` with handlers at 16159-16180.

**Requirements:**

1. Accept an optional JSON body on `POST /api/bot/runtimes/discover` and
   `POST /api/llm/runtimes/discover`:

   ```json
   { "background": true, "providers": ["workbuddy"] }
   ```

   Both fields optional. Missing/invalid body = treat as `{}`.
   `providers` entries that are not runtime platform ids are ignored.
2. `background: true` behavior:
   - Start the sweep without awaiting it; respond immediately with HTTP
     200 and `{ ok: true, data: { status: "running", runtimes: [...] } }`
     where `runtimes` is the current store snapshot.
   - Single-flight: if a sweep is already in flight for the same store
     (same resolved home dir), do not start another; respond with the
     same `status: "running"` payload. Track in-flight sweeps in a
     module-level `Map` keyed by home dir; clear the entry when the sweep
     settles (success or failure).
   - A failed background sweep is logged (existing logger path) and
     leaves the store untouched apart from progressive upserts that
     already landed.
3. `background` absent/false keeps the current blocking behavior
   (including its response shape), now with progressive upserts from A4.
4. `providers` narrows the sweep in both modes
   (`discoverLlmRuntimes({ providers })` already supports this).
5. Implement the shared logic once (helper used by both the bot and llm
   handlers); do not duplicate sweep bookkeeping.

### 3.6 B2 — Discovery status exposure

**Requirements:**

1. Extend the `data` payload of `GET /api/bot/runtimes` (and the llm
   mirror) with an optional field:

   ```ts
   discoveryStatus?: {
     running: boolean;
     lastStartedAt?: string;  // ISO
     lastFinishedAt?: string; // ISO
   };
   ```

2. Source it from the same in-memory bookkeeping as B1 (plus timestamps
   for the last completed sweep, including blocking ones). Absent when no
   sweep has run since daemon start.
3. This is in-memory only; nothing is persisted to `runtimes.json`, and
   the file format (`{ version, runtimes[] }`) must not change.

### 3.7 C1 — Dropdown: healthy selectable, detected visible-disabled

**Current state:** `availableRuntimes()` (`app.ts:252`) filters
`health === 'healthy'`; `uniqueProviderRuntimes` (411-415) dedupes per
provider; `providerPickerMarkup` (416-438) renders Primary/Fallback
pickers with empty state `bot.noHealthyRuntimes` at 433-434.

**Requirements:**

1. Keep healthy runtimes as the only **selectable** options; selection,
   saving, and `llmRuntimeResolver` behavior are unchanged.
2. Render a second, disabled option group listing providers that have a
   `detected` (or `degraded`) runtime but no healthy one. Each disabled
   option shows the provider display name plus a suffix from
   `bot.runtimeNotReadySuffix`; the option `title` attribute carries the
   runtime's `healthReason` when present.
3. Group labels: `bot.runtimeGroupReady` above selectable options,
   `bot.runtimeGroupDetected` above disabled ones. Render groups only
   when non-empty.
4. The existing "Provider unavailable: X" hint for a configured-but-not-
   healthy provider stays, and gains a pointer to open the LLM runtimes
   modal (the modal already offers per-runtime Test).

### 3.8 C2 — Auto background discovery on page load

**Current state:** `loadAll()` (1869) = `loadProfiles()` +
`loadRuntimes()` (1853, cache read only). The only refresh trigger is the
manual button (`discoverRuntimes`, 1886-1889), which blocks on the POST
and reloads afterwards.

**Requirements:**

1. After the initial `loadRuntimes()` resolves, if `state.runtimes`
   contains zero `healthy` runtimes, fire one background discover POST
   per page load (`{ background: true }`) and begin polling
   `GET /api/bot/runtimes` every 2 s.
2. While the background sweep is running and no healthy runtime exists
   yet, picker areas and the runtime summary show an in-progress state
   (`bot.checkingRuntimes` + `bot.checkingRuntimesHint`) instead of the
   "no healthy runtimes" empty state.
3. Stop polling when any of these is true:
   - a healthy runtime appears in state;
   - `discoveryStatus.running` was observed `true` and is now `false`;
   - 60 s hard timeout since the auto-trigger.
   After stopping without a healthy runtime, show the appropriate empty
   state (C4) and leave the manual Refresh button available.
4. Convert the manual "Refresh Runtimes" button to the same
   background-plus-polling flow: click -> POST `{ background: true }` ->
   button shows `bot.refreshing` until polling stops. Reuse one polling
   loop for auto and manual triggers; a manual click while polling is
   active is a no-op.
5. Polling must reuse `loadRuntimes()` semantics (update `state.runtimes`,
   set `_runtimesLoaded`, re-render list/tab/stats, and re-render the
   runtime modal when open) without resetting picker selections the user
   has already made in an open modal.
6. Guards: never run more than one background sweep trigger at a time
   from this page; clear all intervals/timeouts on page unload.

### 3.9 C3 — Sidebar label split

**Current state:** `shouldShowNoLlmLabel` (303-308) and
`noLlmLabelMarkup` (309-313) show a single `NO LLM` label when no
providers are configured, or when none of the bound providers is healthy.

**Requirements:**

1. No providers bound (no primary/fallback): label
   `bot.noLlmBoundLabel` with tooltip `bot.noLlmBoundTitle`.
2. Providers bound but none healthy (only after `_runtimesLoaded`):
   label `bot.llmNotReadyLabel` with tooltip `bot.llmNotReadyTitle`.
3. While runtimes have not loaded yet, render no label (unchanged).
4. Remove the now-unused `bot.noLlmLabel` / `bot.noLlmTitle` keys from
   both dictionaries if nothing references them anymore.

### 3.10 C4 — Empty-state copy

**Requirements:**

1. Zero runtimes at all: `bot.noRuntimesYet`.
2. Some runtimes detected but none healthy: `bot.detectedNotReadyOne` /
   `bot.detectedNotReadyMany` with `{count}` interpolation.
3. Replace the `bot.noHealthyRuntimes` usages accordingly; remove the key
   if unreferenced afterwards.

### 3.11 i18n key table (both dictionaries, exact copy)

Add to `src/ui/i18n.ts` (`en` dictionary starts at line 11, `zh-CN` at
line 585; keep the two in sync per repo policy):

| key | en | zh-CN |
|---|---|---|
| `bot.runtimeGroupReady` | `Ready` | `可用` |
| `bot.runtimeGroupDetected` | `Detected (not ready)` | `已检测（未就绪）` |
| `bot.runtimeNotReadySuffix` | `not ready` | `未就绪` |
| `bot.noRuntimesYet` | `No LLM runtimes discovered yet.` | `尚未发现 LLM 运行时。` |
| `bot.detectedNotReadyOne` | `1 runtime detected but not ready — open LLM runtimes to test.` | `已检测到 1 个运行时，但尚未就绪——请打开 LLM 运行时进行测试。` |
| `bot.detectedNotReadyMany` | `{count} runtimes detected but not ready — open LLM runtimes to test.` | `已检测到 {count} 个运行时，但尚未就绪——请打开 LLM 运行时进行测试。` |
| `bot.checkingRuntimes` | `Checking local LLM runtimes…` | `正在检测本机 LLM 运行时…` |
| `bot.checkingRuntimesHint` | `This can take up to a minute on the first run.` | `首次检测可能需要约一分钟。` |
| `bot.noLlmBoundLabel` | `NO LLM BOUND` | `未绑定 LLM` |
| `bot.noLlmBoundTitle` | `No Primary or Fallback LLM bound to this bot.` | `该 Bot 未绑定 Primary 或 Fallback LLM。` |
| `bot.llmNotReadyLabel` | `LLM NOT READY` | `LLM 未就绪` |
| `bot.llmNotReadyTitle` | `Bound LLM runtimes are not ready yet. Open LLM runtimes to test or refresh.` | `已绑定的 LLM 运行时尚未就绪，请打开 LLM 运行时弹窗测试或刷新。` |

## 4. Test Requirements

Build before testing (`npm run build`). Tests run with
`--test-concurrency=1`; `tests/cli/runtime.test.mjs` runs last. Create
test temp directories only through `tests/helpers/tempRoots.mjs`
(`mkdtempTempRoot` / `mkdtempTempRootSync`); raw `fs.mkdtemp(os.tmpdir(),
...)` is not allowed.

Extend or add coverage for:

1. `tests/llm/llmProviderExpansion.test.mjs`
   - registry `probeHints` drive readiness / version / semantic-inactivity
     timeouts (workbuddy resolves to 45_000 / 20_000 / 45_000; an
     unlisted provider falls back to defaults);
   - lazy shell resolution: shell resolver is not invoked when all
     providers resolve via env/PATH/default paths; it is invoked with
     exactly the missed binary names otherwise;
   - shell-returned paths that fail `fs.access` are rejected;
   - `input.shellResolvedExecutables` injection still bypasses shell
     resolution;
   - platform ordering: known-runtime providers and existing
     `defaultExecutablePaths` providers are processed first;
   - `onRuntimeDiscovered` fires per provider and a throwing callback is
     captured into `errors` without aborting the sweep.
2. Probe hardening: a fake executable (shell script that traps/ignores
   SIGTERM and writes forever) must still settle the version probe with
   the timeout message and leave no running child process afterwards.
3. `tests/daemon/defaultBotHandlers.test.mjs`
   - background discover returns immediately with `status: "running"` and
     the current store snapshot;
   - single-flight: a second background POST while in flight does not
     start a new sweep;
   - `providers` filter is passed through;
   - `listRuntimes` exposes `discoveryStatus` transitions;
   - progressive upserts are visible to `listRuntimes` mid-sweep.
4. `tests/daemon/defaultLlmHandlers.test.mjs` — same behavior through the
   llm mirror.
5. `tests/daemon/httpServer.test.mjs` — discover routes accept a JSON
   body (`background`, `providers`) alongside the existing `from` query;
   malformed bodies do not 500.
6. `tests/ui/botPageScript.test.mjs`
   - picker renders healthy options selectable and detected options
     disabled with suffix/title, grouped with labels;
   - auto background discover fires exactly once on load when nothing is
     healthy, and not when a healthy runtime exists;
   - polling stops on healthy appearance / `running: false` / timeout;
   - manual refresh uses background mode and re-enables afterwards;
   - sidebar shows the bound-vs-not-ready label variants;
   - empty states switch between "nothing discovered" and "detected but
     not ready" copy;
   - every new i18n key exists in both `en` and `zh-CN` dictionaries.

## 5. Verification Plan

Scoped commands first, then the full suite (this change touches shared
runtime behavior, so full `npm test` is mandatory per `AGENTS.md`):

```bash
npm run build && npm run build:skillpacks
node --test tests/llm/llmProviderExpansion.test.mjs
node --test tests/daemon/defaultBotHandlers.test.mjs
node --test tests/daemon/defaultLlmHandlers.test.mjs
node --test tests/daemon/httpServer.test.mjs
node --test tests/ui/botPageScript.test.mjs
npm test          # full suite, runs via scripts/run-tests-with-leak-guard.mjs
npm run verify
git diff --check
```

Manual acceptance (the original field report):

1. Seed `~/.metabot/LLM/runtimes.json` with WorkBuddy as
   `detected` + `healthReason: "Readiness probe timed out after 30000ms."`.
2. Open `/ui/bot`:
   - within a few seconds a background sweep starts automatically with a
     visible progress state (no manual Refresh needed);
   - the Primary picker shows WorkBuddy under "Detected (not ready)"
     while the probe runs, and moves it to "Ready" once readiness passes
     (now bounded at 45 s);
   - a bot bound to WorkBuddy shows `LLM NOT READY` until the probe
     succeeds, then the label clears; a bot with nothing bound shows
     `NO LLM BOUND`.
3. Click "Refresh Runtimes": the button no longer blocks for the whole
   sweep; partial results appear as providers complete.
4. `metabot llm discover` (CLI path) still returns the same blocking
   result shape as before.

## 6. Implementation Constraints (repo rules)

- All code comments, docs, and test names in English; UI copy goes
  through `src/ui/i18n.ts` with `en` + `zh-CN` kept in sync.
- Surgical changes only: every changed line traces to a requirement in
  this document. No unrelated refactors or formatting churn.
- Do not introduce dependencies on the legacy `.metabot/hot` layout.
- `runtimes.json` format is unchanged; `discoveryStatus` is in-memory
  only.
- Suggested commit split (each via the closeout flow below):
  1. discovery layer (A1-A4) + its tests;
  2. daemon API (B1-B2) + its tests;
  3. bot page UI + i18n (C1-C4) + its tests.
- Closeout per commit round, run from this worktree:

  ```bash
  npm run closeout:eric -- --message "type: summary" \
    --journal "What changed and why." \
    --verify "<scoped verification command>" \
    --stage <file> --stage <file>
  ```

- Definition of done per round: scoped verification passed,
  `git diff --check` passed, scoped commit exists, `eric` journal buzz
  with a real pinId.
- Merge back to `main` later with `git merge --no-ff` (release work only
  from `main`).

## 7. Key Code Anchors (verified at base `f910bfb1`)

| Area | File | Lines / symbols |
|---|---|---|
| Timeouts & constants | `src/core/llm/llmRuntimeDiscovery.ts` | 53-62 |
| Login-shell resolution | same | `resolveExecutablesViaLoginShell` 164-209 |
| Candidate collection | same | `executableCandidatesForProvider` 253-292 (shell path at 286) |
| Version probe | same | `probeExecutableVersion` 304-362 (timeout kill 325-328) |
| Runtime build | same | `buildDiscoveredRuntime` 377-412 |
| Timeout policy | same | 418-438 (three functions) |
| Readiness probe | same | `defaultRuntimeReadinessProbe` 440-502 |
| Per-provider sweep | same | `discoverProvider` 504-598 |
| Full sweep | same | `discoverLlmRuntimes` 695-751 (eager shell at 706-709) |
| WorkBuddy registry entry | `src/core/platform/platformRegistry.ts` | 402-429 (`defaultExecutablePaths` at 413) |
| Health enum | `src/core/llm/llmTypes.ts` | 14 |
| Store merge policy | `src/core/llm/llmRuntimeStore.ts` | `mergeRuntimeForUpsert` 94-136 |
| Bot runtime routes | `src/daemon/routes/bot.ts` | 241-273 |
| LLM mirror routes | `src/daemon/routes/llm.ts` | 124-137 |
| Bot runtime handlers | `src/daemon/defaultHandlers.ts` | 16031-16091 |
| LLM mirror handlers | same | 16159-16180 |
| Startup background sweep | `src/cli/runtime.ts` | 3936-3948 (leave as-is) |
| UI dropdown filter | `src/ui/pages/bot/app.ts` | `availableRuntimes` 252 |
| UI provider health | same | 287-313 |
| UI picker | same | `uniqueProviderRuntimes` 411-415, `providerPickerMarkup` 416-438 |
| UI loaders | same | `loadRuntimes` 1853, `loadAll` 1869, `discoverRuntimes` 1886-1889, `testRuntime` 1890-1919, init 2183-2201 |
| i18n dictionaries | `src/ui/i18n.ts` | `en` from 11, `zh-CN` from 585 |
