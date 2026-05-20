import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createMetabotDaemon } = require('../../dist/daemon/index.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');

function createHome(prefix) {
  const systemHome = mkdtempSync(path.join(tmpdir(), prefix));
  const homeDir = path.join(systemHome, '.metabot', 'profiles', 'test-profile');
  mkdirSync(homeDir, { recursive: true });
  return homeDir;
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
