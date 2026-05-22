import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  listMasters,
  readChainMasterDirectoryWithFallback,
  parseChainMasterItem,
  resolveCurrentChainMasters,
} = require('../../dist/core/master/masterDirectory.js');

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

test('readChainMasterDirectoryWithFallback returns chain-backed online masters without seeded sources', async () => {
  let fallbackCalls = 0;
  const result = await readChainMasterDirectoryWithFallback({
    chainApiBaseUrl: 'https://chain.test',
    socketPresenceApiBaseUrl: 'https://presence.test',
    now: () => 1_776_000_000_000,
    fetchSeededDirectoryMasters: async () => {
      fallbackCalls += 1;
      return [];
    },
    fetchImpl: async (url) => {
      const value = String(url);
      if (value.startsWith('https://chain.test/pin/path/list?')) {
        return jsonResponse({
          data: {
            list: [
              {
                id: 'master-pin-1',
                metaid: 'metaid-provider',
                address: 'mvc-provider-address',
                timestamp: 1_776_000_000,
                status: 0,
                operation: 'create',
                path: '/protocols/master-service',
                contentSummary: JSON.stringify({
                  serviceName: 'official-debug-master',
                  displayName: 'Official Debug Master',
                  description: 'Structured debugging help from the official Ask Master fixture.',
                  providerMetaBot: 'idq1provider',
                  masterKind: 'debug',
                  specialties: ['debugging'],
                  hostModes: ['codex'],
                  modelInfo: { provider: 'metaweb', model: 'official-debug-master-v1' },
                  style: 'direct_and_structured',
                  pricingMode: 'free',
                  price: '0',
                  currency: 'MVC',
                  responseMode: 'structured',
                  contextPolicy: 'standard',
                  official: true,
                  trustedTier: 'official',
                }),
              },
            ],
            nextCursor: null,
          },
        });
      }
      if (value === 'https://presence.test/group-chat/socket/online-users?cursor=0&size=100&withUserInfo=true') {
        return jsonResponse({
          code: 0,
          data: {
            total: 1,
            onlineWindowSeconds: 1200,
            list: [
              {
                globalMetaId: 'idq1provider',
                lastSeenAt: 1_776_000_000_000,
                lastSeenAgoSeconds: 30,
                deviceCount: 1,
                userInfo: {
                  name: 'Provider Bot',
                },
              },
            ],
          },
        });
      }
      throw new Error(`Unexpected URL ${value}`);
    },
  });

  assert.equal(result.source, 'chain');
  assert.equal(result.fallbackUsed, false);
  assert.equal(fallbackCalls, 0);
  assert.equal(result.masters.length, 1);
  assert.equal(result.masters[0].displayName, 'Official Debug Master');
  assert.equal(result.masters[0].online, true);
  assert.equal(result.masters[0].providerName, 'Provider Bot');
  assert.equal(result.masters[0].lastSeenAgoSeconds, 30);
});

test('readChainMasterDirectoryWithFallback throws for online masters when socket presence is unavailable', async () => {
  await assert.rejects(
    () => readChainMasterDirectoryWithFallback({
      chainApiBaseUrl: 'https://chain.test',
      socketPresenceApiBaseUrl: 'https://presence.test',
      onlineOnly: true,
      fetchSeededDirectoryMasters: async () => [],
      fetchImpl: async (url) => {
        const value = String(url);
        if (value.startsWith('https://chain.test/pin/path/list?')) {
          return jsonResponse({
            data: {
              list: [
                {
                  id: 'master-pin-1',
                  metaid: 'metaid-provider',
                  address: 'mvc-provider-address',
                  timestamp: 1_776_000_000,
                  status: 0,
                  operation: 'create',
                  path: '/protocols/master-service',
                  contentSummary: JSON.stringify({
                    serviceName: 'official-debug-master',
                    displayName: 'Official Debug Master',
                    description: 'Structured debugging help.',
                    providerMetaBot: 'idq1provider',
                    masterKind: 'debug',
                    hostModes: ['codex'],
                    price: '0',
                    currency: 'MVC',
                  }),
                },
              ],
              nextCursor: null,
            },
          });
        }
        if (value === 'https://presence.test/group-chat/socket/online-users?cursor=0&size=100&withUserInfo=true') {
          throw new Error('socket presence unavailable');
        }
        throw new Error(`Unexpected URL ${value}`);
      },
    }),
    /socket presence unavailable/,
  );
});

test('resolveCurrentChainMasters keeps the latest modify row as the active master state', () => {
  const created = parseChainMasterItem({
    id: 'master-pin-1',
    metaid: 'metaid-provider',
    address: 'mvc-provider-address',
    timestamp: 1_776_000_000,
    status: 0,
    operation: 'create',
    path: '/protocols/master-service',
    contentSummary: JSON.stringify({
      serviceName: 'official-debug-master',
      displayName: 'Official Debug Master',
      description: 'Structured debugging help from the official Ask Master fixture.',
      providerMetaBot: 'idq1provider',
      masterKind: 'debug',
      specialties: ['debugging'],
      hostModes: ['codex'],
      modelInfo: { provider: 'metaweb', model: 'official-debug-master-v1' },
      style: 'direct_and_structured',
      pricingMode: 'free',
      price: '0',
      currency: 'MVC',
      responseMode: 'structured',
      contextPolicy: 'standard',
      official: true,
      trustedTier: 'official',
    }),
  });
  const modified = parseChainMasterItem({
    id: 'master-pin-2',
    metaid: 'metaid-provider',
    address: 'mvc-provider-address',
    timestamp: 1_776_000_300,
    status: 0,
    operation: 'modify',
    path: '@master-pin-1',
    contentSummary: JSON.stringify({
      serviceName: 'official-debug-master',
      displayName: 'Official Debug Master v2',
      description: 'Updated structured debugging help.',
      providerMetaBot: 'idq1provider',
      masterKind: 'debug',
      specialties: ['debugging', 'runtime diagnosis'],
      hostModes: ['codex'],
      modelInfo: { provider: 'metaweb', model: 'official-debug-master-v2' },
      style: 'direct_and_structured',
      pricingMode: 'free',
      price: '0',
      currency: 'MVC',
      responseMode: 'structured',
      contextPolicy: 'standard',
      official: true,
      trustedTier: 'official',
    }),
  });

  const masters = resolveCurrentChainMasters([created, modified]);

  assert.equal(masters.length, 1);
  assert.equal(masters[0].masterPinId, 'master-pin-2');
  assert.equal(masters[0].sourceMasterPinId, 'master-pin-1');
  assert.deepEqual(masters[0].chainPinIds, ['master-pin-1', 'master-pin-2']);
  assert.equal(masters[0].displayName, 'Official Debug Master v2');
  assert.deepEqual(masters[0].specialties, ['debugging', 'runtime diagnosis']);
});

test('listMasters filters out non-master services and offline providers', () => {
  const masters = listMasters({
    entries: [
      {
        masterPinId: 'master-pin-1',
        sourceMasterPinId: 'master-pin-1',
        providerGlobalMetaId: 'idq1provider',
        displayName: 'Official Debug Master',
        masterKind: 'debug',
        hostModes: ['codex'],
        official: true,
        online: true,
        updatedAt: 10,
      },
      {
        masterPinId: 'master-pin-2',
        sourceMasterPinId: 'master-pin-2',
        providerGlobalMetaId: 'idq1provider2',
        displayName: 'Offline Debug Master',
        masterKind: 'debug',
        hostModes: ['codex'],
        official: false,
        online: false,
        updatedAt: 5,
      },
      {
        servicePinId: 'service-weather',
        providerGlobalMetaId: 'idq1service',
        online: true,
        updatedAt: 20,
      },
    ],
    host: 'codex',
  });

  assert.deepEqual(masters.map((entry) => entry.masterPinId), ['master-pin-1', 'master-pin-2']);

  const onlineOnly = listMasters({
    entries: masters,
    host: 'codex',
    onlineOnly: true,
  });
  assert.deepEqual(onlineOnly.map((entry) => entry.masterPinId), ['master-pin-1']);

  const officialOnly = listMasters({
    entries: masters,
    host: 'codex',
    official: true,
  });
  assert.deepEqual(officialOnly.map((entry) => entry.masterPinId), ['master-pin-1']);
});
