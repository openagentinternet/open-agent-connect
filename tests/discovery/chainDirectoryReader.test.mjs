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
    now: () => 1_775_000_000_000,
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
      if (value === 'https://chain.test/address/pin/list/mvc-provider-address?cursor=0&size=1&path=%2Fprotocols%2Fmetabot-heartbeat') {
        return jsonResponse({
          data: {
            list: [
              {
                seenTime: 1_775_000_000 - 30,
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
  assert.equal(result.services.length, 1);
  assert.equal(result.services[0].displayName, 'Weather Oracle');
  assert.equal(result.services[0].online, true);
});

test('readChainDirectoryWithFallback falls back to seeded services when chain discovery fails', async () => {
  let fallbackCalls = 0;
  const result = await readChainDirectoryWithFallback({
    chainApiBaseUrl: 'https://chain.test',
    now: () => 1_775_000_000_000,
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
    fetchImpl: async () => {
      throw new Error('chain unavailable');
    },
  });

  assert.equal(result.source, 'seeded');
  assert.equal(result.fallbackUsed, true);
  assert.equal(fallbackCalls, 1);
  assert.equal(result.services.length, 1);
  assert.equal(result.services[0].displayName, 'Seeded Demo Service');
});
