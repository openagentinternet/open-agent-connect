import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  LOOM_PROTOCOLS,
  LOOM_PROTOCOL_PATHS,
  isLoomProtocolName,
  resolveLoomProtocol,
  validateLoomPayload,
} = require('../../dist/core/loom/index.js');

const validTaskPinId = `${'a'.repeat(64)}i0`;
const validClaimPinId = `${'b'.repeat(64)}i1`;
const validDeliveryPinId = `${'c'.repeat(64)}i2`;

function validTaskPayload(overrides = {}) {
  return {
    title: 'Build a MetaWeb music player',
    requirementContentType: 'text/markdown',
    requirement: 'Build playback for metafile music files.',
    criteriaContentType: 'text/markdown',
    criteria: 'Playback works and tests pass.',
    projectBase: 'github',
    project: {
      repoUri: 'https://github.com/openagentinternet/open-agent-connect',
      baseBranch: 'main',
    },
    bounty: {
      amount: '0.001',
      currency: 'BTC',
    },
    deadline: 1750000000000,
    tags: ['frontend', 'music'],
    attachments: ['metafile://task-brief'],
    ...overrides,
  };
}

function validClaimPayload(overrides = {}) {
  return {
    taskPinId: validTaskPinId,
    payoutAddress: '1DeveloperPayoutAddress',
    estimatedStartAt: 1750000000000,
    message: 'I can do this task.',
    ...overrides,
  };
}

function validStatusPayload(overrides = {}) {
  return {
    taskPinId: validTaskPinId,
    claimPinId: validClaimPinId,
    status: 'in_progress',
    progressSummary: 'Finished the UI shell and core playback logic.',
    branchName: 'feat/music-player',
    commits: [
      {
        sha: 'abc1234',
        message: 'feat: add player UI shell',
        files: ['src/player.tsx', 'src/player.css'],
      },
    ],
    processLogs: ['metafile://process-log'],
    artifactUris: ['metafile://preview-build'],
    ...overrides,
  };
}

function validDeliveryPayload(overrides = {}) {
  return {
    taskPinId: validTaskPinId,
    claimPinId: validClaimPinId,
    deliveryBase: 'github',
    deliverySummary: 'Implemented the requested player workflow.',
    delivery: {
      prUrl: 'https://github.com/openagentinternet/open-agent-connect/pull/1',
      prBranch: 'feat/music-player',
      prBaseBranch: 'main',
      prTitle: 'feat: add MetaWeb music player',
    },
    reviewChecklist: [
      {
        item: 'Playback supports metafile music files.',
        status: 'passed',
      },
    ],
    attachments: ['metafile://delivery-notes'],
    ...overrides,
  };
}

function validAcceptancePayload(overrides = {}) {
  return {
    taskPinId: validTaskPinId,
    deliveryPinId: validDeliveryPinId,
    verdict: 'passed',
    score: 5,
    comment: 'Delivery satisfies the acceptance criteria.',
    releasePayment: true,
    paymentTxId: 'payment-tx-id',
    attachments: ['metafile://acceptance-notes'],
    ...overrides,
  };
}

function validClaimRejectPayload(overrides = {}) {
  return {
    taskPinId: validTaskPinId,
    claimPinId: validClaimPinId,
    reason: 'The claim does not match the requested implementation plan.',
    attachments: ['metafile://claim-review'],
    ...overrides,
  };
}

test('maps Loom protocol names to protocol paths', () => {
  assert.equal(LOOM_PROTOCOLS.claim.path, '/protocols/loom-claim');
  assert.equal(resolveLoomProtocol('claim').path, '/protocols/loom-claim');
  assert.equal(resolveLoomProtocol('claim-reject').path, '/protocols/loom-claim-reject');
  assert.deepEqual(LOOM_PROTOCOL_PATHS, [
    '/protocols/loom-task',
    '/protocols/loom-claim',
    '/protocols/loom-status',
    '/protocols/loom-delivery',
    '/protocols/loom-acceptance',
    '/protocols/loom-claim-reject',
  ]);
  assert.equal(isLoomProtocolName('delivery'), true);
  assert.equal(isLoomProtocolName('unknown'), false);
});

test('requires payoutAddress for loom claim payloads', () => {
  const result = validateLoomPayload('claim', { taskPinId: validTaskPinId });

  assert.equal(result.valid, false);
  assert.equal(result.protocol, 'claim');
  assert.equal(result.path, '/protocols/loom-claim');
  assert.ok(result.errors.some((error) => error.path === 'payoutAddress'));
});

test('accepts a valid loom claim payload with payoutAddress', () => {
  const result = validateLoomPayload('claim', validClaimPayload());

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('enforces acceptance payment consistency', () => {
  const passedWithoutPaymentTx = validAcceptancePayload({ paymentTxId: '' });
  const rejectedWithPaymentTx = validAcceptancePayload({
    verdict: 'rejected',
    releasePayment: false,
    paymentTxId: 'payment-tx-id',
  });
  const passedWithPaymentTx = validAcceptancePayload();

  assert.equal(validateLoomPayload('acceptance', passedWithoutPaymentTx).valid, false);
  assert.equal(validateLoomPayload('acceptance', rejectedWithPaymentTx).valid, false);
  assert.equal(validateLoomPayload('acceptance', passedWithPaymentTx).valid, true);
});

test('accepts a valid loom task payload', () => {
  assert.equal(validateLoomPayload('task', validTaskPayload()).valid, true);
});

test('accepts a valid loom status payload', () => {
  assert.equal(validateLoomPayload('status', validStatusPayload()).valid, true);
});

test('accepts a valid loom delivery payload', () => {
  assert.equal(validateLoomPayload('delivery', validDeliveryPayload()).valid, true);
});

test('accepts a valid loom claim-reject payload', () => {
  assert.equal(validateLoomPayload('claim-reject', validClaimRejectPayload()).valid, true);
});

test('reports nested loom task validation errors with qualified paths', () => {
  const result = validateLoomPayload(
    'task',
    validTaskPayload({
      bounty: {
        amount: '0.001',
        currency: 'ETH',
      },
    }),
  );

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.path === 'bounty.currency'));
  assert.equal(result.errors.some((error) => error.path === 'currency'), false);
});

test('reports nested loom status commit errors with qualified paths', () => {
  const result = validateLoomPayload(
    'status',
    validStatusPayload({
      commits: [
        {
          sha: '',
          message: 'feat: add player UI shell',
          files: [''],
        },
      ],
    }),
  );

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.path === 'commits.0.sha'));
  assert.ok(result.errors.some((error) => error.path === 'commits.0.files.0'));
  assert.equal(result.errors.some((error) => error.path === 'sha'), false);
  assert.equal(result.errors.some((error) => error.path === 'files.0'), false);
});
