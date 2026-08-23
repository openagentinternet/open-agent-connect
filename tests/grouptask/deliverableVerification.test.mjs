import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRootSync } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const {
  createMetasoPinVerifier,
  verifyTaskDeliverables,
  extractDeliverablePinId,
} = require('../../dist/core/grouptask/deliverableVerification.js');
const { createGroupTaskStore } = require('../../dist/core/grouptask/store.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');

function jsonRes(body) {
  return { status: 200, json: async () => body };
}

test('metaso verifier maps envelope codes to verdicts', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes('goodpin')) return jsonRes({ code: 0, data: {} });
    if (String(url).includes('missingpin')) return jsonRes({ code: 40400, message: 'no pin' });
    return jsonRes({ code: 1003, message: 'internal' });
  };
  const verify = createMetasoPinVerifier({ baseUrl: 'https://so.test/', fetchImpl, timeoutMs: 2000 });
  assert.equal(await verify('goodpin'.padEnd(64, '0') + 'i0'), 'found');
  assert.equal(await verify('missingpin'.padEnd(64, '0') + 'i0'), 'not_found');
  assert.equal(await verify('otherpin'.padEnd(64, '0') + 'i0'), 'error');
  assert.ok(calls[0].startsWith('https://so.test/api/metaweb/pin/'));
});

test('extractDeliverablePinId pulls the chain pin out of URIs', () => {
  const pin = 'a'.repeat(64) + 'i0';
  assert.equal(extractDeliverablePinId(`pin://${pin}`), pin);
  assert.equal(extractDeliverablePinId(`https://x.test/p/${pin}?y=1`), pin);
  assert.equal(extractDeliverablePinId('https://example.com/no-pin'), null);
});

test('verifyTaskDeliverables flips confirmation, delivers pending, keeps errors', async () => {
  const systemHome = mkdtempTempRootSync('metabot-gt-verify-');
  const homeDir = path.join(systemHome, '.metabot', 'profiles', 'chair');
  mkdirSync(homeDir, { recursive: true });
  const store = createGroupTaskStore(resolveMetabotPaths(homeDir));
  const task = await store.createTask({
    groupId: 'g-verify', title: 'T', goal: 'G', chairSlug: 'chair', createdBy: 'user',
  });
  const goodPin = 'b'.repeat(64) + 'i0';
  const badPin = 'c'.repeat(64) + 'i0';
  const good = await store.addDeliverable({
    taskId: task.id, msgPinId: 'm1', authorGlobalMetaId: 'IDW', kind: 'pin', uri: `pin://${goodPin}`,
  });
  const missing = await store.addDeliverable({
    taskId: task.id, msgPinId: 'm2', authorGlobalMetaId: 'IDW', kind: 'pin', uri: `pin://${badPin}`,
  });
  const verdicts = new Map([[goodPin, 'found'], [badPin, 'not_found']]);
  const logs = [];
  const report = await verifyTaskDeliverables(store, task.id, async (pinId) => verdicts.get(pinId) ?? 'error', {
    now: () => 1_000,
    log: (message) => logs.push(message),
  });
  assert.deepEqual(report, { checked: 2, confirmed: 1, stillUnconfirmed: 1 });

  const rows = await store.listDeliverables(task.id);
  const goodRow = rows.find((row) => row.id === good.id);
  assert.equal(goodRow.confirmation, 'confirmed');
  assert.equal(goodRow.status, 'delivered');
  assert.ok(goodRow.verification.includes('"checkedAt":1000'));
  const missingRow = rows.find((row) => row.id === missing.id);
  assert.equal(missingRow.confirmation, 'unconfirmed');
  assert.equal(missingRow.status, 'pending');
  assert.ok(logs.some((line) => line.includes('still unverified')));

  // Re-run: confirmed rows are skipped entirely.
  const again = await verifyTaskDeliverables(store, task.id, async () => 'found', { now: () => 2_000 });
  assert.equal(again.checked, 1);
});
