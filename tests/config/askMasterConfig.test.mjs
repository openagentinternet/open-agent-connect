import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createConfigStore } = require('../../dist/core/config/configStore.js');

async function withTempHome(action) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'metabot-ask-master-config-'));
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

test('createConfigStore exposes askMaster defaults', async () => {
  await withTempHome(async () => {
    const store = createConfigStore();
    const config = await store.read();

    assert.deepEqual(config.askMaster, {
      enabled: true,
      triggerMode: 'manual',
      confirmationMode: 'always',
      contextMode: 'standard',
      trustedMasters: [],
    });
  });
});

test('read merges askMaster defaults when fields are missing or malformed', async () => {
  await withTempHome(async () => {
    const store = createConfigStore();
    await store.ensureLayout();
    await fs.writeFile(store.paths.configPath, `${JSON.stringify({
      askMaster: {
        enabled: false,
        trustedMasters: ['master-pin-1', '', 'master-pin-1'],
        confirmationMode: 1,
      },
    }, null, 2)}\n`, 'utf8');

    const config = await store.read();
    assert.deepEqual(config.askMaster, {
      enabled: false,
      triggerMode: 'manual',
      confirmationMode: 'always',
      contextMode: 'standard',
      trustedMasters: ['master-pin-1'],
    });
  });
});
