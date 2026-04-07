import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  parseChainServiceItem,
  resolveCurrentChainServices,
} = require('../../dist/core/discovery/chainServiceDirectory.js');

test('parseChainServiceItem + resolveCurrentChainServices keep IDBots create payload fields', () => {
  const row = parseChainServiceItem({
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
  });

  assert.equal(row.pinId, 'service-pin-1');

  const services = resolveCurrentChainServices([row]);

  assert.equal(services.length, 1);
  assert.deepEqual(services[0], {
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
    updatedAt: 1_775_000_000_000,
  });
});

test('resolveCurrentChainServices keeps the latest modify row as the active service state', () => {
  const created = parseChainServiceItem({
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
  });
  const modified = parseChainServiceItem({
    id: 'service-pin-2',
    metaid: 'metaid-provider',
    address: 'mvc-provider-address',
    timestamp: 1_775_000_300,
    status: 0,
    operation: 'modify',
    path: '@service-pin-1',
    contentSummary: JSON.stringify({
      serviceName: 'weather-oracle',
      displayName: 'Weather Oracle v2',
      description: 'Returns tomorrow weather with more detail.',
      providerMetaBot: 'idq1provider',
      providerSkill: 'metabot-weather-oracle',
      price: '0.00002',
      currency: 'SPACE',
      skillDocument: '# Weather Oracle v2',
      inputType: 'text',
      outputType: 'markdown',
      endpoint: 'simplemsg',
      paymentAddress: 'mvc-payment-address',
    }),
  });

  const services = resolveCurrentChainServices([created, modified]);

  assert.equal(services.length, 1);
  assert.equal(services[0].servicePinId, 'service-pin-2');
  assert.equal(services[0].sourceServicePinId, 'service-pin-1');
  assert.deepEqual(services[0].chainPinIds, ['service-pin-1', 'service-pin-2']);
  assert.equal(services[0].displayName, 'Weather Oracle v2');
  assert.equal(services[0].description, 'Returns tomorrow weather with more detail.');
  assert.equal(services[0].price, '0.00002');
  assert.equal(services[0].outputType, 'markdown');
});

test('resolveCurrentChainServices hides a service after a revoke row for the same source pin', () => {
  const created = parseChainServiceItem({
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
  });
  const revoked = parseChainServiceItem({
    id: 'service-pin-3',
    metaid: 'metaid-provider',
    address: 'mvc-provider-address',
    timestamp: 1_775_000_600,
    status: -1,
    operation: 'revoke',
    path: '@service-pin-1',
  });

  const services = resolveCurrentChainServices([created, revoked]);

  assert.deepEqual(services, []);
});
