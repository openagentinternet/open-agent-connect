# LLM First-Run Availability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make fresh MetaBot creations bind the best available LLM (even when nothing is `healthy`), add daemon-side availability self-healing, cut chat cold-start cost via scope reuse, and surface the binding outcome in the create UI.

**Architecture:** Spec: `docs/superpowers/specs/2026-07-24-llm-first-run-availability-requirements.md` (requirements R1-R8, anchors verified at base `70d4f120`). Four commit rounds: (1) R1+R2+R3 creation binding/scan/upgrade probe, (2) R4+R5+R6 recovery loop + chat-runner changes, (3) R7 strict-isolation scope reuse, (4) R8 UI + i18n + skillpack resync.

**Tech Stack:** TypeScript strict → `dist/` via `npm run build`; tests are `node --test` `.mjs` files that `createRequire` from `dist` (build before tests); temp dirs only via `tests/helpers/tempRoots.mjs`; per-round closeout via `npm run closeout:eric`.

**Worktree rules (from spec §0):** work only inside `/Users/tusm/Documents/MetaID_Projects/open-agent-connect/.worktrees/llm/availability`; never touch sibling worktrees; no git mutations outside this worktree.

**Test harness facts (verified):**
- `tests/daemon/defaultBotHandlers.test.mjs`: builds handlers via `createDefaultMetabotDaemonHandlers({ homeDir, systemHomeDir, identitySyncStepDelayMs: 0, getDaemonRecord: () => null, ...makeChainedCreateOverrides(writeCalls) })`; seeds runtime stores with `createLlmRuntimeStore(homeDir).write({ version: 1, runtimes: [...] })`; `runtime(provider, id, health = 'healthy')` fixture at file top; homes via `createProfileHome('metabot-default-bot-handlers-', 'active-bot')` + `deriveSystemHome(homeDir)` + `t.after(cleanupProfileHome)`; target profile store path is `path.join(systemHomeDir, '.metabot', 'profiles', '<slug>')`.
- `tests/chat/hostLlmChatReplyRunner.test.mjs`: pure in-memory fakes; `createFakeRuntimeResolver(runtime, calls)` records `markRuntimeUnavailable` calls; fake executor `{ execute: async () => 'llm-session-N', getSession: async (sessionId) => ({ sessionId, status: 'running' }) }` for hangs; `pollIntervalMs: 1`, `timeoutMs: 10` for deadline tests; template fallback asserted via `result.state === 'reply'` + `/Thanks for/`; `makeInput()` builds `ChatReplyRunnerInput`.
- `tests/llm/llmExecutorCore.test.mjs`: `new LlmExecutor({ sessionsRoot, transcriptsRoot, skillsRoot, systemHomeDir?, env?, backends: { codex: () => ({ provider: 'codex', async execute(request) { ... } }) } })`; roots via `mkdtempTempRoot('metabot-llm-executor-')`; assertions inside the fake backend's `execute` (`request.env.HOME`, `request.cwd`); completion via `collectEvents(executor.streamEvents(sessionId))` then `getSession`.
- `tests/ui/botPageScript.test.mjs`: `vm.runInNewContext(buildBotPageDefinition().script, context)` with selector-keyed fake DOM; `context.createMetabot()` called directly; modal markup asserted on the `{ innerHTML }` sink under `'[data-modal="add-metabot"]'`; `context.loadProfiles = () => Promise.resolve()` stubbed after eval; zh via `zhI18nWindow()`.
- `tests/ui/i18n.test.mjs`: `requiredBotKeys` loop asserts presence + non-empty in both dictionaries; zh-CN Bot copy must not contain `机器人`.
- Discovery tests (`tests/llm/llmProviderExpansion.test.mjs`): stub binaries in a temp `bin/` dir (`writeFile` `#!/bin/sh\necho "name 1.2.3"\n` + `chmod 0o755`), `discoverLlmRuntimes({ env: { PATH: binDir }, now: ..., readinessProbe: async () => ({ ok: true, output: 'OK' }) })`, wrapped in `withDefaultExecutablePathsDisabled`.

---

## Round 1 (R1 + R2 + R3): creation binding, presence scan, upgrade probe

### Task 1: Availability ranking + best-effort default selection (manager)

**Files:**
- Modify: `src/core/bot/metabotProfileManager.ts:234-305`
- Test: `tests/bot/metabotProfileManager.test.mjs`

- [ ] **Step 1: Write the failing tests**

Add to `tests/bot/metabotProfileManager.test.mjs`. The file already has a `runtime(provider, id, health = 'healthy')` fixture (~lines 43-57) and requires `../../dist/core/bot/metabotProfileManager.js`; extend the destructure to include `selectDefaultMetabotProviders, selectBestRuntimeForProvider, runtimeAvailabilityTier`. Tests:

```js
test('selectDefaultMetabotProviders ranks availability tiers ahead of activity', () => {
  const older = '2026-05-01T00:00:00.000Z';
  const newer = '2026-05-06T00:00:00.000Z';
  // tier 1 (detected+authenticated) beats tier 2 (detected other auth) despite age.
  const tier1 = { ...runtime('codex', 'runtime-codex', 'detected'), authState: 'authenticated', lastSeenAt: older, updatedAt: older };
  const tier2 = { ...runtime('workbuddy', 'runtime-workbuddy', 'detected'), authState: 'unknown', lastSeenAt: newer, updatedAt: newer };
  const selection = selectDefaultMetabotProviders({ runtimes: [tier2, tier1] });
  assert.equal(selection.primaryProvider, 'codex');
  assert.equal(selection.fallbackProvider, 'workbuddy');
});

test('selectDefaultMetabotProviders prefers detected over degraded and degraded over unavailable', () => {
  const detected = runtime('codex', 'runtime-codex', 'detected');
  const degraded = runtime('claude-code', 'runtime-claude', 'degraded');
  const unavailable = runtime('gemini', 'runtime-gemini', 'unavailable');
  const selection = selectDefaultMetabotProviders({ runtimes: [unavailable, degraded, detected] });
  assert.equal(selection.primaryProvider, 'codex');
  assert.equal(selection.fallbackProvider, 'claude-code');
  const noDetected = selectDefaultMetabotProviders({ runtimes: [unavailable, degraded] });
  assert.equal(noDetected.primaryProvider, 'claude-code');
});

test('selectDefaultMetabotProviders binds the single runtime of a one-runtime machine at any tier', () => {
  const only = runtime('workbuddy', 'runtime-workbuddy', 'unavailable');
  const selection = selectDefaultMetabotProviders({ runtimes: [only] });
  assert.equal(selection.primaryProvider, 'workbuddy');
  assert.equal(selection.fallbackProvider, undefined);
});

test('selectDefaultMetabotProviders keeps the preferred provider when it has a candidate at any tier', () => {
  const healthy = runtime('claude-code', 'runtime-claude', 'healthy');
  const degradedPreferred = runtime('codex', 'runtime-codex', 'degraded');
  const selection = selectDefaultMetabotProviders({
    runtimes: [healthy, degradedPreferred],
    preferredProvider: 'codex',
  });
  assert.equal(selection.primaryProvider, 'codex');
  assert.equal(selection.fallbackProvider, 'claude-code');
});

test('selectDefaultMetabotProviders prefers the most recently active unavailable runtime within tier 4', () => {
  const older = { ...runtime('codex', 'runtime-codex', 'unavailable'), lastSeenAt: '2026-05-01T00:00:00.000Z', updatedAt: '2026-05-01T00:00:00.000Z' };
  const newer = { ...runtime('workbuddy', 'runtime-workbuddy', 'unavailable'), lastSeenAt: '2026-05-06T00:00:00.000Z', updatedAt: '2026-05-06T00:00:00.000Z' };
  const selection = selectDefaultMetabotProviders({ runtimes: [older, newer] });
  assert.equal(selection.primaryProvider, 'workbuddy');
});

test('selectBestRuntimeForProvider returns the best-tier runtime or null', () => {
  const healthy = runtime('codex', 'runtime-codex-healthy', 'healthy');
  const detected = { ...runtime('codex', 'runtime-codex-detected', 'detected'), lastSeenAt: '2026-05-06T00:00:00.000Z', updatedAt: '2026-05-06T00:00:00.000Z' };
  assert.equal(selectBestRuntimeForProvider([detected, healthy], 'codex').id, 'runtime-codex-healthy');
  assert.equal(selectBestRuntimeForProvider([detected], 'codex').id, 'runtime-codex-detected');
  assert.equal(selectBestRuntimeForProvider([], 'codex'), null);
  assert.equal(selectBestRuntimeForProvider([detected], 'custom'), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && node --test tests/bot/metabotProfileManager.test.mjs`
Expected: FAIL — `selectBestRuntimeForProvider`/`runtimeAvailabilityTier` undefined; tier-ranking tests fail (current code drops non-healthy runtimes).

- [ ] **Step 3: Implement ranking + best-effort selection**

In `src/core/bot/metabotProfileManager.ts`, after `compareRuntimeActivityPreference` (line 240), add:

```ts
// Availability tiers for SYSTEM default selection only (spec R1). Lower is
// more likely usable. Explicit provider requests and the message-path
// resolver keep their healthy-only gates; never reuse this there.
export function runtimeAvailabilityTier(runtime: LlmRuntime): number {
  if (runtime.health === 'healthy') return 0;
  if (runtime.health === 'detected' && runtime.authState === 'authenticated') return 1;
  if (runtime.health === 'detected') return 2;
  if (runtime.health === 'degraded') return 3;
  return 4; // unavailable
}

function compareRuntimeAvailabilityPreference(left: LlmRuntime, right: LlmRuntime): number {
  const tierDelta = runtimeAvailabilityTier(left) - runtimeAvailabilityTier(right);
  if (tierDelta !== 0) return tierDelta;
  return compareRuntimeActivityPreference(left, right);
}
```

Delete `isDefaultSelectableRuntime` (lines 242-244; no other callers). After `selectRuntimeForProvider` (keep it unchanged — explicit bindings stay healthy-only), add:

```ts
// Best-tier runtime for a provider across ALL availability tiers (spec R1.6);
// used for system-selected binding rows, which are valid on non-healthy
// runtimes. Returns null when the provider has no candidate at all.
export function selectBestRuntimeForProvider(runtimes: LlmRuntime[], provider: LlmProvider): LlmRuntime | null {
  if (provider === 'custom') return null;
  const candidates = runtimes.filter((runtime) => (
    runtime.provider === provider && runtime.provider !== 'custom'
  )).sort(compareRuntimeAvailabilityPreference);
  return candidates[0] ?? null;
}
```

In `selectDefaultMetabotProviders`, replace the `availableRuntimes` computation (lines 263-265) with:

```ts
  const availableRuntimes = input.runtimes
    .filter((runtime) => runtime.provider !== 'custom')
    .sort(compareRuntimeAvailabilityPreference);
```

Rest of the function is unchanged: a `preferredProvider` present in `availableProviders` still wins (now at any tier, R1.3), fallback is the first provider row different from primary, a single-runtime machine yields that provider as primary.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test tests/bot/metabotProfileManager.test.mjs`
Expected: PASS (whole file).

- [ ] **Step 5: Commit (deferred to round closeout)**

Leave staged for the Round 1 closeout (`closeout:eric` stages named files).

---

### Task 2: Tier-aware binding writes for system-selected providers (manager)

**Files:**
- Modify: `src/core/bot/metabotProfileManager.ts:85-89` (`CreateMetabotFromIdentityInput`), `420-487` (`createMetabotProfile`), `530-577` (`createMetabotProfileFromIdentity`), `681-738` (`buildProviderBindingWrite`)
- Test: `tests/bot/metabotProfileManager.test.mjs`

- [ ] **Step 1: Write the failing tests**

Add to `tests/bot/metabotProfileManager.test.mjs` (uses `createSystemHome()` → `mkdtempTempRoot('oac-metabot-manager-')`, reads bindings via `resolveMetabotPaths(created.homeDir).llmBindingsPath`):

```js
test('createMetabotProfile binds a detected runtime when nothing is healthy', async () => {
  const systemHomeDir = await createSystemHome();
  const targetHomeDir = path.join(systemHomeDir, '.metabot', 'profiles', 'detected-default-bot');
  await createLlmRuntimeStore(targetHomeDir).write({
    version: 1,
    runtimes: [runtime('workbuddy', 'runtime-workbuddy', 'detected')],
  });
  const created = await createMetabotProfile(systemHomeDir, { name: 'Detected Default Bot' });
  assert.equal(created.primaryProvider, 'workbuddy');
  const bindings = JSON.parse(await readFile(resolveMetabotPaths(created.homeDir).llmBindingsPath, 'utf8')).bindings;
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].role, 'primary');
  assert.equal(bindings[0].llmRuntimeId, 'runtime-workbuddy');
});

test('createMetabotProfile still rejects an explicitly requested provider without a healthy runtime', async () => {
  const systemHomeDir = await createSystemHome();
  const targetHomeDir = path.join(systemHomeDir, '.metabot', 'profiles', 'explicit-detected-bot');
  await createLlmRuntimeStore(targetHomeDir).write({
    version: 1,
    runtimes: [runtime('workbuddy', 'runtime-workbuddy', 'detected')],
  });
  await assert.rejects(
    () => createMetabotProfile(systemHomeDir, { name: 'Explicit Detected Bot', primaryProvider: 'workbuddy' }),
    /No available runtime found for provider: workbuddy/,
  );
});
```

(The file already imports `readFile` from `node:fs/promises` and `createLlmRuntimeStore`, `resolveMetabotPaths` — verify at the top and reuse its existing imports/helpers.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && node --test tests/bot/metabotProfileManager.test.mjs`
Expected: FAIL — first test: no binding row (and `primaryProvider` null); second already passes.

- [ ] **Step 3: Implement system-default-aware binding writes**

3a. `CreateMetabotFromIdentityInput` (lines 85-89) gains:

```ts
export interface CreateMetabotFromIdentityInput extends CreateMetabotInput {
  homeDir: string;
  globalMetaId: string;
  mvcAddress: string;
  /** Roles whose provider came from system defaulting (not user request); binding writes for them accept any availability tier. */
  systemDefaultProviderRoles?: Array<'primary' | 'fallback'>;
}
```

3b. `buildProviderBindingWrite` (lines 681-738): add `systemDefaultRoles?: ReadonlySet<'primary' | 'fallback'>` to the input type, and replace the runtime pick at line 715 with:

```ts
    const runtime = input.systemDefaultRoles?.has(update.role)
      ? selectBestRuntimeForProvider(runtimeState.runtimes, update.provider)
      : selectRuntimeForProvider(runtimeState.runtimes, update.provider);
    if (!runtime) continue; // System-selected role whose candidate vanished: skip the row instead of failing creation.
```

3c. `createMetabotProfile` — before the `buildProviderBindingWrite` call (line 478), add:

```ts
  const systemDefaultRoles = new Set<'primary' | 'fallback'>();
  if (input.primaryProvider === undefined && providerSelection.primaryProvider) systemDefaultRoles.add('primary');
  if (input.fallbackProvider === undefined && providerSelection.fallbackProvider) systemDefaultRoles.add('fallback');
```

and pass `systemDefaultRoles` into that call.

3d. `createMetabotProfileFromIdentity` — same, honoring the explicit override from the daemon:

```ts
  const systemDefaultRoles = new Set<'primary' | 'fallback'>(input.systemDefaultProviderRoles ?? []);
  if (!input.systemDefaultProviderRoles) {
    if (input.primaryProvider === undefined && providerSelection.primaryProvider) systemDefaultRoles.add('primary');
    if (input.fallbackProvider === undefined && providerSelection.fallbackProvider) systemDefaultRoles.add('fallback');
  }
```

and pass `systemDefaultRoles` into its `buildProviderBindingWrite` call (line 568).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test tests/bot/metabotProfileManager.test.mjs`
Expected: PASS.

---

### Task 3: `skipReadinessProbe` discovery option (R2)

**Files:**
- Modify: `src/core/llm/llmRuntimeDiscovery.ts:15-28` (`DiscoveryInput`), `533-627` (`discoverProvider`), `805-822` (plumbing)
- Test: `tests/llm/llmProviderExpansion.test.mjs`

- [ ] **Step 1: Write the failing test**

Add to `tests/llm/llmProviderExpansion.test.mjs`, following its stub-binary pattern (`withDefaultExecutablePathsDisabled`, `mkdtempTempRoot`, `chmod 0o755`):

```js
test('runtime discovery with skipReadinessProbe yields detected runtimes after the version probe only', async () => {
  await withDefaultExecutablePathsDisabled(async () => {
    const tempRoot = await mkdtempTempRoot('oac-provider-discovery-');
    const binDir = path.join(tempRoot, 'bin');
    await mkdir(binDir, { recursive: true });
    const workbuddyPath = path.join(binDir, 'workbuddy');
    await writeFile(workbuddyPath, '#!/bin/sh\necho "workbuddy 1.2.3"\n', 'utf8');
    await chmod(workbuddyPath, 0o755);

    const result = await discoverLlmRuntimes({
      env: { PATH: binDir },
      providers: ['workbuddy'],
      skipReadinessProbe: true,
      now: () => '2026-05-06T00:00:00.000Z',
      readinessProbe: async () => { throw new Error('readiness probe must not run during a presence scan'); },
    });

    assert.equal(result.errors.length, 0);
    assert.equal(result.runtimes.length, 1);
    assert.equal(result.runtimes[0].provider, 'workbuddy');
    assert.equal(result.runtimes[0].health, 'detected');
    assert.equal(result.runtimes[0].version, '1.2.3');
    assert.match(result.runtimes[0].healthReason, /skipped/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test tests/llm/llmProviderExpansion.test.mjs`
Expected: FAIL — `skipReadinessProbe` ignored, so the throwing fake probe surfaces an error/detected-with-different-reason (and the throw proves the probe ran).

- [ ] **Step 3: Implement the option**

3a. `DiscoveryInput` (lines 15-28) gains:

```ts
  /** Presence-scan mode (spec R2): skip readiness probes; each present binary yields a `detected` runtime after the version probe only. */
  skipReadinessProbe?: boolean;
```

3b. `discoverProvider` options type (lines 536-546) gains `skipReadinessProbe?: boolean;`. Inside `discoverProvider`, right after the `canSkipReadinessForKnownRuntime` early-return block (line 586) and before `const readiness = await readinessProbe(...)` (line 587), insert:

```ts
      if (options?.skipReadinessProbe) {
        const checkedAt = (options?.now ?? (() => new Date().toISOString()))();
        return {
          ...runtime,
          health: 'detected',
          healthReason: 'Readiness probe skipped for create-time presence scan.',
          healthCheckedAt: checkedAt,
          updatedAt: checkedAt,
        };
      }
```

3c. `discoverLlmRuntimes` passes it through (in the `discoverProvider(...)` call at lines 811-821): add `skipReadinessProbe: input?.skipReadinessProbe,`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test tests/llm/llmProviderExpansion.test.mjs`
Expected: PASS (whole file).

---

### Task 4: Daemon create defaulting — any-tier host, presence scan, explicit-only gate (R1.3/R1.4/R1.5/R2)

**Files:**
- Modify: `src/daemon/defaultHandlers.ts:1158-1248` (selection/defaulting), `1460-1491` area (gate call site), `14968-15024` (`createProfile`), `11618-11670` (`identity.create`)
- Test: `tests/daemon/defaultBotHandlers.test.mjs`

- [ ] **Step 1: Write the failing tests**

Add to `tests/daemon/defaultBotHandlers.test.mjs` (harness per header facts; `makeChainedCreateOverrides(writeCalls)` supplies signer/subsidy fakes):

```js
test('default bot createProfile binds the best detected provider when nothing is healthy', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-', 'active-bot');
  t.after(async () => { await cleanupProfileHome(homeDir); });
  const systemHomeDir = deriveSystemHome(homeDir);
  await createLlmRuntimeStore(homeDir).write({
    version: 1,
    runtimes: [
      { ...runtime('workbuddy', 'runtime-workbuddy', 'detected'), authState: 'unknown' },
      { ...runtime('codex', 'runtime-codex', 'detected'), authState: 'authenticated', lastSeenAt: '2026-05-01T00:00:00.000Z', updatedAt: '2026-05-01T00:00:00.000Z' },
    ],
  });
  const writeCalls = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    ...makeChainedCreateOverrides(writeCalls),
  });
  const result = await handlers.bot.createProfile({ name: 'Detected Default Bot' });
  assert.equal(result.ok, true);
  assert.equal(result.data.profile.primaryProvider, 'codex'); // tier 1 beats tier 2
  assert.equal(result.data.profile.fallbackProvider, 'workbuddy');
  assert.equal(result.data.llmBinding.status, 'pending');
  assert.equal(result.data.llmBinding.primaryProvider, 'codex');
  const profileRuntimes = await createLlmRuntimeStore(result.data.profile.homeDir).read();
  assert.deepEqual(profileRuntimes.runtimes.map((entry) => entry.id).sort(), ['runtime-codex', 'runtime-workbuddy']);
  const bindings = await createLlmBindingStore(result.data.profile.homeDir).read();
  assert.deepEqual(
    bindings.bindings.map((binding) => [binding.role, binding.llmRuntimeId]).sort(),
    [['fallback', 'runtime-workbuddy'], ['primary', 'runtime-codex']],
  );
});

test('default bot createProfile runs one presence scan only when both stores are empty', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-', 'active-bot');
  t.after(async () => { await cleanupProfileHome(homeDir); });
  const systemHomeDir = deriveSystemHome(homeDir);
  const discoverCalls = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    ...makeChainedCreateOverrides([]),
    discoverLlmRuntimes: async (input) => {
      discoverCalls.push(input);
      return { runtimes: [runtime('workbuddy', 'runtime-workbuddy', 'detected')], errors: [] };
    },
  });
  const result = await handlers.bot.createProfile({ name: 'Presence Scan Bot' });
  assert.equal(result.ok, true);
  assert.equal(discoverCalls.length, 1);
  assert.equal(discoverCalls[0].skipReadinessProbe, true);
  assert.equal(result.data.profile.primaryProvider, 'workbuddy');
  assert.equal(result.data.llmBinding.status, 'pending');
});

test('default bot createProfile does not scan or retire known runtimes when a store already has entries', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-', 'active-bot');
  t.after(async () => { await cleanupProfileHome(homeDir); });
  const systemHomeDir = deriveSystemHome(homeDir);
  await createLlmRuntimeStore(homeDir).write({
    version: 1,
    runtimes: [runtime('workbuddy', 'runtime-workbuddy', 'detected')],
  });
  let discoverCalls = 0;
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    ...makeChainedCreateOverrides([]),
    discoverLlmRuntimes: async () => { discoverCalls += 1; return { runtimes: [], errors: [] }; },
  });
  const result = await handlers.bot.createProfile({ name: 'Known Runtime Bot' });
  assert.equal(result.ok, true);
  assert.equal(discoverCalls, 0);
  assert.equal(result.data.profile.primaryProvider, 'workbuddy');
  const hostRuntimes = await createLlmRuntimeStore(homeDir).read();
  assert.equal(hostRuntimes.runtimes[0].health, 'detected'); // untouched, never retired
});

test('default bot createProfile selects a requested host with a candidate at a non-healthy tier', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-', 'active-bot');
  t.after(async () => { await cleanupProfileHome(homeDir); });
  const systemHomeDir = deriveSystemHome(homeDir);
  await createLlmRuntimeStore(homeDir).write({
    version: 1,
    runtimes: [runtime('gemini', 'runtime-gemini', 'detected')],
  });
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    ...makeChainedCreateOverrides([]),
  });
  const result = await handlers.bot.createProfile({ name: 'Requested Host Bot', host: 'gemini' });
  assert.equal(result.ok, true);
  assert.equal(result.data.profile.primaryProvider, 'gemini');
  assert.equal(result.data.llmBinding.status, 'pending');
});

test('default bot createProfile still rejects an explicit provider without a healthy runtime', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-', 'active-bot');
  t.after(async () => { await cleanupProfileHome(homeDir); });
  const systemHomeDir = deriveSystemHome(homeDir);
  const writeCalls = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    ...makeChainedCreateOverrides(writeCalls),
  });
  const targetHomeDir = path.join(systemHomeDir, '.metabot', 'profiles', 'explicit-detected-bot');
  await createLlmRuntimeStore(targetHomeDir).write({
    version: 1,
    runtimes: [runtime('codex', 'runtime-codex', 'detected')],
  });
  const result = await handlers.bot.createProfile({ name: 'Explicit Detected Bot', primaryProvider: 'codex' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_metabot_profile_create');
  assert.match(result.message, /No healthy runtime found for provider: codex/);
  assert.deepEqual(writeCalls, []);
});

test('default bot createProfile reports llmBinding none when no candidate exists at any tier', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-', 'active-bot');
  t.after(async () => { await cleanupProfileHome(homeDir); });
  const systemHomeDir = deriveSystemHome(homeDir);
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    ...makeChainedCreateOverrides([]),
    discoverLlmRuntimes: async () => ({ runtimes: [], errors: [] }),
  });
  const result = await handlers.bot.createProfile({ name: 'No Llm Bot' });
  assert.equal(result.ok, true);
  assert.equal(result.data.llmBinding.status, 'none');
  assert.equal(result.data.llmBinding.primaryProvider, undefined);
});
```

(The existing `'rejects an unavailable requested host instead of selecting a different provider'` test — PATH emptied, requested `gemini`, only claude seeded — must keep passing: no gemini candidate at any tier even after discovery.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && node --test tests/daemon/defaultBotHandlers.test.mjs`
Expected: FAIL — `llmBinding` missing; detected-only creation binds nothing; `discoverLlmRuntimes` injection unused on the create path; requested detected host throws.

- [ ] **Step 3: Implement the daemon changes (defaultHandlers.ts)**

3a. Delete `hasHealthyMetabotCreateProvider` (lines 1158-1160; no other callers).

3b. Rewrite `resolveDefaultMetabotCreateProviders` (lines 1162-1224) as:

```ts
async function resolveDefaultMetabotCreateProviders(input: {
  homeDir: string;
  sourceHomeDir?: string;
  preferredProvider?: LlmProvider | null;
  primaryProvider?: LlmProvider | null;
  fallbackProvider?: LlmProvider | null;
  discover?: typeof discoverLlmRuntimes;
}): Promise<{ primaryProvider?: LlmProvider | null; fallbackProvider?: LlmProvider | null }> {
  const discover = input.discover ?? discoverLlmRuntimes;
  const targetRuntimeStore = createLlmRuntimeStore(resolveMetabotPaths(input.homeDir));
  const targetRuntimeState = await targetRuntimeStore.read();
  const sourceHomeDir = input.sourceHomeDir ? path.resolve(input.sourceHomeDir) : path.resolve(input.homeDir);
  const sourceRuntimeState = sourceHomeDir === path.resolve(input.homeDir)
    ? targetRuntimeState
    : await createLlmRuntimeStore(resolveMetabotPaths(sourceHomeDir)).read();
  let candidateRuntimes = mergeMetabotCreateRuntimeCandidates(
    targetRuntimeState.runtimes,
    sourceRuntimeState.runtimes,
  );

  // R2: fresh-install presence scan — exactly one bounded probe-less
  // discovery, only when nothing is known at all. Results are merged for
  // selection; nothing here retires or downsamples previously known runtimes.
  if (candidateRuntimes.length === 0) {
    const scan = await discover({
      env: process.env,
      knownRuntimes: [],
      skipReadinessProbe: true,
    });
    candidateRuntimes = mergeMetabotCreateRuntimeCandidates(candidateRuntimes, scan.runtimes);
  }

  const preferredProvider = input.preferredProvider && input.preferredProvider !== 'custom'
    ? input.preferredProvider
    : null;
  if (
    preferredProvider
    && input.primaryProvider === undefined
    && !candidateRuntimes.some((runtime) => runtime.provider === preferredProvider)
  ) {
    const discoveryResult = await discover({
      env: process.env,
      providers: [preferredProvider],
      knownRuntimes: candidateRuntimes,
    });
    candidateRuntimes = mergeMetabotCreateRuntimeCandidates(candidateRuntimes, discoveryResult.runtimes);
  }

  const defaults = selectDefaultMetabotProviders({
    runtimes: candidateRuntimes,
    preferredProvider,
    primaryProvider: input.primaryProvider,
    fallbackProvider: input.fallbackProvider,
  });
  if (
    preferredProvider
    && input.primaryProvider === undefined
    && defaults.primaryProvider !== preferredProvider
  ) {
    throw new RequestedMetabotHostUnavailableError(preferredProvider);
  }

  // R1.5: carry the selected runtime into the new profile's store at ANY
  // tier. System-selected providers use the best-tier selector; explicit
  // requests keep the throwing healthy-only selector (failures surface at
  // the validation gate, so they are swallowed here as before).
  for (const provider of [defaults.primaryProvider, defaults.fallbackProvider]) {
    if (!provider || provider === 'custom') continue;
    const systemSelected = input.primaryProvider !== provider && input.fallbackProvider !== provider;
    try {
      const runtime = systemSelected
        ? selectBestRuntimeForProvider(candidateRuntimes, provider)
        : selectRuntimeForProvider(candidateRuntimes, provider);
      if (!runtime) continue;
      await targetRuntimeStore.upsertRuntime(runtime, { preserveRecentHealthyOnDetected: true });
    } catch (error) {
      if (input.primaryProvider === provider || input.fallbackProvider === provider) {
        continue;
      }
      throw error;
    }
  }

  return defaults;
}
```

(`selectBestRuntimeForProvider` must be added to the existing metabotProfileManager import block; `selectRuntimeForProvider` is already imported.)

3c. `applyDefaultMetabotCreateProviders` (lines 1226-1248) now returns the create input plus the system-defaulted roles:

```ts
async function applyDefaultMetabotCreateProviders(input: {
  createInput: CreateMetabotInput;
  homeDir: string;
  sourceHomeDir?: string;
  preferredProvider?: LlmProvider | null;
  discover?: typeof discoverLlmRuntimes;
}): Promise<{ createInput: CreateMetabotInput; systemDefaultProviderRoles: Array<'primary' | 'fallback'> }> {
  const defaults = await resolveDefaultMetabotCreateProviders({
    homeDir: input.homeDir,
    sourceHomeDir: input.sourceHomeDir,
    preferredProvider: input.preferredProvider,
    primaryProvider: input.createInput.primaryProvider,
    fallbackProvider: input.createInput.fallbackProvider,
    discover: input.discover,
  });
  const systemDefaultProviderRoles: Array<'primary' | 'fallback'> = [];
  const createInput: CreateMetabotInput = { ...input.createInput };
  if (input.createInput.primaryProvider === undefined && defaults.primaryProvider !== undefined) {
    createInput.primaryProvider = defaults.primaryProvider;
    if (defaults.primaryProvider) systemDefaultProviderRoles.push('primary');
  }
  if (input.createInput.fallbackProvider === undefined && defaults.fallbackProvider !== undefined) {
    createInput.fallbackProvider = defaults.fallbackProvider;
    if (defaults.fallbackProvider) systemDefaultProviderRoles.push('fallback');
  }
  return { createInput, systemDefaultProviderRoles };
}
```

3d. `createProfile` handler (14968-15024): capture explicit providers BEFORE defaulting and use the new return shape; pass only explicit providers to the healthy gate (R1.4); thread roles into `createMetabotProfileFromIdentity`:

```ts
        const explicitPrimaryProvider = createInput.primaryProvider;
        const explicitFallbackProvider = createInput.fallbackProvider;
        let systemDefaultProviderRoles: Array<'primary' | 'fallback'> = [];
        try {
          const applied = await applyDefaultMetabotCreateProviders({
            createInput,
            homeDir: profileHomeDir,
            sourceHomeDir: input.homeDir,
            preferredProvider: resolveMetabotCreatePreferredProvider(body),
            discover: input.discoverLlmRuntimes,
          });
          createInput = applied.createInput;
          systemDefaultProviderRoles = applied.systemDefaultProviderRoles;
        } catch (error) {
          ...unchanged...
        }
        ...
        try {
          await validateMetabotProviderAvailability(providerValidationProfile, {
            primaryProvider: explicitPrimaryProvider,
            fallbackProvider: explicitFallbackProvider,
          });
        } catch (error) {
          ...unchanged...
        }
```

and at the `createMetabotProfileFromIdentity` call (15086-15091) add `systemDefaultProviderRoles,` to the object literal.

3e. `identity.create` handler (11618-11670): pass `discover: input.discoverLlmRuntimes` into `resolveDefaultMetabotCreateProviders`, and compute roles for `createMetabotProfileFromIdentity`:

```ts
        const systemDefaultProviderRoles: Array<'primary' | 'fallback'> = [];
        if (defaultProviders.primaryProvider) systemDefaultProviderRoles.push('primary');
        if (defaultProviders.fallbackProvider) systemDefaultProviderRoles.push('fallback');
```

then add `systemDefaultProviderRoles,` to the `createMetabotProfileFromIdentity` object literal.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test tests/daemon/defaultBotHandlers.test.mjs`
Expected: PASS — except the two `llmBinding` assertions, which belong to Task 5 (keep them; they fail until then, or temporarily assert `undefined` and flip in Task 5 — prefer keeping and finishing Task 5 before the round closeout).

---

### Task 5: Post-create upgrade probe + `llmBinding` response (R3)

**Files:**
- Modify: `src/daemon/defaultHandlers.ts` (near 4584 chain helpers; `createProfile` handler success path)
- Test: `tests/daemon/defaultBotHandlers.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
test('default bot createProfile probes a pending binding once and upgrades it when ready', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-', 'active-bot');
  t.after(async () => { await cleanupProfileHome(homeDir); });
  const systemHomeDir = deriveSystemHome(homeDir);
  await createLlmRuntimeStore(homeDir).write({
    version: 1,
    runtimes: [runtime('workbuddy', 'runtime-workbuddy', 'detected')],
  });
  const probeCalls = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    ...makeChainedCreateOverrides([]),
    testLlmRuntimeReadiness: async (entry) => {
      probeCalls.push(entry.id);
      return { ...entry, health: 'healthy', healthReason: undefined, healthCheckedAt: '2026-05-07T00:00:00.000Z' };
    },
  });
  const result = await handlers.bot.createProfile({ name: 'Pending Probe Bot' });
  assert.equal(result.ok, true);
  assert.equal(result.data.llmBinding.status, 'pending');
  // Fire-and-forget probe: poll the profile store until it flips healthy.
  let profileRuntimes;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    profileRuntimes = await createLlmRuntimeStore(result.data.profile.homeDir).read();
    if (profileRuntimes.runtimes[0]?.health === 'healthy') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(profileRuntimes.runtimes[0].health, 'healthy');
  assert.deepEqual(probeCalls, ['runtime-workbuddy']);
});

test('default bot createProfile with a healthy binding reports healthy and schedules no probe', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-', 'active-bot');
  t.after(async () => { await cleanupProfileHome(homeDir); });
  const systemHomeDir = deriveSystemHome(homeDir);
  await createLlmRuntimeStore(homeDir).write({
    version: 1,
    runtimes: [runtime('workbuddy', 'runtime-workbuddy', 'healthy')],
  });
  let probeCalls = 0;
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    ...makeChainedCreateOverrides([]),
    testLlmRuntimeReadiness: async (entry) => { probeCalls += 1; return entry; },
  });
  const result = await handlers.bot.createProfile({ name: 'Healthy Binding Bot' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.llmBinding, { primaryProvider: 'workbuddy', status: 'healthy' });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(probeCalls, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && node --test tests/daemon/defaultBotHandlers.test.mjs`
Expected: FAIL — no `llmBinding` in response; no probe call.

- [ ] **Step 3: Implement R3**

3a. Next to the sweep-chain helpers (~line 4584), add a chain-joining helper and the targeted probe:

```ts
// Joins the same per-store serialization chain as discovery sweeps, so a
// targeted probe never interleaves store writes with an in-flight sweep.
function chainLlmRuntimeStoreTask(homeDir: string, task: () => Promise<unknown>): Promise<unknown> {
  const previous = llmDiscoverySweepChainByHomeDir.get(homeDir) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  llmDiscoverySweepChainByHomeDir.set(homeDir, current);
  return current.finally(() => {
    if (llmDiscoverySweepChainByHomeDir.get(homeDir) === current) {
      llmDiscoverySweepChainByHomeDir.delete(homeDir);
    }
  });
}

// R3: fire-and-forget single-runtime readiness probes for a freshly created
// profile whose binding landed on a non-healthy runtime. Success flips the
// stored runtime healthy through the normal upsert merge; failure leaves it
// for the availability recovery loop (R4).
function schedulePostCreateLlmBindingProbe(input: {
  homeDir: string;
  runtimeIds: string[];
  testReadiness: typeof testLlmRuntimeReadiness;
}): void {
  if (input.runtimeIds.length === 0) return;
  void chainLlmRuntimeStoreTask(input.homeDir, async () => {
    const runtimeStore = createLlmRuntimeStore(resolveMetabotPaths(input.homeDir));
    for (const runtimeId of input.runtimeIds) {
      const state = await runtimeStore.read();
      const runtime = state.runtimes.find((entry) => entry.id === runtimeId);
      if (!runtime || runtime.health === 'healthy') continue;
      const probed = await input.testReadiness(runtime, { env: process.env });
      await runtimeStore.upsertRuntime(probed, { preserveRecentHealthyOnDetected: true });
    }
  }).catch((error) => {
    console.warn('[llm] post-create binding probe failed', error instanceof Error ? error.message : String(error));
  });
}
```

3b. Add the outcome builder near the create-defaulting helpers:

```ts
// R3.3: machine-readable binding outcome for the create response.
async function buildCreateLlmBindingOutcome(input: {
  homeDir: string;
  primaryProvider?: LlmProvider | null;
  fallbackProvider?: LlmProvider | null;
}): Promise<{
  primaryProvider?: string;
  fallbackProvider?: string;
  status: 'healthy' | 'pending' | 'none';
  reason?: string;
}> {
  const primaryProvider = input.primaryProvider ?? null;
  if (!primaryProvider) return { status: 'none' };
  const fallbackProvider = input.fallbackProvider ?? null;
  const runtimeState = await createLlmRuntimeStore(resolveMetabotPaths(input.homeDir)).read();
  const boundProviders = fallbackProvider ? [primaryProvider, fallbackProvider] : [primaryProvider];
  const boundRuntimes = boundProviders
    .map((provider) => selectBestRuntimeForProvider(runtimeState.runtimes, provider))
    .filter((runtime): runtime is LlmRuntime => Boolean(runtime));
  const allHealthy = boundRuntimes.length > 0 && boundRuntimes.every((runtime) => runtime.health === 'healthy');
  const primaryRuntime = boundRuntimes[0];
  return {
    primaryProvider,
    ...(fallbackProvider ? { fallbackProvider } : {}),
    status: allHealthy ? 'healthy' : 'pending',
    ...(!allHealthy && primaryRuntime?.healthReason ? { reason: primaryRuntime.healthReason } : {}),
  };
}
```

3c. In the `createProfile` success path, replace the final `return commandSuccess({...})` (15097-15104) with:

```ts
          const llmBinding = await buildCreateLlmBindingOutcome({
            homeDir: profileHomeDir,
            primaryProvider: profile.primaryProvider,
            fallbackProvider: profile.fallbackProvider,
          });
          if (llmBinding.status === 'pending') {
            const profileBindingState = await createLlmBindingStore(resolveMetabotPaths(profileHomeDir)).read();
            const boundRuntimeIds = [...new Set(profileBindingState.bindings
              .filter((binding) => (
                binding.metaBotSlug === profile.slug
                && binding.enabled
                && (binding.role === 'primary' || binding.role === 'fallback')
              ))
              .map((binding) => binding.llmRuntimeId))];
            schedulePostCreateLlmBindingProbe({
              homeDir: profileHomeDir,
              runtimeIds: boundRuntimeIds,
              testReadiness: input.testLlmRuntimeReadiness ?? testLlmRuntimeReadiness,
            });
          }
          return commandSuccess({
            profile,
            identity,
            chainWrites: [...(bootstrap.sync?.chainWrites ?? []), ...profileChainWrites],
            subsidy: bootstrap.subsidy,
            setup: buildMetabotSetupStatus(identity),
            llmBinding,
            ...(hostPersonaProjection ? { hostPersonaProjection } : {}),
          });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test tests/daemon/defaultBotHandlers.test.mjs`
Expected: PASS (whole file, including Task 4's `llmBinding` assertions).

- [ ] **Step 5: Round 1 closeout**

Run: `npm run test:fast` (default pre-merge suite) — must pass. Then `git diff --check`. Then:

```bash
npm run closeout:eric -- --message "feat: best-effort LLM binding at bot creation" \
  --journal "R1-R3: availability-tiered default provider selection, fresh-install presence scan (skipReadinessProbe), tier-aware binding writes for system-selected providers, explicit-only healthy gate, llmBinding create outcome + post-create upgrade probe." \
  --verify "npm run build && node --test tests/bot/metabotProfileManager.test.mjs && node --test tests/daemon/defaultBotHandlers.test.mjs && node --test tests/llm/llmProviderExpansion.test.mjs" \
  --stage src/core/bot/metabotProfileManager.ts \
  --stage src/core/llm/llmRuntimeDiscovery.ts \
  --stage src/daemon/defaultHandlers.ts \
  --stage tests/bot/metabotProfileManager.test.mjs \
  --stage tests/daemon/defaultBotHandlers.test.mjs \
  --stage tests/llm/llmProviderExpansion.test.mjs \
  --stage docs/superpowers/plans/2026-07-24-llm-first-run-availability.md
```

---

## Round 2 (R4 + R5 + R6): availability recovery loop, message-path trigger, wedge softening

### Task 6: `llmAvailabilityRecovery` module (R4)

**Files:**
- Create: `src/core/llm/llmAvailabilityRecovery.ts`
- Test: `tests/llm/llmAvailabilityRecovery.test.mjs` (new; fast tier — pure fakes + injected clock, no real timers/daemons, so NOT added to `INTEGRATION_FILES`)

- [ ] **Step 1: Write the failing tests**

Create `tests/llm/llmAvailabilityRecovery.test.mjs`:

```js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createLlmAvailabilityRecovery } = require('../../dist/core/llm/llmAvailabilityRecovery.js');

function makeRuntime(id, overrides = {}) {
  return {
    id,
    provider: 'codex',
    displayName: 'Codex',
    binaryPath: '/bin/codex',
    version: '1.0.0',
    authState: 'authenticated',
    health: 'detected',
    capabilities: ['tool-use'],
    lastSeenAt: '2026-05-06T00:00:00.000Z',
    createdAt: '2026-05-06T00:00:00.000Z',
    updatedAt: '2026-05-06T00:00:00.000Z',
    healthCheckedAt: '2026-05-06T00:00:00.000Z',
    ...overrides,
  };
}

function makeFakeStore(initial) {
  const state = { version: 1, runtimes: [...initial] };
  return {
    state,
    async read() { return state; },
    async write(next) { state.version = next.version; state.runtimes = [...next.runtimes]; return state; },
    async upsertRuntime(runtime) {
      const index = state.runtimes.findIndex((entry) => entry.id === runtime.id);
      if (index >= 0) state.runtimes[index] = runtime;
      else state.runtimes.push(runtime);
      state.version += 1;
      return state;
    },
    async removeRuntime(runtimeId) { state.runtimes = state.runtimes.filter((entry) => entry.id !== runtimeId); return state; },
    async markSeen() { return state; },
    async updateHealth(runtimeId, health, options = {}) {
      const runtime = state.runtimes.find((entry) => entry.id === runtimeId);
      if (runtime) {
        runtime.health = health;
        runtime.healthReason = options.reason;
        runtime.healthCheckedAt = options.healthCheckedAt ?? new Date().toISOString();
        runtime.unavailableUntil = options.unavailableUntil;
      }
      return state;
    },
  };
}

const T0 = Date.parse('2026-05-06T00:00:00.000Z');

function makeHarness({ stores, probeResults = [], nowStart = T0, ...options } = {}) {
  const probes = [];
  let nowMs = nowStart;
  const scheduled = [];
  const recovery = createLlmAvailabilityRecovery({
    hostHomeDir: '/host',
    listStoreHomeDirs: async () => Object.keys(stores),
    createRuntimeStore: (homeDir) => stores[homeDir].store ?? stores[homeDir],
    probeRuntime: async (runtime) => {
      probes.push({ runtimeId: runtime.id, at: nowMs });
      const next = probeResults.length > 1 ? probeResults.shift() : probeResults[0];
      const outcome = typeof next === 'function' ? next(runtime) : next;
      return { ...runtime, ...outcome, healthCheckedAt: new Date(nowMs).toISOString(), updatedAt: new Date(nowMs).toISOString() };
    },
    now: () => nowMs,
    setIntervalFn: (callback, intervalMs) => {
      const handle = { intervalMs, unrefCalled: false, unref() { this.unrefCalled = true; } };
      scheduled.push({ callback, handle });
      return handle;
    },
    clearIntervalFn: () => {},
    logWarning: () => {},
    ...options,
  });
  return { recovery, probes, scheduled, advance: (ms) => { nowMs += ms; }, setNow: (ms) => { nowMs = ms; }, getNow: () => nowMs };
}

test('availability recovery probes a detected runtime only after the base backoff', async () => {
  const stores = { '/host': makeFakeStore([makeRuntime('rt-1')]) };
  const { recovery, probes, advance } = makeHarness({ stores });
  advance(30_000);
  await recovery.runOnce();
  assert.equal(probes.length, 0); // healthCheckedAt + 60s not reached
  advance(31_000);
  await recovery.runOnce();
  assert.equal(probes.length, 1);
  recovery.stop();
});

test('availability recovery doubles backoff per failure up to the 30 minute cap', async () => {
  const stores = { '/host': makeFakeStore([makeRuntime('rt-1')]) };
  const { recovery, probes, advance, setNow } = makeHarness({
    stores,
    probeResults: [{ health: 'detected', healthReason: 'still cold' }],
  });
  // Eligibility: now >= healthCheckedAt + (failures === 0 ? 60s : min(60s * 2 ** (failures - 1), 30min)).
  // Waits between consecutive probes: 60s, 60s, 120s, 240s, 480s, 960s, then capped at 1800s.
  const expectedWaitsMs = [60_000, 60_000, 120_000, 240_000, 480_000, 960_000, 1_800_000, 1_800_000];
  setNow(T0);
  for (const waitMs of expectedWaitsMs) {
    const before = probes.length;
    advance(waitMs - 1_000);
    await recovery.runOnce();
    assert.equal(probes.length, before); // not yet eligible
    advance(1_000);
    await recovery.runOnce();
    assert.equal(probes.length, before + 1); // eligible exactly at the boundary
  }
  recovery.stop();
});

test('availability recovery resets the backoff after a successful probe', async () => {
  const stores = { '/host': makeFakeStore([makeRuntime('rt-1')]) };
  let outcome = { health: 'detected', healthReason: 'cold' };
  const { recovery, probes, advance, setNow, getNow } = makeHarness({
    stores,
    probeResults: [() => outcome],
  });
  setNow(T0 + 60_000);
  await recovery.runOnce(); // probe 1 fails -> failures = 1
  assert.equal(probes.length, 1);
  advance(60_000);
  await recovery.runOnce(); // probe 2 fails -> failures = 2 (next wait 240s)
  assert.equal(probes.length, 2);
  outcome = { health: 'healthy' };
  advance(240_000);
  await recovery.runOnce(); // probe 3 succeeds -> backoff reset
  assert.equal(probes.length, 3);
  assert.equal(stores['/host'].state.runtimes[0].health, 'healthy');
  // A later sweep marks the runtime detected again; eligibility is the base
  // 60s again, not the pre-reset 480s.
  stores['/host'].state.runtimes[0].health = 'detected';
  stores['/host'].state.runtimes[0].healthCheckedAt = new Date(getNow()).toISOString();
  advance(60_000);
  await recovery.runOnce();
  assert.equal(probes.length, 4);
  recovery.stop();
});

test('availability recovery treats an expired-cooldown unavailable runtime as a candidate and clears it on success', async () => {
  const expired = makeRuntime('rt-1', {
    health: 'unavailable',
    unavailableUntil: '2026-05-06T00:10:00.000Z',
  });
  const stores = { '/host': makeFakeStore([expired]) };
  const { recovery, probes, setNow } = makeHarness({
    stores,
    probeResults: [{ health: 'healthy' }],
  });
  setNow(T0 + 10 * 60_000 + 61_000);
  await recovery.runOnce();
  assert.equal(probes.length, 1);
  assert.equal(stores['/host'].state.runtimes[0].health, 'healthy');
  recovery.stop();
});

test('availability recovery skips an active-cooldown unavailable runtime', async () => {
  const wedged = makeRuntime('rt-1', {
    health: 'unavailable',
    unavailableUntil: '2026-05-06T01:00:00.000Z',
  });
  const stores = { '/host': makeFakeStore([wedged]) };
  const { recovery, probes, setNow } = makeHarness({ stores });
  setNow(T0 + 30 * 60_000);
  await recovery.runOnce();
  assert.equal(probes.length, 0);
  recovery.stop();
});

test('availability recovery skips a store while a discovery sweep is running on it', async () => {
  const stores = { '/host': makeFakeStore([makeRuntime('rt-1')]) };
  const { recovery, probes, setNow } = makeHarness({
    stores,
    isSweepRunning: (homeDir) => homeDir === '/host',
  });
  setNow(T0 + 61_000);
  await recovery.runOnce();
  assert.equal(probes.length, 0);
  recovery.stop();
});

test('availability recovery caps probes at two per cycle across stores and one per store', async () => {
  const stores = {
    '/a': makeFakeStore([makeRuntime('rt-a1'), makeRuntime('rt-a2')]),
    '/b': makeFakeStore([makeRuntime('rt-b1')]),
    '/c': makeFakeStore([makeRuntime('rt-c1')]),
  };
  const { recovery, probes, setNow, advance } = makeHarness({ stores });
  setNow(T0 + 61_000);
  await recovery.runOnce();
  // Global cap 2; store /c waits; store /a contributes only one probe despite
  // two eligible runtimes (oldest healthCheckedAt first).
  assert.deepEqual(probes.map((probe) => probe.runtimeId), ['rt-a1', 'rt-b1']);
  advance(61_000); // T0+122s: rt-a2 (never probed) and rt-b1 (failure backoff 60s) eligible
  await recovery.runOnce();
  assert.deepEqual(probes.map((probe) => probe.runtimeId), ['rt-a1', 'rt-b1', 'rt-a2', 'rt-b1']);
  recovery.stop();
});

test('availability recovery does nothing when disabled', async () => {
  const stores = { '/host': makeFakeStore([makeRuntime('rt-1')]) };
  const { recovery, probes, scheduled, setNow } = makeHarness({ stores, disabled: true });
  setNow(T0 + 61_000);
  await recovery.runOnce();
  assert.equal(probes.length, 0);
  assert.equal(scheduled.length, 0); // no interval scheduled
  recovery.stop();
});

test('availability recovery requestRecovery probes the requested store immediately, ignoring backoff', async () => {
  const stores = { '/host': makeFakeStore([makeRuntime('rt-1')]) };
  const { recovery, probes } = makeHarness({ stores });
  recovery.requestRecovery('/host');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(probes.length, 1);
  recovery.stop();
});

test('availability recovery schedules an unref interval when enabled', async () => {
  const stores = { '/host': makeFakeStore([]) };
  const { recovery, scheduled } = makeHarness({ stores });
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].handle.intervalMs, 60_000);
  assert.equal(scheduled[0].handle.unrefCalled, true);
  recovery.stop();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && node --test tests/llm/llmAvailabilityRecovery.test.mjs`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the module**

Create `src/core/llm/llmAvailabilityRecovery.ts`:

```ts
import { listIdentityProfiles } from '../identity/identityProfiles';
import { testLlmRuntimeReadiness } from './llmRuntimeDiscovery';
import { createLlmRuntimeStore } from './llmRuntimeStore';
import type { LlmRuntimeStore } from './llmRuntimeStore';
import type { LlmRuntime } from './llmTypes';

/**
 * R4 — daemon availability recovery loop.
 *
 * Re-probes non-healthy runtimes on an interval so a runtime that failed
 * once (cold start, transient wedge) becomes selectable again without a
 * manual Test. Candidates per store: `detected`/`degraded`, or `unavailable`
 * whose cooldown (`unavailableUntil`) is missing or expired. Backoff is
 * in-memory only (failures counter keyed by runtime id); the persisted
 * `healthCheckedAt` is the reference timestamp. The runtime store file
 * format is unchanged.
 */

export interface LlmAvailabilityRecoveryOptions {
  hostHomeDir: string;
  systemHomeDir?: string;
  listStoreHomeDirs?: () => Promise<string[]>;
  createRuntimeStore?: (homeDir: string) => LlmRuntimeStore;
  probeRuntime?: (runtime: LlmRuntime) => Promise<LlmRuntime>;
  isSweepRunning?: (homeDir: string) => boolean;
  now?: () => number;
  intervalMs?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  maxConcurrentProbesPerCycle?: number;
  disabled?: boolean;
  setIntervalFn?: (callback: () => void, intervalMs: number) => { unref?: () => void };
  clearIntervalFn?: (handle: { unref?: () => void }) => void;
  logWarning?: (message: string) => void;
}

export interface LlmAvailabilityRecovery {
  runOnce(): Promise<void>;
  /** R5 hook: schedule an out-of-cycle, backoff-ignoring probe for one store (fire-and-forget, deduped). */
  requestRecovery(homeDir: string): void;
  stop(): void;
}

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_BASE_BACKOFF_MS = 60_000;
const DEFAULT_MAX_BACKOFF_MS = 30 * 60_000;
const DEFAULT_MAX_CONCURRENT_PROBES = 2;
const DISABLED_ENV = 'METABOT_LLM_AVAILABILITY_RECOVERY_DISABLED';

function isRecoveryCandidate(runtime: LlmRuntime, nowMs: number): boolean {
  if (runtime.provider === 'custom') return false;
  if (runtime.health === 'detected' || runtime.health === 'degraded') return true;
  if (runtime.health === 'unavailable') {
    if (!runtime.unavailableUntil) return true;
    const untilMs = Date.parse(runtime.unavailableUntil);
    return !Number.isFinite(untilMs) || untilMs <= nowMs;
  }
  return false;
}

function lastCheckedMs(runtime: LlmRuntime): number {
  return Date.parse(runtime.healthCheckedAt ?? '') || Date.parse(runtime.updatedAt ?? '') || 0;
}

export function createLlmAvailabilityRecovery(options: LlmAvailabilityRecoveryOptions): LlmAvailabilityRecovery {
  const disabled = options.disabled ?? process.env[DISABLED_ENV] === '1';
  const now = options.now ?? (() => Date.now());
  const createStore = options.createRuntimeStore ?? ((homeDir: string) => createLlmRuntimeStore(homeDir));
  const probeRuntime = options.probeRuntime ?? ((runtime: LlmRuntime) => testLlmRuntimeReadiness(runtime));
  const isSweepRunning = options.isSweepRunning ?? (() => false);
  const logWarning = options.logWarning ?? ((message: string) => console.warn(message));
  const intervalMs = Math.max(1, Math.floor(options.intervalMs ?? DEFAULT_INTERVAL_MS));
  const baseBackoffMs = options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
  const maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  const maxConcurrent = Math.max(1, Math.floor(options.maxConcurrentProbesPerCycle ?? DEFAULT_MAX_CONCURRENT_PROBES));
  const setIntervalFn = options.setIntervalFn
    ?? ((callback: () => void, ms: number) => setInterval(callback, ms));
  const clearIntervalFn = options.clearIntervalFn
    ?? ((handle: { unref?: () => void }) => clearInterval(handle as unknown as NodeJS.Timeout));

  const failuresByRuntimeId = new Map<string, number>();
  const requestedHomeDirs = new Set<string>();
  let running = false;
  let stopped = false;

  const listHomeDirs = options.listStoreHomeDirs ?? (async () => {
    const homeDirs = [options.hostHomeDir];
    if (options.systemHomeDir) {
      const profiles = await listIdentityProfiles(options.systemHomeDir).catch(() => []);
      for (const profile of profiles) {
        if (profile.homeDir && !homeDirs.includes(profile.homeDir)) homeDirs.push(profile.homeDir);
      }
    }
    return homeDirs;
  });

  function backoffDelayMs(failures: number): number {
    if (failures <= 0) return baseBackoffMs;
    return Math.min(baseBackoffMs * 2 ** (failures - 1), maxBackoffMs);
  }

  function isEligible(runtime: LlmRuntime, nowMs: number): boolean {
    if (!isRecoveryCandidate(runtime, nowMs)) return false;
    const failures = failuresByRuntimeId.get(runtime.id) ?? 0;
    return nowMs >= lastCheckedMs(runtime) + backoffDelayMs(failures);
  }

  async function probeOne(store: LlmRuntimeStore, runtime: LlmRuntime): Promise<void> {
    try {
      const probed = await probeRuntime(runtime);
      // The upsert merge clears healthReason/unavailableUntil on healthy and
      // never lets a detected result overwrite an active cooldown.
      await store.upsertRuntime(probed, { preserveRecentHealthyOnDetected: true });
      if (probed.health === 'healthy') {
        failuresByRuntimeId.delete(runtime.id);
      } else {
        failuresByRuntimeId.set(runtime.id, (failuresByRuntimeId.get(runtime.id) ?? 0) + 1);
      }
    } catch (error) {
      failuresByRuntimeId.set(runtime.id, (failuresByRuntimeId.get(runtime.id) ?? 0) + 1);
      logWarning(`[llm availability recovery] probe failed for ${runtime.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function runStoreCycle(homeDir: string, ignoreBackoff: boolean, budget: { remaining: number }): Promise<void> {
    if (budget.remaining <= 0 || isSweepRunning(homeDir)) return;
    const store = createStore(homeDir);
    const state = await store.read().catch(() => null);
    if (!state) return;
    const nowMs = now();
    const candidate = state.runtimes
      .filter((runtime) => (ignoreBackoff ? isRecoveryCandidate(runtime, nowMs) : isEligible(runtime, nowMs)))
      .sort((left, right) => lastCheckedMs(left) - lastCheckedMs(right))[0];
    if (!candidate) return;
    budget.remaining -= 1;
    await probeOne(store, candidate);
  }

  async function runOnce(): Promise<void> {
    if (disabled || running || stopped) return;
    running = true;
    try {
      const homeDirs = await listHomeDirs();
      const budget = { remaining: maxConcurrent };
      for (const homeDir of homeDirs) {
        if (budget.remaining <= 0) break;
        await runStoreCycle(homeDir, false, budget);
      }
    } catch (error) {
      logWarning(`[llm availability recovery] cycle failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running = false;
    }
  }

  function requestRecovery(homeDir: string): void {
    if (disabled || stopped || !homeDir || requestedHomeDirs.has(homeDir)) return;
    requestedHomeDirs.add(homeDir);
    void (async () => {
      try {
        await runStoreCycle(homeDir, true, { remaining: 1 });
      } catch (error) {
        logWarning(`[llm availability recovery] requested probe failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        requestedHomeDirs.delete(homeDir);
      }
    })();
  }

  const handle = disabled ? null : setIntervalFn(() => { void runOnce(); }, intervalMs);
  handle?.unref?.();

  return {
    runOnce,
    requestRecovery,
    stop() {
      stopped = true;
      if (handle) clearIntervalFn(handle);
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test tests/llm/llmAvailabilityRecovery.test.mjs`
Expected: PASS.

---

### Task 7: Wire the recovery loop into daemon startup (R4.1/R4.4/R4.6)

**Files:**
- Modify: `src/daemon/defaultHandlers.ts:4589` (export `llmDiscoveryStatusForHomeDir`)
- Modify: `src/cli/runtime.ts` (create loop before handlers at 3174; pass trigger into handlers input; stop in `shutdown` at 3517)
- Modify: `tests/cli/runtime.test.mjs:40`, `tests/cli/daemonLifecycle.test.mjs` (kill switch env)

- [ ] **Step 1: Export the sweep-status lookup**

Change `function llmDiscoveryStatusForHomeDir(` (defaultHandlers.ts:4589) to `export function llmDiscoveryStatusForHomeDir(`. Add `requestLlmAvailabilityRecovery?: (input: { homeDir: string; metaBotSlug: string }) => void;` to the `createDefaultMetabotDaemonHandlers` input type (~4716, next to `llmExecutor`).

- [ ] **Step 2: Wire in runtime.ts**

Import: add `llmDiscoveryStatusForHomeDir` to the existing `../daemon/defaultHandlers` import (line 74), and add `import { createLlmAvailabilityRecovery } from '../core/llm/llmAvailabilityRecovery';`.

Immediately after the `llmExecutor` creation (line 3142), insert:

```ts
  // R4: availability self-healing — re-probes non-healthy runtimes on a
  // backoff schedule so a cold/wedged runtime recovers without manual Test.
  const llmAvailabilityRecovery = createLlmAvailabilityRecovery({
    hostHomeDir: homeDir,
    systemHomeDir,
    isSweepRunning: (sweptHomeDir) => llmDiscoveryStatusForHomeDir(sweptHomeDir)?.running === true,
    logWarning: (message) => console.warn(message),
  });
```

In the `createDefaultMetabotDaemonHandlers({...})` input (3174-3210), add:

```ts
    requestLlmAvailabilityRecovery: ({ homeDir: recoveryHomeDir }) => llmAvailabilityRecovery.requestRecovery(recoveryHomeDir),
```

In `shutdown` (next to `serviceRefundSyncLoop.stop();` at 3517), add:

```ts
    llmAvailabilityRecovery.stop();
```

- [ ] **Step 3: Kill switch in daemon-booting tests**

`tests/cli/runtime.test.mjs:40`: after `process.env.METABOT_TEST_SKIP_BACKGROUND_LLM_DISCOVERY = '1';` add `process.env.METABOT_LLM_AVAILABILITY_RECOVERY_DISABLED = '1';`.

`tests/cli/daemonLifecycle.test.mjs`: in every env literal that sets `METABOT_TEST_SKIP_BACKGROUND_LLM_DISCOVERY: '1'` (lines ~159, 204, 224, 277, 349), add `METABOT_LLM_AVAILABILITY_RECOVERY_DISABLED: '1',` alongside.

- [ ] **Step 4: Verify**

Run: `npm run build && node --test tests/llm/llmAvailabilityRecovery.test.mjs && node --test tests/daemon/defaultBotHandlers.test.mjs`
Expected: PASS. (`tests/cli/*` run in the round-2 closeout verification and full suite.)

---

### Task 8: Message-path recovery trigger (R5)

**Files:**
- Modify: `src/core/chat/hostLlmChatReplyRunner.ts:400-486`
- Modify: `src/daemon/defaultHandlers.ts:6278-6292` (guidance runner wiring)
- Modify: `src/cli/runtime.ts:1446-1470` (`createPrivateChatReplyRunnerForProfile`) and 3320 call site
- Test: `tests/chat/hostLlmChatReplyRunner.test.mjs`

- [ ] **Step 1: Write the failing tests**

Add to `tests/chat/hostLlmChatReplyRunner.test.mjs`:

```js
test('host LLM chat runner fires requestAvailabilityRecovery once when no runtime is selectable', async () => {
  const recoveryCalls = [];
  const resolver = {
    async resolveRuntime() { return { runtime: null }; },
    async selectMetaBot() { return null; },
    async markBindingUsed() {},
    async markRuntimeUnavailable() {},
  };
  const runner = createHostLlmChatReplyRunner({
    runtimeResolver: resolver,
    llmExecutor: { async execute() { throw new Error('must not execute'); }, async getSession() { return null; } },
    metaBotSlug: 'alice',
    pollIntervalMs: 1,
    requestAvailabilityRecovery: (input) => { recoveryCalls.push(input); },
  });
  const result = await runner(makeInput());
  assert.equal(result.state, 'reply'); // template fallback still happens
  assert.match(result.content, /Thanks for/);
  assert.deepEqual(recoveryCalls, [{ metaBotSlug: 'alice' }]);
});

test('host LLM chat runner does not fire requestAvailabilityRecovery when a runtime executed', async () => {
  const runtime = makeHealthyRuntime('llm-runtime-ok');
  const recoveryCalls = [];
  let getSessionCalls = 0;
  const runner = createHostLlmChatReplyRunner({
    runtimeResolver: createFakeRuntimeResolver(runtime, {}),
    llmExecutor: {
      async execute() { return 'llm-session-1'; },
      async getSession(sessionId) {
        getSessionCalls += 1;
        if (getSessionCalls === 1) return { sessionId, status: 'running' };
        return { sessionId, status: 'completed', result: { status: 'completed', output: 'Hello there', durationMs: 1 } };
      },
    },
    metaBotSlug: 'alice',
    pollIntervalMs: 1,
    requestAvailabilityRecovery: (input) => { recoveryCalls.push(input); },
  });
  const result = await runner(makeInput());
  assert.equal(result.state, 'reply');
  assert.equal(result.content, 'Hello there');
  assert.deepEqual(recoveryCalls, []);
});

test('host LLM chat runner without requestAvailabilityRecovery behaves as before', async () => {
  const resolver = {
    async resolveRuntime() { return { runtime: null }; },
    async selectMetaBot() { return null; },
    async markBindingUsed() {},
    async markRuntimeUnavailable() {},
  };
  const runner = createHostLlmChatReplyRunner({
    runtimeResolver: resolver,
    llmExecutor: { async execute() { throw new Error('must not execute'); }, async getSession() { return null; } },
    metaBotSlug: 'alice',
    pollIntervalMs: 1,
  });
  const result = await runner(makeInput());
  assert.equal(result.state, 'reply');
  assert.match(result.content, /Thanks for/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && node --test tests/chat/hostLlmChatReplyRunner.test.mjs`
Expected: FAIL — option unknown, `recoveryCalls` stays empty.

- [ ] **Step 3: Implement R5**

3a. `hostLlmChatReplyRunner.ts`: add an attempt tracker type and parameter. Change the `tryExecute` signature to take one more trailing parameter `attemptState: { executed: boolean }`, and set `attemptState.executed = true;` immediately before `const sessionId = await llmExecutor.execute(request);` (line 349).

3b. `createHostLlmChatReplyRunner` options type gains:

```ts
  requestAvailabilityRecovery?: (input: { metaBotSlug: string }) => void;
```

Destructure it near line 410-418: `const requestAvailabilityRecovery = options?.requestAvailabilityRecovery;`. In the returned runner, create `const attemptState = { executed: false };` before the attempt loop, pass it into each `tryExecute(...)` call, and after the loop (before the fallback return at 483-484) add:

```ts
    // R5: nothing was even selectable this turn — nudge availability
    // recovery for this profile (fire-and-forget, never awaited).
    if (!attemptState.executed) {
      try {
        requestAvailabilityRecovery?.({ metaBotSlug: metaBotSlug ?? '' });
      } catch {
        // Best effort only.
      }
    }
```

3c. Daemon wiring — `defaultHandlers.ts:6278-6292`, add to the `createHostLlmChatReplyRunner({...})` call:

```ts
          requestAvailabilityRecovery: ({ metaBotSlug: slug }) => {
            input.requestLlmAvailabilityRecovery?.({ homeDir: profileHomeDir, metaBotSlug: slug });
          },
```

3d. `runtime.ts` — `createPrivateChatReplyRunnerForProfile` input gains `requestAvailabilityRecovery?: (input: { metaBotSlug: string }) => void;` and passes it through in its `createHostLlmChatReplyRunner({...})` call. At the call site (3320-3329), add:

```ts
      requestAvailabilityRecovery: () => llmAvailabilityRecovery.requestRecovery(homeDir),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test tests/chat/hostLlmChatReplyRunner.test.mjs && node --test tests/daemon/defaultBotHandlers.test.mjs`
Expected: PASS.

---

### Task 9: Soften the poll-deadline wedge (R6)

**Files:**
- Modify: `src/core/chat/hostLlmChatReplyRunner.ts:307-398` (`tryExecute`), `400-434` (factory state)
- Test: `tests/chat/hostLlmChatReplyRunner.test.mjs`

- [ ] **Step 1: Update the existing wedge test + add new ones**

The existing test `'host LLM chat runner marks a timed-out runtime unavailable even with strict skill scope'` (~line 919) asserts a mark on the FIRST poll-deadline — it now contradicts R6. Replace it with:

```js
test('host LLM chat runner does not mark a runtime unavailable on the first poll-deadline, marks on the second consecutive one', async () => {
  const runtime = makeHealthyRuntime('llm-runtime-hung');
  const resolverCalls = {};
  const llmExecutor = {
    async execute() { return 'llm-session-hung'; },
    async getSession(sessionId) { return { sessionId, status: 'running' }; },
  };
  const runner = createHostLlmChatReplyRunner({
    runtimeResolver: createFakeRuntimeResolver(runtime, resolverCalls),
    llmExecutor,
    metaBotSlug: 'alice',
    timeoutMs: 10,
    pollIntervalMs: 1,
    allowedChatSkillsResolver: async () => ({
      skills: [], skillSourcePaths: {}, skippedSkills: [], warning: null,
    }),
  });
  const first = await runner(makeInput());
  assert.equal(first.state, 'reply'); // template fallback
  assert.deepEqual(resolverCalls.markRuntimeUnavailable ?? [], []); // a cold start is not a death certificate
  const second = await runner(makeInput());
  assert.equal(second.state, 'reply');
  assert.deepEqual(resolverCalls.markRuntimeUnavailable, ['llm-runtime-hung']); // second consecutive poll-deadline
});

test('host LLM chat runner resets the consecutive poll-deadline counter on a successful completion', async () => {
  const runtime = makeHealthyRuntime('llm-runtime-flaky');
  const resolverCalls = {};
  let hang = true;
  const llmExecutor = {
    async execute() { return hang ? 'llm-session-hung' : 'llm-session-ok'; },
    async getSession(sessionId) {
      if (hang) return { sessionId, status: 'running' };
      return { sessionId, status: 'completed', result: { status: 'completed', output: 'Recovered', durationMs: 1 } };
    },
  };
  const runner = createHostLlmChatReplyRunner({
    runtimeResolver: createFakeRuntimeResolver(runtime, resolverCalls),
    llmExecutor,
    metaBotSlug: 'alice',
    timeoutMs: 10,
    pollIntervalMs: 1,
  });
  await runner(makeInput()); // hang #1 — no mark
  hang = false;
  const recovered = await runner(makeInput());
  assert.equal(recovered.content, 'Recovered');
  hang = true;
  await runner(makeInput()); // hang #2 after success — counter was reset, still no mark
  assert.deepEqual(resolverCalls.markRuntimeUnavailable ?? [], []);
  await runner(makeInput()); // hang #3 consecutive — second consecutive → mark
  assert.deepEqual(resolverCalls.markRuntimeUnavailable, ['llm-runtime-flaky']);
});
```

Also grep the file for other poll-deadline mark expectations (hang-style `getSession` returning only `status: 'running'`) and align them: only the mark-on-first-deadline semantics changed; empty-output and error-status paths are unchanged.

- [ ] **Step 2: Run tests to verify the first fails**

Run: `npm run build && node --test tests/chat/hostLlmChatReplyRunner.test.mjs`
Expected: FAIL — first test still marks on turn one.

- [ ] **Step 3: Implement R6**

3a. `tryExecute` gains one more trailing parameter: `pollDeadlineTimeouts: Map<string, number>`.

3b. Replace the poll-deadline block (lines 382-387) with:

```ts
    excludeRuntimeIds.add(resolved.runtime.id);
    stickyRuntime.onFailure(resolved.runtime.id);
    // R6: a session that outruns the poll deadline is often just a cold
    // start. Only mark the runtime unavailable on the SECOND consecutive
    // poll-deadline; the first one merely excludes it for this turn.
    const consecutiveTimeouts = (pollDeadlineTimeouts.get(resolved.runtime.id) ?? 0) + 1;
    pollDeadlineTimeouts.set(resolved.runtime.id, consecutiveTimeouts);
    if (consecutiveTimeouts >= 2) {
      await resolver.markRuntimeUnavailable(resolved.runtime.id, 'LLM runtime timed out while running chat reply.').catch(() => {});
    }
    return null;
```

3c. In the successful-completion branch (where `stickyRuntime.onSuccess(resolved.runtime.id)` runs, line 359), add `pollDeadlineTimeouts.delete(resolved.runtime.id);`.

3d. In the factory, next to `lastSuccessfulRuntimeId` (line 423), add `const pollDeadlineTimeouts = new Map<string, number>();` and pass it as the final argument in the `tryExecute(...)` call.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test tests/chat/hostLlmChatReplyRunner.test.mjs`
Expected: PASS.

- [ ] **Step 5: Round 2 closeout**

Run: `npm run test:fast` — must pass; `git diff --check`. Then:

```bash
npm run closeout:eric -- --message "feat: LLM availability recovery loop and softer poll-deadline wedge" \
  --journal "R4-R6: daemon availability recovery loop with exponential backoff + kill switch, message-path recovery trigger on no-selectable-runtime turns, poll-deadline wedge softened to mark only on the second consecutive timeout." \
  --verify "npm run build && node --test tests/llm/llmAvailabilityRecovery.test.mjs && node --test tests/chat/hostLlmChatReplyRunner.test.mjs && node --test tests/daemon/defaultBotHandlers.test.mjs" \
  --stage src/core/llm/llmAvailabilityRecovery.ts \
  --stage src/core/chat/hostLlmChatReplyRunner.ts \
  --stage src/daemon/defaultHandlers.ts \
  --stage src/cli/runtime.ts \
  --stage tests/llm/llmAvailabilityRecovery.test.mjs \
  --stage tests/chat/hostLlmChatReplyRunner.test.mjs \
  --stage tests/cli/runtime.test.mjs \
  --stage tests/cli/daemonLifecycle.test.mjs
```

---

## Round 3 (R7): strict-isolation scope reuse

### Task 10: Cache the strict-isolation scope per trust domain

**Files:**
- Modify: `src/core/llm/executor/executor.ts:1-14` (imports), `176-263` (scope helpers), `401-492` (`runSession`), add class members + public `evictStrictIsolationScopesForSlug`
- Modify: `src/daemon/defaultHandlers.ts:4716` (widen `llmExecutor` input type), `15420-15430` (`deleteProfile` hook)
- Test: `tests/llm/llmExecutorCore.test.mjs`, `tests/daemon/defaultBotHandlers.test.mjs`

- [ ] **Step 1: Write the failing tests**

Add to `tests/llm/llmExecutorCore.test.mjs` (harness per header facts; reuse its `runtime` fixture, `mkdtempTempRoot`, `collectEvents`, `pathExists`):

```js
test('LlmExecutor strict skill isolation reuses the scope home across turns of one trust domain', async () => {
  const base = await mkdtempTempRoot('metabot-llm-executor-');
  const originalHome = path.join(base, 'original-home');
  const originalCodexHome = path.join(originalHome, '.codex');
  await fs.mkdir(originalCodexHome, { recursive: true });
  await fs.writeFile(path.join(originalCodexHome, 'auth.json'), '{"token":"codex-auth"}\n', 'utf8');
  await fs.writeFile(path.join(originalCodexHome, 'config.toml'), 'model = "gpt-5.5"\n', 'utf8');
  const homes = [];
  const executor = new LlmExecutor({
    sessionsRoot: path.join(base, 'sessions'),
    transcriptsRoot: path.join(base, 'transcripts'),
    skillsRoot: path.join(base, 'skills'),
    systemHomeDir: originalHome,
    env: { HOME: originalHome, CODEX_HOME: originalCodexHome },
    backends: {
      codex: () => ({
        provider: 'codex',
        async execute(request) {
          homes.push(request.env.HOME);
          return { status: 'completed', output: 'ok', durationMs: 1 };
        },
      }),
    },
  });
  const executeTurn = async () => {
    const sessionId = await executor.execute({
      runtimeId: 'runtime-codex',
      runtime: { ...runtime, provider: 'codex', binaryPath: '/bin/codex' },
      prompt: 'hi',
      metaBotSlug: 'alice',
      skillIsolation: 'strict',
    });
    await collectEvents(executor.streamEvents(sessionId));
    const session = await executor.getSession(sessionId);
    assert.equal(session.result.status, 'completed');
  };
  await executeTurn();
  await executeTurn();
  assert.equal(homes.length, 2);
  assert.equal(homes[0], homes[1]); // same prepared HOME reused
  assert.notEqual(path.resolve(homes[0]), path.resolve(originalHome));
  const cacheRoot = path.join(base, 'sessions', 'skill-scope-cache');
  assert.equal((await fs.readdir(cacheRoot)).length, 1);
  assert.equal(await pathExists(path.join(homes[0], '.codex', 'auth.json')), true);
});

test('LlmExecutor strict skill isolation rebuilds the scope when a platform home file changes', async () => {
  const base = await mkdtempTempRoot('metabot-llm-executor-');
  const originalHome = path.join(base, 'original-home');
  const originalCodexHome = path.join(originalHome, '.codex');
  await fs.mkdir(originalCodexHome, { recursive: true });
  await fs.writeFile(path.join(originalCodexHome, 'auth.json'), '{"token":"codex-auth"}\n', 'utf8');
  const homes = [];
  const executor = new LlmExecutor({
    sessionsRoot: path.join(base, 'sessions'),
    transcriptsRoot: path.join(base, 'transcripts'),
    skillsRoot: path.join(base, 'skills'),
    systemHomeDir: originalHome,
    env: { HOME: originalHome, CODEX_HOME: originalCodexHome },
    backends: {
      codex: () => ({
        provider: 'codex',
        async execute(request) {
          homes.push(request.env.HOME);
          return { status: 'completed', output: 'ok', durationMs: 1 };
        },
      }),
    },
  });
  const executeTurn = async () => {
    const sessionId = await executor.execute({
      runtimeId: 'runtime-codex',
      runtime: { ...runtime, provider: 'codex', binaryPath: '/bin/codex' },
      prompt: 'hi',
      metaBotSlug: 'alice',
      skillIsolation: 'strict',
    });
    await collectEvents(executor.streamEvents(sessionId));
    const session = await executor.getSession(sessionId);
    assert.equal(session.result.status, 'completed');
  };
  await executeTurn();
  const firstHome = homes[0];
  // A marker planted inside the reused scope disappears only on rebuild.
  await fs.writeFile(path.join(firstHome, 'marker.txt'), 'x', 'utf8');
  await new Promise((resolve) => setTimeout(resolve, 5)); // keep mtimes distinct for the fingerprint
  await fs.writeFile(path.join(originalCodexHome, 'auth.json'), '{"token":"rotated"}\n', 'utf8');
  await executeTurn();
  assert.notEqual(homes[1], firstHome);
  assert.equal(await pathExists(path.join(homes[1], 'marker.txt')), false);
  assert.equal(await fs.readFile(path.join(homes[1], '.codex', 'auth.json'), 'utf8'), '{"token":"rotated"}\n');
});

test('LlmExecutor strict skill isolation evicts least-recently-used scopes beyond the cap', async () => {
  // 9 distinct metaBotSlugs -> at most 8 scope dirs under skill-scope-cache,
  // and the first slug's dir is gone.
  const base = await mkdtempTempRoot('metabot-llm-executor-');
  const executor = new LlmExecutor({
    sessionsRoot: path.join(base, 'sessions'),
    transcriptsRoot: path.join(base, 'transcripts'),
    skillsRoot: path.join(base, 'skills'),
    env: { HOME: base },
    backends: { codex: () => ({ provider: 'codex', async execute() { return { status: 'completed', output: 'ok', durationMs: 1 }; } }) },
  });
  for (let index = 0; index < 9; index += 1) {
    const sessionId = await executor.execute({
      runtimeId: 'runtime-codex',
      runtime: { ...runtime, provider: 'codex', binaryPath: '/bin/codex' },
      prompt: 'hi',
      metaBotSlug: `bot-${index}`,
      skillIsolation: 'strict',
    });
    await collectEvents(executor.streamEvents(sessionId));
  }
  const entries = await fs.readdir(path.join(base, 'sessions', 'skill-scope-cache'));
  assert.equal(entries.length, 8);
  assert.equal(entries.some((entry) => entry.includes('bot-0')), false);
});

test('LlmExecutor evictStrictIsolationScopesForSlug removes only that slug scopes', async () => {
  const base = await mkdtempTempRoot('metabot-llm-executor-');
  const executor = new LlmExecutor({
    sessionsRoot: path.join(base, 'sessions'),
    transcriptsRoot: path.join(base, 'transcripts'),
    skillsRoot: path.join(base, 'skills'),
    env: { HOME: base },
    backends: { codex: () => ({ provider: 'codex', async execute() { return { status: 'completed', output: 'ok', durationMs: 1 }; } }) },
  });
  const executeTurn = async (slug) => {
    const sessionId = await executor.execute({
      runtimeId: 'runtime-codex',
      runtime: { ...runtime, provider: 'codex', binaryPath: '/bin/codex' },
      prompt: 'hi',
      metaBotSlug: slug,
      skillIsolation: 'strict',
    });
    await collectEvents(executor.streamEvents(sessionId));
  };
  await executeTurn('alice');
  await executeTurn('bob');
  const cacheRoot = path.join(base, 'sessions', 'skill-scope-cache');
  assert.equal((await fs.readdir(cacheRoot)).length, 2);
  await executor.evictStrictIsolationScopesForSlug('alice');
  const remaining = await fs.readdir(cacheRoot);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].includes('bob'), true);
});
```

And in `tests/daemon/defaultBotHandlers.test.mjs`:

```js
test('default bot deleteProfile evicts strict isolation scopes for the deleted slug', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-', 'active-bot');
  t.after(async () => { await cleanupProfileHome(homeDir); });
  const systemHomeDir = deriveSystemHome(homeDir);
  const writeCalls = [];
  const evicted = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    ...makeChainedCreateOverrides(writeCalls),
    llmExecutor: {
      execute: async () => 'unused',
      getSession: async () => null,
      cancel: async () => undefined,
      listSessions: async () => [],
      streamEvents: async function* () {},
      evictStrictIsolationScopesForSlug: async (slug) => { evicted.push(slug); },
    },
  });
  const created = await handlers.bot.createProfile({ name: 'Scope Evict Bot' });
  assert.equal(created.ok, true);
  const removed = await handlers.bot.deleteProfile({ slug: created.data.profile.slug });
  assert.equal(removed.ok, true);
  assert.deepEqual(evicted, [created.data.profile.slug]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && node --test tests/llm/llmExecutorCore.test.mjs && node --test tests/daemon/defaultBotHandlers.test.mjs`
Expected: FAIL — fresh temp home per turn today (`homes[0] !== homes[1]`), no cache dir, no eviction method.

- [ ] **Step 3: Implement scope reuse**

3a. `executor.ts` imports: add `createHash` from `node:crypto` (keep `randomUUID`).

3b. Add near the strict-isolation constants (after line 53):

```ts
const STRICT_SCOPE_CACHE_DIR_NAME = 'skill-scope-cache';
const STRICT_SCOPE_CACHE_MAX_ENTRIES = 8;
const STRICT_SCOPE_MANIFEST_NAME = 'scope.json';

interface StrictScopeManifest {
  key: string;
  metaBotSlug: string;
  provider: string;
  allowlistHash: string;
  fingerprint: string;
  skillSystemHomeDir: string;
  lastUsedAt: number;
}

interface StrictScopeCacheEntry {
  manifest: StrictScopeManifest;
  root: string;
  cwd: string;
  systemHomeDir: string;
  skillSystemHomeDir: string;
}

function normalizeStrictScopeSlug(value: unknown): string {
  const slug = typeof value === 'string' ? value.trim() : '';
  return slug || 'default';
}

function sanitizeStrictScopeSlugForPath(slug: string): string {
  return slug.replace(/[^a-zA-Z0-9._-]+/g, '_');
}
```

3c. Fingerprint + allowlist hash helpers (module level):

```ts
// Fingerprint of every platform/user home file copied into the scope:
// path + size + mtime of each source file ('missing' when absent). A change
// invalidates the cached scope and forces a rebuild.
async function buildStrictIsolationFingerprint(input: {
  provider: string;
  sourceHome: string;
  baseEnv?: NodeJS.ProcessEnv;
  requestEnv?: Record<string, string>;
}): Promise<string> {
  const parts: string[] = [];
  const sourceEnv = mergeStringEnvValues(input.baseEnv, input.requestEnv);
  const addFile = async (filePath: string) => {
    try {
      const stat = await fs.stat(filePath);
      parts.push(`${filePath}:${stat.size}:${Math.floor(stat.mtimeMs)}`);
    } catch {
      parts.push(`${filePath}:missing`);
    }
  };
  for (const fileName of STRICT_ISOLATION_USER_HOME_FILES[input.provider] ?? []) {
    await addFile(path.join(input.sourceHome, fileName));
  }
  const supportFiles = STRICT_ISOLATION_PLATFORM_HOME_FILES[input.provider] ?? [];
  if (supportFiles.length > 0 && isPlatformId(input.provider)) {
    for (const root of getPlatformSkillRoots(input.provider)) {
      if (root.kind !== 'global') continue;
      const sourceParent = skillRootParent(resolvePlatformSkillRootPath(root, input.sourceHome, sourceEnv));
      for (const fileName of supportFiles) {
        await addFile(path.join(sourceParent, fileName));
      }
    }
  }
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

function buildStrictScopeAllowlistHash(request: LlmExecutionRequest): string {
  const skills = [...(request.skills ?? [])].sort();
  const sourcePaths = Object.entries(request.skillSourcePaths ?? {}).sort(([left], [right]) => left.localeCompare(right));
  return createHash('sha256').update(JSON.stringify({ skills, sourcePaths })).digest('hex').slice(0, 16);
}
```

3d. In `LlmExecutor`: add `private readonly strictScopeCache = new Map<string, StrictScopeCacheEntry>();` and these methods:

```ts
  /**
   * R7 — reuses the prepared strict-isolation HOME across turns within one
   * trust domain: (metaBotSlug, provider, skill allowlist). The platform-home
   * fingerprint guards staleness; a mismatch rebuilds the scope in place.
   * Trust boundary: reuse never crosses profile/provider/allowlist domains,
   * the per-turn env repointing is unchanged, and source-home providers
   * (STRICT_ISOLATION_SOURCE_HOME_PROVIDERS) keep using the real HOME.
   * Per-turn artifacts (session records, transcripts) never live here.
   */
  private async acquireStrictSkillIsolationScope(request: LlmExecutionRequest): Promise<StrictSkillIsolationScope> {
    const provider = request.runtime.provider;
    const metaBotSlug = normalizeStrictScopeSlug(request.metaBotSlug);
    const allowlistHash = buildStrictScopeAllowlistHash(request);
    const key = createHash('sha256').update(`${metaBotSlug}|${provider}|${allowlistHash}`).digest('hex').slice(0, 16);
    const cacheRoot = path.join(this.sessionsRoot, STRICT_SCOPE_CACHE_DIR_NAME);
    await fs.mkdir(cacheRoot, { recursive: true });
    const root = path.join(cacheRoot, `scope--${sanitizeStrictScopeSlugForPath(metaBotSlug)}--${key}`);
    const sourceHome = resolveStrictIsolationSourceHome({
      baseEnv: this.env,
      requestEnv: request.env,
      fallbackHome: path.join(root, 'home'),
    });
    const fingerprint = await buildStrictIsolationFingerprint({
      provider,
      sourceHome,
      baseEnv: this.env,
      requestEnv: request.env,
    });

    const cached = this.strictScopeCache.get(key) ?? await this.readStrictScopeManifest(root);
    if (cached && cached.manifest.fingerprint === fingerprint) {
      cached.manifest.lastUsedAt = Date.now();
      this.strictScopeCache.delete(key);
      this.strictScopeCache.set(key, cached); // refresh LRU recency
      await this.writeStrictScopeManifest(cached).catch(() => undefined);
      return this.buildStrictScopeEnv(cached, request);
    }

    await fs.rm(root, { recursive: true, force: true });
    const cwd = path.join(root, 'work');
    const systemHomeDir = path.join(root, 'home');
    await fs.mkdir(cwd, { recursive: true });
    await fs.mkdir(systemHomeDir, { recursive: true });
    await fs.mkdir(path.join(systemHomeDir, '.config'), { recursive: true });
    const env = buildStrictSkillIsolationEnv({
      provider,
      sourceHome,
      isolatedHome: systemHomeDir,
      isolatedCwd: cwd,
      baseEnv: this.env,
      requestEnv: request.env,
    });
    await prepareStrictSkillIsolationPlatformHome({
      provider,
      sourceHome,
      isolatedHome: systemHomeDir,
      env,
      baseEnv: this.env,
      requestEnv: request.env,
    });
    const entry: StrictScopeCacheEntry = {
      manifest: {
        key,
        metaBotSlug,
        provider,
        allowlistHash,
        fingerprint,
        skillSystemHomeDir: shouldUseSourceHomeForStrictIsolation(provider) ? sourceHome : systemHomeDir,
        lastUsedAt: Date.now(),
      },
      root,
      cwd,
      systemHomeDir,
      skillSystemHomeDir: shouldUseSourceHomeForStrictIsolation(provider) ? sourceHome : systemHomeDir,
    };
    await this.writeStrictScopeManifest(entry).catch(() => undefined);
    this.strictScopeCache.set(key, entry);
    await this.evictStrictScopeCacheOverflow(cacheRoot);
    return { root, cwd, systemHomeDir, skillSystemHomeDir: entry.skillSystemHomeDir, env };
  }

  private buildStrictScopeEnv(entry: StrictScopeCacheEntry, request: LlmExecutionRequest): StrictSkillIsolationScope {
    const sourceHome = resolveStrictIsolationSourceHome({
      baseEnv: this.env,
      requestEnv: request.env,
      fallbackHome: entry.systemHomeDir,
    });
    return {
      root: entry.root,
      cwd: entry.cwd,
      systemHomeDir: entry.systemHomeDir,
      skillSystemHomeDir: entry.skillSystemHomeDir,
      env: buildStrictSkillIsolationEnv({
        provider: request.runtime.provider,
        sourceHome,
        isolatedHome: entry.systemHomeDir,
        isolatedCwd: entry.cwd,
        baseEnv: this.env,
        requestEnv: request.env,
      }),
    };
  }

  private async readStrictScopeManifest(root: string): Promise<StrictScopeCacheEntry | null> {
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(root, STRICT_SCOPE_MANIFEST_NAME), 'utf8')) as StrictScopeManifest;
      if (!parsed || typeof parsed.key !== 'string' || typeof parsed.fingerprint !== 'string') return null;
      if (typeof parsed.skillSystemHomeDir !== 'string' || !parsed.skillSystemHomeDir) return null;
      return {
        manifest: parsed,
        root,
        cwd: path.join(root, 'work'),
        systemHomeDir: path.join(root, 'home'),
        skillSystemHomeDir: parsed.skillSystemHomeDir,
      };
    } catch {
      return null;
    }
  }

  private async writeStrictScopeManifest(entry: StrictScopeCacheEntry): Promise<void> {
    await fs.writeFile(path.join(entry.root, STRICT_SCOPE_MANIFEST_NAME), JSON.stringify(entry.manifest, null, 2), 'utf8');
  }

  private async evictStrictScopeCacheOverflow(cacheRoot: string): Promise<void> {
    const entries = await fs.readdir(cacheRoot).catch(() => [] as string[]);
    if (entries.length <= STRICT_SCOPE_CACHE_MAX_ENTRIES) return;
    const manifests: Array<{ dir: string; lastUsedAt: number }> = [];
    for (const dir of entries) {
      try {
        const parsed = JSON.parse(await fs.readFile(path.join(cacheRoot, dir, STRICT_SCOPE_MANIFEST_NAME), 'utf8')) as StrictScopeManifest;
        manifests.push({ dir, lastUsedAt: typeof parsed.lastUsedAt === 'number' ? parsed.lastUsedAt : 0 });
      } catch {
        manifests.push({ dir, lastUsedAt: 0 });
      }
    }
    manifests.sort((left, right) => left.lastUsedAt - right.lastUsedAt);
    for (const { dir } of manifests.slice(0, manifests.length - STRICT_SCOPE_CACHE_MAX_ENTRIES)) {
      const root = path.join(cacheRoot, dir);
      for (const [cacheKey, cacheEntry] of this.strictScopeCache) {
        if (cacheEntry.root === root) this.strictScopeCache.delete(cacheKey);
      }
      await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** R7.3 — profile-delete hook: drop every cached scope of one profile (memory + disk). */
  async evictStrictIsolationScopesForSlug(metaBotSlug: string): Promise<void> {
    const slug = normalizeStrictScopeSlug(metaBotSlug);
    for (const [key, entry] of this.strictScopeCache) {
      if (entry.manifest.metaBotSlug !== slug) continue;
      this.strictScopeCache.delete(key);
      await fs.rm(entry.root, { recursive: true, force: true }).catch(() => undefined);
    }
    const cacheRoot = path.join(this.sessionsRoot, STRICT_SCOPE_CACHE_DIR_NAME);
    const prefix = `scope--${sanitizeStrictScopeSlugForPath(slug)}--`;
    const entries = await fs.readdir(cacheRoot).catch(() => [] as string[]);
    await Promise.all(entries
      .filter((entry) => entry.startsWith(prefix))
      .map((entry) => fs.rm(path.join(cacheRoot, entry), { recursive: true, force: true }).catch(() => undefined)));
  }
```

3e. `runSession` (401-492): replace the `createStrictSkillIsolationScope({...})` call with `this.acquireStrictSkillIsolationScope(request)`, and DELETE both `removeStrictSkillIsolationScope` calls (line 480-486 and the `finally` at 490) — cached scopes must survive the turn. Delete the now-unused `createStrictSkillIsolationScope`/`removeStrictSkillIsolationScope` module functions if nothing else references them (grep first; keep `StrictSkillIsolationScope`).

NOTE for this task: some existing strict-isolation tests in `tests/llm/llmExecutorCore.test.mjs` may implicitly depend on per-turn scope deletion (fresh temp HOME per execute). With reuse, the same `(slug, provider, allowlist)` domain now shares the prepared HOME. If an existing test breaks only because of that semantic (e.g. asserting unique temp roots per turn, or skill-injector behavior unchanged by a persistent destination), update the test to the reuse semantics; the injector's skip-if-exists fast path is the intended behavior, not a regression. Flag any other kind of breakage before changing test expectations.

3f. `defaultHandlers.ts:4716`: widen the type:

```ts
  llmExecutor?: Pick<LlmExecutor, 'execute' | 'getSession' | 'cancel' | 'listSessions' | 'streamEvents'> & {
    evictStrictIsolationScopesForSlug?: (metaBotSlug: string) => Promise<void>;
  };
```

3g. `deleteProfile` handler (15420): inside the success path (after `deleteMetabotProfile` succeeds), add:

```ts
          await input.llmExecutor?.evictStrictIsolationScopesForSlug?.(normalizeText(slug))?.catch(() => undefined);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test tests/llm/llmExecutorCore.test.mjs && node --test tests/daemon/defaultBotHandlers.test.mjs`
Expected: PASS.

- [ ] **Step 5: Round 3 closeout**

Run: `npm run test:fast` + `git diff --check`, then:

```bash
npm run closeout:eric -- --message "feat: reuse strict-isolation scope across chat turns" \
  --journal "R7: cache the strict-isolation platform HOME per (profile, provider, skill allowlist) trust domain with platform-home fingerprint invalidation, LRU cap 8, and profile-delete eviction; cuts first-reply-after-idle cold start." \
  --verify "npm run build && node --test tests/llm/llmExecutorCore.test.mjs && node --test tests/daemon/defaultBotHandlers.test.mjs" \
  --stage src/core/llm/executor/executor.ts \
  --stage src/daemon/defaultHandlers.ts \
  --stage tests/llm/llmExecutorCore.test.mjs \
  --stage tests/daemon/defaultBotHandlers.test.mjs
```

---

## Round 4 (R8): creation outcome feedback + resync + full verification

### Task 11: Create-modal LLM binding outcome + i18n (R8)

**Files:**
- Modify: `src/ui/i18n.ts` (en ~line 208 area; zh-CN ~line 805 area)
- Modify: `src/ui/pages/bot/app.ts:2058-2074` (`createChainSuccessMarkup`), `2114-2119` (`renderCreateChainSuccess`), `2185-2192` (`createMetabot` success handler)
- Test: `tests/ui/botPageScript.test.mjs`, `tests/ui/i18n.test.mjs`

- [ ] **Step 1: Write the failing tests**

Add to `tests/ui/botPageScript.test.mjs` (pattern per header facts — deferred `createResponse`, `fields` map, `context.loadProfiles` stub). One parametrized-style trio:

```js
test('bot page create flow shows the bound LLM provider on success', async () => {
  // fetch returns data.llmBinding = { primaryProvider: 'workbuddy', status: 'healthy' }
  // after createMetabot resolves: assert.match(modal.innerHTML, /LLM bound: workbuddy/)
});

test('bot page create flow shows the verifying state for a pending binding', async () => {
  // llmBinding = { primaryProvider: 'workbuddy', status: 'pending', reason: 'cold' }
  // assert /Selected workbuddy — verifying availability…/ and /It becomes usable automatically once ready/
});

test('bot page create flow shows the no-LLM state when nothing was discovered', async () => {
  // llmBinding = { status: 'none' }
  // assert /No LLM discovered on this machine yet/ and /Bind one later from the bot settings page/
});

test('bot page create-outcome i18n keys exist in both dictionaries', async () => {
  const keys = ['bot.createLlmBound', 'bot.createLlmPending', 'bot.createLlmPendingHint', 'bot.createLlmNone', 'bot.createLlmNoneHint'];
  for (const key of keys) {
    assert.notEqual(translate('en', key), key, `${key} missing from en dictionary`);
    assert.notEqual(translate('zh-CN', key), key, `${key} missing from zh-CN dictionary`);
  }
});
```

Add the same 5 keys to `requiredBotKeys` in `tests/ui/i18n.test.mjs`, plus exact-string spot checks:

```js
assert.equal(translate('en', 'bot.createLlmBound'), 'LLM bound: {provider}');
assert.equal(translate('zh-CN', 'bot.createLlmBound'), '已绑定 LLM：{provider}');
assert.equal(translate('en', 'bot.createLlmPending'), 'Selected {provider} — verifying availability…');
assert.equal(translate('zh-CN', 'bot.createLlmPending'), '已选择 {provider}，正在验证可用性…');
assert.equal(translate('en', 'bot.createLlmPendingHint'), 'It becomes usable automatically once ready; you can also test it under LLM runtimes.');
assert.equal(translate('zh-CN', 'bot.createLlmPendingHint'), '就绪后会自动可用，也可在 LLM 运行时中手动测试。');
assert.equal(translate('en', 'bot.createLlmNone'), 'No LLM discovered on this machine yet — detecting in the background.');
assert.equal(translate('zh-CN', 'bot.createLlmNone'), '本机暂未发现 LLM，已在后台检测。');
assert.equal(translate('en', 'bot.createLlmNoneHint'), 'Bind one later from the bot settings page.');
assert.equal(translate('zh-CN', 'bot.createLlmNoneHint'), '稍后可在 Bot 设置页面绑定。');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && node --test tests/ui/botPageScript.test.mjs && node --test tests/ui/i18n.test.mjs`
Expected: FAIL — keys missing.

- [ ] **Step 3: Implement**

3a. `src/ui/i18n.ts` — add to the `en` dictionary (near `bot.createFailed`):

```ts
    'bot.createLlmBound': 'LLM bound: {provider}',
    'bot.createLlmPending': 'Selected {provider} — verifying availability…',
    'bot.createLlmPendingHint': 'It becomes usable automatically once ready; you can also test it under LLM runtimes.',
    'bot.createLlmNone': 'No LLM discovered on this machine yet — detecting in the background.',
    'bot.createLlmNoneHint': 'Bind one later from the bot settings page.',
```

and to the `zh-CN` dictionary:

```ts
    'bot.createLlmBound': '已绑定 LLM：{provider}',
    'bot.createLlmPending': '已选择 {provider}，正在验证可用性…',
    'bot.createLlmPendingHint': '就绪后会自动可用，也可在 LLM 运行时中手动测试。',
    'bot.createLlmNone': '本机暂未发现 LLM，已在后台检测。',
    'bot.createLlmNoneHint': '稍后可在 Bot 设置页面绑定。',
```

3b. `src/ui/pages/bot/app.ts` — add a markup helper next to `createChainSuccessMarkup`:

```js
function createLlmBindingOutcomeMarkup(llmBinding){
  if(!llmBinding||!llmBinding.status)return '';
  if(llmBinding.status==='healthy'&&llmBinding.primaryProvider){
    return '<p>'+esc(uiText('bot.createLlmBound','LLM bound: {provider}',{provider:llmBinding.primaryProvider}))+'</p>';
  }
  if(llmBinding.status==='pending'&&llmBinding.primaryProvider){
    return '<p>'+esc(uiText('bot.createLlmPending','Selected {provider} — verifying availability…',{provider:llmBinding.primaryProvider}))+'</p>'+
      '<p>'+esc(uiText('bot.createLlmPendingHint','It becomes usable automatically once ready; you can also test it under LLM runtimes.'))+'</p>';
  }
  if(llmBinding.status==='none'){
    return '<p>'+esc(uiText('bot.createLlmNone','No LLM discovered on this machine yet — detecting in the background.'))+'</p>'+
      '<p>'+esc(uiText('bot.createLlmNoneHint','Bind one later from the bot settings page.'))+'</p>';
  }
  return '';
}
```

Change `createChainSuccessMarkup(profile,url)` to `createChainSuccessMarkup(profile,url,llmBinding)` and insert `createLlmBindingOutcomeMarkup(llmBinding)` right after the `chainCreateSuccessMessage` `<p>`. Change `renderCreateChainSuccess(profile)` to `renderCreateChainSuccess(profile,llmBinding)` passing through. In `createMetabot` (2185-2192), pass `r.data&&r.data.llmBinding`:

```js
    if(r.data&&r.data.setup&&r.data.setup.state!=='ready')renderCreateChainWarning(profile,r.data.setup);
    else renderCreateChainSuccess(profile,r.data&&r.data.llmBinding);
```

(`retryMetabotSetup` keeps calling `renderCreateChainSuccess(profile)` — binding markup is simply omitted there. No new polling; R8.2.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test tests/ui/botPageScript.test.mjs && node --test tests/ui/i18n.test.mjs`
Expected: PASS.

- [ ] **Step 5: Skillpack resync**

Run: `npm run build:skillpacks && git status --porcelain`
Expected: regenerated tracked mirrors under `skillpacks/*/runtime/dist/` from rounds 1-3 source changes. Stage every changed file they produced (list them via `git status --porcelain`).

- [ ] **Step 6: Round 4 closeout**

Run: `npm run test:fast` + `git diff --check`, then:

```bash
npm run closeout:eric -- --message "feat: show LLM binding outcome in the create-bot flow" \
  --journal "R8: create success view renders bound/verifying/none LLM outcomes from llmBinding with en + zh-CN copy; skillpack runtime mirrors resynced." \
  --verify "npm run build && node --test tests/ui/botPageScript.test.mjs && node --test tests/ui/i18n.test.mjs && npm run test:fast" \
  --stage src/ui/i18n.ts \
  --stage src/ui/pages/bot/app.ts \
  --stage tests/ui/botPageScript.test.mjs \
  --stage tests/ui/i18n.test.mjs \
  --stage skillpacks
```

---

### Task 12: Full verification

Per spec §5 (REQUIRED — shared runtime behavior + executor changes):

- [ ] `npm run build && npm run build:skillpacks`
- [ ] `node --test tests/daemon/defaultBotHandlers.test.mjs`
- [ ] `node --test tests/chat/hostLlmChatReplyRunner.test.mjs`
- [ ] `node --test tests/llm/llmAvailabilityRecovery.test.mjs`
- [ ] `node --test tests/llm/llmExecutorCore.test.mjs`
- [ ] `node --test tests/ui/botPageScript.test.mjs`
- [ ] `npm run test:fast`
- [ ] `npm test` (full suite: fast + integration; `tests/cli/runtime.test.mjs` runs last via the npm scripts)
- [ ] `git diff --check`

Manual acceptance (spec §5 items 1-4) is performed by the user/reviewer; the merge back to `main` with `git merge --no-ff` happens only after that acceptance — do not merge autonomously.
