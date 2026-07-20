import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

import { cleanupTempRoot, mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { probeDaemonStatus } = require('../../dist/cli/runtime.js');
const {
  resolveMetabotDaemonPaths,
  resolveMetabotPaths,
} = require('../../dist/core/state/paths.js');
const { createDaemonStateStore } = require('../../dist/core/state/daemonStateStore.js');
const { createRuntimeStateStore } = require('../../dist/core/state/runtimeStateStore.js');

function parseLastJson(chunks) {
  return JSON.parse(chunks.join('').trim());
}

async function closeServerAndConnections(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}

async function listenIfAvailable(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      if (error?.code === 'EADDRINUSE') {
        resolve(false);
        return;
      }
      reject(error);
    };
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError);
      resolve(true);
    });
  });
}

async function createIndexedProfileHome() {
  const systemHomeDir = await mkdtempTempRoot('metabot-daemon-lifecycle-');
  const homeDir = path.join(systemHomeDir, '.metabot', 'profiles', 'alice');
  const paths = resolveMetabotPaths(homeDir);
  await mkdir(paths.managerRoot, { recursive: true });
  await mkdir(homeDir, { recursive: true });
  await writeFile(
    paths.identityProfilesPath,
    `${JSON.stringify({
      profiles: [{
        name: 'Initial',
        slug: 'alice',
        aliases: [],
        homeDir,
        globalMetaId: 'gm-alice',
        mvcAddress: 'mvc-alice',
        createdAt: 1,
        updatedAt: 1,
      }],
    }, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    paths.activeHomePath,
    `${JSON.stringify({ homeDir, updatedAt: 1 }, null, 2)}\n`,
    'utf8',
  );
  return {
    systemHomeDir,
    homeDir,
    paths,
    daemonPaths: resolveMetabotDaemonPaths(systemHomeDir),
  };
}

function globalDaemonRecord(overrides = {}) {
  return {
    schemaVersion: 1,
    instanceId: 'default',
    ownerId: 'metabot-daemon-test',
    pid: 12345,
    host: '127.0.0.1',
    port: 32123,
    baseUrl: 'http://127.0.0.1:32123',
    oacVersion: '0.2.32',
    runtimeFingerprint: 'test-runtime',
    supervisor: { kind: 'none', serviceId: null },
    startedAt: Date.now(),
    ...overrides,
  };
}

test('probeDaemonStatus times out when a local endpoint accepts but never answers', async (t) => {
  const sockets = new Set();
  const server = http.createServer((_req, _res) => {
    // Intentionally leave the response open to emulate a hung daemon route.
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP listener address.');
  }
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  const startedAt = Date.now();
  const result = await probeDaemonStatus(`http://127.0.0.1:${address.port}`, 40);

  assert.deepEqual(result, { reachable: false, ownerId: null, pid: null });
  assert.ok(Date.now() - startedAt < 1_000);
});

test('daemon stop refuses an unverified live pid and preserves its record', async (t) => {
  const { systemHomeDir, homeDir } = await createIndexedProfileHome();
  const store = createDaemonStateStore(systemHomeDir);
  t.after(async () => {
    await cleanupTempRoot(systemHomeDir);
  });

  await store.writeDaemon(globalDaemonRecord({
    ownerId: 'stale-owner',
    pid: process.pid,
    host: '127.0.0.1',
    port: 32123,
    baseUrl: 'http://127.0.0.1:9',
  }));

  const stdout = [];
  const exitCode = await runCli(['daemon', 'stop'], {
    env: {
      ...process.env,
      HOME: systemHomeDir,
      METABOT_HOME: homeDir,
    },
    cwd: homeDir,
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 1);
  assert.equal(parseLastJson(stdout).code, 'daemon_ownership_unverified');
  assert.equal((await store.readDaemon())?.pid, process.pid);
});

test('daemon stop keeps a dead daemon record when its recorded port is still occupied', async (t) => {
  const { systemHomeDir, homeDir } = await createIndexedProfileHome();
  const store = createDaemonStateStore(systemHomeDir);
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP listener address.');
  }
  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await cleanupTempRoot(systemHomeDir);
  });

  await store.writeDaemon(globalDaemonRecord({
    ownerId: 'dead-owner',
    pid: 999_999,
    host: '127.0.0.1',
    port: address.port,
    baseUrl: `http://127.0.0.1:${address.port}`,
  }));

  const stdout = [];
  const exitCode = await runCli(['daemon', 'stop'], {
    env: {
      ...process.env,
      HOME: systemHomeDir,
      METABOT_HOME: homeDir,
    },
    cwd: homeDir,
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 1);
  assert.equal(parseLastJson(stdout).code, 'daemon_stop_failed');
  assert.equal((await store.readDaemon())?.pid, 999_999);
});

test('daemon stop waits for a verified daemon to exit before clearing its record', async (t) => {
  const { systemHomeDir, homeDir } = await createIndexedProfileHome();
  const store = createDaemonStateStore(systemHomeDir);
  const env = {
    ...process.env,
    HOME: systemHomeDir,
    METABOT_HOME: homeDir,
    METABOT_TEST_FAKE_CHAIN_WRITE: '1',
    METABOT_TEST_FAKE_SUBSIDY: '1',
    METABOT_CHAIN_API_BASE_URL: 'http://127.0.0.1:9',
  };
  t.after(async () => {
    // Stops the daemon process group and waits for exit before removing the
    // temp system home.
    await cleanupTempRoot(systemHomeDir);
  });

  const startOutput = [];
  const startExitCode = await runCli(['daemon', 'start'], {
    env,
    cwd: homeDir,
    stdout: { write: (chunk) => { startOutput.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });
  assert.equal(startExitCode, 0, startOutput.join(''));

  const daemonBeforeStop = await store.readDaemon();
  assert.ok(daemonBeforeStop?.pid);

  const stopOutput = [];
  const stopExitCode = await runCli(['daemon', 'stop'], {
    env,
    cwd: homeDir,
    stdout: { write: (chunk) => { stopOutput.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(stopExitCode, 0, stopOutput.join(''));
  assert.equal(parseLastJson(stopOutput).data.stopped, true);
  assert.equal(await store.readDaemon(), null);
});

test('first installation persists the bounded fallback port and never drifts after it is configured', async (t) => {
  const { systemHomeDir, homeDir } = await createIndexedProfileHome();
  const daemonStore = createDaemonStateStore(systemHomeDir);
  const defaultPortBlocker = http.createServer();
  await listenIfAvailable(defaultPortBlocker, 10001);
  t.after(async () => {
    await closeServerAndConnections(defaultPortBlocker).catch(() => undefined);
    // Stops the daemon process group and waits for exit before removing the
    // temp system home.
    await cleanupTempRoot(systemHomeDir);
  });

  const env = {
    ...process.env,
    HOME: systemHomeDir,
    METABOT_HOME: homeDir,
    METABOT_TEST_FAKE_CHAIN_WRITE: '1',
    METABOT_TEST_FAKE_SUBSIDY: '1',
    METABOT_CHAIN_API_BASE_URL: 'http://127.0.0.1:9',
  };
  const startOutput = [];
  const startExitCode = await runCli(['daemon', 'start'], {
    env,
    cwd: homeDir,
    stdout: { write: (chunk) => { startOutput.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });
  assert.equal(startExitCode, 0, startOutput.join(''));

  const installation = await daemonStore.readInstallation();
  assert.equal(installation?.host, '127.0.0.1');
  assert.equal(installation?.selectionOrigin, 'fallback');
  assert.ok(
    Number.isInteger(installation?.port)
      && installation.port >= 10002
      && installation.port <= 10020,
  );

  const stopOutput = [];
  const stopExitCode = await runCli(['daemon', 'stop'], {
    env,
    cwd: homeDir,
    stdout: { write: (chunk) => { stopOutput.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });
  assert.equal(stopExitCode, 0, stopOutput.join(''));

  const fallbackPortBlocker = http.createServer();
  assert.equal(await listenIfAvailable(fallbackPortBlocker, installation.port), true);
  t.after(async () => {
    await closeServerAndConnections(fallbackPortBlocker).catch(() => undefined);
  });

  const restartOutput = [];
  const restartExitCode = await runCli(['daemon', 'start'], {
    env,
    cwd: homeDir,
    stdout: { write: (chunk) => { restartOutput.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });
  assert.equal(restartExitCode, 1);
  assert.match(parseLastJson(restartOutput).message, /daemon_port_in_use/);
  assert.equal((await daemonStore.readInstallation())?.port, installation.port);
});

test('first global start quarantines stale profile daemon metadata without touching profile state', async (t) => {
  const { systemHomeDir, homeDir, paths } = await createIndexedProfileHome();
  const daemonStore = createDaemonStateStore(systemHomeDir);
  await createRuntimeStateStore(homeDir).writeDaemon({
    ownerId: 'legacy-daemon',
    pid: 999_999,
    host: '127.0.0.1',
    port: 32145,
    baseUrl: 'http://127.0.0.1:32145',
    startedAt: 1,
  });
  t.after(async () => {
    // Stops the daemon process group and waits for exit before removing the
    // temp system home.
    await cleanupTempRoot(systemHomeDir);
  });

  const env = {
    ...process.env,
    HOME: systemHomeDir,
    METABOT_HOME: homeDir,
    METABOT_TEST_FAKE_CHAIN_WRITE: '1',
    METABOT_TEST_FAKE_SUBSIDY: '1',
    METABOT_CHAIN_API_BASE_URL: 'http://127.0.0.1:9',
  };
  const output = [];
  const exitCode = await runCli(['daemon', 'start'], {
    env,
    cwd: homeDir,
    stdout: { write: (chunk) => { output.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });
  assert.equal(exitCode, 0, output.join(''));
  assert.equal(await createRuntimeStateStore(homeDir).readDaemon(), null);
  assert.equal(
    (await readdir(paths.runtimeRoot)).some((entry) => entry.startsWith('daemon.json.migrated-')),
    true,
  );
  assert.equal((await daemonStore.readDaemon())?.instanceId, 'default');
  const installation = await daemonStore.readInstallation();
  assert.equal(installation?.host, '127.0.0.1');
  assert.ok(
    Number.isInteger(installation?.port)
      && installation.port >= 10001
      && installation.port <= 10020,
  );
  assert.equal(installation?.selectionOrigin, installation?.port === 10001 ? 'default' : 'fallback');

  const stopOutput = [];
  const stopExitCode = await runCli(['daemon', 'stop'], {
    env,
    cwd: homeDir,
    stdout: { write: (chunk) => { stopOutput.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });
  assert.equal(stopExitCode, 0, stopOutput.join(''));
});
