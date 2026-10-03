import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot, mkdtempTempRootSync } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const {
  createGroupTaskDaemonHandlers,
  createGroupTaskServiceContext,
} = require('../../dist/daemon/grouptaskHandlers.js');
const { createOwnerIdentity } = require('../../dist/core/owner/ownerIdentity.js');
const { createConfigStore } = require('../../dist/core/config/configStore.js');

function unusedSignerFactory() {
  throw new Error('createSignerForProfileHome must not be called by this test');
}

/**
 * Temp-home service context for the handler-level tests below: one twin and
 * one worker profile (the store seams default to paths under the temp home).
 * These tests stop before any chain write, so the signer and owner identity
 * are deliberate fail-loud stubs.
 */
function createFakeGroupTaskContext(prefix) {
  const systemHome = mkdtempTempRootSync(prefix);
  const makeProfile = (slug, botType, globalMetaId) => {
    const homeDir = path.join(systemHome, '.metabot', 'profiles', slug);
    mkdirSync(homeDir, { recursive: true });
    return { slug, homeDir, name: slug, globalMetaId, metaId: `meta-${slug}`, botType, avatar: null };
  };
  const profiles = [
    makeProfile('twin-bot', 'twin', 'IDTWIN'),
    makeProfile('worker-1', 'worker', 'IDWORKER1'),
  ];
  return {
    systemHome,
    ctx: {
      listProfiles: async () => profiles,
      getProfile: async (slug) => profiles.find((profile) => profile.slug === slug) ?? null,
      signerForSlug: async () => { throw new Error('signerForSlug must not be called by these tests'); },
      ownerIdentity: async () => null,
    },
  };
}

function createFakeHandlers(fake) {
  return createGroupTaskDaemonHandlers({
    systemHomeDir: fake.systemHome,
    createSignerForProfileHome: unusedSignerFactory,
    adapters: new Map(),
    context: fake.ctx,
  });
}

/** Plan with one available local seat and one remote seat (propose-valid). */
const fakeStaffingPlan = {
  stages: [{ id: 's1', title: 'Draft', seatRole: 'content' }],
  seats: [
    { role: 'content', candidateName: 'Worker One', candidateSlug: 'worker-1', source: 'local', reason: 'bio match' },
    { role: 'design', candidateName: 'Remote Pixel', candidateGlobalMetaId: 'idremote1', source: 'remote', reason: 'portfolio' },
  ],
};

test('production grouptask context resolves the owner identity (owner home is not a profile home)', async () => {
  const systemHomeDir = await mkdtempTempRoot('metabot-grouptask-ctx-');
  const owner = await createOwnerIdentity(systemHomeDir, { name: 'Alice' });
  const ctx = createGroupTaskServiceContext({
    systemHomeDir,
    createSignerForProfileHome: unusedSignerFactory,
    adapters: new Map(),
  });

  const ref = await ctx.ownerIdentity();
  assert.ok(ref, 'ownerIdentity() must resolve when ~/.metabot/owner/identity.json exists');
  assert.equal(ref.globalMetaId, owner.globalMetaId);
  assert.equal(ref.name, 'Alice');

  // The owner signer backs owner-join and owner posts; it must derive the
  // same identity from the stored mnemonic.
  const identity = await ref.signer.getIdentity();
  assert.equal(identity.globalMetaId, owner.globalMetaId);
});

test('production grouptask context returns null when no owner identity exists', async () => {
  const systemHomeDir = await mkdtempTempRoot('metabot-grouptask-ctx-');
  const ctx = createGroupTaskServiceContext({
    systemHomeDir,
    createSignerForProfileHome: unusedSignerFactory,
    adapters: new Map(),
  });
  assert.equal(await ctx.ownerIdentity(), null);
});

test('grouptask health reads the a2a listener switch from the daemon home config', async () => {
  const systemHomeDir = await mkdtempTempRoot('metabot-grouptask-health-');
  const daemonHomeDir = path.join(systemHomeDir, '.metabot', 'profiles', 'twin');
  const configStore = createConfigStore(daemonHomeDir);
  const config = await configStore.read();
  await configStore.set({
    ...config,
    a2a: { ...config.a2a, simplemsgListenerEnabled: false },
  });

  const handlers = createGroupTaskDaemonHandlers({
    systemHomeDir,
    daemonHomeDir,
    createSignerForProfileHome: unusedSignerFactory,
    adapters: new Map(),
  });
  const result = await handlers.health({});
  assert.equal(result.ok, true);
  assert.equal(result.data.simplemsgListenerEnabled, false);
});

test('grouptask health surfaces the owner identity through the daemon handler', async () => {
  const systemHomeDir = await mkdtempTempRoot('metabot-grouptask-health-');
  const owner = await createOwnerIdentity(systemHomeDir, { name: 'Alice' });
  const handlers = createGroupTaskDaemonHandlers({
    systemHomeDir,
    createSignerForProfileHome: unusedSignerFactory,
    adapters: new Map(),
  });
  const result = await handlers.health({});
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.ownerIdentity, {
    present: true,
    globalMetaId: owner.globalMetaId,
    name: 'Alice',
  });
});

test('owner signer routes MVC writes through the sponsor hook when provided', async () => {
  const systemHomeDir = await mkdtempTempRoot('metabot-grouptask-ctx-');
  const owner = await createOwnerIdentity(systemHomeDir, { name: 'Alice' });
  const sponsoredResult = {
    txids: ['f'.repeat(64)],
    pinId: `${'f'.repeat(64)}i0`,
    totalCost: 0,
    network: 'mvc',
    operation: 'create',
    path: '/protocols/simplebuzz',
    contentType: 'text/plain',
    encoding: 'utf-8',
    globalMetaId: owner.globalMetaId,
    mvcAddress: 'owner-mvc-address',
  };
  const hookCalls = [];
  const ctx = createGroupTaskServiceContext({
    systemHomeDir,
    createSignerForProfileHome: unusedSignerFactory,
    adapters: new Map([['mvc', { network: 'mvc', deriveAddress: async () => 'owner-mvc-address' }]]),
    resolveSponsorWritePin: async (hookInput) => {
      hookCalls.push(hookInput);
      return sponsoredResult;
    },
  });

  const ref = await ctx.ownerIdentity();
  const result = await ref.signer.writePin({
    operation: 'create',
    path: '/protocols/simplebuzz',
    encryption: '0',
    version: '1.0',
    contentType: 'text/plain',
    payload: '{"content":"hi"}',
    encoding: 'utf-8',
    network: 'mvc',
  });
  assert.equal(result, sponsoredResult);
  assert.equal(hookCalls.length, 1);
  assert.equal(typeof hookCalls[0].runSelfPaid, 'function');
});

test('owner signer keeps the self-paid path when no sponsor hook is provided', async () => {
  const systemHomeDir = await mkdtempTempRoot('metabot-grouptask-ctx-');
  await createOwnerIdentity(systemHomeDir, { name: 'Alice' });
  const ctx = createGroupTaskServiceContext({
    systemHomeDir,
    createSignerForProfileHome: unusedSignerFactory,
    adapters: new Map([['mvc', {
      network: 'mvc',
      deriveAddress: async () => 'owner-mvc-address',
      buildInscription: async () => { throw new Error('self-paid buildInscription reached'); },
    }]]),
  });

  const ref = await ctx.ownerIdentity();
  await assert.rejects(
    ref.signer.writePin({
      operation: 'create',
      path: '/protocols/simplebuzz',
      encryption: '0',
      version: '1.0',
      contentType: 'text/plain',
      payload: '{"content":"hi"}',
      encoding: 'utf-8',
      network: 'mvc',
    }),
    /self-paid buildInscription reached/,
  );
});

const ACCEPTANCE_CRITERIA_ERROR = 'acceptanceCriteria must be a string (newline-separated) or an array of strings.';

test('grouptask handlers reject a non-string acceptanceCriteria instead of degrading to empty', async () => {
  const fake = createFakeGroupTaskContext('metabot-grouptask-accept-');
  const handlers = createFakeHandlers(fake);

  for (const bad of [12345, { items: ['a'] }, true]) {
    const created = await handlers.create({ title: 'T', goal: 'G', acceptanceCriteria: bad });
    assert.equal(created.ok, false, `create must refuse ${JSON.stringify(bad)}`);
    assert.equal(created.code, 'invalid_argument');
    assert.equal(created.message, ACCEPTANCE_CRITERIA_ERROR);

    const proposed = await handlers.staffingPropose({
      title: 'T', goal: 'G', plan: fakeStaffingPlan, acceptanceCriteria: bad,
    });
    assert.equal(proposed.ok, false, `staffingPropose must refuse ${JSON.stringify(bad)}`);
    assert.equal(proposed.code, 'invalid_argument');
    assert.equal(proposed.message, ACCEPTANCE_CRITERIA_ERROR);
  }

  // Absent and explicitly-null criteria stay "not set" rather than failing.
  const none = await handlers.staffingPropose({ title: 'T', goal: 'G', plan: fakeStaffingPlan });
  assert.equal(none.ok, true);
  assert.equal(none.data.proposal.acceptanceCriteria, null);
});

test('grouptask handlers trim and join a string-array acceptanceCriteria before persisting', async () => {
  const fake = createFakeGroupTaskContext('metabot-grouptask-accept-join-');
  const handlers = createFakeHandlers(fake);

  const proposed = await handlers.staffingPropose({
    title: 'T',
    goal: 'G',
    plan: fakeStaffingPlan,
    acceptanceCriteria: ['  可点击链接 ', '无报错', ''],
  });
  assert.equal(proposed.ok, true);
  assert.equal(proposed.data.proposal.acceptanceCriteria, '可点击链接\n无报错');
});

test('grouptask handler records the decision source and who decided', async () => {
  const fake = createFakeGroupTaskContext('metabot-grouptask-decide-');
  const handlers = createFakeHandlers(fake);
  const propose = async () => {
    const result = await handlers.staffingPropose({
      title: 'T', goal: 'G', plan: fakeStaffingPlan, chairSlug: 'twin-bot',
    });
    assert.equal(result.ok, true);
    return result.data.proposal.id;
  };

  const toolId = await propose();
  const toolDecision = await handlers.staffingDecide({
    chairSlug: 'twin-bot', proposalId: toolId, decision: 'confirm', source: 'tool',
  });
  assert.equal(toolDecision.ok, true);
  assert.equal(toolDecision.data.proposal.decisionSource, 'tool');
  assert.equal(toolDecision.data.proposal.decidedBy, 'twin-bot', 'the chair Bot decided on the owner\'s behalf');

  const uiId = await propose();
  const uiDecision = await handlers.staffingDecide({
    chairSlug: 'twin-bot', proposalId: uiId, decision: 'confirm', source: 'ui',
  });
  assert.equal(uiDecision.data.proposal.decidedBy, 'owner', 'the panel is the owner acting in person');

  const explicitId = await propose();
  const explicit = await handlers.staffingDecide({
    chairSlug: 'twin-bot', proposalId: explicitId, decision: 'confirm', source: 'ui', decidedBy: 'alice',
  });
  assert.equal(explicit.data.proposal.decidedBy, 'alice', 'an explicit decidedBy wins');

  const rejectId = await propose();
  const rejected = await handlers.staffingDecide({
    chairSlug: 'twin-bot', proposalId: rejectId, decision: 'reject', source: 'tool',
  });
  assert.equal(rejected.ok, true);
  assert.equal(rejected.data.proposal.status, 'rejected');
  const rows = await handlers.staffingList({ chairSlug: 'twin-bot' });
  assert.ok(
    !rows.data.proposals.some((row) => row.id === rejectId),
    'rejected proposals leave the pending list',
  );
});
