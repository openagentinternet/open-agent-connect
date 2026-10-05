import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { readOwnerIdentity, DEFAULT_OWNER_NAME } = require('../../dist/core/owner/ownerIdentity.js');
const {
  createOwnerOnboardingRunner,
  markOwnerOnboardingOptedOut,
  readOwnerOnboardingState,
  readOwnerOnboardingStatus,
  resetOwnerOnboardingAfterManualIdentity,
  resolveOwnerOnboardingStatePath,
} = require('../../dist/core/owner/ownerOnboarding.js');
const { TrafficApiError } = require('../../dist/core/traffic/trafficAccountService.js');

const GRANT_BYTES = 10_000_000;

function fakeTrafficService(behavior = {}) {
  const calls = { ensure: 0, claim: 0 };
  return {
    calls,
    async ensureTrafficAccount() {
      calls.ensure += 1;
      if (behavior.ensureError) throw behavior.ensureError;
      return {
        accountId: 'acct-1',
        identityAddress: 'mvc-owner',
        balanceBytes: GRANT_BYTES,
        reservedBytes: 0,
        grantedBytesTotal: GRANT_BYTES,
        spentBytesTotal: 0,
        status: 1,
      };
    },
    async claimFreeGrant() {
      calls.claim += 1;
      if (behavior.claimError) throw behavior.claimError;
      return behavior.claimResult ?? { grantId: 7, grantBytes: GRANT_BYTES, balanceAfter: GRANT_BYTES };
    },
  };
}

function fakeSubsidy(behavior = {}) {
  const calls = { requested: 0 };
  const fn = async () => {
    calls.requested += 1;
    return behavior.failure
      ? { success: false, error: 'subsidy service unreachable' }
      : { success: true };
  };
  fn.calls = calls;
  return fn;
}

function recordingSigner(writes) {
  let counter = 0;
  return {
    writePin: async (request) => {
      counter += 1;
      writes.push(request);
      return { pinId: `pin-${counter}`, path: request.path, txids: [`tx-${counter}`] };
    },
  };
}

function buildRunner(systemHomeDir, { traffic, subsidy, signer } = {}) {
  return createOwnerOnboardingRunner({
    systemHomeDir,
    trafficAccountService: traffic ?? fakeTrafficService(),
    requestMvcGasSubsidy: subsidy ?? fakeSubsidy(),
    ...(signer ? { createSigner: () => signer } : {}),
    chainWriteDelayMs: 0,
  });
}

test('onboarding converges end-to-end from a fresh machine', async () => {
  const systemHomeDir = await mkdtempTempRoot('metabot-owner-onboard-');
  const traffic = fakeTrafficService();
  const subsidy = fakeSubsidy();
  const writes = [];
  const runner = buildRunner(systemHomeDir, { traffic, subsidy, signer: recordingSigner(writes) });

  const state = await runner.run();

  assert.equal(state.status, 'ready');
  assert.equal(state.attempts, 1);
  assert.equal(state.lastError, null);
  assert.deepEqual(state.steps, {
    identity: 'done',
    trafficAccount: 'done',
    freeGrant: 'claimed',
    subsidy: 'done',
    namePin: 'done',
  });
  assert.equal(state.freeGrantBytes, GRANT_BYTES);
  assert.equal(traffic.calls.ensure, 1);
  assert.equal(traffic.calls.claim, 1);

  // The owner identity was silently created with the IDBots default name.
  const owner = await readOwnerIdentity(systemHomeDir);
  assert.ok(owner);
  assert.equal(owner.name, DEFAULT_OWNER_NAME);
  assert.equal(owner.mnemonic.split(/\s+/).length >= 12, true);

  // The /info/name pin went through the injected (traffic-sponsored) signer.
  assert.deepEqual(writes.map((write) => write.path), ['/info/name']);
  assert.equal(writes[0].payload, DEFAULT_OWNER_NAME);

  // Persisted state and the status snapshot agree.
  const persisted = await readOwnerOnboardingState(systemHomeDir);
  assert.equal(persisted.status, 'ready');
  const snapshot = await readOwnerOnboardingStatus(systemHomeDir);
  assert.equal(snapshot.identityPresent, true);
  assert.equal(snapshot.onboarding.status, 'ready');

  // A second run is a converged no-op.
  const again = await runner.run();
  assert.equal(again.status, 'ready');
  assert.equal(again.attempts, 2);
  assert.equal(traffic.calls.ensure, 1);
  assert.equal(traffic.calls.claim, 1);
  assert.equal(writes.length, 1);
});

test('a concurrent run shares the in-flight execution', async () => {
  const systemHomeDir = await mkdtempTempRoot('metabot-owner-onboard-inflight-');
  const traffic = fakeTrafficService();
  const runner = buildRunner(systemHomeDir, { traffic });
  const [first, second] = await Promise.all([runner.run(), runner.run()]);
  assert.equal(first.attempts, 1);
  assert.deepEqual(first, second);
  assert.equal(traffic.calls.ensure, 1);
});

test('ALREADY_CLAIMED and CAMPAIGN_DISABLED are terminal grant states', async () => {
  const systemHomeDir = await mkdtempTempRoot('metabot-owner-onboard-grant-');

  const already = buildRunner(systemHomeDir, {
    traffic: fakeTrafficService({
      claimError: new TrafficApiError({ stage: 'campaign', message: 'already claimed', errorCode: 'ALREADY_CLAIMED' }),
    }),
  });
  const alreadyState = await already.run();
  assert.equal(alreadyState.steps.freeGrant, 'already_claimed');
  assert.equal(alreadyState.status, 'ready');
  assert.equal(alreadyState.freeGrantBytes, null);

  const systemHomeDir2 = await mkdtempTempRoot('metabot-owner-onboard-grant2-');
  const disabled = buildRunner(systemHomeDir2, {
    traffic: fakeTrafficService({
      claimError: new TrafficApiError({ stage: 'campaign', message: 'campaign off', errorCode: 'CAMPAIGN_DISABLED' }),
    }),
  });
  const disabledState = await disabled.run();
  assert.equal(disabledState.steps.freeGrant, 'disabled');
  assert.equal(disabledState.status, 'ready');
});

test('a traffic-account failure parks the run and the next run recovers', async () => {
  const systemHomeDir = await mkdtempTempRoot('metabot-owner-onboard-retry-');
  const behavior = { ensureError: new Error('assist service unreachable') };
  const traffic = fakeTrafficService(behavior);
  const runner = buildRunner(systemHomeDir, { traffic });

  const failed = await runner.run();
  assert.equal(failed.status, 'pending');
  assert.equal(failed.steps.identity, 'done');
  assert.equal(failed.steps.trafficAccount, 'failed');
  assert.equal(failed.lastError, 'assist service unreachable');
  // No grant attempt was made after the account step failed.
  assert.equal(traffic.calls.claim, 0);

  behavior.ensureError = null;
  const recovered = await runner.run();
  assert.equal(recovered.status, 'ready');
  assert.equal(recovered.steps.trafficAccount, 'done');
  assert.equal(recovered.steps.freeGrant, 'claimed');
  assert.equal(recovered.attempts, 2);
});

test('a subsidy failure skips the name pin without blocking readiness', async () => {
  const systemHomeDir = await mkdtempTempRoot('metabot-owner-onboard-subsidy-');
  const subsidy = fakeSubsidy({ failure: true });
  const writes = [];
  const runner = buildRunner(systemHomeDir, { subsidy, signer: recordingSigner(writes) });

  const state = await runner.run();
  assert.equal(state.steps.subsidy, 'failed');
  assert.equal(state.steps.namePin, 'skipped');
  assert.equal(state.status, 'ready');
  assert.equal(state.lastError, 'subsidy service unreachable');
  assert.equal(writes.length, 0);
});

test('the opt-out tombstone makes the runner a no-op', async () => {
  const systemHomeDir = await mkdtempTempRoot('metabot-owner-onboard-optout-');
  await markOwnerOnboardingOptedOut(systemHomeDir);

  const traffic = fakeTrafficService();
  const runner = buildRunner(systemHomeDir, { traffic });
  const state = await runner.run();

  assert.equal(state.status, 'opted_out');
  assert.equal(traffic.calls.ensure, 0);
  assert.equal(await readOwnerIdentity(systemHomeDir), null);
});

test('resetOwnerOnboardingAfterManualIdentity re-arms a tombstoned machine', async () => {
  const systemHomeDir = await mkdtempTempRoot('metabot-owner-onboard-rearm-');
  await markOwnerOnboardingOptedOut(systemHomeDir);

  const reset = await resetOwnerOnboardingAfterManualIdentity(systemHomeDir);
  assert.equal(reset.status, 'pending');
  assert.equal(reset.steps.identity, 'done');
  assert.equal(reset.steps.freeGrant, 'pending');

  const runner = buildRunner(systemHomeDir);
  const state = await runner.run();
  assert.equal(state.status, 'ready');
});

test('the onboarding state file lives in the owner directory', async () => {
  const systemHomeDir = await mkdtempTempRoot('metabot-owner-onboard-path-');
  const statePath = resolveOwnerOnboardingStatePath(systemHomeDir);
  assert.match(statePath, /\.metabot[/\\]owner[/\\]onboarding\.json$/);
});
