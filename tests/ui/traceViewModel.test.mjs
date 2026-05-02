import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildSessionListViewModel,
  buildSessionDetailViewModel,
} = require('../../dist/ui/pages/trace/viewModel.js');

const NOW = 1_775_000_100_000;

test('buildSessionListViewModel returns empty array for no sessions', () => {
  const result = buildSessionListViewModel([], NOW);
  assert.deepEqual(result, []);
});

test('buildSessionListViewModel skips entries without sessionId', () => {
  const result = buildSessionListViewModel([{}, { sessionId: '' }, null, 42], NOW);
  assert.equal(result.length, 0);
});

test('buildSessionListViewModel maps a caller session correctly', () => {
  const rawSession = {
    sessionId: 'session-abc',
    traceId: 'trace-abc',
    role: 'caller',
    state: 'completed',
    createdAt: NOW - 60000,
    updatedAt: NOW - 5000,
    localMetabotName: 'Alice',
    localMetabotGlobalMetaId: 'gm-alice',
    peerGlobalMetaId: 'gm-bob',
    peerName: 'Bob Bot',
    servicePinId: 'pin-svc-1',
  };
  const [item] = buildSessionListViewModel([rawSession], NOW);

  assert.equal(item.sessionId, 'session-abc');
  assert.equal(item.role, 'caller');
  assert.equal(item.state, 'completed');
  assert.equal(item.stateTone, 'completed');
  assert.equal(item.stateLabel, 'Completed');
  assert.equal(item.localMetabotName, 'Alice');
  assert.equal(item.peerGlobalMetaId, 'gm-bob');
  assert.equal(item.peerName, 'Bob Bot');
  assert.equal(item.timeAgoMs, 5000);
});

test('buildSessionListViewModel maps state tones correctly', () => {
  const cases = [
    { state: 'requesting_remote',    expected: 'active' },
    { state: 'remote_received',      expected: 'active' },
    { state: 'remote_executing',     expected: 'active' },
    { state: 'completed',            expected: 'completed' },
    { state: 'remote_failed',        expected: 'failure' },
    { state: 'timeout',              expected: 'timeout' },
    { state: 'manual_action_required', expected: 'manual' },
    { state: 'discovered',           expected: 'neutral' },
  ];

  for (const { state, expected } of cases) {
    const [item] = buildSessionListViewModel([{
      sessionId: 'x',
      role: 'caller',
      state,
      updatedAt: NOW,
    }], NOW);
    assert.equal(item.stateTone, expected, `State "${state}" should map to tone "${expected}"`);
  }
});

test('buildSessionListViewModel treats active sessions stale >15min as timeout', () => {
  const STALE = 16 * 60 * 1000; // 16 minutes
  for (const state of ['requesting_remote', 'remote_received', 'remote_executing']) {
    const [item] = buildSessionListViewModel([{
      sessionId: 'x',
      role: 'caller',
      state,
      updatedAt: NOW - STALE,
    }], NOW);
    assert.equal(item.stateTone, 'timeout', `Stale "${state}" should map to tone "timeout"`);
    assert.equal(item.stateLabel, 'Timeout', `Stale "${state}" should have label "Timeout"`);
  }
  // Fresh active session should still be active
  const [fresh] = buildSessionListViewModel([{
    sessionId: 'y',
    role: 'caller',
    state: 'requesting_remote',
    updatedAt: NOW - 60000,
  }], NOW);
  assert.equal(fresh.stateTone, 'active');
});

test('buildSessionDetailViewModel returns null for missing session', () => {
  assert.equal(buildSessionDetailViewModel({}), null);
  assert.equal(buildSessionDetailViewModel({ session: null }), null);
  assert.equal(buildSessionDetailViewModel({ session: 42 }), null);
});

test('buildSessionDetailViewModel builds session detail with messages', () => {
  const payload = {
    session: {
      sessionId: 'session-xyz',
      traceId: 'trace-xyz',
      role: 'caller',
      state: 'completed',
      createdAt: NOW - 90000,
      updatedAt: NOW - 1000,
      callerGlobalMetaId: 'gm-caller',
      providerGlobalMetaId: 'gm-provider',
      servicePinId: 'pin-svc-2',
    },
    localMetabotName: 'Alice',
    localMetabotGlobalMetaId: 'gm-caller',
    peerGlobalMetaId: 'gm-provider',
    transcriptItems: [
      {
        id: 'msg-1',
        sessionId: 'session-xyz',
        timestamp: NOW - 80000,
        type: 'user_task',
        sender: 'caller',
        content: 'What is the weather?',
        metadata: null,
      },
      {
        id: 'msg-2',
        sessionId: 'session-xyz',
        timestamp: NOW - 50000,
        type: 'assistant',
        sender: 'provider',
        content: 'It will be sunny.',
        metadata: null,
      },
      {
        id: 'msg-3',
        sessionId: 'session-xyz',
        timestamp: NOW - 80500,
        type: 'system',
        sender: 'system',
        content: 'Session started.',
        metadata: null,
      },
    ],
  };

  const detail = buildSessionDetailViewModel(payload);

  assert.ok(detail !== null);
  assert.equal(detail.sessionId, 'session-xyz');
  assert.equal(detail.role, 'caller');
  assert.equal(detail.localMetabotName, 'Alice');
  assert.equal(detail.peerGlobalMetaId, 'gm-provider');
  assert.equal(detail.messages.length, 3);

  // Sorted by timestamp ascending
  assert.equal(detail.messages[0].id, 'msg-3');  // earliest
  assert.equal(detail.messages[1].id, 'msg-1');
  assert.equal(detail.messages[2].id, 'msg-2');

  // Tone assignment: caller session, caller sender → local; provider sender → peer
  assert.equal(detail.messages[0].tone, 'system');
  assert.equal(detail.messages[1].tone, 'local');   // caller in caller session
  assert.equal(detail.messages[2].tone, 'peer');    // provider in caller session
});

test('buildSessionDetailViewModel reads legacy trace messages from inspector transcript fallback', () => {
  const detail = buildSessionDetailViewModel({
    session: {
      sessionId: 'session-legacy',
      traceId: 'trace-legacy',
      role: 'caller',
      state: 'completed',
    },
    inspector: {
      transcriptItems: [
        {
          id: 'legacy-delivery',
          sessionId: 'session-legacy',
          timestamp: NOW,
          type: 'delivery',
          sender: 'provider',
          content: '# Forecast\n\nSunny.',
          metadata: null,
        },
      ],
    },
  });

  assert.ok(detail !== null);
  assert.equal(detail.messages.length, 1);
  assert.equal(detail.messages[0].id, 'legacy-delivery');
  assert.equal(detail.messages[0].content, '# Forecast\n\nSunny.');
});

test('buildSessionDetailViewModel assigns tool tone for tool_use and tool_result', () => {
  const payload = {
    session: {
      sessionId: 's1',
      role: 'provider',
      state: 'completed',
      callerGlobalMetaId: 'gm-caller',
      providerGlobalMetaId: 'gm-provider',
    },
    transcriptItems: [
      { id: 't1', sessionId: 's1', timestamp: 100, type: 'tool_use', sender: 'provider', content: 'search', metadata: null },
      { id: 't2', sessionId: 's1', timestamp: 200, type: 'tool_result', sender: 'provider', content: 'result', metadata: null },
    ],
  };

  const detail = buildSessionDetailViewModel(payload);
  assert.ok(detail !== null);
  assert.equal(detail.messages[0].tone, 'tool');
  assert.equal(detail.messages[1].tone, 'tool');
});

test('buildSessionDetailViewModel skips transcript items without id', () => {
  const payload = {
    session: { sessionId: 's1', role: 'caller', state: 'completed' },
    transcriptItems: [
      { id: '', sessionId: 's1', timestamp: 100, type: 'user_task', sender: 'caller', content: 'hi' },
      { id: 'm1', sessionId: 's1', timestamp: 200, type: 'assistant', sender: 'provider', content: 'hello' },
    ],
  };

  const detail = buildSessionDetailViewModel(payload);
  assert.ok(detail !== null);
  assert.equal(detail.messages.length, 1);
  assert.equal(detail.messages[0].id, 'm1');
});
