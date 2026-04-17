import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildPublishedMaster,
  publishMasterToChain,
} = require('../../dist/core/master/masterServicePublish.js');
const { validateMasterServicePayload } = require('../../dist/core/master/masterServiceSchema.js');

function loadDraft() {
  const payload = JSON.parse(
    readFileSync(
      path.resolve('templates/master-service/debug-master.template.json'),
      'utf8'
    )
  );
  const result = validateMasterServicePayload(payload);
  assert.equal(result.ok, true);
  return result.value;
}

test('buildPublishedMaster preserves payload content and provider identity semantics', () => {
  const result = buildPublishedMaster({
    sourceMasterPinId: 'master-pin-1',
    currentPinId: 'master-pin-1',
    creatorMetabotId: 7,
    providerGlobalMetaId: 'idq1provider',
    providerAddress: '1provider-address',
    draft: loadDraft(),
    now: 1_776_000_000_000,
  });

  assert.deepEqual(result.payload, {
    serviceName: 'official-debug-master',
    displayName: 'Official Debug Master',
    description: 'Structured debugging help from the official Ask Master fixture.',
    providerMetaBot: 'idq1provider',
    masterKind: 'debug',
    specialties: ['debugging', 'failing tests', 'runtime diagnosis'],
    hostModes: ['codex'],
    modelInfo: {
      provider: 'metaweb',
      model: 'official-debug-master-v1',
    },
    style: 'direct_and_structured',
    pricingMode: 'free',
    price: '0',
    currency: 'MVC',
    responseMode: 'structured',
    contextPolicy: 'standard',
    official: true,
    trustedTier: 'official',
  });
  assert.equal(result.record.available, 1);
  assert.equal(result.record.providerGlobalMetaId, 'idq1provider');
  assert.equal(result.record.providerAddress, '1provider-address');
  assert.equal(result.record.masterKind, 'debug');
});

test('publishMasterToChain writes the master-service protocol and persists the returned chain pin id', async () => {
  const writes = [];

  const published = await publishMasterToChain({
    signer: {
      async writePin(input) {
        writes.push(input);
        return {
          txids: ['chain-tx-1'],
          pinId: '/protocols/master-service-pin-1',
          totalCost: 1,
          network: 'mvc',
          operation: 'create',
          path: '/protocols/master-service',
          contentType: 'application/json',
          encoding: 'utf-8',
          globalMetaId: 'idq1provider',
          mvcAddress: '1provider-address',
        };
      },
    },
    creatorMetabotId: 7,
    providerGlobalMetaId: 'idq1provider',
    providerAddress: '1provider-address',
    draft: loadDraft(),
    now: 1_776_000_000_001,
  });

  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, '/protocols/master-service');
  assert.equal(writes[0].contentType, 'application/json');
  assert.equal(published.chainWrite.pinId, '/protocols/master-service-pin-1');
  assert.equal(published.record.currentPinId, '/protocols/master-service-pin-1');
  assert.equal(published.record.sourceMasterPinId, '/protocols/master-service-pin-1');
  assert.equal(published.record.payloadJson, writes[0].payload);
});
