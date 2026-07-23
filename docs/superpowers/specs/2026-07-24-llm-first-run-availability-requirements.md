# LLM First-Run Availability — Development Requirements

Date: 2026-07-24
Status: Approved for implementation
Branch: `llm/availability`
Base commit: `70d4f120` (main at branch creation, includes the `938443b6`
LLM-discovery-rework merge and the loom retirement)

## 0. Work Location (read first — handed to a separate dev session)

All implementation MUST happen inside this git worktree, nowhere else:

```text
/Users/tusm/Documents/MetaID_Projects/open-agent-connect/.worktrees/llm/availability
```

- Branch `llm/availability` is already checked out there, based directly on
  `main`. Do not rebase onto anything newer without asking; other sessions
  move `main` frequently.
- **Other agents are actively working in sibling worktrees** (the main
  checkout at `/Users/tusm/Documents/MetaID_Projects/open-agent-connect` and
  several `.worktrees/codex/*` directories). Never edit, build, commit, or
  run `git` mutation commands outside the worktree path above.
- Build and test from the worktree root (`npm run build`, scoped
  `node --test …`). The worktree has its own `node_modules`; run `npm ci`
  only if the build proves it incomplete.
- Closeout (per round, from the worktree):

  ```bash
  npm run closeout:eric -- --message "type: summary" \
    --journal "What changed and why." \
    --verify "<scoped verification command>" \
    --stage <file> --stage <file>
  ```

## 1. Background and Problem Statement

Three availability problems, all verified against the base commit:

### P1 — Fresh users create a bot and silently get NO LLM

Creation-time provider defaulting (`selectDefaultMetabotProviders`,
`src/core/bot/metabotProfileManager.ts:257-290`) considers only
`health === 'healthy'` runtimes (`isDefaultSelectableRuntime`, 242-244).
When nothing is healthy it returns `undefined` for both providers **without
an error**; creation proceeds, zero binding rows are written
(`buildProviderBindingWrite` no-op, 681-738), no `/info/llm` pin is
published, and the detected runtime is not even copied into the new
profile's store (carryover loop only runs for selected providers,
`src/daemon/defaultHandlers.ts:1210-1221`). The UI success modal says
nothing about LLM binding; the only trace is the `NO LLM BOUND` sidebar
badge. The post-create auto background sweep targets the host store and
never retro-binds.

### P2 — After a daemon restart, a slow runtime (Codex) stays unusable for minutes

Runtime health only recovers through a successful readiness probe, and
probes fire only on: daemon boot (one sweep, `src/cli/runtime.ts:3293-3305`),
manual Refresh/Test, or the bot page's auto sweep while it is open. A cold
Codex app-server often exceeds its 45 s probe budget → recorded `detected`
→ invisible to the healthy-only resolver
(`src/core/llm/llmRuntimeResolver.ts:125`). Worse, if it was still `healthy`
(skip window), the first real message's cold start overruns the runner's
60 s poll deadline → unconditional `markRuntimeUnavailable`
(`src/core/chat/hostLlmChatReplyRunner.ts:382-386`) → 15-min cooldown —
and nothing re-evaluates the runtime when the cooldown expires (the
resolver never reads `unavailableUntil`; `detected` upserts cannot
overwrite an active cooldown). The only on-demand un-wedge today is the
manual Test button (`testLlmRuntimeReadiness`,
`src/core/llm/llmRuntimeDiscovery.ts:629-722`).

### P3 — First reply after idle is structurally slow

Every chat turn rebuilds the strict skill-isolation scope from scratch:
`fs.mkdtemp` + copy platform home files (`auth.json`, `config.toml` for
codex; `src/core/llm/executor/executor.ts:44-47, 176-258`) + recursive copy
of every allowed skill (`skill-injector.ts:76-112`, whose skip-if-exists
fast path is defeated by the fresh temp root) + a brand-new backend
process + (for codex) a 3-RPC handshake. Nothing is reused across turns.

## 2. Goals and Non-Goals

### 2.1 Goals (in scope)

- **A. Best-probability default binding at creation** — when the user did
  not explicitly request providers, bind the single most likely usable
  provider even if it is not `healthy`; a machine with exactly one LLM must
  always bind it.
- **B. Availability self-healing** — a daemon-side recovery loop with
  exponential backoff that re-probes non-healthy runtimes and clears
  cooldowns on success; a message-path trigger that starts recovery when
  nothing healthy is selectable; softening of the 60 s poll-deadline wedge.
- **C. Cold-start reduction** — reuse the strict-isolation platform home
  across turns within one profile+provider trust domain.
- **D. Creation outcome feedback** — the create flow reports the LLM
  binding outcome (bound / verifying / none found) in en + zh-CN.

### 2.2 Non-Goals (explicitly out of scope)

- Warm backend process pools, codex app-server reuse across turns, thread
  resume.
- Silent post-hoc binding for ALREADY-created unbound bots (retro-repair).
  This branch only fixes binding at creation time and runtime health.
- Changing the healthy-only gate for **user-explicit** provider requests
  (create or edit): explicit intent keeps failing loudly.
- Changing `llmRuntimeResolver`'s healthy-only selection at message time.
- The previously recorded minor nits from the discovery-rework acceptance
  (fast-sweep poll fallback, `missedBinaryNames` dedupe, etc.).

## 3. Detailed Requirements

### 3.1 R1 — Best-probability default binding (A)

Current anchors: `metabotProfileManager.ts:234-305` (ranking helpers),
`defaultHandlers.ts:1132-1248` (preferred-provider resolution, defaulting,
carryover), `defaultHandlers.ts:1460-1491` (validation gate).

1. Add an availability ranking for runtimes, used ONLY by the system
   default selection path (never by explicit requests, never by the
   message-path resolver):
   - tier 0: `healthy`
   - tier 1: `detected` with `authState === 'authenticated'`
   - tier 2: `detected` (any other auth state)
   - tier 3: `degraded`
   - tier 4: `unavailable` (prefer the most recently active one)
   `custom` providers stay excluded. Within a tier, keep the existing
   `compareRuntimeActivityPreference` ordering.
2. `selectDefaultMetabotProviders` gains a best-effort mode used when the
   caller did not explicitly request providers: primary = best candidate
   across all tiers (a `preferredProvider` host hint still wins when it
   has any candidate at any tier); fallback = best candidate from a
   different provider, if any. A machine with exactly one runtime at any
   health tier MUST yield that provider as primary.
3. A requested host (`body.host` / `METABOT_HOST` / `OAC_HOST`) that has NO
   runtime candidate at any tier keeps throwing
   `RequestedMetabotHostUnavailableError`; a requested host with a
   candidate at tiers 1-4 is now selected (previously this threw).
4. Track selection origin: system-selected providers must be distinguish-
   able from user-explicit ones so that
   `validateMetabotProviderAvailability` (1460-1491) enforces the
   healthy gate ONLY for user-explicit providers. System-selected
   providers skip the healthy requirement.
5. The carryover loop (`defaultHandlers.ts:1210-1221`) upserts the
   selected runtime into the new profile's store at ANY tier (today it is
   only reached for healthy selections).
6. Binding writes (`buildProviderBindingWrite`,
   `metabotProfileManager.ts:681-738`, and `selectRuntimeForProvider`,
   246-255): add a best-tier runtime selector mirroring the ranking in
   item 1 for system-selected bindings; keep the throwing healthy-only
   selector for explicit bindings. Binding rows for a non-healthy runtime
   are valid and expected after this change.
7. Chain write semantics are unchanged: `/info/llm` publishes the chosen
   provider names regardless of tier.

### 3.2 R2 — Presence scan when candidate stores are empty (A)

1. In `resolveDefaultMetabotCreateProviders` (defaultHandlers.ts:1162-1224):
   when the merged candidate set (target store + source store) contains
   ZERO runtimes — the fresh-install case where no sweep has ever run —
   perform ONE bounded discovery before concluding anything.
2. This create-time discovery runs with readiness probes SKIPPED: add an
   option (e.g. `skipReadinessProbe: true`) to `discoverLlmRuntimes` /
   `discoverProvider` so each present binary yields a `detected` runtime
   after the version probe only. Absent providers fail fast in the version
   probe, so the whole scan stays in the seconds range.
3. Selection (R1) then runs over the scan results; the chosen runtime is
   carried into the profile store per R1.5.
4. The create-time scan must not mark any previously known runtime
   unavailable and must not run the missing-runtime retirement pass.

### 3.3 R3 — Post-create upgrade probe + binding outcome (A/D)

1. After a creation whose binding landed on a non-healthy provider (tiers
   1-4), the daemon fires ONE targeted readiness probe for the bound
   runtime(s) in the new profile's store — background, fire-and-forget,
   using `testLlmRuntimeReadiness` or an equivalent single-runtime probe,
   serialized with any in-flight sweep on that store (the
   `runTrackedLlmDiscoverySweep` chain from the discovery rework).
2. Probe success flips the runtime to `healthy` (the existing merge clears
   `healthReason`/`unavailableUntil`); failure leaves it for the recovery
   loop (R4).
3. The `createProfile` response gains a machine-readable binding outcome:

   ```ts
   data.llmBinding: {
     primaryProvider?: string;
     fallbackProvider?: string;
     status: 'healthy' | 'pending' | 'none';
     reason?: string;   // healthReason of the bound runtime when pending
   }
   ```

   (`'none'` = no candidate at any tier even after the R2 scan.)
4. The post-create auto background sweep in the bot UI currently sweeps
   the host store; keep that, and make the targeted probe in item 1 cover
   the new profile's store so the new bot's own runtime copy is what gets
   upgraded.

### 3.4 R4 — Daemon availability recovery loop (B)

1. New module `src/core/llm/llmAvailabilityRecovery.ts` with injected
   dependencies (store factory, readiness probe, clock, logger) for
   testability, wired into daemon startup next to the boot sweep
   (`src/cli/runtime.ts:3293-3305`).
2. Every 60 s, scan: the host home store AND every indexed profile store.
   Candidates per store: runtimes with `health` `detected`/`degraded`, or
   `unavailable` whose `unavailableUntil` is missing or expired.
3. Per-runtime exponential backoff (in-memory, keyed by runtime id):
   first retry 1 min after the last failed probe, doubling to a 30-min
   cap; reset when the runtime becomes `healthy`. `healthCheckedAt` is the
   persisted reference timestamp; the failure counter is in-memory only.
4. Probe budget: at most 2 concurrent probes globally and 1 per store per
   cycle; skip a store's cycle entirely while a discovery sweep is running
   on it (`llmDiscoveryStatusForHomeDir(homeDir).running === true`).
5. Each probe = `testLlmRuntimeReadiness(runtime)`; upsert the result.
   Success flips `healthy` and clears any active cooldown through the
   existing merge semantics.
6. Kill switch: `METABOT_LLM_AVAILABILITY_RECOVERY_DISABLED=1` disables
   the loop (tests set it unless exercising the loop). All sleeps use the
   injected clock.

### 3.5 R5 — Message-path recovery trigger (B)

Current anchors: `hostLlmChatReplyRunner.ts:301-398` (tryExecute),
483-484 (template fallback / skip).

1. Add an optional injected dependency to `createHostLlmChatReplyRunner`,
   e.g. `requestAvailabilityRecovery?: (input: { metaBotSlug: string }) => void`.
2. Fire it (fire-and-forget, never awaited) when a turn finds NO
   selectable runtime (resolver returned null on every attempt) — i.e.
   exactly the situations that today end in a silent template fallback.
3. The daemon wires it to the R4 recovery loop ("probe this profile's
   bound providers soon"), scoped to the acting profile's store.
4. Behavior when the callback is absent (tests, CLI) is unchanged.

### 3.6 R6 — Soften the poll-deadline wedge (B)

Current anchor: `hostLlmChatReplyRunner.ts:382-386` — poll-deadline expiry
ALWAYS calls `markRuntimeUnavailable`.

1. Track consecutive poll-deadline timeouts per runtime id (in-memory,
   per runner instance).
2. First consecutive poll-deadline for a runtime that was `healthy` when
   selected: exclude it for this turn and clear the sticky preference, but
   DO NOT mark it unavailable (a cold start is not a death certificate).
3. Second consecutive poll-deadline for the same runtime: mark
   unavailable as today. Any successful completion resets the counter.
4. All other failure modes keep today's behavior (they already do not
   mark in the daemon path).

### 3.7 R7 — Strict-isolation scope reuse (C)

Current anchors: `executor.ts:44-47` (platform home file list), 148-174
(env repointing), 176-258 (scope creation), `skill-injector.ts:76-112`.

1. Cache the strict-isolation scope root per
   `(metaBotSlug, provider, skillAllowlistHash, platformHomeFingerprint)`
   under a stable cache directory inside the profile's sessions root
   (instead of a fresh `fs.mkdtemp` per turn).
2. On a cache hit: skip the platform-home copies when the fingerprint
   (path + size + mtime of each source file, e.g. `auth.json`,
   `config.toml`) is unchanged, and let the skill injector's existing
   skip-if-exists fast path actually skip (destination now persists).
3. On fingerprint or allowlist change: rebuild the scope. Evict with a
   small LRU cap (8 scopes). Remove a profile's scopes when the profile
   is deleted (hook the existing profile-delete path).
4. Document the trust boundary in a comment: reuse is limited to the same
   profile + provider + allowlist domain; the env repointing behavior
   (148-174) is unchanged, and source-home providers
   (`STRICT_ISOLATION_SOURCE_HOME_PROVIDERS`) are unaffected.
5. Per-turn temp artifacts that must stay per-turn (session output files)
   keep living in per-turn locations; only the prepared HOME scope is
   reused.

### 3.8 R8 — Creation outcome feedback (D)

Current anchors: `app.ts:2022-2037` (create modal), 2177-2193
(`createMetabot`), 2185-2192 (success render).

1. After a successful create, the success view renders the LLM binding
   outcome from the response's `llmBinding` (R3.3):
   - `healthy`: `bot.createLlmBound` with the provider name;
   - `pending`: `bot.createLlmPending` + `bot.createLlmPendingHint`;
   - `none`: `bot.createLlmNone` + `bot.createLlmNoneHint`.
2. No blocking UI: the pending state is informational; the R3 background
   probe and R4 loop do the work. Do not add new polling to the create
   modal.
3. New i18n keys (both dictionaries, exact copy):

   | key | en | zh-CN |
   |---|---|---|
   | `bot.createLlmBound` | `LLM bound: {provider}` | `已绑定 LLM：{provider}` |
   | `bot.createLlmPending` | `Selected {provider} — verifying availability…` | `已选择 {provider}，正在验证可用性…` |
   | `bot.createLlmPendingHint` | `It becomes usable automatically once ready; you can also test it under LLM runtimes.` | `就绪后会自动可用，也可在 LLM 运行时中手动测试。` |
   | `bot.createLlmNone` | `No LLM discovered on this machine yet — detecting in the background.` | `本机暂未发现 LLM，已在后台检测。` |
   | `bot.createLlmNoneHint` | `Bind one later from the bot settings page.` | `稍后可在 Bot 设置页面绑定。` |

## 4. Test Requirements

Repo rules: build before tests; `--test-concurrency=1`;
`tests/cli/runtime.test.mjs` last; temp dirs only via
`tests/helpers/tempRoots.mjs`. Test tiers are defined in
`scripts/run-test-suite.mjs`; new slow/discovery-heavy files belong in its
`INTEGRATION_FILES` allowlist, NOT the fast tier.

Add coverage for:

1. Selection ranking (`tests/bot/` or the existing manager test file):
   tier ordering (healthy > detected-authed > detected > degraded >
   unavailable), single-runtime machine binds it at any tier, preferred
   host wins at any tier, fallback from a different provider.
2. Handler create tests (`tests/daemon/defaultBotHandlers.test.mjs`):
   zero-healthy creation binds the best detected candidate and copies it
   into the profile store; explicit-request healthy gate unchanged
   (including `requested_host_unavailable` when no candidate exists at
   all); R2 presence scan fires only when both stores are empty and never
   retires known runtimes; `llmBinding` response shape for
   healthy/pending/none.
3. Upgrade probe: a create with a pending binding schedules exactly one
   targeted probe for the profile store; success flips the stored runtime
   healthy.
4. Recovery loop (`tests/llm/llmAvailabilityRecovery.test.mjs`, likely
   integration tier): backoff schedule (1→2→4…→30 min cap, reset on
   healthy), cooldown-expired `unavailable` becomes a candidate,
   skip-while-sweep-running, concurrency caps, kill switch.
5. Runner tests (`tests/chat/hostLlmChatReplyRunner.test.mjs`): no
   selectable runtime fires `requestAvailabilityRecovery` exactly once per
   turn and still falls back; first poll-deadline does NOT mark
   unavailable, second consecutive does, success resets.
6. Executor scope reuse (`tests/llm/llmExecutorCore.test.mjs` or new):
   cache hit skips platform-home copies and skill copies; fingerprint
   change rebuilds; allowlist change rebuilds; LRU eviction.
7. UI tests (`tests/ui/botPageScript.test.mjs`): three create-outcome
   states render with the new copy; i18n parity for the 5 new keys.

## 5. Verification Plan

```bash
npm run build && npm run build:skillpacks
# scoped files touched by the round
node --test tests/daemon/defaultBotHandlers.test.mjs
node --test tests/chat/hostLlmChatReplyRunner.test.mjs
node --test tests/llm/llmAvailabilityRecovery.test.mjs   # if added
node --test tests/llm/llmExecutorCore.test.mjs
node --test tests/ui/botPageScript.test.mjs
npm run test:fast        # default pre-merge suite
npm test                 # full suite (fast + integration): REQUIRED —
                         # shared runtime behavior + executor changes
git diff --check
```

Manual acceptance (fresh-user scenario, API level):

1. Seed an isolated home with one WorkBuddy runtime at `detected`
   (timeout reason); create a bot via `POST /api/bot/profiles` (no
   provider fields): the response's `llmBinding.status` is `pending` with
   `primaryProvider: 'workbuddy'`; the profile store now contains the
   runtime; a targeted probe follows and (with WorkBuddy installed)
   flips it `healthy` — the bot can then answer a chat turn via the LLM.
2. Repeat with zero runtimes in both stores: creation triggers the
   presence scan and binds WorkBuddy (`pending` → `healthy`).
3. Recovery loop: force Codex (or a fixture runtime) into `unavailable`
   with an expired `unavailableUntil`; observe the loop re-probe it on
   schedule and clear the state on success.
4. Create modal shows the three outcome states per R8.

## 6. Implementation Constraints

- English code comments and tests; UI copy through `src/ui/i18n.ts` with
  `en` + `zh-CN` in sync.
- Surgical changes only — every changed line traces to a requirement
  here. No drive-by refactors.
- Do not touch files outside this requirements' blast radius; in
  particular do NOT modify `llmRuntimeResolver`'s healthy-only selection,
  the explicit-request validation gate, or the loom-retired areas.
- `runtimes.json` format unchanged; recovery backoff state is in-memory.
- Suggested commit rounds (each closed out per §0):
  1. R1 + R2 + R3 (creation binding + scan + upgrade probe) with tests;
  2. R4 + R5 + R6 (recovery loop, message trigger, wedge softening) with
     tests;
  3. R7 (scope reuse) with tests;
  4. R8 (UI + i18n) with tests, then skillpack resync if mirrors drift.
- Merge back with `git merge --no-ff` after acceptance.

## 7. Key Code Anchors (verified at base `70d4f120`)

| Area | File | Lines / symbols |
|---|---|---|
| Default provider selection | `src/core/bot/metabotProfileManager.ts` | `selectDefaultMetabotProviders` 257-290, `isDefaultSelectableRuntime` 242-244, `compareRuntimeActivityPreference` 234-240, `selectRuntimeForProvider` 246-255, `resolveCreateProviderSelection` 292-305 |
| Binding write | same | `buildProviderBindingWrite` 681-738, `buildMetabotInfoPublishTargets` 912-1002 (`/info/llm` 976-985) |
| Create-time defaulting | `src/daemon/defaultHandlers.ts` | `resolveDefaultMetabotCreateProviders` 1162-1224, `applyDefaultMetabotCreateProviders` 1226-1248, carryover 1210-1221 |
| Validation gate | same | `validateMetabotProviderAvailability` 1460-1491 |
| createProfile handler | same | 14968-15115 |
| Bot runtime handlers | same | discoverRuntimes/testRuntime 15453-15496 |
| Discovery | `src/core/llm/llmRuntimeDiscovery.ts` | `discoverProvider` 533-627, `defaultRuntimeReadinessProbe` 469-531, `testLlmRuntimeReadiness` 629-722, skip window 93-103 |
| Probe hints | `src/core/platform/platformRegistry.ts` | e.g. codex 143, workbuddy 430 |
| Resolver gate | `src/core/llm/llmRuntimeResolver.ts` | `isSelectable` 125, `markRuntimeUnavailable` 219-226 |
| Chat runner | `src/core/chat/hostLlmChatReplyRunner.ts` | constants 15-17, tryExecute 307-398, poll-deadline mark 382-386, fallback 483-484, sticky 420-434 |
| Executor isolation | `src/core/llm/executor/executor.ts` | file list 44-47, env repoint 148-174, scope 176-258, runSession 401-492 |
| Skill injection | `src/core/llm/executor/skill-injector.ts` | 76-112 |
| Daemon boot sweep | `src/cli/runtime.ts` | 3293-3305 |
| UI create flow | `src/ui/pages/bot/app.ts` | create modal 2022-2037, `createMetabot` 2177-2193, auto sweep 1972-1984 |
| Test tiers | `scripts/run-test-suite.mjs` | `INTEGRATION_FILES` allowlist |
