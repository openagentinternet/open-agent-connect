import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  readChainDirectoryWithFallback,
} = require('../../dist/core/discovery/chainDirectoryReader.js');

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

test('readChainDirectoryWithFallback returns chain-backed online services without seeded sources', async () => {
  let fallbackCalls = 0;
  const result = await readChainDirectoryWithFallback({
    chainApiBaseUrl: 'https://chain.test',
    fetchSeededDirectoryServices: async () => {
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
                id: 'service-pin-1',
                metaid: 'metaid-provider',
                address: 'mvc-provider-address',
                timestamp: 1_775_000_000,
                status: 0,
                operation: 'create',
                path: '/protocols/skill-service',
                contentSummary: JSON.stringify({
                  serviceName: 'weather-oracle',
                  displayName: 'Weather Oracle',
                  description: 'Returns tomorrow weather.',
                  providerMetaBot: 'idq1provider',
                  providerSkill: 'metabot-weather-oracle',
                  price: '0.00001',
                  currency: 'SPACE',
                  skillDocument: '# Weather Oracle',
                  inputType: 'text',
                  outputType: 'text',
                  endpoint: 'simplemsg',
                  paymentAddress: 'mvc-payment-address',
                }),
              },
            ],
            nextCursor: null,
          },
        });
      }
      if (value === 'https://api.idchat.io/group-chat/socket/online-users?cursor=0&size=100&withUserInfo=true') {
        return jsonResponse({
          code: 0,
          data: {
            total: 1,
            cursor: 0,
            size: 100,
            onlineWindowSeconds: 1200,
            list: [
              {
                globalMetaId: 'idq1provider',
                lastSeenAt: 1_775_000_000_000,
                lastSeenAgoSeconds: 30,
                deviceCount: 1,
              },
            ],
          }
        });
      }
      throw new Error(`Unexpected URL ${value}`);
    },
  });

  assert.equal(result.source, 'chain');
  assert.equal(result.fallbackUsed, false);
  assert.equal(fallbackCalls, 0);
  assert.equal(result.services.length, 1);
  assert.equal(result.services[0].displayName, 'Weather Oracle');
  assert.equal(result.services[0].online, true);
  assert.equal(result.services[0].lastSeenSec, 1_775_000_000);
});

test('readChainDirectoryWithFallback falls back to seeded services when chain discovery fails', async () => {
  let fallbackCalls = 0;
  const result = await readChainDirectoryWithFallback({
    chainApiBaseUrl: 'https://chain.test',
    fetchSeededDirectoryServices: async () => {
      fallbackCalls += 1;
      return [
        {
          servicePinId: 'seeded-service-1',
          sourceServicePinId: 'seeded-service-1',
          providerGlobalMetaId: 'idq1seeded',
          displayName: 'Seeded Demo Service',
          online: true,
          updatedAt: 1_775_000_000_000,
        },
      ];
    },
    fetchImpl: async (url) => {
      const value = String(url);
      if (value === 'https://api.idchat.io/group-chat/socket/online-users?cursor=0&size=100&withUserInfo=true') {
        return jsonResponse({
          code: 0,
          data: {
            total: 1,
            cursor: 0,
            size: 100,
            onlineWindowSeconds: 1200,
            list: [
              {
                globalMetaId: 'idq1seeded',
                lastSeenAt: 1_775_000_000_000,
                lastSeenAgoSeconds: 10,
                deviceCount: 1,
              },
            ],
          },
        });
      }
      throw new Error('chain unavailable');
    },
  });

  assert.equal(result.source, 'seeded');
  assert.equal(result.fallbackUsed, true);
  assert.equal(fallbackCalls, 1);
  assert.equal(result.services.length, 1);
  assert.equal(result.services[0].displayName, 'Seeded Demo Service');
  assert.equal(result.services[0].online, true);
});

test('readChainDirectoryWithFallback keeps visible services and marks them offline when socket presence is unavailable', async () => {
  let fallbackCalls = 0;
  const result = await readChainDirectoryWithFallback({
    chainApiBaseUrl: 'https://chain.test',
    onlineOnly: false,
    fetchSeededDirectoryServices: async () => {
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
                id: 'service-pin-1',
                metaid: 'metaid-provider',
                address: 'mvc-provider-address',
                timestamp: 1_775_000_000,
                status: 0,
                operation: 'create',
                path: '/protocols/skill-service',
                contentSummary: JSON.stringify({
                  serviceName: 'weather-oracle',
                  displayName: 'Weather Oracle',
                  description: 'Returns tomorrow weather.',
                  providerMetaBot: 'idq1provider',
                  providerSkill: 'metabot-weather-oracle',
                  price: '0.00001',
                  currency: 'SPACE',
                  skillDocument: '# Weather Oracle',
                  inputType: 'text',
                  outputType: 'text',
                  endpoint: 'simplemsg',
                  paymentAddress: 'mvc-payment-address',
                }),
              },
            ],
            nextCursor: null,
          },
        });
      }
      if (value === 'https://api.idchat.io/group-chat/socket/online-users?cursor=0&size=100&withUserInfo=true') {
        throw new Error('socket presence unavailable');
      }
      throw new Error(`Unexpected URL ${value}`);
    },
  });

  assert.equal(result.source, 'chain');
  assert.equal(result.fallbackUsed, false);
  assert.equal(fallbackCalls, 0);
  assert.equal(result.services.length, 1);
  assert.equal(result.services[0].displayName, 'Weather Oracle');
  assert.equal(result.services[0].online, false);
  assert.equal(result.services[0].lastSeenSec, null);
  assert.equal(result.services[0].lastSeenAt, null);
});

test('readChainDirectoryWithFallback throws when onlineOnly is requested and socket presence is unavailable', async () => {
  await assert.rejects(
    () => readChainDirectoryWithFallback({
      chainApiBaseUrl: 'https://chain.test',
      onlineOnly: true,
      fetchSeededDirectoryServices: async () => [],
      fetchImpl: async (url) => {
        const value = String(url);
        if (value.startsWith('https://chain.test/pin/path/list?')) {
          return jsonResponse({
            data: {
              list: [
                {
                  id: 'service-pin-1',
                  metaid: 'metaid-provider',
                  address: 'mvc-provider-address',
                  timestamp: 1_775_000_000,
                  status: 0,
                  operation: 'create',
                  path: '/protocols/skill-service',
                  contentSummary: JSON.stringify({
                    serviceName: 'weather-oracle',
                    displayName: 'Weather Oracle',
                    description: 'Returns tomorrow weather.',
                    providerMetaBot: 'idq1provider',
                    providerSkill: 'metabot-weather-oracle',
                    price: '0.00001',
                    currency: 'SPACE',
                    skillDocument: '# Weather Oracle',
                    inputType: 'text',
                    outputType: 'text',
                    endpoint: 'simplemsg',
                    paymentAddress: 'mvc-payment-address',
                  }),
                },
              ],
              nextCursor: null,
            },
          });
        }
        if (value === 'https://api.idchat.io/group-chat/socket/online-users?cursor=0&size=100&withUserInfo=true') {
          throw new Error('socket presence unavailable');
        }
        throw new Error(`Unexpected URL ${value}`);
      },
    }),
    /socket presence unavailable/
  );
});
