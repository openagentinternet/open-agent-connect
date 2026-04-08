import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  mapPublicStatus,
  resolvePublicStatus,
} = require('../../dist/core/a2a/publicStatus.js');

test('public status mapper covers the required progress and exception labels', () => {
  assert.equal(mapPublicStatus({ event: 'request_sent' }), 'requesting_remote');
  assert.equal(mapPublicStatus({ event: 'provider_received' }), 'remote_received');
  assert.equal(mapPublicStatus({ event: 'provider_executing' }), 'remote_executing');
  assert.equal(mapPublicStatus({ event: 'timeout' }), 'timeout');
  assert.equal(mapPublicStatus({ event: 'provider_failed' }), 'remote_failed');
  assert.equal(mapPublicStatus({ event: 'clarification_needed' }), 'manual_action_required');
});

test('provider completion maps to completed', () => {
  assert.equal(mapPublicStatus({ event: 'provider_completed' }), 'completed');
});

test('resolvePublicStatus surfaces raw unknown events via resolution metadata', () => {
  const resolution = resolvePublicStatus({ event: 'provider_cancelled' });
  assert.equal(resolution.status, 'local_runtime_error');
  assert.equal(resolution.rawEvent, 'provider_cancelled');
  assert.equal(mapPublicStatus({}), 'local_runtime_error');
});

test('prototype-edge event names do not slip through the resolver', () => {
  const resolution = resolvePublicStatus({ event: 'toString' });
  assert.equal(resolution.status, 'local_runtime_error');
  assert.equal(resolution.rawEvent, 'toString');
});

test('mapPublicStatus handles missing input by surfacing the exception state', () => {
  assert.equal(mapPublicStatus(undefined), 'local_runtime_error');
});
