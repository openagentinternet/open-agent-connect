import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { createUserDaemonHandlers } = require('../../dist/daemon/userHandlers.js');
const { readOwnerOnboardingState } = require('../../dist/core/owner/ownerOnboarding.js');

function buildHandlers(systemHomeDir, extra = {}) {
  return createUserDaemonHandlers({ systemHomeDir, ...extra });
}

test('user create re-arms onboarding and the verbs surface the state', async () => {
  const systemHomeDir = await mkdtempTempRoot('metabot-user-onboarding-verbs-');
  const handlers = buildHandlers(systemHomeDir);

  const created = await handlers.create({ name: 'Alice' });
  assert.equal(created.ok, true);
  assert.equal(created.data.identity.name, 'Alice');
  assert.ok(created.data.mnemonic.split(/\s+/).length >= 12);

  // The explicit create cleared any tombstone and pre-marked the identity step.
  const afterCreate = await readOwnerOnboardingState(systemHomeDir);
  assert.equal(afterCreate.status, 'pending');
  assert.equal(afterCreate.steps.identity, 'done');

  const who = await handlers.who();
  assert.equal(who.data.identity.globalMetaId, created.data.identity.globalMetaId);

  const status = await handlers.getOnboarding();
  assert.equal(status.ok, true);
  assert.equal(status.data.identityPresent, true);
  assert.equal(status.data.onboarding.steps.identity, 'done');
});

test('runOnboarding drives the shared runner and tolerates a missing one', async () => {
  const systemHomeDir = await mkdtempTempRoot('metabot-user-onboarding-run-');

  const missing = await buildHandlers(systemHomeDir).runOnboarding();
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'not_implemented');

  const runs = [];
  const handlers = buildHandlers(systemHomeDir, {
    ownerOnboardingRunner: {
      run: async () => {
        runs.push(1);
        return { status: 'ready', attempts: runs.length };
      },
    },
  });
  const result = await handlers.runOnboarding();
  assert.equal(result.ok, true);
  assert.equal(result.data.onboarding.status, 'ready');
  assert.equal(runs.length, 1);
});

test('user delete tombstones onboarding so auto-provisioning stays off', async () => {
  const systemHomeDir = await mkdtempTempRoot('metabot-user-onboarding-delete-');
  const handlers = buildHandlers(systemHomeDir);

  await handlers.create({ name: 'Alice' });
  const deleted = await handlers.delete();
  assert.equal(deleted.ok, true);

  const state = await readOwnerOnboardingState(systemHomeDir);
  assert.equal(state.status, 'opted_out');

  const status = await handlers.getOnboarding();
  assert.equal(status.data.identityPresent, false);
  assert.equal(status.data.onboarding.status, 'opted_out');
});
