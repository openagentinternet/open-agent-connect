import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const {
  collectDaemonStartupDiagnostics,
  formatDaemonStartupTimeoutMessage,
} = require('../../dist/cli/daemonStartupDiagnostics.js');
const { resolveMetabotDaemonPaths } = require('../../dist/core/state/paths.js');
const { createDaemonStateStore } = require('../../dist/core/state/daemonStateStore.js');

test('collectDaemonStartupDiagnostics reads global daemon.json and daemon.lock for the installation', async (t) => {
  const systemHome = await mkdtempTempRoot('metabot-daemon-diagnostics-');
  const paths = resolveMetabotDaemonPaths(systemHome);
  t.after(async () => {
    await rm(systemHome, { recursive: true, force: true });
  });

  await createDaemonStateStore(systemHome).writeDaemon({
    schemaVersion: 1,
    instanceId: 'default',
    ownerId: 'daemon-alice',
    pid: 1111,
    host: '127.0.0.1',
    port: 32390,
    baseUrl: 'http://127.0.0.1:32390',
    startedAt: 123456,
    configHash: 'config-hash-1',
    oacVersion: '0.2.32',
    runtimeFingerprint: 'runtime-fingerprint',
    supervisor: { kind: 'none', serviceId: null },
  });
  await mkdir(path.dirname(paths.daemonLockPath), { recursive: true });
  await writeFile(paths.daemonLockPath, `${JSON.stringify({
    ownerId: 'lock-alice',
    pid: 999999,
    acquiredAt: 654321,
  }, null, 2)}\n`, 'utf8');

  const snapshot = await collectDaemonStartupDiagnostics({
    systemHomeDir: systemHome,
    preferredPort: 32390,
  });

  assert.equal(snapshot.systemHomeDir, path.resolve(systemHome));
  assert.equal(snapshot.preferredPort, 32390);
  assert.equal(snapshot.daemonStatePath, paths.daemonStatePath);
  assert.equal(snapshot.lockPath, paths.daemonLockPath);
  assert.equal(snapshot.daemonRecord?.baseUrl, 'http://127.0.0.1:32390');
  assert.equal(snapshot.daemonRecord?.pid, 1111);
  assert.equal(snapshot.lockInfo?.ownerId, 'lock-alice');
  assert.equal(snapshot.lockInfo?.pid, 999999);
  assert.equal(snapshot.lockOwnerAlive, false);
});

test('formatDaemonStartupTimeoutMessage includes the installation, preferred port, daemon.json, and daemon.lock evidence', async () => {
  const message = formatDaemonStartupTimeoutMessage({
    systemHomeDir: '/tmp/system-home',
    preferredPort: 32390,
    daemonStatePath: '/tmp/system-home/.metabot/runtime/daemon.json',
    lockPath: '/tmp/system-home/.metabot/runtime/locks/daemon.lock',
    daemonRecord: {
      schemaVersion: 1,
      instanceId: 'default',
      ownerId: 'daemon-alice',
      pid: 1111,
      host: '127.0.0.1',
      port: 32390,
      baseUrl: 'http://127.0.0.1:32390',
      startedAt: 123456,
      configHash: 'config-hash-1',
      oacVersion: '0.2.32',
      runtimeFingerprint: 'runtime-fingerprint',
      supervisor: { kind: 'none', serviceId: null },
    },
    lockInfo: {
      ownerId: 'lock-alice',
      pid: 999999,
      acquiredAt: 654321,
    },
    lockOwnerAlive: false,
  });

  assert.ok(message.includes('Timed out while starting the local MetaBot daemon.'));
  assert.ok(message.includes('System home: /tmp/system-home'));
  assert.ok(message.includes('Preferred port: 32390'));
  assert.ok(message.includes('daemon.json: /tmp/system-home/.metabot/runtime/daemon.json'));
  assert.ok(message.includes('daemon.lock: /tmp/system-home/.metabot/runtime/locks/daemon.lock'));
  assert.ok(message.includes('pid=999999'));
  assert.ok(message.includes('ownerAlive=no'));
});
