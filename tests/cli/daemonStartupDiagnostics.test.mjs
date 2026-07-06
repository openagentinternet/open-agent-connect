import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  collectDaemonStartupDiagnostics,
  formatDaemonStartupTimeoutMessage,
} = require('../../dist/cli/daemonStartupDiagnostics.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createRuntimeStateStore } = require('../../dist/core/state/runtimeStateStore.js');

async function createProfileHome(systemHome, slug = 'test-profile') {
  const homeDir = path.join(systemHome, '.metabot', 'profiles', slug);
  await mkdir(homeDir, { recursive: true });
  return homeDir;
}

test('collectDaemonStartupDiagnostics reads daemon.json and daemon.lock for the selected profile home', async (t) => {
  const systemHome = await mkdtemp(path.join(os.tmpdir(), 'metabot-daemon-diagnostics-'));
  const homeDir = await createProfileHome(systemHome, 'alice');
  const paths = resolveMetabotPaths(homeDir);
  t.after(async () => {
    await rm(systemHome, { recursive: true, force: true });
  });

  await createRuntimeStateStore(homeDir).writeDaemon({
    ownerId: 'daemon-alice',
    pid: 1111,
    host: '127.0.0.1',
    port: 32390,
    baseUrl: 'http://127.0.0.1:32390',
    startedAt: 123456,
    configHash: 'config-hash-1',
  });
  await mkdir(path.dirname(paths.daemonLockPath), { recursive: true });
  await writeFile(paths.daemonLockPath, `${JSON.stringify({
    ownerId: 'lock-alice',
    pid: 999999,
    acquiredAt: 654321,
  }, null, 2)}\n`, 'utf8');

  const snapshot = await collectDaemonStartupDiagnostics({
    homeDir,
    preferredPort: 32390,
  });

  assert.equal(snapshot.homeDir, path.resolve(homeDir));
  assert.equal(snapshot.preferredPort, 32390);
  assert.equal(snapshot.daemonStatePath, paths.daemonStatePath);
  assert.equal(snapshot.lockPath, paths.daemonLockPath);
  assert.equal(snapshot.daemonRecord?.baseUrl, 'http://127.0.0.1:32390');
  assert.equal(snapshot.daemonRecord?.pid, 1111);
  assert.equal(snapshot.lockInfo?.ownerId, 'lock-alice');
  assert.equal(snapshot.lockInfo?.pid, 999999);
  assert.equal(snapshot.lockOwnerAlive, false);
});

test('formatDaemonStartupTimeoutMessage includes the selected home, preferred port, daemon.json, and daemon.lock evidence', async () => {
  const message = formatDaemonStartupTimeoutMessage({
    homeDir: '/tmp/.metabot/profiles/alice',
    preferredPort: 32390,
    daemonStatePath: '/tmp/.metabot/profiles/alice/.runtime/daemon.json',
    lockPath: '/tmp/.metabot/profiles/alice/.runtime/locks/daemon.lock',
    daemonRecord: {
      ownerId: 'daemon-alice',
      pid: 1111,
      host: '127.0.0.1',
      port: 32390,
      baseUrl: 'http://127.0.0.1:32390',
      startedAt: 123456,
      configHash: 'config-hash-1',
    },
    lockInfo: {
      ownerId: 'lock-alice',
      pid: 999999,
      acquiredAt: 654321,
    },
    lockOwnerAlive: false,
  });

  assert.ok(message.includes('Timed out while starting the local MetaBot daemon.'));
  assert.ok(message.includes('Selected profile home: /tmp/.metabot/profiles/alice'));
  assert.ok(message.includes('Preferred port: 32390'));
  assert.ok(message.includes('daemon.json: /tmp/.metabot/profiles/alice/.runtime/daemon.json'));
  assert.ok(message.includes('daemon.lock: /tmp/.metabot/profiles/alice/.runtime/locks/daemon.lock'));
  assert.ok(message.includes('pid=999999'));
  assert.ok(message.includes('ownerAlive=no'));
});
