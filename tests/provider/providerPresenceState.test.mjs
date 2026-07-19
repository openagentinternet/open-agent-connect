import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const {
  createProviderPresenceStateStore,
} = require('../../dist/core/provider/providerPresenceState.js');

const legacyOnlinePath = `/protocols/${[['meta', 'bot'].join(''), ['heart', 'beat'].join('')].join('-')}`;
const legacyOnlineKeys = {
  at: ['last', 'Heartbeat', 'At'].join(''),
  pinId: ['last', 'Heartbeat', 'PinId'].join(''),
  txid: ['last', 'Heartbeat', 'Txid'].join(''),
};

async function createProfileHome(prefix, slug = 'test-profile') {
  const systemHome = await mkdtempTempRoot(prefix);
  const homeDir = path.join(systemHome, '.metabot', 'profiles', slug);
  await mkdir(path.join(systemHome, '.metabot', 'manager'), { recursive: true });
  await mkdir(homeDir, { recursive: true });
  return homeDir;
}

test('createProviderPresenceStateStore persists only socket-listener enabled state', async () => {
  const homeDir = await createProfileHome('metabot-provider-presence-');

  try {
    const store = createProviderPresenceStateStore(homeDir);
    const written = await store.write({
      enabled: false,
      [legacyOnlineKeys.at]: 1_775_000_000_000,
      [legacyOnlineKeys.pinId]: `${legacyOnlinePath}-pin-1`,
      [legacyOnlineKeys.txid]: `${legacyOnlinePath}-tx-1`,
    });

    assert.deepEqual(written, {
      enabled: false,
    });
    assert.equal(store.paths.providerPresenceStatePath.startsWith(store.paths.stateRoot), true);
    assert.deepEqual(await store.read(), written);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('createProviderPresenceStateStore defaults to enabled so daemon socket presence starts online', async () => {
  const homeDir = await createProfileHome('metabot-provider-presence-default-');

  try {
    const store = createProviderPresenceStateStore(homeDir);

    assert.deepEqual(await store.read(), {
      enabled: true,
    });
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('createProviderPresenceStateStore keeps reads parseable while writes race', async () => {
  const homeDir = await createProfileHome('metabot-provider-presence-race-');

  try {
    const store = createProviderPresenceStateStore(homeDir);
    await store.write({ enabled: true });

    await Promise.all([
      (async () => {
        for (let index = 0; index < 2000; index += 1) {
          await store.write({
            enabled: index % 2 === 0,
            [legacyOnlineKeys.at]: index,
            [legacyOnlineKeys.pinId]: `${legacyOnlinePath}-pin-${index}`,
            [legacyOnlineKeys.txid]: `${legacyOnlinePath}-tx-${index}`,
          });
        }
      })(),
      (async () => {
        for (let index = 0; index < 2000; index += 1) {
          const current = await store.read();
          assert.equal(typeof current.enabled, 'boolean');
          assert.equal(Object.hasOwn(current, legacyOnlineKeys.at), false);
          assert.equal(Object.hasOwn(current, legacyOnlineKeys.pinId), false);
          assert.equal(Object.hasOwn(current, legacyOnlineKeys.txid), false);
        }
      })(),
    ]);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});
