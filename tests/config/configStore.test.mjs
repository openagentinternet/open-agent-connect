import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createConfigStore } = require('../../dist/core/config/configStore.js');

async function withTempProfileHome(action) {
  const systemHome = await fs.mkdtemp(path.join(os.tmpdir(), 'metabot-config-'));
  const homeDir = path.join(systemHome, '.metabot', 'profiles', 'test-profile');
  const managerRoot = path.join(systemHome, '.metabot', 'manager');
  const previousHome = process.env.METABOT_HOME;
  const previousSystemHome = process.env.HOME;
  await fs.mkdir(homeDir, { recursive: true });
  await fs.mkdir(managerRoot, { recursive: true });
  const now = Date.now();
  await fs.writeFile(
    path.join(managerRoot, 'identity-profiles.json'),
    `${JSON.stringify({
      profiles: [
        {
          name: 'Test Profile',
          slug: 'test-profile',
          aliases: ['test profile', 'test-profile'],
          homeDir,
          globalMetaId: '',
          mvcAddress: '',
          createdAt: now,
          updatedAt: now,
        },
      ],
    }, null, 2)}\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(managerRoot, 'active-home.json'),
    `${JSON.stringify({ homeDir, updatedAt: now }, null, 2)}\n`,
    'utf8',
  );

  process.env.HOME = systemHome;
  process.env.METABOT_HOME = homeDir;
  try {
    await action(homeDir);
  } finally {
    if (previousHome === undefined) {
      delete process.env.METABOT_HOME;
    } else {
      process.env.METABOT_HOME = previousHome;
    }
    if (previousSystemHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousSystemHome;
    }
    await fs.rm(systemHome, { recursive: true, force: true });
  }
}

test('createConfigStore defaults to the active runtime config and persists updates', async () => {
  await withTempProfileHome(async (homeDir) => {
    const store = createConfigStore();
    const defaults = await store.read();
    assert.equal(store.paths.configPath, path.join(homeDir, '.runtime', 'config.json'));
    assert.deepEqual(JSON.parse(await fs.readFile(store.paths.configPath, 'utf8')), defaults);
    assert.deepEqual(defaults, {
      chain: {
        defaultWriteNetwork: 'mvc',
      },
      a2a: {
        simplemsgListenerEnabled: true,
      },
    });

    const updated = {
      chain: {
        defaultWriteNetwork: 'opcat',
      },
      a2a: {
        simplemsgListenerEnabled: false,
      },
    };

    await store.set(updated);
    const reloaded = await store.read();
    assert.deepEqual(reloaded, updated);
  });
});

test('read merges defaults when active config fields are missing', async () => {
  await withTempProfileHome(async () => {
    const store = createConfigStore();
    await store.ensureLayout();

    await fs.writeFile(store.paths.configPath, `${JSON.stringify({ chain: {} }, null, 2)}\n`, 'utf8');
    const reloaded = await store.read();
    assert.deepEqual(reloaded, {
      chain: {
        defaultWriteNetwork: 'mvc',
      },
      a2a: {
        simplemsgListenerEnabled: true,
      },
    });
  });
});

test('read ignores retired askMaster and evolution_network config fields', async () => {
  await withTempProfileHome(async () => {
    const store = createConfigStore();
    await store.ensureLayout();
    const legacy = {
      chain: {
        defaultWriteNetwork: 'btc',
      },
      evolution_network: {
        enabled: false,
        autoRecordExecutions: false,
      },
      askMaster: {
        enabled: false,
        triggerMode: 'manual',
      },
      a2a: {
        simplemsgListenerEnabled: false,
      },
    };

    await fs.writeFile(store.paths.configPath, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8');
    const reloaded = await store.read();
    assert.deepEqual(reloaded, {
      chain: {
        defaultWriteNetwork: 'btc',
      },
      a2a: {
        simplemsgListenerEnabled: false,
      },
    });
  });
});

test('set drops retired askMaster and evolution_network fields from persisted config', async () => {
  await withTempProfileHome(async () => {
    const store = createConfigStore();

    await store.set({
      chain: {
        defaultWriteNetwork: 'doge',
      },
      evolution_network: {
        enabled: false,
      },
      askMaster: {
        enabled: false,
      },
      a2a: {
        simplemsgListenerEnabled: true,
      },
    });

    const persisted = JSON.parse(await fs.readFile(store.paths.configPath, 'utf8'));
    assert.deepEqual(persisted, {
      chain: {
        defaultWriteNetwork: 'doge',
      },
      a2a: {
        simplemsgListenerEnabled: true,
      },
    });
  });
});
