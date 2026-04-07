import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  applyHeartbeatOnlineState,
  filterOnlineChainServices,
  HEARTBEAT_ONLINE_WINDOW_SEC,
} = require('../../dist/core/discovery/chainHeartbeatDirectory.js');

const NOW_MS = 1_775_000_000_000;
const BASE_SERVICE = {
  servicePinId: 'service-pin-1',
  sourceServicePinId: 'service-pin-1',
  chainPinIds: ['service-pin-1'],
  providerGlobalMetaId: 'idq1provider',
  providerMetaId: 'metaid-provider',
  providerAddress: 'mvc-provider-address',
  serviceName: 'weather-oracle',
  displayName: 'Weather Oracle',
  description: 'Returns tomorrow weather.',
  price: '0.00001',
  currency: 'SPACE',
  serviceIcon: null,
  providerSkill: 'metabot-weather-oracle',
  skillDocument: '# Weather Oracle',
  inputType: 'text',
  outputType: 'text',
  endpoint: 'simplemsg',
  paymentAddress: 'mvc-payment-address',
  available: true,
  updatedAt: NOW_MS - 60_000,
};

test('applyHeartbeatOnlineState marks services online when the latest heartbeat is fresh', () => {
  const decorated = applyHeartbeatOnlineState(
    [BASE_SERVICE],
    [
      {
        address: 'mvc-provider-address',
        timestamp: Math.floor(NOW_MS / 1000) - 30,
      },
    ],
    { now: () => NOW_MS }
  );

  assert.equal(decorated.length, 1);
  assert.equal(decorated[0].online, true);
  assert.equal(decorated[0].lastSeenSec, Math.floor(NOW_MS / 1000) - 30);
  assert.deepEqual(
    filterOnlineChainServices([BASE_SERVICE], [{ address: 'mvc-provider-address', timestamp: Math.floor(NOW_MS / 1000) - 30 }], {
      now: () => NOW_MS,
    }),
    decorated
  );
});

test('filterOnlineChainServices excludes services when the latest heartbeat is stale', () => {
  const staleHeartbeat = Math.floor(NOW_MS / 1000) - HEARTBEAT_ONLINE_WINDOW_SEC - 1;

  const online = filterOnlineChainServices(
    [BASE_SERVICE],
    [{ address: 'mvc-provider-address', timestamp: staleHeartbeat }],
    { now: () => NOW_MS }
  );

  assert.deepEqual(online, []);
});

test('filterOnlineChainServices excludes services when no heartbeat exists for the provider address', () => {
  const online = filterOnlineChainServices([BASE_SERVICE], [], { now: () => NOW_MS });
  assert.deepEqual(online, []);
});
