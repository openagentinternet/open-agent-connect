import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  listLoomTasksFromCache,
  showLoomTaskFromCache,
} = require('../../dist/core/loom/index.js');

const taskPinId = `${'a'.repeat(64)}i0`;
const claimPinId = `${'b'.repeat(64)}i0`;
const deliveryPinId = `${'c'.repeat(64)}i0`;

function rawRecord(protocol, pinId, payload, timestamp = 1750000000000) {
  return {
    pinId,
    protocol,
    path: `/protocols/loom-${protocol}`,
    operation: 'create',
    contentType: 'application/json',
    timestamp,
    creatorAddress: '1CreatorAddress',
    creatorMetaId: 'metaid-creator',
    globalMetaId: 'global-creator',
    payload,
    payloadValid: true,
    validationErrors: [],
    raw: { id: pinId, content: JSON.stringify(payload) },
  };
}

function cacheState() {
  const task = rawRecord('task', taskPinId, {
    title: 'Add Loom cache',
    requirement: 'Build the raw cache.',
    bounty: { amount: '10', currency: 'SPACE' },
    tags: ['loom', 'cache'],
  });
  const claim = rawRecord('claim', claimPinId, {
    taskPinId,
    payoutAddress: '1DeveloperPayoutAddress',
  });
  const status = rawRecord('status', `${'d'.repeat(64)}i0`, {
    taskPinId,
    claimPinId,
    status: 'in_progress',
    progressSummary: 'Halfway done.',
  });
  const delivery = rawRecord('delivery', deliveryPinId, {
    taskPinId,
    claimPinId,
    deliverySummary: 'Ready for review.',
  });
  const acceptance = rawRecord('acceptance', `${'e'.repeat(64)}i0`, {
    taskPinId,
    deliveryPinId,
    verdict: 'passed',
    releasePayment: true,
    paymentTxId: 'payment-tx',
  });

  return {
    version: 1,
    updatedAt: 1750000000000,
    records: {
      task: [task],
      claim: [claim],
      status: [status],
      delivery: [delivery],
      acceptance: [acceptance],
      'claim-reject': [],
    },
  };
}

test('task list returns task basics and related counts', () => {
  const result = listLoomTasksFromCache(cacheState());

  assert.equal(result.tasks.length, 1);
  assert.deepEqual(result.tasks[0], {
    pinId: taskPinId,
    title: 'Add Loom cache',
    bounty: { amount: '10', currency: 'SPACE' },
    tags: ['loom', 'cache'],
    timestamp: 1750000000000,
    creatorAddress: '1CreatorAddress',
    creatorMetaId: 'metaid-creator',
    globalMetaId: 'global-creator',
    payloadValid: true,
    validationErrors: [],
    relatedCounts: {
      claims: 1,
      statuses: 1,
      deliveries: 1,
      acceptances: 1,
      claimRejects: 0,
    },
  });
});

test('task list does not include derived status', () => {
  const result = listLoomTasksFromCache(cacheState());

  assert.equal(Object.hasOwn(result.tasks[0], 'status'), false);
});

test('show returns task and grouped related records', () => {
  const result = showLoomTaskFromCache(cacheState(), taskPinId);

  assert.equal(result.found, true);
  assert.equal(result.task.pinId, taskPinId);
  assert.equal(result.related.claims.length, 1);
  assert.equal(result.related.statuses.length, 1);
  assert.equal(result.related.deliveries.length, 1);
  assert.equal(result.related.acceptances.length, 1);
  assert.equal(result.related.claimRejects.length, 0);
  assert.equal(Object.hasOwn(result, 'status'), false);
});

test('missing task returns a clear not-found result', () => {
  const missingPinId = `${'f'.repeat(64)}i0`;
  const result = showLoomTaskFromCache(cacheState(), missingPinId);

  assert.deepEqual(result, {
    found: false,
    code: 'task_not_found',
    message: `Loom task not found in cache: ${missingPinId}`,
    taskPinId: missingPinId,
  });
});
