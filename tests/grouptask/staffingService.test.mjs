import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRootSync } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const {
  proposeGroupTaskStaffing,
  recordStaffingOwnerDecision,
  evaluateStaffingOwnerGate,
  createGroupTaskFromProposal,
  listStaffingProposals,
} = require('../../dist/core/grouptask/staffingService.js');
const { GroupTaskStaffingError } = require('../../dist/core/grouptask/staffing.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');

function jsonResponse(body) {
  return { ok: true, json: async () => body };
}

function createFakeIndexer() {
  const state = { members: [], history: [] };
  const fetchImpl = async (input) => {
    const url = String(input);
    if (url.includes('/group-info')) {
      return jsonResponse({ code: 0, data: { groupId: new URL(url).searchParams.get('groupId') } });
    }
    if (url.includes('/group-member-list')) {
      return jsonResponse({ code: 0, data: { list: state.members.map((id) => ({ metaId: id })) } });
    }
    if (url.includes('/group-chat-list-by-index')) {
      return jsonResponse({ code: 0, data: { list: [] } });
    }
    throw new Error(`Unexpected fake indexer URL: ${url}`);
  };
  return { state, fetchImpl };
}

function createFakeContext(prefix, { createFails = false } = {}) {
  const systemHome = mkdtempTempRootSync(prefix);
  const pins = [];
  let pinSeq = 0;
  const makeProfile = (slug, botType, gmid) => {
    const homeDir = path.join(systemHome, '.metabot', 'profiles', slug);
    mkdirSync(homeDir, { recursive: true });
    return { slug, homeDir, name: slug, globalMetaId: gmid, metaId: `meta-${slug}`, botType, avatar: null };
  };
  const profiles = [
    makeProfile('twin-bot', 'twin', 'IDTWIN'),
    makeProfile('worker-1', 'worker', 'IDWORKER1'),
    makeProfile('worker-2', 'worker', 'IDWORKER2'),
  ];
  const makeSigner = (label) => ({
    async writePin(request) {
      if (createFails && request.path === '/protocols/simplegroupcreate') {
        throw new Error('chain create failed');
      }
      pinSeq += 1;
      const pinId = `pin-${label}-${pinSeq}`;
      pins.push({ label, pinId, ...request });
      return { pinId, txId: `tx-${pinSeq}` };
    },
  });
  const indexer = createFakeIndexer();
  const ctx = {
    listProfiles: async () => profiles,
    getProfile: async (slug) => profiles.find((profile) => profile.slug === slug) ?? null,
    signerForSlug: async (slug) => makeSigner(slug),
    ownerIdentity: async () => ({
      globalMetaId: 'IDOWNER', metaId: 'meta-owner', name: 'Owner', signer: makeSigner('owner'),
    }),
    transport: { indexerHosts: ['https://fake-indexer.test'], fetchImpl: indexer.fetchImpl },
  };
  return { ctx, pins, indexer, profiles, systemHome };
}

const validPlan = {
  stages: [{ id: 's1', title: 'Draft', seatRole: 'content' }],
  seats: [
    { role: 'content', candidateName: 'Worker One', candidateSlug: 'worker-1', source: 'local', reason: 'bio match' },
    { role: 'design', candidateName: 'Remote Pixel', candidateGlobalMetaId: 'idremote1', source: 'remote', reason: 'portfolio' },
  ],
};

test('propose validates the plan, persists a proposal, and returns the slate', async () => {
  const { ctx } = createFakeContext('metabot-gt-propose-');
  const result = await proposeGroupTaskStaffing(ctx, {
    title: 'Landing page',
    goal: 'Ship a landing page',
    plan: validPlan,
    triggeringWish: '帮我做个落地页',
  });
  assert.equal(result.ownerConfirmRequired, true);
  assert.equal(result.proposal.status, 'pending');
  assert.equal(result.proposal.chairSlug, 'twin-bot');
  assert.match(result.slateText, /确认人选/);
  assert.match(result.slateText, /在线，非本机/);

  const skip = await proposeGroupTaskStaffing(ctx, {
    title: 'Landing page',
    goal: 'Ship a landing page',
    plan: validPlan,
    triggeringWish: '做个落地页，不用确认直接开',
  });
  assert.equal(skip.ownerConfirmRequired, false);
  assert.equal(skip.proposal.status, 'skip_authorized');
  assert.match(skip.slateText, /直接开群/);

  await assert.rejects(
    proposeGroupTaskStaffing(ctx, {
      title: 'bad', goal: 'bad',
      plan: { seats: [{ role: 'content', candidateName: 'X', source: 'local' }] },
    }),
    (error) => error instanceof GroupTaskStaffingError && error.code === 'STAFFING_PLAN_INVALID',
  );
});

test('create gate: awaiting owner blocks; explicit decision and chat replies open', async () => {
  const { ctx } = createFakeContext('metabot-gt-gate-');

  const { proposal } = await proposeGroupTaskStaffing(ctx, {
    title: 'T', goal: 'G', plan: validPlan, triggeringWish: '做个任务',
  });

  await assert.rejects(
    createGroupTaskFromProposal(ctx, { proposalId: proposal.id }),
    (error) => error.code === 'OWNER_CONFIRM_REQUIRED',
  );

  const decided = await recordStaffingOwnerDecision(ctx, 'twin-bot', proposal.id, 'confirm');
  assert.equal(decided.status, 'confirmed');

  const created = await createGroupTaskFromProposal(ctx, { proposalId: proposal.id });
  assert.equal(created.task.task.status, 'planning');
  assert.equal(created.chairSlug, 'twin-bot');
  assert.equal(created.pendingRemoteSeats.length, 1);
  assert.equal(created.pendingRemoteSeats[0].candidateGlobalMetaId, 'idremote1');

  // Consumed proposals are not usable twice.
  await assert.rejects(
    createGroupTaskFromProposal(ctx, { proposalId: proposal.id }),
    (error) => error.code === 'PROPOSAL_NOT_USABLE',
  );
});

test('chat-reply last-intent gate drives create without explicit decisions', async () => {
  const { ctx } = createFakeContext('metabot-gt-chatgate-');
  const { proposal } = await proposeGroupTaskStaffing(ctx, {
    title: 'T', goal: 'G', plan: validPlan, triggeringWish: '做个任务',
  });

  const reviseMessages = [
    { type: 'user', content: '做个任务', timestamp: proposal.createdAt - 1000 },
    { type: 'assistant', content: 'slate', timestamp: proposal.createdAt },
    { type: 'user', content: '换人', timestamp: proposal.createdAt + 1000 },
  ];
  const blocked = await evaluateStaffingOwnerGate(ctx, { proposalId: proposal.id, sessionMessages: reviseMessages });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.decision, 'owner_revise');

  const confirmMessages = [
    ...reviseMessages,
    { type: 'user', content: '确认人选', timestamp: proposal.createdAt + 2000 },
  ];
  const allowed = await evaluateStaffingOwnerGate(ctx, { proposalId: proposal.id, sessionMessages: confirmMessages });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.decision, 'owner_confirmed');

  const created = await createGroupTaskFromProposal(ctx, {
    proposalId: proposal.id,
    sessionMessages: confirmMessages,
  });
  assert.equal(created.task.task.status, 'planning');
});

test('failed chain create releases the CAS claim so the slate survives', async () => {
  const { ctx } = createFakeContext('metabot-gt-cas-');
  const { proposal } = await proposeGroupTaskStaffing(ctx, {
    title: 'T', goal: 'G', plan: validPlan, triggeringWish: '不用确认直接开',
  });

  const failing = { ...ctx };
  failing.signerForSlug = async (slug) => ({
    async writePin(request) {
      if (request.path === '/protocols/simplegroupcreate') throw new Error('chain create failed');
      return { pinId: `pin-${slug}`, txId: 'tx' };
    },
  });

  await assert.rejects(
    createGroupTaskFromProposal(failing, { proposalId: proposal.id }),
    /chain create failed/,
  );

  // The released proposal is usable again: a retry with a healthy signer
  // creates the task instead of failing with PROPOSAL_NOT_USABLE.
  const created = await createGroupTaskFromProposal(ctx, { proposalId: proposal.id });
  assert.equal(created.task.task.status, 'planning');
});

test('listStaffingProposals returns fresh proposals for the chair', async () => {
  const { ctx } = createFakeContext('metabot-gt-list-');
  await proposeGroupTaskStaffing(ctx, { title: 'a', goal: 'b', plan: validPlan, triggeringWish: '做' });
  await proposeGroupTaskStaffing(ctx, { title: 'c', goal: 'd', plan: validPlan, triggeringWish: '做' });
  const rows = await listStaffingProposals(ctx);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].chairSlug, 'twin-bot');
});
