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
    paymentChain: 'mvc',
    settlementKind: 'native',
    mrc20Ticker: null,
    mrc20Id: null,
    skillDocument: '',
    inputType: 'text',
    outputType: 'text',
    endpoint: 'simplemsg',
    paymentAddress: '1seller-payment-address',
  });
  assert.equal('runtimeId' in result.payload, false);
  assert.equal('runtimeProvider' in result.payload, false);
  assert.equal('binaryPath' in result.payload, false);
  assert.equal('cwd' in result.payload, false);
  assert.equal('model' in result.payload, false);
  assert.equal('skillRootPath' in result.payload, false);
  assert.equal(result.record.available, 1);
  assert.equal(result.record.providerGlobalMetaId, 'seller-global-metaid');
  assert.equal(result.record.skillDocument, '');
  assert.equal(result.record.paymentChain, 'mvc');
  assert.equal(result.record.settlementKind, 'native');
  assert.equal(result.record.serviceIcon, 'data:image/png;base64,icon-data');
});

test('buildPublishedService maps DOGE and BTC-OPCAT settlement metadata into the IDBots-compatible payload', () => {
  const doge = buildPublishedService({
    sourceServicePinId: 'service-doge',
    currentPinId: 'service-doge',
    creatorMetabotId: 7,
    providerGlobalMetaId: 'seller-global-metaid',
    paymentAddress: 'doge-payment-address',
    draft: createDraft({ currency: 'DOGE' }),
    skillDocument: '',
    now: 1_744_444_444_000,
  });
  assert.equal(doge.payload.currency, 'DOGE');
  assert.equal(doge.payload.paymentChain, 'doge');
  assert.equal(doge.payload.settlementKind, 'native');
  assert.equal(doge.record.paymentAddress, 'doge-payment-address');

  const btcOpcat = buildPublishedService({
    sourceServicePinId: 'service-opcat',
    currentPinId: 'service-opcat',
    creatorMetabotId: 7,
    providerGlobalMetaId: 'seller-global-metaid',
    paymentAddress: 'opcat-payment-address',
    draft: createDraft({ currency: 'BTC-OPCAT' }),
    skillDocument: '',
    now: 1_744_444_444_000,
  });
  assert.equal(btcOpcat.payload.currency, 'BTC-OPCAT');
  assert.equal(btcOpcat.payload.paymentChain, 'opcat');
  assert.equal(btcOpcat.payload.settlementKind, 'native');
  assert.equal(btcOpcat.record.paymentChain, 'opcat');
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
  assert.equal(revoked.skillDocument, '');
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
      paymentChain: 'mvc',
      settlementKind: 'native',
      mrc20Ticker: null,
      mrc20Id: null,
      skillDocument: '',
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

test('publishServiceToChain uploads a service icon data URL before writing the skill-service pin', async () => {
  const writes = [];

  const published = await publishServiceToChain({
    signer: {
      async writePin(input) {
        writes.push(input);
        if (input.path === '/file') {
          return {
            txids: ['file-tx-1'],
            pinId: 'file-pin-1',
            totalCost: 1,
            network: 'mvc',
            operation: 'create',
            path: '/file',
            contentType: input.contentType,
            encoding: input.encoding,
            globalMetaId: 'seller-global-metaid',
            mvcAddress: '1seller-payment-address',
          };
        }
        return {
          txids: ['service-tx-1'],
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
    draft: createDraft({
      serviceIconUri: null,
      serviceIconDataUrl: 'data:image/png;base64,aWNvbg==',
    }),
    skillDocument: '',
    now: 1_744_444_446_000,
  });

  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0], {
    operation: 'create',
    path: '/file',
    payload: 'aWNvbg==',
    contentType: 'image/png',
    encoding: 'base64',
    network: 'mvc',
  });
  assert.equal(JSON.parse(writes[1].payload).serviceIcon, 'metafile://file-pin-1');
  assert.equal(published.record.serviceIcon, 'metafile://file-pin-1');
  assert.equal(published.serviceIconUpload.pinId, 'file-pin-1');
});

test('publishServiceToChain uploads service icons on a file-capable network when service write network is DOGE', async () => {
  const writes = [];

  await publishServiceToChain({
    signer: {
      async writePin(input) {
        writes.push(input);
        return {
          txids: [input.path === '/file' ? 'file-tx-1' : 'service-tx-1'],
          pinId: input.path === '/file' ? 'file-pin-1' : '/protocols/skill-service-pin-1',
          totalCost: 1,
          network: input.network,
          operation: input.operation,
          path: input.path,
          contentType: input.contentType,
          encoding: input.encoding || 'utf-8',
          globalMetaId: 'seller-global-metaid',
          mvcAddress: '1seller-payment-address',
        };
      },
    },
    creatorMetabotId: 7,
    providerGlobalMetaId: 'seller-global-metaid',
    paymentAddress: 'doge-payment-address',
    draft: createDraft({
      currency: 'DOGE',
      serviceIconUri: null,
      serviceIconDataUrl: 'data:image/png;base64,aWNvbg==',
    }),
    skillDocument: '',
    now: 1_744_444_446_000,
    network: 'doge',
  });

  assert.equal(writes[0].path, '/file');
  assert.equal(writes[0].network, 'mvc');
  assert.equal(writes[1].path, '/protocols/skill-service');
  assert.equal(writes[1].network, 'doge');
  assert.equal(JSON.parse(writes[1].payload).serviceIcon, 'metafile://file-pin-1');
});
