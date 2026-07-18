import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createDaemonStateStore } = require('../../dist/core/state/daemonStateStore.js');

test('createDaemonStateStore persists one installation endpoint and global daemon process record', async () => {
  const systemHomeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-global-daemon-'));
  const store = createDaemonStateStore(systemHomeDir);

  await store.writeInstallation({
    schemaVersion: 1,
    host: '127.0.0.1',
    port: 10002,
    selectionOrigin: 'fallback',
    updatedAt: 1_744_444_444_000,
  });
  await store.writeDaemon({
    schemaVersion: 1,
    instanceId: 'default',
    ownerId: 'metabot-daemon-1',
    pid: 12345,
    host: '127.0.0.1',
    port: 10002,
    baseUrl: 'http://127.0.0.1:10002',
    oacVersion: '0.2.32',
    runtimeFingerprint: 'runtime-fingerprint',
    supervisor: {
      kind: 'none',
      serviceId: null,
    },
    startedAt: 1_744_444_444_000,
  });

  assert.deepEqual(await store.readInstallation(), {
    schemaVersion: 1,
    host: '127.0.0.1',
    port: 10002,
    selectionOrigin: 'fallback',
    updatedAt: 1_744_444_444_000,
  });
  assert.equal((await store.readDaemon())?.baseUrl, 'http://127.0.0.1:10002');
  assert.match(await readFile(store.paths.daemonStatePath, 'utf8'), /runtime-fingerprint/);
  assert.equal(store.paths.daemonStatePath.includes('/profiles/'), false);

  await store.clearDaemon(12345);
  assert.equal(await store.readDaemon(), null);
});
