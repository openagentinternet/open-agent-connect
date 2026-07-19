import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRootSync } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { createMetabotDaemon } = require('../../dist/daemon/index.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');

function createHome(prefix) {
  const systemHome = mkdtempTempRootSync(prefix);
  const homeDir = path.join(systemHome, '.metabot', 'profiles', 'test-profile');
  mkdirSync(homeDir, { recursive: true });
  return homeDir;
}

async function httpGet(url, agent) {
  await new Promise((resolve, reject) => {
    const request = http.get(url, { agent }, (response) => {
      response.resume();
      response.on('end', resolve);
      response.on('error', reject);
    });
    request.on('error', reject);
  });
}

test('daemon startup recovers from a stale legacy lock without pid metadata', async () => {
  const homeDir = createHome('metabot-daemon-stale-lock-');
  const paths = resolveMetabotPaths(homeDir);
  const daemon = createMetabotDaemon({
    homeDirOrPaths: paths,
    ownerId: 'daemon-lock-test',
  });

  mkdirSync(paths.locksRoot, { recursive: true });
  writeFileSync(paths.daemonLockPath, `${JSON.stringify({
    ownerId: 'legacy-daemon',
    acquiredAt: Date.now() - 10_000,
  })}\n`, 'utf8');

  const address = await daemon.start(0);
  assert.match(address.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);

  const lock = JSON.parse(readFileSync(paths.daemonLockPath, 'utf8'));
  assert.equal(lock.ownerId, 'daemon-lock-test');
  assert.equal(lock.pid, process.pid);

  await daemon.close();
});

test('daemon close resolves even when the caller keeps an idle keep-alive socket open', async () => {
  const homeDir = createHome('metabot-daemon-keepalive-close-');
  const daemon = createMetabotDaemon({
    homeDirOrPaths: resolveMetabotPaths(homeDir),
    ownerId: 'daemon-close-keepalive-test',
  });
  const address = await daemon.start(0);
  const keepAliveAgent = new http.Agent({ keepAlive: true });

  try {
    await httpGet(`${address.baseUrl}/api/daemon/status`, keepAliveAgent);
    const closeResult = await Promise.race([
      daemon.close().then(() => 'closed'),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 1_000)),
    ]);
    assert.equal(closeResult, 'closed');
  } finally {
    keepAliveAgent.destroy();
  }
});
