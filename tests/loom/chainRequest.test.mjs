import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildLoomChainWriteRequest,
} = require('../../dist/core/loom/index.js');

const validTaskPinId = `${'a'.repeat(64)}i0`;

function validClaimPayload(overrides = {}) {
  return {
    taskPinId: validTaskPinId,
    payoutAddress: '1DeveloperPayoutAddress',
    estimatedStartAt: 1750000000000,
    message: 'I can do this task.',
    ...overrides,
  };
}

test('builds a valid loom claim chain write request with stringified payload', () => {
  const payload = validClaimPayload();
  const result = buildLoomChainWriteRequest('claim', payload);

  assert.equal(result.validation.valid, true);
  assert.deepEqual(result.request, {
    operation: 'create',
    path: '/protocols/loom-claim',
    encryption: '0',
    version: '1.0.0',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
  });
  assert.equal(typeof result.request.payload, 'string');
  assert.deepEqual(JSON.parse(result.request.payload), payload);
});

test('returns validation errors for invalid loom claim chain requests', () => {
  const result = buildLoomChainWriteRequest('claim', {
    taskPinId: validTaskPinId,
  });

  assert.equal(result.request, null);
  assert.equal(result.code, 'invalid_payload');
  assert.equal(result.validation.valid, false);
  assert.equal(result.validation.protocol, 'claim');
  assert.equal(result.validation.path, '/protocols/loom-claim');
  assert.ok(result.validation.errors.some((error) => error.path === 'payoutAddress'));
});
