import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const {
  classifyDaemonRecordState,
  collectDaemonStartupDiagnostics,
  formatDaemonStartupTimeoutMessage,
  formatPermissionDeniedStartupError,
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
  assert.equal(snapshot.startupLogPath, paths.daemonLogPath);
  // pid 1111 is not a running process in the test environment — a present
  // record with a dead pid classifies as stale.
  assert.equal(snapshot.daemonRecordState, 'stale');
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
    startupLogPath: '/tmp/system-home/.metabot/runtime/logs/daemon.log',
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
    daemonRecordState: 'stale',
    lockInfo: {
      ownerId: 'lock-alice',
      pid: 999999,
      acquiredAt: 654321,
    },
    lockOwnerAlive: false,
  }, {
    spawnError: 'spawn EBADF',
    exitCode: 1,
  });

  assert.ok(message.includes('Timed out while starting the local MetaBot daemon.'));
  assert.ok(message.includes('System home: /tmp/system-home'));
  assert.ok(message.includes('Preferred port: 32390'));
  assert.ok(message.includes('daemon.json: /tmp/system-home/.metabot/runtime/daemon.json'));
  assert.ok(message.includes('daemon.lock: /tmp/system-home/.metabot/runtime/locks/daemon.lock'));
  assert.ok(message.includes('pid=999999'));
  assert.ok(message.includes('ownerAlive=no'));
  // The stale classification names the leftover record; the child cause and
  // the startup log path point at the real failure reason.
  assert.ok(message.includes('daemon.json state: stale'));
  assert.ok(message.includes('Daemon spawn failed: spawn EBADF'));
  assert.ok(message.includes('exit code 1'));
  assert.ok(message.includes('Startup log (real cause): /tmp/system-home/.metabot/runtime/logs/daemon.log'));
});

test('classifyDaemonRecordState distinguishes missing, stale, and alive records', () => {
  assert.equal(classifyDaemonRecordState(null), 'missing');
  assert.equal(classifyDaemonRecordState({ pid: 999_999 }), 'stale');
  assert.equal(classifyDaemonRecordState({ pid: process.pid }), 'alive');
  assert.equal(classifyDaemonRecordState({}), 'missing');
});

test('formatPermissionDeniedStartupError attaches stat context and sandbox guidance', async (t) => {
  const existingPath = path.join(await mkdtempTempRoot('metabot-perm-diag-'), 'daemon.json');
  await writeFile(existingPath, '{}', 'utf8');
  t.after(async () => {
    await rm(path.dirname(existingPath), { recursive: true, force: true });
  });

  const existingMessage = await formatPermissionDeniedStartupError(
    Object.assign(new Error(`EPERM: operation not permitted, unlink '${existingPath}'`), {
      code: 'EPERM',
      path: existingPath,
    }),
  );
  assert.ok(existingMessage.includes('EPERM'));
  assert.ok(existingMessage.includes(existingPath));
  assert.ok(existingMessage.includes(`stat ${existingPath}: exists`));
  assert.ok(existingMessage.includes('mode='));
  assert.ok(existingMessage.includes('sandbox'));
  assert.ok(existingMessage.includes('chown'));

  const missingMessage = await formatPermissionDeniedStartupError(
    Object.assign(new Error(`EPERM: operation not permitted, unlink '/nonexistent/daemon.json'`), {
      code: 'EPERM',
      path: '/nonexistent/daemon.json',
    }),
  );
  assert.ok(missingMessage.includes('does not exist'));
});
