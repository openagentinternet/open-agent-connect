import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { createOwnerIdentity } = require('../../dist/core/owner/ownerIdentity.js');
const { createRootOwnerIdentity } = require('../../dist/core/owner/rootOwnerIdentity.js');
const { createTrustCacheStore } = require('../../dist/core/trust/trustCacheStore.js');
const { createOwnerDaemonHandlers } = require('../../dist/daemon/ownerHandlers.js');

function fakeSigner(deviceGlobalMetaId) {
  return {
    getIdentity: async () => { throw new Error('not used by this test'); },
    getPrivateChatIdentity: async () => { throw new Error('not used by this test'); },
    writePin: async (request) => ({
      txids: ['faketxid00000000000000000000000000000000000000000000000000000000'],
      pinId: 'faketxid00000000000000000000000000000000000000000000000000000000i0',
      totalCost: 100,
      network: 'mvc',
      operation: 'create',
      path: request.path,
      contentType: request.contentType,
      encoding: request.encoding,
      globalMetaId: deviceGlobalMetaId,
      mvcAddress: 'fake-address',
    }),
  };
}

test('bindDevice publishes the binding pin and drops the device trust-cache entry (BUG-2)', async () => {
  const systemHomeDir = await mkdtempTempRoot('metabot-owner-handlers-');
  const device = await createOwnerIdentity(systemHomeDir, { name: 'Device' });
  await createRootOwnerIdentity(systemHomeDir, { name: 'Alice' });

  // Seed the shared cache with the pre-bind "self-root" resolution that a
  // tier check may have written moments before the bind.
  const cache = createTrustCacheStore(systemHomeDir);
  await cache.set({
    subjectGlobalMetaId: device.globalMetaId,
    pinId: null,
    rootOwnerGlobalMetaId: device.globalMetaId,
    chain: [],
    resolvedAt: new Date().toISOString(),
  });
  assert.ok(await cache.get(device.globalMetaId));

  const subsidyCalls = [];
  const handlers = createOwnerDaemonHandlers({
    systemHomeDir,
    createSigner: (identity) => fakeSigner(identity.globalMetaId),
    requestSubsidy: async (options) => {
      subsidyCalls.push(options);
      return { success: true };
    },
  });

  const result = await handlers.bindDevice();
  assert.equal(result.ok, true);
  assert.equal(result.data.ownerBinding.device, device.globalMetaId);
  assert.equal(result.data.ownerBinding.path, '/info/owner');
  assert.equal(result.data.chainWrites.length, 1);

  // The stale pre-bind entry is gone: the next deviceBindingStatus read
  // re-resolves the chain immediately instead of serving the old TTL value.
  assert.equal(await cache.get(device.globalMetaId), null);
  assert.equal(subsidyCalls.length, 1);
  assert.equal(subsidyCalls[0].mvcAddress, device.mvcAddress);
});

test('bindDevice without a root owner fails closed and leaves the cache untouched', async () => {
  const systemHomeDir = await mkdtempTempRoot('metabot-owner-handlers-');
  const device = await createOwnerIdentity(systemHomeDir, { name: 'Device' });
  const cache = createTrustCacheStore(systemHomeDir);
  await cache.set({
    subjectGlobalMetaId: device.globalMetaId,
    pinId: null,
    rootOwnerGlobalMetaId: device.globalMetaId,
    chain: [],
    resolvedAt: new Date().toISOString(),
  });

  const handlers = createOwnerDaemonHandlers({
    systemHomeDir,
    createSigner: (identity) => fakeSigner(identity.globalMetaId),
  });

  const result = await handlers.bindDevice();
  assert.equal(result.ok, false);
  assert.equal(result.code, 'root_owner_missing');
  assert.ok(await cache.get(device.globalMetaId));
});

test('who surfaces the deviceBinding status when wired', async () => {
  const systemHomeDir = await mkdtempTempRoot('metabot-owner-handlers-');
  await createRootOwnerIdentity(systemHomeDir, { name: 'Alice' });

  const handlers = createOwnerDaemonHandlers({
    systemHomeDir,
    deviceBindingStatus: async () => 'bound',
  });

  const result = await handlers.who();
  assert.equal(result.ok, true);
  assert.equal(result.data.deviceBinding, 'bound');
  assert.equal(result.data.identity.name, 'Alice');
});
