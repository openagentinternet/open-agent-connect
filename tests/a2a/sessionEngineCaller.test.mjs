import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  createA2ASessionEngine,
} = require('../../dist/core/a2a/sessionEngine.js');

function createEngine() {
  let sequence = 0;
  return createA2ASessionEngine({
    now: () => 1_744_444_444_000 + (sequence += 1),
    createSessionId: () => 'session-caller-1',
    createTaskRunId: () => 'run-caller-1',
  });
}

test('caller session creation builds a session, task run, and stable linkage from a confirmed delegation', () => {
  const engine = createEngine();

  const first = engine.startCallerSession({
    traceId: 'trace-weather-order-123456789',
    servicePinId: 'pin-weather',
    callerGlobalMetaId: 'idq-caller',
    providerGlobalMetaId: 'idq-provider',
    userTask: 'What is the weather tomorrow?',
    taskContext: 'User is in Shanghai.',
  });
  const secondLinkage = engine.buildSessionLinkage({
    traceId: 'trace-weather-order-123456789',
    providerGlobalMetaId: 'idq-provider',
    sessionId: 'session-caller-1',
  });

  assert.equal(first.session.role, 'caller');
  assert.equal(first.session.state, 'requesting_remote');
  assert.equal(first.taskRun.state, 'queued');
  assert.equal(first.event, 'request_sent');
  assert.equal(first.publicStatus, 'requesting_remote');
  assert.equal(first.linkage.coworkSessionId, 'session-caller-1');
  assert.equal(first.linkage.externalConversationId, secondLinkage.externalConversationId);
  assert.match(first.linkage.externalConversationId, /^metaweb_order:buyer:idq-provider:/);
});

test('foreground timeout becomes public timeout without forcing failed state', () => {
  const engine = createEngine();
  const started = engine.startCallerSession({
    traceId: 'trace-weather-order-123456789',
    servicePinId: 'pin-weather',
    callerGlobalMetaId: 'idq-caller',
    providerGlobalMetaId: 'idq-provider',
    userTask: 'What is the weather tomorrow?',
    taskContext: '',
  });

  const timedOut = engine.markForegroundTimeout({
    session: started.session,
    taskRun: started.taskRun,
  });

  assert.equal(timedOut.session.state, 'timeout');
  assert.equal(timedOut.taskRun.state, 'timeout');
  assert.equal(timedOut.taskRun.failureCode, null);
  assert.equal(timedOut.event, 'timeout');
  assert.equal(timedOut.publicStatus, 'timeout');
});
