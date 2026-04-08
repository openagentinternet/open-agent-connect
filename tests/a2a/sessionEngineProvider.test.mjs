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
  assert.equal(received.publicStatus, 'remote_received');
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
  assert.equal(completed.publicStatus, 'completed');
});

test('one clarification round is accepted, and a second request is guarded', () => {
  const engine = createEngine();
  const received = engine.receiveProviderTask({
    traceId: 'trace-weather-order-123456789',
    servicePinId: 'pin-weather',
    callerGlobalMetaId: 'idq-caller',
    providerGlobalMetaId: 'idq-provider',
    userTask: 'What is the weather tomorrow?',
    taskContext: '',
  });

  const firstClarification = engine.applyProviderRunnerResult({
    session: received.session,
    taskRun: received.taskRun,
    result: {
      state: 'needs_clarification',
      question: 'Which city should I use?',
    },
  });

  assert.equal(firstClarification.accepted, true);
  assert.equal(firstClarification.session.state, 'manual_action_required');
  assert.equal(firstClarification.taskRun.state, 'needs_clarification');
  assert.equal(firstClarification.taskRun.clarificationRounds.length, 1);
  assert.equal(firstClarification.taskRun.clarificationRounds[0].status, 'pending');
  assert.equal(firstClarification.event, 'clarification_needed');
  assert.equal(firstClarification.publicStatus, 'manual_action_required');

  const resumed = engine.answerClarification({
    session: firstClarification.session,
    taskRun: firstClarification.taskRun,
    answer: 'Shanghai',
  });

  assert.equal(resumed.accepted, true);
  assert.equal(resumed.taskRun.state, 'running');
  assert.equal(resumed.taskRun.clarificationRounds[0].status, 'answered');
  assert.equal(resumed.taskRun.clarificationRounds[0].answer, 'Shanghai');

  const secondClarification = engine.applyProviderRunnerResult({
    session: resumed.session,
    taskRun: resumed.taskRun,
    result: {
      state: 'needs_clarification',
      question: 'And what time of day?',
    },
  });

  assert.equal(secondClarification.accepted, false);
  assert.equal(secondClarification.session.state, 'manual_action_required');
  assert.equal(secondClarification.taskRun.clarificationRounds.length, 1);
  assert.equal(secondClarification.guardCode, 'clarification_round_limit_exceeded');
  assert.equal(secondClarification.publicStatus, 'manual_action_required');
});
