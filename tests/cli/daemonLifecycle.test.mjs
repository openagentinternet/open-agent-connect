import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { probeDaemonStatus } = require('../../dist/cli/runtime.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createRuntimeStateStore } = require('../../dist/core/state/runtimeStateStore.js');

function parseLastJson(chunks) {
  return JSON.parse(chunks.join('').trim());
}

async function createIndexedProfileHome() {
  const systemHomeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-daemon-lifecycle-'));
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
  return { systemHomeDir, homeDir, paths };
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
  const { systemHomeDir, homeDir, paths } = await createIndexedProfileHome();
  const store = createRuntimeStateStore(homeDir);
  t.after(async () => {
    await rm(systemHomeDir, { recursive: true, force: true });
  });

  await store.writeDaemon({
    ownerId: 'stale-owner',
    pid: process.pid,
    host: '127.0.0.1',
    port: 32123,
    baseUrl: 'http://127.0.0.1:9',
    startedAt: Date.now(),
  });

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
  const store = createRuntimeStateStore(homeDir);
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
    await rm(systemHomeDir, { recursive: true, force: true });
  });

  await store.writeDaemon({
    ownerId: 'dead-owner',
    pid: 999_999,
    host: '127.0.0.1',
    port: address.port,
    baseUrl: `http://127.0.0.1:${address.port}`,
    startedAt: Date.now(),
  });

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
  const store = createRuntimeStateStore(homeDir);
  const env = {
    ...process.env,
    HOME: systemHomeDir,
    METABOT_HOME: homeDir,
    METABOT_TEST_FAKE_CHAIN_WRITE: '1',
    METABOT_TEST_FAKE_SUBSIDY: '1',
    METABOT_CHAIN_API_BASE_URL: 'http://127.0.0.1:9',
  };
  t.after(async () => {
    const daemon = await store.readDaemon();
    if (daemon?.pid) {
      try {
        process.kill(daemon.pid, 'SIGTERM');
      } catch {
        // The daemon already exited.
      }
    }
    await rm(systemHomeDir, { recursive: true, force: true });
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
