// Fast-tier unit tests for the daemon automation ticks (Codex↔DSH parity
// Phase 3): the dream tick (stand-down, ordering, gates, isolation) and the
// chain-history summary drain (budget/cap semantics), plus the shared serial
// loop lifecycle. Everything runs against injected fakes — no real timers,
// no daemon boots, no filesystem.

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildChainHistorySummaryPrompt,
  createHostLlmExecutorBridge,
  isDshHostExecutorConnected,
  runChainHistorySummaryTick,
  runDreamAutomationTick,
  setActiveHostLlmExecutorBridge,
  startAutomationTickLoop,
} = (() => {
  const ticks = require('../../dist/daemon/automationTicks.js');
  const bridge = require('../../dist/core/llm/hostLlmExecutorBridge.js');
  return { ...ticks, ...bridge };
})();

function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

// ---------------------------------------------------------------------------
// Dream tick
// ---------------------------------------------------------------------------

function createDreamTickFixture(options = {}) {
  const calls = [];
  const profiles = options.profiles ?? [
    { slug: 'alice', homeDir: '/home/u/.metabot/profiles/alice', isAvailable: true },
  ];
  const policyEnabledBySlug = options.policyEnabledBySlug ?? {};
  const tickEnabledByHome = options.tickEnabledByHome ?? {};
  const handlers = {
    dream: {
      due: options.dreamDue ?? (async (input) => {
        calls.push(['dream.due', input]);
        return { ok: true, data: { dueDates: ['2026-09-23'], repairDates: [] } };
      }),
      run: options.dreamRun ?? (async (input) => {
        calls.push(['dream.run', input]);
        return { ok: true, data: { date: input.date, kind: 'completed' } };
      }),
    },
    memory: {
      hygieneDue: options.hygieneDue ?? (async (input) => {
        calls.push(['memory.hygieneDue', input]);
        return { ok: true, data: { due: true, reason: 'due' } };
      }),
      hygieneRun: options.hygieneRun ?? (async (input) => {
        calls.push(['memory.hygieneRun', input]);
        return { ok: true, data: {} };
      }),
    },
    surf: {
      status: options.surfStatus ?? (async (input) => {
        calls.push(['surf.status', input]);
        return { ok: true, data: { preDreamDue: true } };
      }),
      run: options.surfRun ?? (async (input) => {
        calls.push(['surf.run', input]);
        return { ok: true, data: { status: 'completed' } };
      }),
    },
  };
  const deps = {
    listBots: async () => profiles,
    isHostExecutorConnected: options.isHostExecutorConnected ?? (() => false),
    isTickEnabled: async (homeDir) => tickEnabledByHome[homeDir] !== false,
    // isDreamPolicyEnabled is keyed by slug in the fixture for readability.
    isDreamPolicyEnabled: async (homeDir) => policyEnabledBySlug[homeDir.split('/').pop()] !== false,
    handlers,
    log: () => undefined,
  };
  return { deps, calls };
}

test('dream tick: stands down completely while the DSH host-executor bridge is connected', async () => {
  const { deps, calls } = createDreamTickFixture({ isHostExecutorConnected: () => true });
  const outcomes = await runDreamAutomationTick(deps);
  assert.deepEqual(outcomes, []);
  assert.deepEqual(calls, []);
});

test('dream tick: runs due → pre-dream surf → dream runs → hygiene tail in order', async () => {
  const { deps, calls } = createDreamTickFixture({
    dreamDue: async (input) => {
      calls.push(['dream.due', input]);
      return { ok: true, data: { dueDates: ['2026-09-21', '2026-09-22'], repairDates: ['2026-09-20', '2026-09-19'] } };
    },
  });
  const outcomes = await runDreamAutomationTick(deps);
  assert.deepEqual(calls, [
    ['dream.due', { from: 'alice' }],
    ['surf.status', { from: 'alice' }],
    ['surf.run', { from: 'alice', trigger: 'pre-dream', wait: true }],
    ['dream.run', { from: 'alice', date: '2026-09-21', wait: true }],
    ['dream.run', { from: 'alice', date: '2026-09-22', wait: true }],
    // At most one repair date per pass: only the first repair date runs.
    ['dream.run', { from: 'alice', date: '2026-09-20', wait: true, isRepair: true }],
    ['memory.hygieneDue', { from: 'alice' }],
    ['memory.hygieneRun', { from: 'alice' }],
  ]);
  assert.deepEqual(outcomes[0].dreamed, ['2026-09-21', '2026-09-22', '2026-09-20']);
  assert.equal(outcomes[0].surfRan, true);
  assert.equal(outcomes[0].hygieneRan, true);
});

test('dream tick: surf gate fires only when preDreamDue and never fails the dream', async () => {
  const surfRuns = [];
  const { deps, calls } = createDreamTickFixture({
    surfStatus: async (input) => {
      calls.push(['surf.status', input]);
      return { ok: true, data: { preDreamDue: false } };
    },
    surfRun: async (input) => {
      surfRuns.push(input);
      return { ok: true, data: { status: 'completed' } };
    },
  });
  const outcomes = await runDreamAutomationTick(deps);
  assert.deepEqual(surfRuns, []);
  assert.equal(outcomes[0].surfSkipped, 'not due (off / recent / memory off / running)');
  assert.equal(outcomes[0].surfRan, undefined);
  assert.deepEqual(outcomes[0].dreamed, ['2026-09-23']);
});

test('dream tick: a failed pre-dream surf is recorded and the dream still runs', async () => {
  const { deps } = createDreamTickFixture({
    surfRun: async () => ({ ok: true, data: { status: 'failed', error: 'surf blew up' } }),
  });
  const outcomes = await runDreamAutomationTick(deps);
  assert.equal(outcomes[0].surfRan, true);
  assert.equal(outcomes[0].surfError, 'surf blew up');
  assert.deepEqual(outcomes[0].dreamed, ['2026-09-23']);
  assert.equal(outcomes[0].error, undefined);
});

test('dream tick: per-bot memory policy dreamEnabled=false skips the dream but keeps the hygiene tail', async () => {
  const { deps, calls } = createDreamTickFixture({ policyEnabledBySlug: { alice: false } });
  const outcomes = await runDreamAutomationTick(deps);
  assert.equal(outcomes[0].skipped, 'dream disabled by memory policy');
  assert.deepEqual(outcomes[0].dreamed, []);
  assert.deepEqual(calls.map(([name]) => name), ['memory.hygieneDue', 'memory.hygieneRun']);
  assert.equal(outcomes[0].hygieneRan, true);
});

test('dream tick: unavailable bot skips everything including the hygiene tail', async () => {
  const { deps, calls } = createDreamTickFixture({
    profiles: [{ slug: 'alice', homeDir: '/home/u/.metabot/profiles/alice', isAvailable: false }],
  });
  const outcomes = await runDreamAutomationTick(deps);
  assert.equal(outcomes[0].skipped, 'bot unavailable (availability toggle off)');
  assert.deepEqual(calls, []);
  assert.equal(outcomes[0].hygieneRan, undefined);
  assert.equal(outcomes[0].hygieneError, undefined);
});

test('dream tick: config switch off makes the bot fully inert', async () => {
  const { deps, calls } = createDreamTickFixture({
    tickEnabledByHome: { '/home/u/.metabot/profiles/alice': false },
  });
  const outcomes = await runDreamAutomationTick(deps);
  assert.equal(outcomes[0].skipped, 'automation.dreamTickEnabled=false');
  assert.deepEqual(calls, []);
  assert.equal(outcomes[0].hygieneRan, undefined);
});

test('dream tick: hygiene tail runs even when no dream dates are due', async () => {
  const { deps, calls } = createDreamTickFixture({
    dreamDue: async (input) => {
      calls.push(['dream.due', input]);
      return { ok: true, data: { dueDates: [], repairDates: [] } };
    },
  });
  const outcomes = await runDreamAutomationTick(deps);
  assert.equal(outcomes[0].skipped, 'no due dates');
  assert.equal(outcomes[0].surfRan, undefined);
  assert.equal(outcomes[0].hygieneRan, true);
  assert.deepEqual(calls.map(([name]) => name), ['dream.due', 'memory.hygieneDue', 'memory.hygieneRun']);
});

test('dream tick: hygiene not due skips the hygiene run with its reason', async () => {
  const { deps, calls } = createDreamTickFixture({
    hygieneDue: async (input) => {
      calls.push(['memory.hygieneDue', input]);
      return { ok: true, data: { due: false, reason: 'already run today' } };
    },
  });
  const outcomes = await runDreamAutomationTick(deps);
  assert.equal(outcomes[0].hygieneSkipped, 'not due (already run today)');
  assert.equal(outcomes[0].hygieneRan, undefined);
  assert.deepEqual(calls.map(([name]) => name), ['dream.due', 'surf.status', 'surf.run', 'dream.run', 'memory.hygieneDue']);
});

test('dream tick: one bot failing never interrupts the others', async () => {
  const { deps } = createDreamTickFixture({
    profiles: [
      { slug: 'alice', homeDir: '/home/u/.metabot/profiles/alice', isAvailable: true },
      { slug: 'bob', homeDir: '/home/u/.metabot/profiles/bob', isAvailable: true },
    ],
    dreamDue: async (input) => {
      if (input.from === 'alice') throw new Error('due store exploded');
      return { ok: true, data: { dueDates: ['2026-09-23'], repairDates: [] } };
    },
  });
  const outcomes = await runDreamAutomationTick(deps);
  assert.equal(outcomes.length, 2);
  assert.match(outcomes[0].error, /due store exploded/);
  assert.deepEqual(outcomes[1].dreamed, ['2026-09-23']);
  assert.equal(outcomes[1].error, undefined);
  // Hygiene tail still visited both bots.
  assert.equal(outcomes[0].hygieneRan, true);
  assert.equal(outcomes[1].hygieneRan, true);
});

test('dream tick: due failure and dream run failure are recorded per bot', async () => {
  const { deps } = createDreamTickFixture({
    dreamDue: async () => ({ ok: false, code: 'dream_due_failed', message: 'due failed' }),
  });
  const outcomes = await runDreamAutomationTick(deps);
  assert.equal(outcomes[0].error, 'due failed');
  assert.equal(outcomes[0].dreamed.length, 0);
});

test('dream tick: dream run failure records the date error', async () => {
  const { deps } = createDreamTickFixture({
    dreamRun: async (input) => ({ ok: false, code: 'dream_run_failed', message: `run failed for ${input.date}` }),
  });
  const outcomes = await runDreamAutomationTick(deps);
  assert.equal(outcomes[0].error, 'run failed for 2026-09-23');
  assert.deepEqual(outcomes[0].dreamed, []);
});

// ---------------------------------------------------------------------------
// Chain-history summary drain
// ---------------------------------------------------------------------------

function createChainHistoryFixture(options = {}) {
  const calls = [];
  const profiles = options.profiles ?? [
    { slug: 'alice', homeDir: '/home/u/.metabot/profiles/alice', isAvailable: true },
  ];
  const tickEnabledByHome = options.tickEnabledByHome ?? {};
  const pendingByHome = options.pendingByHome ?? {};
  const applyByKey = options.applyByKey ?? {};
  const summarizedTodayByHome = options.summarizedTodayByHome ?? {};
  const summarizeByPin = options.summarizeByPin ?? {};
  const stores = new Map();
  const deps = {
    listBots: async () => profiles,
    isHostExecutorConnected: options.isHostExecutorConnected ?? (() => false),
    isTickEnabled: async (homeDir) => tickEnabledByHome[homeDir] !== false,
    summarize: options.summarize ?? (async (input) => {
      calls.push(['summarize', input]);
      if (summarizeByPin[input.content]) return summarizeByPin[input.content];
      if (options.summarizeErrorFor?.includes(input.content)) throw new Error('llm exploded');
      return `summary of ${input.content}`;
    }),
    storeFor: (homeDir) => {
      if (!stores.has(homeDir)) {
        const pending = pendingByHome[homeDir] ?? [];
        stores.set(homeDir, {
          listPendingSummaries: async (kind, limit) => {
            calls.push(['listPendingSummaries', { homeDir, kind, limit }]);
            return pending
              .filter((item) => item.kind === kind)
              .slice(0, limit)
              .map((record) => ({ record }));
          },
          applySummaryOutcome: async (kind, pinId, outcome) => {
            calls.push(['applySummaryOutcome', { homeDir, kind, pinId, outcome }]);
            if (applyByKey[`${kind}:${pinId}`] === false) return false;
            return true;
          },
          countSummariesSince: async (kind, sinceMs) => {
            calls.push(['countSummariesSince', { homeDir, kind, sinceMs }]);
            return summarizedTodayByHome[homeDir] ?? 0;
          },
        });
      }
      return stores.get(homeDir);
    },
    perTick: options.perTick,
    dailyCap: options.dailyCap,
    log: () => undefined,
    now: options.now,
  };
  return { deps, calls };
}

test('chain-history drain: stands down while the DSH host-executor bridge is connected', async () => {
  const { deps, calls } = createChainHistoryFixture({ isHostExecutorConnected: () => true });
  const outcomes = await runChainHistorySummaryTick(deps);
  assert.deepEqual(outcomes, []);
  assert.deepEqual(calls, []);
});

test('chain-history drain: per-tick budget is global across bots, writes first then reads', async () => {
  const homeA = '/home/u/.metabot/profiles/alice';
  const homeB = '/home/u/.metabot/profiles/bob';
  const { deps, calls } = createChainHistoryFixture({
    perTick: 3,
    profiles: [
      { slug: 'alice', homeDir: homeA, isAvailable: true },
      { slug: 'bob', homeDir: homeB, isAvailable: true },
    ],
    pendingByHome: {
      [homeA]: [
        { kind: 'write', pinId: 'w1', path: '/path/w1', contentText: 'write one' },
        { kind: 'read', pinId: 'r1', title: 'Read One', path: '/path/r1', contentExcerpt: 'read one' },
        { kind: 'write', pinId: 'w2', path: '/path/w2', contentText: 'write two' },
      ],
      [homeB]: [
        { kind: 'write', pinId: 'w9', path: '/path/w9', contentText: 'write nine' },
      ],
    },
  });
  const outcomes = await runChainHistorySummaryTick(deps);
  assert.equal(outcomes[0].slug, 'alice');
  assert.equal(outcomes[0].done, 3);
  assert.equal(outcomes[0].failed, 0);
  assert.equal(outcomes[1].slug, 'bob');
  assert.equal(outcomes[1].done, 0);
  assert.equal(outcomes[1].skipped, 'per-tick summary budget exhausted');
  // Writes always precede reads in the combined pending list (CLI
  // `chainhistory summary pending` parity).
  const summarizeCalls = calls.filter(([name]) => name === 'summarize');
  assert.deepEqual(summarizeCalls.map(([, input]) => [input.kind, input.content]), [
    ['write', 'write one'],
    ['write', 'write two'],
    ['read', 'read one'],
  ]);
});

test('chain-history drain: per-bot daily cap stops summarization for that bot only', async () => {
  const home = '/home/u/.metabot/profiles/alice';
  const { deps, calls } = createChainHistoryFixture({
    perTick: 10,
    dailyCap: 1,
    pendingByHome: {
      [home]: [
        { kind: 'write', pinId: 'w1', path: '/p1', contentText: 'one' },
        { kind: 'write', pinId: 'w2', path: '/p2', contentText: 'two' },
      ],
    },
  });
  const outcomes = await runChainHistorySummaryTick(deps);
  assert.equal(outcomes[0].done, 1);
  assert.equal(outcomes[0].failed, 0);
  const summarizeCalls = calls.filter(([name]) => name === 'summarize');
  assert.equal(summarizeCalls.length, 1);
});

test('chain-history drain: already-capped bot is skipped without store writes', async () => {
  const home = '/home/u/.metabot/profiles/alice';
  const { deps, calls } = createChainHistoryFixture({
    dailyCap: 3,
    summarizedTodayByHome: { [home]: 3 },
    pendingByHome: {
      [home]: [{ kind: 'write', pinId: 'w1', path: '/p1', contentText: 'one' }],
    },
  });
  const outcomes = await runChainHistorySummaryTick(deps);
  assert.equal(outcomes[0].skipped, 'daily summary cap reached');
  assert.equal(outcomes[0].done, 0);
  assert.deepEqual(calls.filter(([name]) => name === 'summarize'), []);
  assert.deepEqual(calls.filter(([name]) => name === 'applySummaryOutcome'), []);
});

test('chain-history drain: a failed summarize applies failed and never interrupts the batch', async () => {
  const home = '/home/u/.metabot/profiles/alice';
  const { deps, calls } = createChainHistoryFixture({
    summarizeErrorFor: ['one'],
    pendingByHome: {
      [home]: [
        { kind: 'write', pinId: 'w1', path: '/p1', contentText: 'one' },
        { kind: 'write', pinId: 'w2', path: '/p2', contentText: 'two' },
      ],
    },
  });
  const outcomes = await runChainHistorySummaryTick(deps);
  assert.equal(outcomes[0].done, 1);
  assert.equal(outcomes[0].failed, 1);
  const applies = calls.filter(([name]) => name === 'applySummaryOutcome');
  assert.deepEqual(applies.map(([, input]) => [input.pinId, input.outcome.status]), [
    ['w1', 'failed'],
    ['w2', 'done'],
  ]);
});

test('chain-history drain: an unpersisted summary does not burn the daily cap', async () => {
  const home = '/home/u/.metabot/profiles/alice';
  const { deps, calls } = createChainHistoryFixture({
    dailyCap: 1,
    applyByKey: { 'write:w1': false },
    pendingByHome: {
      [home]: [
        { kind: 'write', pinId: 'w1', path: '/p1', contentText: 'one' },
        { kind: 'write', pinId: 'w2', path: '/p2', contentText: 'two' },
      ],
    },
  });
  const outcomes = await runChainHistorySummaryTick(deps);
  // w1 generated but not persisted (failed); the daily cap is untouched, so
  // w2 still gets its (successful) attempt within the same pass.
  assert.equal(outcomes[0].done, 1);
  assert.equal(outcomes[0].failed, 1);
  assert.equal(calls.filter(([name]) => name === 'summarize').length, 2);
});

test('chain-history drain: blank content is left alone without burning the budget', async () => {
  const home = '/home/u/.metabot/profiles/alice';
  const { deps, calls } = createChainHistoryFixture({
    perTick: 2,
    pendingByHome: {
      [home]: [
        { kind: 'write', pinId: 'w1', path: '/p1', contentText: '   ' },
        { kind: 'write', pinId: 'w2', path: '/p2', contentText: 'two' },
      ],
    },
  });
  const outcomes = await runChainHistorySummaryTick(deps);
  assert.equal(outcomes[0].done, 1);
  const summarizeCalls = calls.filter(([name]) => name === 'summarize');
  assert.deepEqual(summarizeCalls.map(([, input]) => input.content), ['two']);
});

test('chain-history drain: config off and unavailable bots are skipped', async () => {
  const homeA = '/home/u/.metabot/profiles/alice';
  const homeB = '/home/u/.metabot/profiles/bob';
  const { deps, calls } = createChainHistoryFixture({
    profiles: [
      { slug: 'alice', homeDir: homeA, isAvailable: true },
      { slug: 'bob', homeDir: homeB, isAvailable: false },
    ],
    tickEnabledByHome: { [homeA]: false },
    pendingByHome: {
      [homeA]: [{ kind: 'write', pinId: 'w1', path: '/p1', contentText: 'one' }],
      [homeB]: [{ kind: 'write', pinId: 'w9', path: '/p9', contentText: 'nine' }],
    },
  });
  const outcomes = await runChainHistorySummaryTick(deps);
  assert.equal(outcomes[0].skipped, 'automation.chainHistorySummaryEnabled=false');
  assert.equal(outcomes[1].skipped, 'bot unavailable (availability toggle off)');
  assert.deepEqual(calls.filter(([name]) => name === 'summarize'), []);
});

test('chain-history drain: no pending summaries is a quiet skip', async () => {
  const { deps } = createChainHistoryFixture();
  const outcomes = await runChainHistorySummaryTick(deps);
  assert.equal(outcomes[0].skipped, 'no pending summaries');
});

test('chain-history drain: summary text is trimmed to the stored cap', async () => {
  const home = '/home/u/.metabot/profiles/alice';
  const longSummary = `x${'y'.repeat(600)}`;
  const { deps, calls } = createChainHistoryFixture({
    pendingByHome: {
      [home]: [{ kind: 'read', pinId: 'r1', title: 'T', path: '/p1', contentExcerpt: 'body' }],
    },
    summarizeByPin: { body: longSummary },
  });
  const outcomes = await runChainHistorySummaryTick(deps);
  assert.equal(outcomes[0].done, 1);
  const apply = calls.find(([name]) => name === 'applySummaryOutcome');
  assert.equal(apply[1].outcome.summary.length, 500);
});

test('chain-history drain: builds the plugin-parity summary prompt', () => {
  const write = buildChainHistorySummaryPrompt({ kind: 'write', title: null, path: '/p', content: 'hello' });
  assert.match(write.system, /compact memory notes/);
  assert.match(write.user, /You published the following content on-chain/);
  assert.match(write.user, /hello/);
  const read = buildChainHistorySummaryPrompt({ kind: 'read', title: 'T', path: '/p', content: 'hello' });
  assert.match(read.user, /You read the following on-chain content/);
  assert.match(read.user, /title: T/);
});

// ---------------------------------------------------------------------------
// Serial loop lifecycle
// ---------------------------------------------------------------------------

function createFakeTimerSeams() {
  const intervals = [];
  const timeouts = [];
  const makeHandle = (entry) => ({
    ...entry,
    cleared: false,
    unref() { return this; },
  });
  return {
    intervals,
    timeouts,
    setIntervalFn(fn, ms) {
      const handle = makeHandle({ fn, ms });
      intervals.push(handle);
      return handle;
    },
    setTimeoutFn(fn, ms) {
      const handle = makeHandle({ fn, ms });
      timeouts.push(handle);
      return handle;
    },
    clearIntervalFn(handle) { handle.cleared = true; },
    clearTimeoutFn(handle) { handle.cleared = true; },
  };
}

test('automation tick loop: boot pass fires once after the boot delay, then on interval cadence', async () => {
  const seams = createFakeTimerSeams();
  let calls = 0;
  const loop = startAutomationTickLoop(async () => { calls += 1; }, {
    tickMs: 600_000,
    bootDelayMs: 15_000,
    ...seams,
  });
  assert.equal(calls, 0);
  assert.equal(seams.intervals.length, 1);
  assert.equal(seams.intervals[0].ms, 600_000);
  assert.equal(seams.timeouts.length, 1);
  assert.equal(seams.timeouts[0].ms, 15_000);
  seams.timeouts[0].fn();
  await flushMicrotasks();
  assert.equal(calls, 1);
  seams.intervals[0].fn();
  await flushMicrotasks();
  assert.equal(calls, 2);
  loop.stop();
});

test('automation tick loop: serial re-entry guard skips a tick while a pass is running', async () => {
  const seams = createFakeTimerSeams();
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const loop = startAutomationTickLoop(() => {
    calls += 1;
    return gate;
  }, {
    tickMs: 600_000,
    bootDelayMs: 15_000,
    ...seams,
  });
  loop.tick();
  assert.equal(calls, 1);
  assert.equal(loop.running, true);
  loop.tick();
  seams.intervals[0].fn();
  await flushMicrotasks();
  assert.equal(calls, 1);
  release();
  await flushMicrotasks();
  await flushMicrotasks();
  assert.equal(loop.running, false);
  loop.tick();
  await flushMicrotasks();
  assert.equal(calls, 2);
  loop.stop();
});

test('automation tick loop: stop clears timers and disables further ticks', async () => {
  const seams = createFakeTimerSeams();
  let calls = 0;
  const loop = startAutomationTickLoop(async () => { calls += 1; }, {
    tickMs: 600_000,
    bootDelayMs: 15_000,
    ...seams,
  });
  loop.stop();
  assert.equal(seams.intervals[0].cleared, true);
  assert.equal(seams.timeouts[0].cleared, true);
  seams.timeouts[0].fn();
  seams.intervals[0].fn();
  loop.tick();
  await flushMicrotasks();
  assert.equal(calls, 0);
});

test('automation tick loop: a throwing pass is logged and the loop recovers', async () => {
  const seams = createFakeTimerSeams();
  const logs = [];
  let calls = 0;
  const loop = startAutomationTickLoop(async () => {
    calls += 1;
    if (calls === 1) throw new Error('boom');
  }, {
    tickMs: 600_000,
    bootDelayMs: 15_000,
    log: (message) => logs.push(message),
    ...seams,
  });
  loop.tick();
  await flushMicrotasks();
  await flushMicrotasks();
  assert.match(logs.join('\n'), /boom/);
  assert.equal(loop.running, false);
  loop.tick();
  await flushMicrotasks();
  assert.equal(calls, 2);
  loop.stop();
});

// ---------------------------------------------------------------------------
// DSH stand-down helper
// ---------------------------------------------------------------------------

test('isDshHostExecutorConnected reflects the active bridge lease', () => {
  const bridge = createHostLlmExecutorBridge();
  setActiveHostLlmExecutorBridge(bridge);
  try {
    assert.equal(isDshHostExecutorConnected(), false);
    const detach = bridge.attach(() => undefined);
    assert.equal(isDshHostExecutorConnected(), true);
    detach();
    assert.equal(isDshHostExecutorConnected(), false);
  } finally {
    setActiveHostLlmExecutorBridge(null);
  }
});
