// Surf failure taxonomy: bootstrap import classification (missing / denied /
// build-in-progress), failure-code classification, backoff math, and the
// pre-dream circuit breaker computed from run history.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const {
  SURF_BUILD_MARKER_FILE,
  SURF_FAILURE_BACKOFF_MAX_MS,
  SURF_FAILURE_CIRCUIT_OPEN_COOLDOWN_MS,
  SURF_FAILURE_CIRCUIT_OPEN_THRESHOLD,
  classifySurfBootstrapError,
  classifySurfLlmFailureCode,
  computeSurfCircuitState,
  computeSurfFailureBackoffMs,
  formatSurfCircuitNotice,
  normalizeSurfRunFailure,
  surfPreDreamDeferral,
  tagSurfBootstrapError,
  toSurfRunFailure,
} = require('../../dist/core/surf/failure.js');

const T0 = Date.parse('2026-09-30T00:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();
const failedRun = (ms, code) => ({
  status: 'failed',
  finishedAt: iso(ms),
  ...(code ? { failure: { stage: 'session', code, message: 'x' } } : {}),
});

test('bootstrap classification: missing vs denied vs build-in-progress', () => {
  assert.equal(classifySurfBootstrapError(Object.assign(new Error('x'), { code: 'EPERM' }), { buildInProgress: false }), 'MODULE_LOAD_DENIED');
  assert.equal(classifySurfBootstrapError(Object.assign(new Error('x'), { code: 'EACCES' }), { buildInProgress: false }), 'MODULE_LOAD_DENIED');
  assert.equal(classifySurfBootstrapError(Object.assign(new Error('x'), { code: 'EPERM' }), { buildInProgress: true }), 'BUILD_IN_PROGRESS');
  assert.equal(classifySurfBootstrapError(Object.assign(new Error('x'), { code: 'ENOENT' }), { buildInProgress: false }), 'MODULE_NOT_FOUND');
  assert.equal(classifySurfBootstrapError(Object.assign(new Error('x'), { code: 'ERR_MODULE_NOT_FOUND' }), { buildInProgress: true }), 'BUILD_IN_PROGRESS');
  assert.equal(classifySurfBootstrapError(Object.assign(new Error('x'), { code: 'MODULE_NOT_FOUND' }), { buildInProgress: false }), 'MODULE_NOT_FOUND');
  assert.equal(classifySurfBootstrapError(new Error('plain'), { buildInProgress: true }), 'UNKNOWN');
});

test('exponential backoff: 30m base, doubling, 6h cap', () => {
  assert.equal(computeSurfFailureBackoffMs(1), 30 * 60_000);
  assert.equal(computeSurfFailureBackoffMs(2), 60 * 60_000);
  assert.equal(computeSurfFailureBackoffMs(3), 120 * 60_000);
  assert.equal(computeSurfFailureBackoffMs(4), 240 * 60_000);
  assert.equal(computeSurfFailureBackoffMs(5), SURF_FAILURE_BACKOFF_MAX_MS);
  assert.equal(computeSurfFailureBackoffMs(12), SURF_FAILURE_BACKOFF_MAX_MS);
});

test('circuit: no history or a trailing done run stays ok', () => {
  assert.deepEqual(computeSurfCircuitState([], T0), {
    reason: 'ok',
    consecutiveFailures: 0,
    sameCodeFailures: 0,
    lastFailureCode: null,
    lastFailureAt: null,
    backoffUntilMs: null,
  });
  const runs = [failedRun(T0, 'LLM_RUNTIME_UNAVAILABLE'), { status: 'done', finishedAt: iso(T0 + 60_000), failure: null }];
  // Newest row is the done run here — reorder newest first as the store returns.
  const state = computeSurfCircuitState([runs[1], runs[0]], T0 + 120_000);
  assert.equal(state.reason, 'ok');
  assert.equal(state.consecutiveFailures, 0);
});

test('circuit: one failure backs off 30 minutes, then clears', () => {
  const runs = [failedRun(T0, 'LLM_RUNTIME_UNAVAILABLE')];
  const during = computeSurfCircuitState(runs, T0 + 60_000);
  assert.equal(during.reason, 'backoff');
  assert.equal(during.consecutiveFailures, 1);
  assert.equal(during.sameCodeFailures, 1);
  assert.equal(during.lastFailureCode, 'LLM_RUNTIME_UNAVAILABLE');
  assert.equal(during.backoffUntilMs, T0 + 30 * 60_000);
  const after = computeSurfCircuitState(runs, T0 + 31 * 60_000);
  assert.equal(after.reason, 'ok');
  // The streak is still reported for diagnostics even once the delay elapsed.
  assert.equal(after.consecutiveFailures, 1);
});

test('circuit: a same-code streak opens the breaker for 24h; mixed codes count per class', () => {
  const streak = [];
  for (let index = 0; index < SURF_FAILURE_CIRCUIT_OPEN_THRESHOLD; index += 1) {
    streak.unshift(failedRun(T0 + index * 60_000, 'LLM_RUNTIME_UNAVAILABLE'));
  }
  const open = computeSurfCircuitState(streak, T0 + 10 * 60_000);
  assert.equal(open.reason, 'open');
  assert.equal(open.consecutiveFailures, SURF_FAILURE_CIRCUIT_OPEN_THRESHOLD);
  assert.equal(open.sameCodeFailures, SURF_FAILURE_CIRCUIT_OPEN_THRESHOLD);
  assert.equal(open.backoffUntilMs, T0 + (SURF_FAILURE_CIRCUIT_OPEN_THRESHOLD - 1) * 60_000 + SURF_FAILURE_CIRCUIT_OPEN_COOLDOWN_MS);

  // Newest failure carries a different code: its class has only one strike.
  const mixed = [failedRun(T0 + 4 * 60_000, 'MODULE_LOAD_DENIED'), ...streak.slice(1)];
  const perClass = computeSurfCircuitState(mixed, T0 + 10 * 60_000);
  assert.equal(perClass.reason, 'backoff');
  assert.equal(perClass.sameCodeFailures, 1);
  assert.equal(perClass.consecutiveFailures, SURF_FAILURE_CIRCUIT_OPEN_THRESHOLD);
  assert.equal(perClass.backoffUntilMs, T0 + 4 * 60_000 + 30 * 60_000);
});

test('circuit: running rows do not break the streak; legacy failures count as UNKNOWN', () => {
  const runs = [
    { status: 'running', finishedAt: null, failure: null },
    failedRun(T0, 'EPERM-ish'),
    failedRun(T0 - 60_000),
  ];
  const state = computeSurfCircuitState(runs, T0 + 60_000);
  assert.equal(state.consecutiveFailures, 2);
  assert.equal(state.lastFailureCode, 'EPERM-ish');
  assert.equal(state.sameCodeFailures, 1);
});

test('failure-code classification from messages and stages', () => {
  const llm = toSurfRunFailure(new Error('No healthy LLM runtime is available for MetaBot bob.'), 'session');
  assert.equal(llm.code, 'LLM_RUNTIME_UNAVAILABLE');
  assert.equal(llm.stage, 'session');
  assert.match(llm.stack, /Error:/);
  const turn = toSurfRunFailure(new Error('LLM runtime timed out while running prompt.'), 'session');
  assert.equal(turn.code, 'LLM_TURN_FAILED');
  const watchdog = toSurfRunFailure(new Error('Surf watchdog: wall-clock budget exhausted — write the final report now.'), 'session');
  assert.equal(watchdog.code, 'WATCHDOG_TIMEOUT');
  const briefing = toSurfRunFailure(new Error('fetch failed'), 'briefing');
  assert.equal(briefing.code, 'BRIEFING_FAILED');
  const commit = toSurfRunFailure(new Error('disk full'), 'commit');
  assert.equal(commit.code, 'COMMIT_FAILED');
  const generic = toSurfRunFailure(new Error('mystery'), 'session');
  assert.equal(generic.code, 'SESSION_FAILED');
  const withContext = toSurfRunFailure(new Error('x'), 'session', { llm: { connectedExecutors: 0 } });
  assert.deepEqual(withContext.context, { llm: { connectedExecutors: 0 } });
  assert.equal(classifySurfLlmFailureCode('No healthy LLM runtime is available for MetaBot bob.'), 'LLM_RUNTIME_UNAVAILABLE');
  assert.equal(classifySurfLlmFailureCode('LLM runtime completed without returning output.'), 'LLM_TURN_FAILED');
});

test('normalizeSurfRunFailure: defensive reads of persisted payloads', () => {
  assert.equal(normalizeSurfRunFailure(null), null);
  assert.equal(normalizeSurfRunFailure('garbage'), null);
  assert.equal(normalizeSurfRunFailure({ stage: 'session' }), null);
  const kept = normalizeSurfRunFailure({ stage: 'session', code: 'FUTURE_CODE', message: 'm', context: { a: 1 } });
  assert.equal(kept.code, 'FUTURE_CODE');
  assert.deepEqual(kept.context, { a: 1 });
  const unknownStage = normalizeSurfRunFailure({ stage: 'weird', code: 'X', message: 'm' });
  assert.equal(unknownStage.stage, 'lifecycle');
});

test('tagSurfBootstrapError: EPERM without a build marker is a denial, not a build race', async () => {
  const distDir = await mkdtempTempRoot('metabot-surf-dist-');
  const original = Object.assign(
    new Error(`EPERM: operation not permitted, open '${path.join(distDir, 'core/surf/turn.js')}'`),
    { code: 'EPERM' },
  );
  const tagged = await tagSurfBootstrapError(original, { distDir, nowMs: T0 });
  assert.equal(tagged.surfFailure.stage, 'bootstrap');
  assert.equal(tagged.surfFailure.code, 'MODULE_LOAD_DENIED');
  assert.match(tagged.message, /Surf bootstrap failed/);
  assert.match(tagged.message, /refused to open/);
  assert.equal(tagged.surfFailure.context.dist.exists, true);
  assert.equal(tagged.surfFailure.context.dist.buildInProgress, false);
  assert.equal(tagged.surfFailure.context.originalMessage, original.message);
  assert.ok(tagged.surfFailure.context.module.endsWith('core/surf/turn.js'));
});

test('tagSurfBootstrapError: a fresh build marker reclassifies ENOENT as build-in-progress', async () => {
  const distDir = await mkdtempTempRoot('metabot-surf-dist-');
  await fs.writeFile(path.join(distDir, SURF_BUILD_MARKER_FILE), JSON.stringify({ pid: 1, startedAt: iso(T0 - 60_000) }));
  const original = Object.assign(new Error(`ENOENT: no such file or directory, open '${distDir}/core/surf/turn.js'`), { code: 'ENOENT' });
  const tagged = await tagSurfBootstrapError(original, { distDir, nowMs: T0 });
  assert.equal(tagged.surfFailure.code, 'BUILD_IN_PROGRESS');
  assert.match(tagged.message, /build is currently replacing dist/);
  assert.equal(tagged.surfFailure.context.dist.buildInProgress, true);
  assert.equal(tagged.surfFailure.context.dist.buildStartedAt, iso(T0 - 60_000));
});

test('tagSurfBootstrapError: a stale marker from a crashed build is ignored (and flagged)', async () => {
  const distDir = await mkdtempTempRoot('metabot-surf-dist-');
  const markerPath = path.join(distDir, SURF_BUILD_MARKER_FILE);
  await fs.writeFile(markerPath, JSON.stringify({ pid: 1, startedAt: iso(T0 - 60 * 60_000) }));
  const stale = new Date(T0 - 45 * 60_000);
  await fs.utimes(markerPath, stale, stale);
  const original = Object.assign(new Error(`ENOENT: no such file or directory, open '${distDir}/core/surf/turn.js'`), { code: 'ENOENT' });
  const tagged = await tagSurfBootstrapError(original, { distDir, nowMs: T0 });
  assert.equal(tagged.surfFailure.code, 'MODULE_NOT_FOUND');
  assert.equal(tagged.surfFailure.context.dist.staleBuildMarker, true);
});

test('deferral + notice: owner-facing surfaces explain the pause', () => {
  const runs = [failedRun(T0, 'LLM_RUNTIME_UNAVAILABLE')];
  const circuit = computeSurfCircuitState(runs, T0 + 60_000);
  const deferral = surfPreDreamDeferral(circuit);
  assert.equal(deferral.reason, 'backoff');
  assert.equal(deferral.consecutiveFailures, 1);
  assert.equal(deferral.nextAttemptAt, iso(T0 + 30 * 60_000));
  assert.match(formatSurfCircuitNotice(circuit), /backing off after 1 consecutive failure/);
  assert.equal(surfPreDreamDeferral(computeSurfCircuitState([], T0)), null);
  assert.equal(formatSurfCircuitNotice(null), null);
  const openCircuit = computeSurfCircuitState(
    Array.from({ length: 5 }, (_, index) => failedRun(T0 + index * 60_000, 'LLM_RUNTIME_UNAVAILABLE')).reverse(),
    T0 + 10 * 60_000,
  );
  assert.match(formatSurfCircuitNotice(openCircuit), /PAUSED by the failure circuit breaker/);
});
