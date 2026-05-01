import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createConfigStore } = require('../../dist/core/config/configStore.js');

async function withTempProfileHome(action, options = {}) {
  const systemHome = await fs.mkdtemp(path.join(os.tmpdir(), 'metabot-config-'));
  const homeDir = path.join(systemHome, '.metabot', 'profiles', 'test-profile');
  const managerRoot = path.join(systemHome, '.metabot', 'manager');
  const previousHome = process.env.METABOT_HOME;
  const previousSystemHome = process.env.HOME;
  const previousInternalAuto = process.env.METABOT_INTERNAL_ASK_MASTER_AUTO;
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
  if (options.allowInternalAuto) {
    process.env.METABOT_INTERNAL_ASK_MASTER_AUTO = '1';
  } else {
    delete process.env.METABOT_INTERNAL_ASK_MASTER_AUTO;
  }
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
    if (previousInternalAuto === undefined) {
      delete process.env.METABOT_INTERNAL_ASK_MASTER_AUTO;
    } else {
      process.env.METABOT_INTERNAL_ASK_MASTER_AUTO = previousInternalAuto;
    }
    await fs.rm(systemHome, { recursive: true, force: true });
  }
}

test('createConfigStore defaults to evolution_network enabled true and persists updates', async () => {
  await withTempProfileHome(async (homeDir) => {
    const store = createConfigStore();
    const defaults = await store.read();
    assert.equal(store.paths.configPath, path.join(homeDir, '.runtime', 'config.json'));
    assert.deepEqual(JSON.parse(await fs.readFile(store.paths.configPath, 'utf8')), defaults);
    assert.strictEqual(defaults.evolution_network.enabled, true);
    assert.strictEqual(defaults.evolution_network.autoRecordExecutions, true);
    assert.deepEqual(defaults.askMaster, {
      enabled: true,
      triggerMode: 'suggest',
      confirmationMode: 'always',
      contextMode: 'standard',
      trustedMasters: [],
      autoPolicy: {
        minConfidence: 0.9,
        minNoProgressWindowMs: 300_000,
        perTraceLimit: 1,
        globalCooldownMs: 1_800_000,
        allowTrustedAutoSend: false,
      },
    });
    assert.deepEqual(defaults.a2a, {
      simplemsgListenerEnabled: true,
    });

    const updated = {
      evolution_network: {
        enabled: false,
        autoAdoptSameSkillSameScope: true,
        autoRecordExecutions: true
      },
      askMaster: {
        enabled: true,
        triggerMode: 'suggest',
        confirmationMode: 'always',
        contextMode: 'compact',
        trustedMasters: ['master-pin-1'],
        autoPolicy: {
          minConfidence: 0.84,
          minNoProgressWindowMs: 600_000,
          perTraceLimit: 2,
          globalCooldownMs: 90_000,
          allowTrustedAutoSend: true,
        },
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

test('read merges defaults when config fields are missing', async () => {
  await withTempProfileHome(async () => {
    const store = createConfigStore();
    await store.ensureLayout();
    const partial = {
      evolution_network: {
        enabled: false
      }
    };

    await fs.writeFile(store.paths.configPath, `${JSON.stringify(partial, null, 2)}\n`, 'utf8');
    const reloaded = await store.read();
    assert.deepEqual(reloaded, {
      evolution_network: {
        enabled: false,
        autoAdoptSameSkillSameScope: false,
        autoRecordExecutions: true
      },
      askMaster: {
        enabled: true,
        triggerMode: 'suggest',
        confirmationMode: 'always',
        contextMode: 'standard',
        trustedMasters: [],
        autoPolicy: {
          minConfidence: 0.9,
          minNoProgressWindowMs: 300_000,
          perTraceLimit: 1,
          globalCooldownMs: 1_800_000,
          allowTrustedAutoSend: false,
        },
      },
      a2a: {
        simplemsgListenerEnabled: true,
      },
    });
  });
});

test('read ignores non-boolean config values and falls back to defaults', async () => {
  await withTempProfileHome(async () => {
    const store = createConfigStore();
    await store.ensureLayout();
    const invalid = {
      evolution_network: {
        enabled: 'nope',
        autoAdoptSameSkillSameScope: 1,
        autoRecordExecutions: null
      }
    };

    await fs.writeFile(store.paths.configPath, `${JSON.stringify(invalid, null, 2)}\n`, 'utf8');
    const reloaded = await store.read();
    assert.deepEqual(reloaded, {
      evolution_network: {
        enabled: true,
        autoAdoptSameSkillSameScope: false,
        autoRecordExecutions: true
      },
      askMaster: {
        enabled: true,
        triggerMode: 'suggest',
        confirmationMode: 'always',
        contextMode: 'standard',
        trustedMasters: [],
        autoPolicy: {
          minConfidence: 0.9,
          minNoProgressWindowMs: 300_000,
          perTraceLimit: 1,
          globalCooldownMs: 1_800_000,
          allowTrustedAutoSend: false,
        },
      },
      a2a: {
        simplemsgListenerEnabled: true,
      },
    });
  });
});

test('read throws when config file contains malformed JSON', async () => {
  await withTempProfileHome(async () => {
    const store = createConfigStore();
    await store.ensureLayout();
    await fs.writeFile(store.paths.configPath, '{ not json', 'utf8');
    await assert.rejects(() => store.read(), { name: 'SyntaxError' });
  });
});

test('set normalizes partial askMaster autoPolicy when callers omit new phase-3 fields', async () => {
  await withTempProfileHome(async () => {
    const store = createConfigStore();
    await store.set({
      evolution_network: {
        enabled: true,
        autoAdoptSameSkillSameScope: false,
        autoRecordExecutions: true
      },
      askMaster: {
        enabled: true,
        triggerMode: 'auto',
        confirmationMode: 'never',
        contextMode: 'standard',
        trustedMasters: ['master-pin-1'],
        autoPolicy: {
          minConfidence: 0.75,
        },
      }
    });

    const reloaded = await store.read();
    assert.equal(reloaded.askMaster.triggerMode, 'suggest');
    assert.deepEqual(reloaded.askMaster.autoPolicy, {
      minConfidence: 0.75,
      minNoProgressWindowMs: 300_000,
      perTraceLimit: 1,
      globalCooldownMs: 1_800_000,
      allowTrustedAutoSend: false,
    });
  });
});

test('set preserves internal auto triggerMode when the internal override is enabled', async () => {
  await withTempProfileHome(async () => {
    const store = createConfigStore();
    await store.set({
      evolution_network: {
        enabled: true,
        autoAdoptSameSkillSameScope: false,
        autoRecordExecutions: true
      },
      askMaster: {
        enabled: true,
        triggerMode: 'auto',
        confirmationMode: 'never',
        contextMode: 'standard',
        trustedMasters: [],
        autoPolicy: {
          minConfidence: 0.75,
          minNoProgressWindowMs: 300_000,
          perTraceLimit: 1,
          globalCooldownMs: 1_800_000,
          allowTrustedAutoSend: false,
        },
      }
    });

    const reloaded = await store.read();
    assert.equal(reloaded.askMaster.triggerMode, 'auto');
  }, { allowInternalAuto: true });
});
