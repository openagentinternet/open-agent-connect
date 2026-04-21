import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createConfigStore } = require('../../dist/core/config/configStore.js');

async function withTempHome(action, options = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'metabot-ask-master-config-'));
  const previousHome = process.env.METABOT_HOME;
  const previousInternalAuto = process.env.METABOT_INTERNAL_ASK_MASTER_AUTO;
  process.env.METABOT_HOME = tempDir;
  if (options.allowInternalAuto) {
    process.env.METABOT_INTERNAL_ASK_MASTER_AUTO = '1';
  } else {
    delete process.env.METABOT_INTERNAL_ASK_MASTER_AUTO;
  }
  try {
    await action(tempDir);
  } finally {
    if (previousHome === undefined) {
      delete process.env.METABOT_HOME;
    } else {
      process.env.METABOT_HOME = previousHome;
    }
    if (previousInternalAuto === undefined) {
      delete process.env.METABOT_INTERNAL_ASK_MASTER_AUTO;
    } else {
      process.env.METABOT_INTERNAL_ASK_MASTER_AUTO = previousInternalAuto;
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
      triggerMode: 'suggest',
      confirmationMode: 'always',
      contextMode: 'standard',
      trustedMasters: ['master-pin-1'],
      autoPolicy: {
        minConfidence: 0.9,
        minNoProgressWindowMs: 300_000,
        perTraceLimit: 1,
        globalCooldownMs: 1_800_000,
        allowTrustedAutoSend: false,
      },
    });
  });
});

test('read migrates legacy public askMaster triggerMode auto back to suggest by default', async () => {
  await withTempHome(async () => {
    const store = createConfigStore();
    await store.ensureLayout();
    await fs.writeFile(store.paths.configPath, `${JSON.stringify({
      askMaster: {
        enabled: true,
        triggerMode: 'auto',
        confirmationMode: 'sensitive_only',
        contextMode: 'full_task',
        trustedMasters: ['master-pin-1'],
        autoPolicy: {
          minConfidence: 0.82,
          minNoProgressWindowMs: 420_000,
          perTraceLimit: 2,
          globalCooldownMs: 900_000,
          allowTrustedAutoSend: true,
        },
      },
    }, null, 2)}\n`, 'utf8');

    const config = await store.read();
    assert.deepEqual(config.askMaster, {
      enabled: true,
      triggerMode: 'suggest',
      confirmationMode: 'sensitive_only',
      contextMode: 'full_task',
      trustedMasters: ['master-pin-1'],
      autoPolicy: {
        minConfidence: 0.82,
        minNoProgressWindowMs: 420_000,
        perTraceLimit: 2,
        globalCooldownMs: 900_000,
        allowTrustedAutoSend: true,
      },
    });
  });
});

test('read preserves internal askMaster triggerMode auto when the internal override is enabled', async () => {
  await withTempHome(async () => {
    const store = createConfigStore();
    await store.ensureLayout();
    await fs.writeFile(store.paths.configPath, `${JSON.stringify({
      askMaster: {
        enabled: true,
        triggerMode: 'auto',
        confirmationMode: 'sensitive_only',
        contextMode: 'full_task',
        trustedMasters: ['master-pin-1'],
        autoPolicy: {
          minConfidence: 0.82,
          minNoProgressWindowMs: 420_000,
          perTraceLimit: 2,
          globalCooldownMs: 900_000,
          allowTrustedAutoSend: true,
        },
      },
    }, null, 2)}\n`, 'utf8');

    const config = await store.read();
    assert.equal(config.askMaster.triggerMode, 'auto');
  }, { allowInternalAuto: true });
});

test('read normalizes malformed nested autoPolicy fields and clamps unsafe values', async () => {
  await withTempHome(async () => {
    const store = createConfigStore();
    await store.ensureLayout();
    await fs.writeFile(store.paths.configPath, `${JSON.stringify({
      askMaster: {
        autoPolicy: {
          minConfidence: 5,
          minNoProgressWindowMs: -1,
          perTraceLimit: 0,
          globalCooldownMs: '120000',
          allowTrustedAutoSend: 'yes',
        },
      },
    }, null, 2)}\n`, 'utf8');

    const config = await store.read();
    assert.deepEqual(config.askMaster.autoPolicy, {
      minConfidence: 0.99,
      minNoProgressWindowMs: 0,
      perTraceLimit: 1,
      globalCooldownMs: 120_000,
      allowTrustedAutoSend: false,
    });
  });
});
