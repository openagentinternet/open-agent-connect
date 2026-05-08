import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  commandSuccess,
  commandWaiting,
  commandManualActionRequired,
  commandFailed
} = require('../../dist/core/contracts/commandResult.js');

test('success returns ok: true', () => {
  const result = commandSuccess({ id: 'task-1' });
  assert.equal(result.ok, true);
  assert.equal(result.state, 'success');
  assert.deepEqual(result.data, { id: 'task-1' });
});

test('waiting returns ok: false with pollAfterMs', () => {
  const result = commandWaiting('WAITING_FOR_RESOURCE', 'waiting', 3000);
  assert.equal(result.ok, false);
  assert.equal(result.state, 'waiting');
  assert.equal(result.code, 'WAITING_FOR_RESOURCE');
  assert.equal(result.message, 'waiting');
  assert.equal(result.pollAfterMs, 3000);
});

test('waiting can carry localUiUrl and data', () => {
  const result = commandWaiting('ORDER_SENT', 'waiting for provider', 3000, {
    localUiUrl: 'http://127.0.0.1:5555/ui/trace?traceId=t1',
    data: { traceId: 't1', serviceName: 'test-service' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.state, 'waiting');
  assert.equal(result.pollAfterMs, 3000);
  assert.equal(result.localUiUrl, 'http://127.0.0.1:5555/ui/trace?traceId=t1');
  assert.deepEqual(result.data, { traceId: 't1', serviceName: 'test-service' });
});

test('waiting without options omits localUiUrl and data', () => {
  const result = commandWaiting('SOME_CODE', 'msg', 1000);
  assert.equal(result.localUiUrl, undefined);
  assert.equal(result.data, undefined);
});

test('manual_action_required can carry a local UI URL', () => {
  const result = commandManualActionRequired(
    'REQUIRES_LOCAL_APPROVAL',
    'approve in local UI',
    'http://127.0.0.1:4455/approve'
  );
  assert.equal(result.ok, false);
  assert.equal(result.state, 'manual_action_required');
  assert.equal(result.code, 'REQUIRES_LOCAL_APPROVAL');
  assert.equal(result.message, 'approve in local UI');
  assert.equal(result.localUiUrl, 'http://127.0.0.1:4455/approve');
});

test('manual_action_required can carry structured data', () => {
  const result = commandManualActionRequired(
    'REFUND_BLOCKED',
    'refund settlement requires operator action',
    {
      localUiUrl: 'http://127.0.0.1:4455/ui/refund',
      data: { orderId: 'seller-order-1', blockingReason: 'refund_request_missing' },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.state, 'manual_action_required');
  assert.equal(result.localUiUrl, 'http://127.0.0.1:4455/ui/refund');
  assert.deepEqual(result.data, {
    orderId: 'seller-order-1',
    blockingReason: 'refund_request_missing',
  });
});

test('failed returns ok: false and preserves code and message', () => {
  const result = commandFailed('PERMISSION_DENIED', 'not allowed');
  assert.equal(result.ok, false);
  assert.equal(result.state, 'failed');
  assert.equal(result.code, 'PERMISSION_DENIED');
  assert.equal(result.message, 'not allowed');
});
