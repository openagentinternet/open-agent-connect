import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  createA2ASessionEngine,
} = require('../../dist/core/a2a/sessionEngine.js');
const {
  resolvePublicStatus,
} = require('../../dist/core/a2a/publicStatus.js');

function createEngine() {
  let sequence = 0;
  return createA2ASessionEngine({
    now: () => 1_744_444_445_000 + (sequence += 1),
    createSessionId: () => 'session-provider-1',
    createTaskRunId: () => 'run-provider-1',
  });
}

test('provider receives a task request and moves to remote_received', () => {
  const engine = createEngine();

  const received = engine.receiveProviderTask({
    traceId: 'trace-weather-order-123456789',
    servicePinId: 'pin-weather',
    callerGlobalMetaId: 'idq-caller',
    providerGlobalMetaId: 'idq-provider',
    userTask: 'What is the weather tomorrow?',
    taskContext: 'User is in Shanghai.',
  });

  assert.equal(received.session.role, 'provider');
  assert.equal(received.session.state, 'remote_received');
  assert.equal(received.taskRun.state, 'running');
  assert.equal(received.event, 'provider_received');
  assert.equal(resolvePublicStatus({ event: received.event }).status, 'remote_received');
  assert.equal(received.runnerResult, null);
});

test('provider runner completion produces a terminal completion', () => {
  const engine = createEngine();
  const received = engine.receiveProviderTask({
    traceId: 'trace-weather-order-123456789',
    servicePinId: 'pin-weather',
    callerGlobalMetaId: 'idq-caller',
    providerGlobalMetaId: 'idq-provider',
    userTask: 'What is the weather tomorrow?',
    taskContext: '',
  });

  const completed = engine.applyProviderRunnerResult({
    session: received.session,
    taskRun: received.taskRun,
    result: {
      state: 'completed',
      responseText: 'Tomorrow will be bright.',
    },
  });

  assert.equal(completed.session.state, 'completed');
  assert.equal(completed.taskRun.state, 'completed');
  assert.equal(completed.event, 'provider_completed');
  assert.equal(resolvePublicStatus({ event: completed.event }).status, 'completed');
  assert.deepEqual(completed.runnerResult, {
    state: 'completed',
    responseText: 'Tomorrow will be bright.',
  });
});

test('a needs_clarification runner outcome is finalized as a terminal failure', () => {
  const engine = createEngine();
  const received = engine.receiveProviderTask({
    traceId: 'trace-weather-order-123456789',
    servicePinId: 'pin-weather',
    callerGlobalMetaId: 'idq-caller',
    providerGlobalMetaId: 'idq-provider',
    userTask: 'What is the weather tomorrow?',
    taskContext: '',
  });

  const failed = engine.applyProviderRunnerResult({
    session: received.session,
    taskRun: received.taskRun,
    result: {
      state: 'needs_clarification',
      question: 'Which city should I use?',
    },
  });

  assert.equal(failed.session.state, 'remote_failed');
  assert.equal(failed.taskRun.state, 'failed');
  assert.equal(failed.taskRun.failureCode, 'clarification_not_supported');
  assert.equal(failed.taskRun.failureReason, 'Which city should I use?');
  assert.ok(failed.taskRun.completedAt);
  assert.equal(failed.event, 'provider_failed');
  assert.equal(resolvePublicStatus({ event: failed.event }).status, 'remote_failed');
  assert.deepEqual(failed.runnerResult, {
    state: 'needs_clarification',
    question: 'Which city should I use?',
  });
});
