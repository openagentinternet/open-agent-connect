import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildPublishedService,
  buildRevokedPublishedService,
} = require('../../dist/core/services/publishService.js');
const {
  publishServiceToChain,
} = require('../../dist/core/services/servicePublishChain.js');

function createDraft(overrides = {}) {
  return {
    serviceName: 'Tarot Reading',
    displayName: 'Tarot Reading',
    description: 'Performs tarot readings.',
    providerSkill: 'tarot-reading',
    price: '0.00005',
    currency: 'SPACE',
    outputType: 'text',
    serviceIconUri: 'data:image/png;base64,icon-data',
    ...overrides,
  };
}

test('buildPublishedService preserves payload content and provider identity semantics', () => {
  const result = buildPublishedService({
    sourceServicePinId: 'service-tarot',
    currentPinId: 'service-tarot',
    creatorMetabotId: 7,
    providerGlobalMetaId: 'seller-global-metaid',
    paymentAddress: '1seller-payment-address',
    draft: createDraft(),
    skillDocument: '# Tarot Reading',
    now: 1_744_444_444_000,
  });

  assert.deepEqual(result.payload, {
    serviceName: 'Tarot Reading',
    displayName: 'Tarot Reading',
    description: 'Performs tarot readings.',
    serviceIcon: 'data:image/png;base64,icon-data',
    providerMetaBot: 'seller-global-metaid',
    providerSkill: 'tarot-reading',
    price: '0.00005',
    currency: 'SPACE',
    skillDocument: '# Tarot Reading',
    inputType: 'text',
    outputType: 'text',
    endpoint: 'simplemsg',
    paymentAddress: '1seller-payment-address',
  });
  assert.equal(result.record.available, 1);
  assert.equal(result.record.providerGlobalMetaId, 'seller-global-metaid');
  assert.equal(result.record.skillDocument, '# Tarot Reading');
  assert.equal(result.record.serviceIcon, 'data:image/png;base64,icon-data');
});

test('buildRevokedPublishedService keeps the prior service metadata but marks it unavailable', () => {
  const revoked = buildRevokedPublishedService({
    sourceServicePinId: 'service-tarot',
    currentPinId: 'service-tarot-v2',
    creatorMetabotId: 7,
    providerGlobalMetaId: 'seller-global-metaid',
    providerSkill: 'tarot-reading',
    serviceName: 'Tarot Reading',
    displayName: 'Tarot Reading',
    description: 'Performs tarot readings.',
    serviceIcon: 'data:image/png;base64,icon-data',
    price: '0.00005',
    currency: 'SPACE',
    skillDocument: '# Tarot Reading',
    now: 1_744_444_445_000,
  });

  assert.equal(revoked.available, 0);
  assert.equal(revoked.currentPinId, 'service-tarot-v2');
  assert.equal(revoked.sourceServicePinId, 'service-tarot');
  assert.equal(revoked.revokedAt, 1_744_444_445_000);
  assert.equal(revoked.skillDocument, '# Tarot Reading');
  assert.equal(revoked.serviceIcon, 'data:image/png;base64,icon-data');
});

test('publishServiceToChain writes the skill-service protocol and persists the returned chain pin id', async () => {
  const writes = [];

  const published = await publishServiceToChain({
    signer: {
      async writePin(input) {
        writes.push(input);
        return {
          txids: ['chain-tx-1'],
          pinId: '/protocols/skill-service-pin-1',
          totalCost: 1,
          network: 'mvc',
          operation: 'create',
          path: '/protocols/skill-service',
          contentType: 'application/json',
          encoding: 'utf-8',
          globalMetaId: 'seller-global-metaid',
          mvcAddress: '1seller-payment-address',
        };
      },
    },
    creatorMetabotId: 7,
    providerGlobalMetaId: 'seller-global-metaid',
    paymentAddress: '1seller-payment-address',
    draft: createDraft(),
    skillDocument: '# Tarot Reading',
    now: 1_744_444_446_000,
  });

  assert.deepEqual(writes, [{
    operation: 'create',
    path: '/protocols/skill-service',
    payload: JSON.stringify({
      serviceName: 'Tarot Reading',
      displayName: 'Tarot Reading',
      description: 'Performs tarot readings.',
      serviceIcon: 'data:image/png;base64,icon-data',
      providerMetaBot: 'seller-global-metaid',
      providerSkill: 'tarot-reading',
      price: '0.00005',
      currency: 'SPACE',
      skillDocument: '# Tarot Reading',
      inputType: 'text',
      outputType: 'text',
      endpoint: 'simplemsg',
      paymentAddress: '1seller-payment-address',
    }),
    contentType: 'application/json',
    network: 'mvc',
  }]);
  assert.equal(published.chainWrite.pinId, '/protocols/skill-service-pin-1');
  assert.equal(published.record.currentPinId, '/protocols/skill-service-pin-1');
  assert.equal(published.record.sourceServicePinId, '/protocols/skill-service-pin-1');
  assert.equal(published.record.payloadJson, writes[0].payload);
});
