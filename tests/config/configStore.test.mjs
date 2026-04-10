import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createConfigStore } = require('../../dist/core/config/configStore.js');

async function withTempHome(action) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'metabot-config-'));
  const previousHome = process.env.METABOT_HOME;
  process.env.METABOT_HOME = tempDir;
  try {
    await action(tempDir);
  } finally {
    if (previousHome === undefined) {
      delete process.env.METABOT_HOME;
    } else {
      process.env.METABOT_HOME = previousHome;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

test('createConfigStore defaults to evolution_network enabled true and persists updates', async () => {
  await withTempHome(async () => {
    const store = createConfigStore();
    const defaults = await store.read();
    assert.strictEqual(defaults.evolution_network.enabled, true);
    assert.strictEqual(defaults.evolution_network.autoRecordExecutions, true);

    const updated = {
      evolution_network: {
        enabled: false,
        autoAdoptSameSkillSameScope: true,
        autoRecordExecutions: true
      }
    };

    await store.set(updated);
    const reloaded = await store.read();
    assert.deepEqual(reloaded, updated);
  });
});

test('read merges defaults when config fields are missing', async () => {
  await withTempHome(async () => {
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
      }
    });
  });
});

test('read ignores non-boolean config values and falls back to defaults', async () => {
  await withTempHome(async () => {
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
      }
    });
  });
});

test('read throws when config file contains malformed JSON', async () => {
  await withTempHome(async () => {
    const store = createConfigStore();
    await store.ensureLayout();
    await fs.writeFile(store.paths.configPath, '{ not json', 'utf8');
    await assert.rejects(() => store.read(), { name: 'SyntaxError' });
  });
});
