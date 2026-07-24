import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  createLlmAvailabilityRecovery,
  LLM_AVAILABILITY_RECOVERY_DISABLED_ENV,
} = require('../../dist/core/llm/llmAvailabilityRecovery.js');

function makeRuntime(id, health, overrides = {}) {
  const now = '2026-05-06T00:00:00.000Z';
  return {
    id,
    provider: 'codex',
    displayName: id,
    binaryPath: '/bin/codex',
    version: '1.0.0',
    authState: 'authenticated',
    health,
    capabilities: ['tool-use'],
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createMemoryRuntimeStore(initialRuntimes) {
  let state = { version: 1, runtimes: [...initialRuntimes] };
  return {
    state: () => state,
    read: async () => state,
    write: async (next) => {
      state = next;
      return state;
    },
    upsertRuntime: async (runtime) => {
      const index = state.runtimes.findIndex((entry) => entry.id === runtime.id);
      if (index >= 0) {
        state.runtimes[index] = runtime;
      } else {
        state.runtimes.push(runtime);
      }
      return state;
    },
    removeRuntime: async () => state,
    markSeen: async () => state,
    updateHealth: async () => state,
  };
}

function makeHarness(options = {}) {
  const stores = new Map();
  const probeCalls = [];
  let currentMs = options.startMs ?? 1_800_000_000_000;
  const harness = {
    stores,
    probeCalls,
    advance: (ms) => {
      currentMs += ms;
    },
    addStore(homeDir, runtimes) {
      stores.set(homeDir, createMemoryRuntimeStore(runtimes));
      return stores.get(homeDir);
    },
    create(overrides = {}) {
      return createLlmAvailabilityRecovery({
        env: {},
        listTargetHomes: async () => [...stores.keys()],
        storeForHome: (homeDir) => stores.get(homeDir),
        probe: overrides.probe ?? (async (runtime) => {
          probeCalls.push({ runtimeId: runtime.id, at: currentMs });
          return { ...runtime, health: 'healthy', healthReason: undefined, unavailableUntil: undefined };
        }),
        now: () => currentMs,
        ...options.create,
        ...overrides,
      });
    },
  };
  return harness;
}

test('availability recovery probes detected, degraded, and cooldown-expired runtimes only', async () => {
  const harness = makeHarness();
  const futureCooldown = new Date(1_800_000_000_000 + 60_000).toISOString();
  const expiredCooldown = new Date(1_800_000_000_000 - 60_000).toISOString();
  const store = harness.addStore('/home/a', [
    makeRuntime('rt-healthy', 'healthy'),
    makeRuntime('rt-detected', 'detected'),
    makeRuntime('rt-degraded', 'degraded'),
    makeRuntime('rt-unavailable-future', 'unavailable', { unavailableUntil: futureCooldown }),
    makeRuntime('rt-unavailable-expired', 'unavailable', { unavailableUntil: expiredCooldown }),
    makeRuntime('rt-unavailable-no-until', 'unavailable'),
    makeRuntime('rt-custom', 'detected', { provider: 'custom' }),
  ]);
  const recovery = harness.create();

  // Per-store probe budget is 1 per cycle, so run one cycle per candidate.
  await recovery.runCycleOnce();
  await recovery.runCycleOnce();
  await recovery.runCycleOnce();
  await recovery.runCycleOnce();

  const probedIds = harness.probeCalls.map((call) => call.runtimeId).sort();
  assert.deepEqual(probedIds, ['rt-degraded', 'rt-detected', 'rt-unavailable-expired', 'rt-unavailable-no-until']);
  assert.equal(store.state().runtimes.find((runtime) => runtime.id === 'rt-healthy').health, 'healthy');
  assert.equal(store.state().runtimes.find((runtime) => runtime.id === 'rt-unavailable-future').health, 'unavailable');
  assert.equal(store.state().runtimes.find((runtime) => runtime.id === 'rt-detected').health, 'healthy');
});

test('availability recovery backs off exponentially and resets on success', async () => {
  const harness = makeHarness();
  harness.addStore('/home/a', [makeRuntime('rt-flaky', 'detected')]);
  let failProbes = true;
  const recovery = harness.create({
    probe: async (runtime) => {
      harness.probeCalls.push({ runtimeId: runtime.id, at: Date.now() });
      if (failProbes) {
        return { ...runtime, health: 'detected', healthReason: 'still broken' };
      }
      return { ...runtime, health: 'healthy' };
    },
  });

  const attempt = async (advanceMs, expectedCalls, label) => {
    harness.advance(advanceMs);
    await recovery.runCycleOnce();
    assert.equal(harness.probeCalls.length, expectedCalls, label);
  };

  await attempt(0, 1, 'first cycle probes');
  await attempt(30_000, 1, 'inside 1-minute backoff: skipped');
  await attempt(31_000, 2, 'after 1 minute: second probe');
  await attempt(61_000, 2, 'inside 2-minute backoff: skipped');
  await attempt(61_000, 3, 'after 2 minutes: third probe');
  await attempt(4 * 60_000 + 1_000, 4, 'after 4 minutes: fourth probe');

  failProbes = false;
  await attempt(8 * 60_000 + 1_000, 5, 'after 8 minutes: success probe');

  // The reset only matters when the runtime later degrades again: with the
  // backoff cleared, an immediate re-probe is allowed.
  const store = harness.stores.get('/home/a');
  await store.upsertRuntime({ ...makeRuntime('rt-flaky', 'detected') });
  failProbes = true;
  await attempt(0, 6, 'backoff reset after success: immediate re-probe allowed');
});

test('availability recovery caps the backoff at 30 minutes', async () => {
  const harness = makeHarness();
  harness.addStore('/home/a', [makeRuntime('rt-down', 'detected')]);
  const recovery = harness.create({
    probe: async (runtime) => {
      harness.probeCalls.push({ runtimeId: runtime.id });
      return { ...runtime, health: 'detected', healthReason: 'down' };
    },
  });

  // Fail 6 times so the schedule reaches the cap: 1,2,4,8,16,30.
  await recovery.runCycleOnce();
  for (const waitMs of [61_000, 121_000, 241_000, 481_000, 961_000]) {
    harness.advance(waitMs);
    await recovery.runCycleOnce();
  }
  assert.equal(harness.probeCalls.length, 6);

  harness.advance(29 * 60_000);
  await recovery.runCycleOnce();
  assert.equal(harness.probeCalls.length, 6, 'still inside the 30-minute cap');

  harness.advance(61_000);
  await recovery.runCycleOnce();
  assert.equal(harness.probeCalls.length, 7, 'past the 30-minute cap: probe again');
});

test('availability recovery skips a store while a discovery sweep runs on it', async () => {
  const harness = makeHarness();
  harness.addStore('/home/a', [makeRuntime('rt-a', 'detected')]);
  const recovery = harness.create({
    isStoreBusy: () => true,
  });

  await recovery.runCycleOnce();
  assert.equal(harness.probeCalls.length, 0, 'busy stores are skipped entirely');
});

test('availability recovery probes at most 2 stores concurrently and 1 runtime per store per cycle', async () => {
  const harness = makeHarness();
  for (const homeDir of ['/home/a', '/home/b', '/home/c']) {
    harness.addStore(homeDir, [
      makeRuntime(`rt-${homeDir.at(-1)}-1`, 'detected'),
      makeRuntime(`rt-${homeDir.at(-1)}-2`, 'detected'),
    ]);
  }
  let inFlight = 0;
  let maxInFlight = 0;
  const recovery = harness.create({
    probe: async (runtime) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      harness.probeCalls.push({ runtimeId: runtime.id });
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
      return { ...runtime, health: 'detected' };
    },
  });

  await recovery.runCycleOnce();
  assert.equal(maxInFlight, 2, 'global concurrency cap is 2');
  assert.equal(harness.probeCalls.length, 3, 'one probe per store per cycle');
});

test('availability recovery honors the kill switch', async () => {
  const harness = makeHarness();
  harness.addStore('/home/a', [makeRuntime('rt-a', 'detected')]);
  const recovery = harness.create({
    env: { [LLM_AVAILABILITY_RECOVERY_DISABLED_ENV]: '1' },
  });

  await recovery.runCycleOnce();
  recovery.requestSoon('/home/a');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.probeCalls.length, 0, 'disabled loop never probes');

  recovery.start();
  assert.equal(harness.probeCalls.length, 0, 'start is a no-op when disabled');
  recovery.stop();
});

test('availability recovery requestSoon probes the requested store once, coalesced', async () => {
  const harness = makeHarness();
  harness.addStore('/home/a', [makeRuntime('rt-a', 'detected')]);
  harness.addStore('/home/b', [makeRuntime('rt-b', 'detected')]);
  const recovery = harness.create();

  recovery.requestSoon('/home/a');
  recovery.requestSoon('/home/a');
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(harness.probeCalls.map((call) => call.runtimeId), ['rt-a'], 'coalesced to a single expedited probe on the requested store');
});
