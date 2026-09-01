import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const {
  createGroupTaskDaemonHandlers,
  createGroupTaskServiceContext,
} = require('../../dist/daemon/grouptaskHandlers.js');
const { createOwnerIdentity } = require('../../dist/core/owner/ownerIdentity.js');
const { createConfigStore } = require('../../dist/core/config/configStore.js');

function unusedSignerFactory() {
  throw new Error('createSignerForProfileHome must not be called by this test');
}

test('production grouptask context resolves the owner identity (owner home is not a profile home)', async () => {
  const systemHomeDir = await mkdtempTempRoot('metabot-grouptask-ctx-');
  const owner = await createOwnerIdentity(systemHomeDir, { name: 'Alice' });
  const ctx = createGroupTaskServiceContext({
    systemHomeDir,
    createSignerForProfileHome: unusedSignerFactory,
    adapters: new Map(),
  });

  const ref = await ctx.ownerIdentity();
  assert.ok(ref, 'ownerIdentity() must resolve when ~/.metabot/owner/identity.json exists');
  assert.equal(ref.globalMetaId, owner.globalMetaId);
  assert.equal(ref.name, 'Alice');

  // The owner signer backs owner-join and owner posts; it must derive the
  // same identity from the stored mnemonic.
  const identity = await ref.signer.getIdentity();
  assert.equal(identity.globalMetaId, owner.globalMetaId);
});

test('production grouptask context returns null when no owner identity exists', async () => {
  const systemHomeDir = await mkdtempTempRoot('metabot-grouptask-ctx-');
  const ctx = createGroupTaskServiceContext({
    systemHomeDir,
    createSignerForProfileHome: unusedSignerFactory,
    adapters: new Map(),
  });
  assert.equal(await ctx.ownerIdentity(), null);
});

test('grouptask health reads the a2a listener switch from the daemon home config', async () => {
  const systemHomeDir = await mkdtempTempRoot('metabot-grouptask-health-');
  const daemonHomeDir = path.join(systemHomeDir, '.metabot', 'profiles', 'twin');
  const configStore = createConfigStore(daemonHomeDir);
  const config = await configStore.read();
  await configStore.set({
    ...config,
    a2a: { ...config.a2a, simplemsgListenerEnabled: false },
  });

  const handlers = createGroupTaskDaemonHandlers({
    systemHomeDir,
    daemonHomeDir,
    createSignerForProfileHome: unusedSignerFactory,
    adapters: new Map(),
  });
  const result = await handlers.health({});
  assert.equal(result.ok, true);
  assert.equal(result.data.simplemsgListenerEnabled, false);
});

test('grouptask health surfaces the owner identity through the daemon handler', async () => {
  const systemHomeDir = await mkdtempTempRoot('metabot-grouptask-health-');
  const owner = await createOwnerIdentity(systemHomeDir, { name: 'Alice' });
  const handlers = createGroupTaskDaemonHandlers({
    systemHomeDir,
    createSignerForProfileHome: unusedSignerFactory,
    adapters: new Map(),
  });
  const result = await handlers.health({});
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.ownerIdentity, {
    present: true,
    globalMetaId: owner.globalMetaId,
    name: 'Alice',
  });
});
