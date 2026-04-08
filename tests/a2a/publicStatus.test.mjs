import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { mapPublicStatus } = require('../../dist/core/a2a/publicStatus.js');

test('public status mapper covers the required progress and exception labels', () => {
  assert.equal(mapPublicStatus({ event: 'request_sent' }), 'requesting_remote');
  assert.equal(mapPublicStatus({ event: 'provider_received' }), 'remote_received');
  assert.equal(mapPublicStatus({ event: 'provider_executing' }), 'remote_executing');
  assert.equal(mapPublicStatus({ event: 'timeout' }), 'timeout');
  assert.equal(mapPublicStatus({ event: 'provider_failed' }), 'remote_failed');
  assert.equal(mapPublicStatus({ event: 'clarification_needed' }), 'manual_action_required');
});
