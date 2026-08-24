import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRootSync } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { getGroupTaskHealth } = require('../../dist/core/grouptask/health.js');

function fakeCtx(overrides = {}) {
  return {
    listProfiles: async () => overrides.profiles ?? [
      { slug: 'worker-1', globalMetaId: 'idW1', homeDir: '/tmp/worker-1', botType: 'worker' },
      { slug: 'twin-bot', globalMetaId: 'idTwin', homeDir: '/tmp/twin-bot', botType: 'twin' },
    ],
    getProfile: async () => null,
    signerForSlug: async () => { throw new Error('unused'); },
    ownerIdentity: overrides.ownerIdentity ?? (async () => ({
      globalMetaId: 'idOwner',
      metaId: null,
      name: 'Owner',
      signer: {},
    })),
    ...overrides.ctx,
  };
}

test('grouptask health reports twin chair, owner, listener, and task counters', async () => {
  const report = await getGroupTaskHealth(fakeCtx(), {
    readSimplemsgListenerEnabled: async () => false,
  });
  assert.deepEqual(report.chair, { resolvable: true, slug: 'twin-bot', globalMetaId: 'idTwin' });
  assert.deepEqual(report.ownerIdentity, { present: true, globalMetaId: 'idOwner', name: 'Owner' });
  assert.equal(report.simplemsgListenerEnabled, false);
  assert.deepEqual(report.tasks, { active: 0, total: 0 });
  assert.deepEqual(report.engine, { logFile: null, recentLines: [] });
});

test('grouptask health surfaces unresolved chair and missing owner as report fields, not errors', async () => {
  const systemHome = mkdtempTempRootSync('metabot-gt-health-empty-');
  const report = await getGroupTaskHealth(fakeCtx({
    profiles: [{ slug: 'worker-1', globalMetaId: 'idW1', homeDir: path.join(systemHome, 'w1'), botType: 'worker' }],
    ownerIdentity: async () => null,
  }), {
    readSimplemsgListenerEnabled: async () => { throw new Error('config unreadable'); },
  });
  assert.equal(report.chair.resolvable, false);
  if (report.chair.resolvable === false) {
    assert.ok(report.chair.reason.includes('twin'));
  }
  assert.deepEqual(report.ownerIdentity, { present: false });
  // Unreadable config degrades to the safe default (on), never throws.
  assert.equal(report.simplemsgListenerEnabled, true);
});

test('grouptask health tails the engine log and caps the line count', async () => {
  const logsRoot = path.join(mkdtempTempRootSync('metabot-gt-health-log-'), 'logs');
  mkdirSync(logsRoot, { recursive: true });
  const logFile = path.join(logsRoot, 'grouptask-engine.log');
  for (let i = 0; i < 20; i += 1) {
    writeFileSync(logFile, `[2026-08-24T00:00:${String(i).padStart(2, '0')}.000Z] event ${i}\n`, { flag: 'a' });
  }
  const report = await getGroupTaskHealth(fakeCtx(), { engineLogFile: logFile });
  assert.equal(report.engine.logFile, logFile);
  assert.equal(report.engine.recentLines.length, 15);
  assert.ok(report.engine.recentLines[report.engine.recentLines.length - 1].includes('event 19'));
  assert.ok(!report.engine.recentLines[0].includes('event 0'));
});
