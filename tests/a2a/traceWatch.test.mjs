import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildTraceWatchEvents,
  serializeTraceWatchEvents,
} = require('../../dist/core/a2a/watch/traceWatch.js');

function createSession(overrides = {}) {
  return {
    sessionId: 'session-trace-1',
    traceId: 'trace-1',
    role: 'caller',
    state: 'requesting_remote',
    createdAt: 1_775_000_000_000,
    updatedAt: 1_775_000_000_000,
    callerGlobalMetaId: 'idq-caller',
    providerGlobalMetaId: 'idq-provider',
    servicePinId: 'service-weather',
    currentTaskRunId: 'run-trace-1',
    latestTaskRunState: 'queued',
    ...overrides,
  };
}

function createSnapshot(status, resolvedAt, overrides = {}) {
  return {
    sessionId: 'session-trace-1',
    taskRunId: 'run-trace-1',
    status,
    mapped: true,
    rawEvent: 'should-not-leak',
    resolvedAt,
    ...overrides,
  };
}

test('trace watch emits newline-delimited machine-first public status events', () => {
  const events = buildTraceWatchEvents({
    traceId: 'trace-1',
    sessions: [createSession()],
    snapshots: [
      createSnapshot('requesting_remote', 1_775_000_000_001),
      createSnapshot('remote_received', 1_775_000_000_002),
      createSnapshot('completed', 1_775_000_000_003),
    ],
  });

  assert.deepEqual(events.map((event) => event.status), [
    'requesting_remote',
    'remote_received',
    'completed',
  ]);

  const lines = serializeTraceWatchEvents(events)
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(lines.length, 3);
  assert.equal(lines[0].traceId, 'trace-1');
  assert.equal(lines[2].terminal, true);
});

test('trace watch emits only the public status contract and strips raw transport internals', () => {
  const [event] = buildTraceWatchEvents({
    traceId: 'trace-1',
    sessions: [createSession()],
    snapshots: [
      createSnapshot('requesting_remote', 1_775_000_000_001, {
        rawEvent: 'request_sent',
      }),
    ],
  });

  assert.deepEqual(Object.keys(event).sort(), [
    'observedAt',
    'sessionId',
    'status',
    'taskRunId',
    'terminal',
    'traceId',
  ]);
  assert.equal('rawEvent' in event, false);
  assert.equal('event' in event, false);
});

test('trace watch terminates when a completed status is reached', () => {
  const events = buildTraceWatchEvents({
    traceId: 'trace-1',
    sessions: [createSession()],
    snapshots: [
      createSnapshot('requesting_remote', 1_775_000_000_001),
      createSnapshot('completed', 1_775_000_000_002),
      createSnapshot('remote_failed', 1_775_000_000_003),
    ],
  });

  assert.deepEqual(events.map((event) => event.status), ['requesting_remote', 'completed']);
});

test('trace watch terminates when manual action is required', () => {
  const events = buildTraceWatchEvents({
    traceId: 'trace-1',
    sessions: [createSession()],
    snapshots: [
      createSnapshot('remote_received', 1_775_000_000_001),
      createSnapshot('manual_action_required', 1_775_000_000_002),
      createSnapshot('completed', 1_775_000_000_003),
    ],
  });

  assert.deepEqual(events.map((event) => event.status), ['remote_received', 'manual_action_required']);
});

test('trace watch terminates when timeout is handed off as a public timeout state', () => {
  const events = buildTraceWatchEvents({
    traceId: 'trace-1',
    sessions: [createSession()],
    snapshots: [
      createSnapshot('remote_received', 1_775_000_000_001),
      createSnapshot('timeout', 1_775_000_000_002),
      createSnapshot('completed', 1_775_000_000_003),
    ],
  });

  assert.deepEqual(events.map((event) => event.status), ['remote_received', 'timeout']);
});
