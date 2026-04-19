import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  createProviderPresenceStateStore,
} = require('../../dist/core/provider/providerPresenceState.js');
const {
  createProviderHeartbeatLoop,
} = require('../../dist/core/provider/providerHeartbeatLoop.js');

test('createProviderPresenceStateStore persists enabled and latest heartbeat metadata in a dedicated hot file', async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-provider-presence-'));

  try {
    const store = createProviderPresenceStateStore(homeDir);
    const written = await store.write({
      enabled: true,
      lastHeartbeatAt: 1_775_000_000_000,
      lastHeartbeatPinId: '/protocols/metabot-heartbeat-pin-1',
      lastHeartbeatTxid: '/protocols/metabot-heartbeat-tx-1',
    });

    assert.deepEqual(written, {
      enabled: true,
      lastHeartbeatAt: 1_775_000_000_000,
      lastHeartbeatPinId: '/protocols/metabot-heartbeat-pin-1',
      lastHeartbeatTxid: '/protocols/metabot-heartbeat-tx-1',
    });
    assert.deepEqual(await store.read(), written);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('createProviderPresenceStateStore keeps reads parseable while writes race', async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-provider-presence-race-'));

  try {
    const store = createProviderPresenceStateStore(homeDir);
    await store.write({
      enabled: true,
      lastHeartbeatAt: null,
      lastHeartbeatPinId: null,
      lastHeartbeatTxid: null,
    });

    await Promise.all([
      (async () => {
        for (let index = 0; index < 2000; index += 1) {
          await store.write({
            enabled: true,
            lastHeartbeatAt: index,
            lastHeartbeatPinId: `/protocols/metabot-heartbeat-pin-${index}`,
            lastHeartbeatTxid: `/protocols/metabot-heartbeat-tx-${index}`,
          });
        }
      })(),
      (async () => {
        for (let index = 0; index < 2000; index += 1) {
          const current = await store.read();
          assert.equal(current.enabled, true);
        }
      })(),
    ]);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('ProviderHeartbeatLoop writes /protocols/metabot-heartbeat and records the latest heartbeat metadata', async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-provider-heartbeat-'));
  const writes = [];

  try {
    const presenceStore = createProviderPresenceStateStore(homeDir);
    await presenceStore.write({
      enabled: true,
      lastHeartbeatAt: null,
      lastHeartbeatPinId: null,
      lastHeartbeatTxid: null,
    });

    const loop = createProviderHeartbeatLoop({
      signer: {
        async writePin(input) {
          writes.push(input);
          return {
            txids: ['/protocols/metabot-heartbeat-tx-1'],
            pinId: '/protocols/metabot-heartbeat-pin-1',
            totalCost: 1,
            network: 'mvc',
            operation: 'create',
            path: '/protocols/metabot-heartbeat',
            contentType: 'application/json',
            encoding: 'utf-8',
            globalMetaId: 'idq1provider',
            mvcAddress: 'mvc-provider-address',
          };
        },
      },
      presenceStore,
      getIdentity: async () => ({
        globalMetaId: 'idq1provider',
        mvcAddress: 'mvc-provider-address',
      }),
      now: () => 1_775_000_000_000,
      intervalMs: 60_000,
    });

    await loop.runOnce();

    assert.deepEqual(writes, [{
      operation: 'create',
      path: '/protocols/metabot-heartbeat',
      payload: JSON.stringify({
        providerGlobalMetaId: 'idq1provider',
        providerAddress: 'mvc-provider-address',
        heartbeatAt: 1_775_000_000,
      }),
      contentType: 'application/json',
      network: 'mvc',
    }]);

    assert.deepEqual(await presenceStore.read(), {
      enabled: true,
      lastHeartbeatAt: 1_775_000_000_000,
      lastHeartbeatPinId: '/protocols/metabot-heartbeat-pin-1',
      lastHeartbeatTxid: '/protocols/metabot-heartbeat-tx-1',
    });
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});
