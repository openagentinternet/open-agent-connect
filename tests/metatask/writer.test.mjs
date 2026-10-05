import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { mkdtempTempRootSync } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const {
  claimMetaTaskNode,
  submitMetaTaskWork,
  verifyMetaTaskSubmission,
  releaseMetaTaskClaim,
  publishMetaTask,
  publishMetaTaskSpec,
  amendMetaTask,
} = require('../../dist/core/metatask/writer.js');
const { replayMetaTask } = require('../../dist/core/metatask/engine/engine.js');
const { innerHash, outerHash } = require('../../dist/core/metatask/engine/canon.js');
const { rosterPinsFromEvents } = require('../../dist/core/metatask/collector.js');

/**
 * MetaTask writer (M6 — OAC port of the IDBots agent-tools suite): writer-side
 * protocol discipline before any chain spend — claim guard refusals, #8/#9
 * vote gates, same-side review blocking, submission hash assembly per the
 * frozen canon, publish invariants and the roster→tree→spec→task ordering,
 * amend publisher authority, draftsFile mode, H_ACT3 gating, competitive
 * parentRefs/git-bundle/amend rules.
 */

const SESSION_BOT = 'idq1localAA0000000000000000000000000';
const LOCAL_PEER = 'idq1localBB0000000000000000000000000';
const FOREIGN_SUBMITTER = 'idq1foreigncc00000000000000000000';
const FOREIGN_PUBLISHER = 'idq1publisherx0000000000000000000';

const REFRESH_NOW = 1_790_050_000_000;

let pinCounter = 0;
const nextPinId = () => `pin${String(++pinCounter).padStart(4, '0')}0i0`;

const ev = (path, body, over = {}) => ({
  pinId: over.pinId ?? nextPinId(),
  path,
  author: over.author ?? SESSION_BOT,
  height: over.height ?? 189_900,
  txIndex: over.txIndex ?? 0,
  timestampMs: over.timestampMs ?? 1_790_000_000_000,
  body,
});

/** A task published by FOREIGN_PUBLISHER: t1 open, r1 claimable. */
const buildForeignTask = () => {
  const treePinId = nextPinId();
  const rootPinId = nextPinId();
  const tree = ev(
    'tree',
    {
      root: 'r1',
      nodes: [
        { id: 'r1', parent: null, title: 'root', kind: 'aggregate', specid: null, params: {}, deps: [], weight: 3000 },
        { id: 't1', parent: 'r1', title: 'open leaf', kind: 'proof', specid: null, params: {}, deps: [], weight: 7000 },
      ],
    },
    { pinId: treePinId, author: FOREIGN_PUBLISHER, height: 189_800 },
  );
  const task = ev(
    'task',
    {
      title: 'agent tools fixture',
      treeid: treePinId,
      // ttl/window 0 = no expiry derivation, so the fixture clock never reopens holders
      policy: { verify_quorum: 2, claim_ttl_hours: 0, verify_window_hours: 0 },
      tags: [],
    },
    { pinId: rootPinId, author: FOREIGN_PUBLISHER, height: 189_801 },
  );
  return { events: [tree, task], treePinId, rootPinId };
};

/** Writer harness: fake pin-write seam + fresh-replay projections + fold-on-refresh. */
const buildHarness = (initialEvents, over = {}) => {
  const state = { events: [...initialEvents] };
  const writes = [];
  const recordWrite = (pinPath, payload, origin) => {
    const pinId = nextPinId();
    writes.push({ pinPath, payload, origin, pinId, folded: false, metaidData: { path: pinPath, payload: JSON.stringify(payload) }, options: { origin } });
    return { pinId, txids: [`tx${writes.length}`], totalCost: 0 };
  };
  const fold = () => {
    for (const write of writes) {
      if (write.folded) continue;
      write.folded = true;
      state.events.push(
        ev(
          String(write.pinPath ?? '').split('/').pop(),
          JSON.parse(JSON.stringify(write.payload)),
          { author: SESSION_BOT, height: 190_100 + state.events.length, pinId: write.pinId },
        ),
      );
    }
  };
  const seams = () => ({
    actorGlobalMetaId: SESSION_BOT,
    localRosterMetaIds: () => [SESSION_BOT, LOCAL_PEER],
    loadEvents: async () => state.events,
    getProjection: async (rootPinId) => {
      try {
        // Mirrors the refresher: roster pins travel with the event set.
        return replayMetaTask(state.events, { rootPinId, now: REFRESH_NOW, rosterPins: rosterPinsFromEvents(state.events) });
      } catch {
        return null;
      }
    },
    activation: () => over.activation ?? { hAct3: null, boundaryBlock: null },
    writeProtocolPin: async (subpath, payload, origin) => recordWrite(`/protocols/metatask/${subpath}`, payload, origin),
    writeRawPin: async (protocolPath, payload, origin) => recordWrite(protocolPath, payload, origin),
    refreshInBackground: () => fold(),
  });
  const verbs = {
    claim: (args) => claimMetaTaskNode(seams(), args),
    submit: (args) => submitMetaTaskWork(seams(), args),
    verify: (args) => verifyMetaTaskSubmission(seams(), args),
    release: (args) => releaseMetaTaskClaim(seams(), args),
    publish: (args) => publishMetaTask(seams(), args),
    publishSpec: (args) => publishMetaTaskSpec(seams(), args),
    amend: (args) => amendMetaTask(seams(), args),
  };
  return { verbs, writes, state };
};

const refusalOf = (outcome) => {
  assert.equal(outcome.ok, false, `expected a refusal, got: ${JSON.stringify(outcome.data ?? outcome)}`);
  return outcome.refusal;
};

// ── claim / submit / verify: tree mode ───────────────────────────────────────

test('claim: guard refuses a claimed node without spending; open node publishes', async () => {
  const { events, rootPinId } = buildForeignTask();
  const claim = ev('claim', { taskid: rootPinId, node: 'r1' }, { author: FOREIGN_SUBMITTER, height: 189_910 });
  const { verbs, writes } = buildHarness([...events, claim]);

  const refused = refusalOf(await verbs.claim({ rootPinId, node: 'r1' }));
  assert.match(refused, /claim-rejected:r1:claimed/);
  assert.equal(writes.length, 0, 'a refused guard must never reach the chain');

  const allowed = await verbs.claim({ rootPinId, node: 't1' });
  assert.equal(allowed.ok, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].pinPath, '/protocols/metatask/claim');
  assert.deepEqual(JSON.parse(writes[0].metaidData.payload), { taskid: rootPinId, node: 't1' });
});

test('claim: unknown node refused', async () => {
  const { events, rootPinId } = buildForeignTask();
  const { verbs, writes } = buildHarness(events);
  refusalOf(await verbs.claim({ rootPinId, node: 'nope' }));
  assert.equal(writes.length, 0);
});

test('submit: hash assembly per frozen canon; foreign claim refused; wrong claimPin refused', async () => {
  const { events, rootPinId } = buildForeignTask();
  // Session bot holds t1.
  const claim = ev('claim', { taskid: rootPinId, node: 't1' }, { author: SESSION_BOT, height: 189_910, pinId: 'claim0000001i0' });
  // Foreign bot holds r1 (submit on it must be refused).
  const foreignClaim = ev('claim', { taskid: rootPinId, node: 'r1' }, { author: FOREIGN_SUBMITTER, height: 189_911 });
  const { verbs, writes } = buildHarness([...events, claim, foreignClaim]);

  const foreign = refusalOf(await verbs.submit({
    rootPinId,
    node: 'r1',
    claimPinId: foreignClaim.pinId,
    result: { type: 'triage', ok: true },
  }));
  assert.match(foreign, /different bot/);

  const stale = refusalOf(await verbs.submit({
    rootPinId,
    node: 't1',
    claimPinId: 'nottheclaim00000000000000000000000i0',
    result: { type: 'triage' },
  }));
  assert.match(stale, /claim-rejected:t1/);

  const resultInput = { type: 'triage', verdict_text: '判定通过', rows: [1, 2, 3] };
  const ok = await verbs.submit({ rootPinId, node: 't1', claimPinId: 'claim0000001i0', result: resultInput });
  assert.equal(ok.ok, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].pinPath, '/protocols/metatask/submission');
  const payload = JSON.parse(writes[0].metaidData.payload);
  assert.equal(payload.claimid, 'claim0000001i0');
  // result.hash is the inner hash over the result minus hash; payload.hash is the outer.
  assert.equal(payload.result.hash, innerHash(resultInput));
  assert.equal(payload.hash, outerHash({ ...resultInput, hash: innerHash(resultInput) }));
  assert.equal(payload.childids.length, 0);
});

test('verify: #9/#8 write gates and same-side blocking before any spend', async () => {
  const { events, rootPinId } = buildForeignTask();
  const claim = ev('claim', { taskid: rootPinId, node: 't1' }, { author: FOREIGN_SUBMITTER, height: 189_910 });
  const sub = ev(
    'submission',
    {
      taskid: rootPinId,
      node: 't1',
      claimid: claim.pinId,
      result: { type: 'triage' },
      hash: '2'.repeat(64),
      contentType: 'application/json;utf-8',
      attachment: null,
      childids: [],
    },
    { author: FOREIGN_SUBMITTER, height: 189_920 },
  );
  // Same-side target: a submission by a LOCAL bot.
  const localClaim = ev('claim', { taskid: rootPinId, node: 'r1' }, { author: LOCAL_PEER, height: 189_915 });
  const localSub = ev(
    'submission',
    {
      taskid: rootPinId,
      node: 'r1',
      claimid: localClaim.pinId,
      result: { type: 'triage' },
      hash: '3'.repeat(64),
      contentType: 'application/json;utf-8',
      attachment: null,
      childids: [],
    },
    { author: LOCAL_PEER, height: 189_925 },
  );
  const { verbs, writes } = buildHarness([...events, claim, sub, localClaim, localSub]);

  const noSemantic = refusalOf(await verbs.verify({
    targetPinId: sub.pinId,
    verdict: 'pass',
    method: 'spec rerun pass',
    semanticCheck: '  ',
  }));
  assert.match(noSemantic, /semantic_check/);

  const noFailReason = refusalOf(await verbs.verify({
    targetPinId: sub.pinId,
    verdict: 'fail',
    method: 'spec rerun fail',
    semanticCheck: 'checked statement',
  }));
  assert.match(noFailReason, /failReason/);

  const sameSide = refusalOf(await verbs.verify({
    targetPinId: localSub.pinId,
    verdict: 'pass',
    method: 'spec rerun pass',
    semanticCheck: 'checked',
  }));
  assert.match(sameSide, /same_side_roster/);

  assert.equal(writes.length, 0, 'all gate refusals must happen before any chain spend');

  const pass = await verbs.verify({
    targetPinId: sub.pinId,
    verdict: 'pass',
    method: 'spec rerun pass; inner+outer hash match',
    semanticCheck: 'statement matches the node spec; definitions aligned',
  });
  assert.equal(pass.ok, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].pinPath, '/protocols/metatask/verify');
  const payload = JSON.parse(writes[0].metaidData.payload);
  assert.equal(payload.targetid, sub.pinId);
  assert.equal(payload.semantic_check, 'statement matches the node spec; definitions aligned');
  assert.equal(payload.failreason, undefined);
});

test('claim: the task root author is refused its own task before any spend', async () => {
  const treePinId = nextPinId();
  const rootPinId = nextPinId();
  const tree = ev(
    'tree',
    {
      root: 'r1',
      nodes: [
        { id: 'r1', parent: null, title: 'root', kind: 'aggregate', specid: null, params: {}, deps: [], weight: 5000 },
        { id: 't1', parent: 'r1', title: 'leaf', kind: 'proof', specid: null, params: {}, deps: [], weight: 5000 },
      ],
    },
    { pinId: treePinId, height: 189_800 },
  );
  // Authored by the SESSION bot: it is the task root author (publisher).
  const task = ev(
    'task',
    { title: 'published by me', treeid: treePinId, policy: { verify_quorum: 2, claim_ttl_hours: 0, verify_window_hours: 0 }, tags: [] },
    { pinId: rootPinId, height: 189_801 },
  );
  const { verbs, writes } = buildHarness([tree, task]);

  const refused = refusalOf(await verbs.claim({ rootPinId, node: 't1' }));
  assert.match(refused, /§12 item 6/);
  assert.match(refused, /submitter != task root author/);
  assert.equal(writes.length, 0, 'the publisher must never spend a claim fee on its own task');
});

test('guard: collected roster pins filter same-side votes (the replay sees it)', async () => {
  const rosterPinId = nextPinId();
  const treePinId = nextPinId();
  const rootPinId = nextPinId();
  const roster = ev(
    'metatask-roster',
    { groups: [[SESSION_BOT, LOCAL_PEER]], owner: 'local-roster', createdAt: 1_790_000_000_000 },
    { pinId: rosterPinId, author: FOREIGN_PUBLISHER, height: 191_490 },
  );
  const tree = ev(
    'tree',
    {
      root: 'r1',
      nodes: [
        { id: 'r1', parent: null, title: 'root', kind: 'aggregate', specid: null, params: {}, deps: [], weight: 3000 },
        { id: 't1', parent: 'r1', title: 'leaf', kind: 'proof', specid: null, params: {}, deps: [], weight: 7000 },
      ],
    },
    { pinId: treePinId, author: FOREIGN_PUBLISHER, height: 191_491 },
  );
  const task = ev(
    'task',
    {
      title: 'roster task',
      treeid: treePinId,
      policy: {
        verify_quorum: 2,
        claim_ttl_hours: 0,
        verify_window_hours: 0,
        split: { submitterShareBP: 8000, rosterid: rosterPinId },
      },
      tags: [],
    },
    { pinId: rootPinId, author: FOREIGN_PUBLISHER, height: 191_492 },
  );
  const claim = ev('claim', { taskid: rootPinId, node: 't1' }, { author: SESSION_BOT, height: 191_500 });
  const sub = ev(
    'submission',
    {
      taskid: rootPinId,
      node: 't1',
      claimid: claim.pinId,
      result: { type: 'triage' },
      hash: '4'.repeat(64),
      contentType: 'application/json;utf-8',
      attachment: null,
      childids: [],
    },
    { author: SESSION_BOT, height: 191_501 },
  );
  const independent = ev(
    'verify',
    { targetid: sub.pinId, verdict: 'pass', method: 'replay pass', semantic_check: 'checked' },
    { author: 'idq1foreignreviewer0000000000000', height: 191_502 },
  );
  // Same-side (LOCAL_PEER shares a roster group with the submitter): if the
  // roster pin were NOT fed to the engine, this fail would reopen the node.
  const sameSideFail = ev(
    'verify',
    { targetid: sub.pinId, verdict: 'fail', method: 'replay fail', semantic_check: 'checked', failreason: 'counterexample' },
    { author: LOCAL_PEER, height: 191_503 },
  );
  const events = [roster, tree, task, claim, sub, independent, sameSideFail];
  const projection = replayMetaTask(events, { rootPinId, rosterPins: rosterPinsFromEvents(events) });
  assert.equal(projection.nodeStates.t1.status, 'claimed');
  assert.ok(
    projection.ignoredEvents.some((entry) => entry.pinId === sameSideFail.pinId && entry.reason === 'same_side_roster'),
    'expected same_side_roster for the local peer vote'
  );

  // The claim guard replays with the same roster map: t1 is still held, so the
  // claim is refused before any spend.
  const { verbs, writes } = buildHarness(events);
  const refused = refusalOf(await verbs.claim({ rootPinId, node: 't1' }));
  assert.match(refused, /claim-rejected:t1:claimed/);
  assert.equal(writes.length, 0);
});

// ── publish: tree mode ───────────────────────────────────────────────────────

test('publish: invariants checked before the first pin; roster→tree→spec→task order', async () => {
  const { verbs, writes } = buildHarness([]);

  const badWeights = refusalOf(await verbs.publish({
    title: 'bad',
    nodes: [
      { id: 'r1', parent: null, title: 'root', kind: 'aggregate', weight: 4000 },
      { id: 't1', parent: 'r1', title: 'leaf', kind: 'proof', weight: 5000 },
    ],
    spec: { name: 'check', lang: 'bash', entry: 'check.sh' },
    policy: { claimTtlHours: 48, verifyQuorum: 2, verifyWindowHours: 72 },
  }));
  assert.match(badWeights, /10000/);
  assert.equal(writes.length, 0, 'invariant failures must not spend');

  const ok = await verbs.publish({
    title: 'formalize JSP-000035',
    brief: 'Lean formalization with machine-checked specs',
    nodes: [
      { id: 'r1', parent: null, title: 'root', kind: 'aggregate', weight: 2000 },
      { id: 't1', parent: 'r1', title: 'main theorem', kind: 'formalize', weight: 6000 },
      { id: 't2', parent: 'r1', title: 'lemma ladder', kind: 'formalize', weight: 2000 },
    ],
    spec: { name: 'lean-build-check', lang: 'bash', entry: 'check.sh', script: 'lake build' },
    policy: { claimTtlHours: 48, verifyQuorum: 2, verifyWindowHours: 72, submitterShareBP: 8000 },
    tags: ['metatask', 'jsp'],
  });
  assert.equal(ok.ok, true);
  const paths = writes.map((write) => write.pinPath);
  // Local roster has 2 bots → roster pin first, then tree → spec → task.
  assert.deepEqual(paths, ['/protocols/metatask-roster', '/protocols/metatask/tree', '/protocols/metatask/spec', '/protocols/metatask/task']);
  const treePayload = JSON.parse(writes[1].metaidData.payload);
  const specPayload = JSON.parse(writes[2].metaidData.payload);
  const taskPayload = JSON.parse(writes[3].metaidData.payload);
  assert.equal(taskPayload.treeid, writes[1].pinId);
  assert.equal(taskPayload.specid, writes[2].pinId);
  assert.equal(treePayload.root, 'r1');
  assert.equal(treePayload.nodes.length, 3);
  assert.equal(taskPayload.policy.split.submitterShareBP, 8000);
  assert.equal(taskPayload.policy.split.rosterid, writes[0].pinId);
  // The root spec goes through the SAME payload builder as publish-spec.
  assert.deepEqual(Object.keys(specPayload), ['name', 'lang', 'entry', 'script', 'input', 'output']);
  assert.equal(specPayload.name, 'lean-build-check');
  assert.equal(specPayload.script, 'lake build');
  assert.equal(specPayload.validation, undefined);
  assert.match(ok.data.reminder, /discovery buzz/i);
  assert.equal(writes[3].folded, true, 'the write is followed by a projection refresh');

  // v1.3 draft §4.1: a declared workspace rides the root spec pin verbatim,
  // and a placeholder baseRef is refused before the first pin of the sequence.
  const withWorkspace = await verbs.publish({
    title: 'git workspace task',
    nodes: [
      { id: 'r1', parent: null, title: 'root', kind: 'aggregate', weight: 4000 },
      { id: 't1', parent: 'r1', title: 'leaf', kind: 'proof', weight: 6000 },
    ],
    spec: {
      name: 'git-check',
      lang: 'bash',
      entry: 'check.sh',
      script: 'make test',
      workspace: { type: 'git', baseRef: 'metafile://basebundle0001', baseCommit: '1'.repeat(40) },
    },
    policy: { claimTtlHours: 48, verifyQuorum: 2, verifyWindowHours: 72 },
  });
  assert.equal(withWorkspace.ok, true);
  const wsSpecPayload = JSON.parse(writes[6].metaidData.payload);
  assert.deepEqual(wsSpecPayload.workspace, { type: 'git', baseRef: 'metafile://basebundle0001', baseCommit: '1'.repeat(40) });

  const placeholderBase = refusalOf(await verbs.publish({
    title: 'git workspace task',
    nodes: [{ id: 'r1', parent: null, title: 'root', kind: 'aggregate', weight: 10000 }],
    spec: {
      name: 'git-check',
      lang: 'bash',
      entry: 'check.sh',
      script: 'make test',
      workspace: { type: 'git', baseRef: 'BASE_BUNDLE_URI:s2a-python-base' },
    },
    policy: { claimTtlHours: 48, verifyQuorum: 2, verifyWindowHours: 72 },
  }));
  assert.match(placeholderBase, /workspace\.baseRef/);
  assert.equal(writes.length, 8, 'the workspace refusal precedes the whole pin sequence');
});

// ── amend: tree mode ─────────────────────────────────────────────────────────

test('amend: publisher-only; bases from the current tree head', async () => {
  // A task PUBLISHED by the session bot's side.
  const treePinId = nextPinId();
  const rootPinId = nextPinId();
  const tree = ev(
    'tree',
    {
      root: 'r1',
      nodes: [
        { id: 'r1', parent: null, title: 'root', kind: 'aggregate', specid: null, params: {}, deps: [], weight: 5000 },
        { id: 't1', parent: 'r1', title: 'leaf', kind: 'proof', specid: null, params: {}, deps: [], weight: 5000 },
      ],
    },
    { pinId: treePinId, author: SESSION_BOT, height: 189_800 },
  );
  const task = ev(
    'task',
    { title: 'mine', treeid: treePinId, policy: { verify_quorum: 2, claim_ttl_hours: 0, verify_window_hours: 0 }, tags: [] },
    { pinId: rootPinId, author: SESSION_BOT, height: 189_801 },
  );
  // A claim by a foreign bot freezes t1 against reweight.
  const foreignClaim = ev('claim', { taskid: rootPinId, node: 't1' }, { author: FOREIGN_SUBMITTER, height: 189_910 });
  const foreign = buildForeignTask();
  const { verbs, writes } = buildHarness([tree, task, foreignClaim, ...foreign.events]);

  const frozen = refusalOf(await verbs.amend({
    rootPinId,
    ops: [{ op: 'reweight', node: 't1', weight: 4000 }],
  }));
  assert.match(frozen, /frozen-on-start/);
  assert.equal(writes.length, 0);

  const notPublisher = refusalOf(await verbs.amend({
    rootPinId: foreign.rootPinId,
    ops: [{ op: 'retitle', node: 't1', title: 'x' }],
  }));
  assert.match(notPublisher, /only the task root author/);

  const ok = await verbs.amend({
    rootPinId,
    ops: [
      { op: 'add_node', node: { id: 't2', parent: 'r1', title: 'added', kind: 'proof', weight: 1000 } },
      { op: 'reweight', node: 'r1', weight: 4000 },
    ],
  });
  assert.equal(ok.ok, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].pinPath, '/protocols/metatask/amend');
  const payload = JSON.parse(writes[0].metaidData.payload);
  assert.equal(payload.bases, treePinId);
  assert.equal(payload.taskid, rootPinId);
});

// ── publish-spec: standalone spec pins ───────────────────────────────────────

const ARTIFACT_REF = 'metafile://correspondenceartifact000000000000000000000000000000i0';
const SPEC_SCRIPT = '#!/usr/bin/env python3\nimport json, sys\nprint("pass")\n';

/** The campaign's validation shape (protocol §3, all three items). */
const buildValidation = (correspondence = ARTIFACT_REF, over = {}) => ({
  null_tolerance: true,
  enumeration_closure: { closure: '2^n + 2^i + 2^j, 0<=j<i<=n-1', selfcheck_n: 8, expected_count: 28 },
  proposition_fidelity: {
    correspondence,
    artifactPin: correspondence,
    coverage: ['statement', 'definitions', 'proof-direction'],
  },
  ...over,
});

const specArgs = (over = {}) => ({
  name: 'witness-extraction-301',
  lang: 'python3',
  entry: 'spec-witness-extraction.py',
  script: SPEC_SCRIPT,
  input: { repo: 'metafile://repo-artifact' },
  output: { verdict: 'pass|fail|invalid' },
  validation: buildValidation(),
  ...over,
});

test('publish-spec: exactly one spec pin, no carrier task, protocol payload', async () => {
  const { verbs, writes } = buildHarness([]);
  const result = await verbs.publishSpec(specArgs());
  assert.equal(result.ok, true);

  assert.equal(writes.length, 1, 'a standalone spec publish spends one pin and creates no task/tree');
  const [write] = writes;
  assert.equal(write.pinPath, '/protocols/metatask/spec');
  assert.equal(write.options.origin, 'metatask:publish-spec');

  const payload = JSON.parse(write.metaidData.payload);
  assert.deepEqual(Object.keys(payload), ['name', 'lang', 'entry', 'script', 'input', 'output', 'validation']);
  assert.equal(payload.name, 'witness-extraction-301');
  assert.equal(payload.script, SPEC_SCRIPT);
  assert.deepEqual(payload.input, { repo: 'metafile://repo-artifact' });
  assert.deepEqual(payload.validation, buildValidation());

  assert.equal(result.data.specPinId, write.pinId);
  assert.deepEqual(result.data.txids, ['tx1']);
  assert.equal(result.data.hasValidation, true);
  assert.match(result.data.note, /specid/);
  assert.equal(write.folded, true, 'the write is followed by a projection refresh');

  // v1.3 draft §4.1: a declared workspace rides the spec pin verbatim.
  const withWorkspace = await verbs.publishSpec(
    specArgs({ workspace: { type: 'git', baseRef: 'metafile://basebundle0001', baseCommit: '1'.repeat(40) } }),
  );
  assert.equal(withWorkspace.ok, true);
  assert.equal(writes.length, 2);
  const wsPayload = JSON.parse(writes[1].metaidData.payload);
  assert.deepEqual(wsPayload.workspace, { type: 'git', baseRef: 'metafile://basebundle0001', baseCommit: '1'.repeat(40) });
});

test('publish-spec: validation block enforced before any spend', async () => {
  const { verbs, writes } = buildHarness([]);

  const noValidation = refusalOf(await verbs.publishSpec(specArgs({ validation: undefined })));
  assert.match(noValidation, /spec\.validation is required/);

  const missingItem = refusalOf(await verbs.publishSpec(
    specArgs({ validation: { null_tolerance: true, enumeration_closure: { closure: 'x', expected_count: 1 } } }),
  ));
  assert.match(missingItem, /proposition_fidelity/);

  const placeholder = refusalOf(await verbs.publishSpec(
    specArgs({ validation: buildValidation('PUBLISH_ARTIFACT_FIRST') }),
  ));
  assert.match(placeholder, /placeholder/);

  const selfAttested = refusalOf(await verbs.publishSpec(
    specArgs({ validation: buildValidation(ARTIFACT_REF, { proposition_fidelity: { checked: true } }) }),
  ));
  assert.match(selfAttested, /self-attested boolean/);

  const httpsRef = refusalOf(await verbs.publishSpec(
    specArgs({ validation: buildValidation('https://example.com/table') }),
  ));
  assert.match(httpsRef, /REAL correspondence artifact/);

  assert.equal(writes.length, 0, 'every validation refusal precedes any spend');
});

test('publish-spec: pin:// script reference, campaign artifactPin shape, pre-H_ACT2 opt-out', async () => {
  const { verbs, writes } = buildHarness([]);

  // A pin:// script reference is accepted as-is (normalized to the trimmed ref).
  const pinRef = await verbs.publishSpec(
    specArgs({ script: 'pin://specscript0000000000000000000000000000000i0' }),
  );
  assert.equal(pinRef.ok, true);
  assert.equal(JSON.parse(writes[0].metaidData.payload).script, 'pin://specscript0000000000000000000000000000000i0');

  // An https:// single-line script is refused (protocol §3 reference forms).
  const httpsScript = refusalOf(await verbs.publishSpec(specArgs({ script: 'https://example.com/spec.sh' })));
  assert.match(httpsScript, /not pin:\/\/ or metafile:\/\//);

  // The campaign shape carries the artifact under `artifactPin` only.
  const campaignShape = await verbs.publishSpec(
    specArgs({ validation: buildValidation(ARTIFACT_REF, { proposition_fidelity: { artifactPin: ARTIFACT_REF } }) }),
  );
  assert.equal(campaignShape.ok, true);

  // The pre-H_ACT2 (v1.1-era) opt-out skips the validation block entirely.
  const legacy = await verbs.publishSpec(specArgs({ validation: undefined, enforceHAct2Validation: false }));
  assert.equal(legacy.ok, true);
  assert.equal(legacy.data.hasValidation, false);
  assert.equal(writes.length, 3);
});

test('publish-spec: enumeration_closure accepts an integer at any depth', async () => {
  const { verbs, writes } = buildHarness([]);

  const nestedObject = await verbs.publishSpec({
    name: 'nested-object',
    lang: 'python3',
    entry: 'nested.py',
    script: SPEC_SCRIPT,
    validation: buildValidation(ARTIFACT_REF, {
      enumeration_closure: {
        closure: 'primes of the two certificates',
        selfcheck: { jsp: 'JSP-000301', expected_count: 4, count_meaning: 'distinct primes' },
      },
    }),
  });
  assert.equal(nestedObject.ok, true);

  const nestedArray = await verbs.publishSpec({
    name: 'nested-array',
    lang: 'python3',
    entry: 'nested-array.py',
    script: SPEC_SCRIPT,
    validation: buildValidation(ARTIFACT_REF, {
      enumeration_closure: {
        closure: 'every batch',
        selfcheck: [{ batch: 'b01', expected_count: 27 }, { batch: 'b02', expected_count: 30 }],
      },
    }),
  });
  assert.equal(nestedArray.ok, true);
  assert.equal(writes.length, 2);

  const noInteger = refusalOf(await verbs.publishSpec({
    name: 'no-integer',
    lang: 'python3',
    entry: 'no-integer.py',
    script: SPEC_SCRIPT,
    validation: buildValidation(ARTIFACT_REF, {
      enumeration_closure: {
        closure: 'every batch',
        selfcheck: { batch: 'b01', count: 'twenty-seven' },
      },
    }),
  }));
  assert.match(noInteger, /integer self-check count/);

  const noClosure = refusalOf(await verbs.publishSpec({
    name: 'no-closure',
    lang: 'python3',
    entry: 'no-closure.py',
    script: SPEC_SCRIPT,
    validation: buildValidation(ARTIFACT_REF, {
      enumeration_closure: { selfcheck: { expected_count: 4 } },
    }),
  }));
  assert.match(noClosure, /closure/);

  assert.equal(writes.length, 2, 'only the two accepted specs were written');
});

// ── draftsFile mode ──────────────────────────────────────────────────────────

const DRAFTS_STANDALONE_SPEC_KEY = 'witness-extraction-301';
const DRAFTS_REVIEW_SPEC_KEY = 'semantic-review-301';
const DRAFTS_ROOT_SPEC_KEY = 'lean-build-301';
const DRAFTS_TASK_ID = 'T1-JSP-000301';

const buildDraftsFixture = () => ({
  specs: {
    [DRAFTS_STANDALONE_SPEC_KEY]: {
      name: DRAFTS_STANDALONE_SPEC_KEY,
      lang: 'python3',
      entry: 'spec-witness-extraction.py',
      script: SPEC_SCRIPT,
      input: { repo: 'metafile://repo-artifact' },
      output: { verdict: 'pass|fail|invalid' },
      validation: buildValidation(),
    },
    [DRAFTS_REVIEW_SPEC_KEY]: {
      name: DRAFTS_REVIEW_SPEC_KEY,
      lang: 'python3',
      entry: 'spec-semantic-review.py',
      script: 'python3 spec-semantic-review.py --strict',
      input: '',
      output: { verdict: 'pass|fail|invalid' },
      validation: buildValidation(),
    },
    [DRAFTS_ROOT_SPEC_KEY]: {
      name: DRAFTS_ROOT_SPEC_KEY,
      lang: 'bash',
      entry: 'check.sh',
      script: 'lake build && lake test',
      input: '',
      output: '',
    },
  },
  tasks: [
    {
      id: DRAFTS_TASK_ID,
      rootSpec: DRAFTS_ROOT_SPEC_KEY,
      publish: {
        title: 'formalize JSP-000301 (drafts fixture)',
        brief: 'fixture brief',
        nodes: [
          { id: 'root', parent: null, title: 'root aggregate', kind: 'aggregate', weight: 2000 },
          { id: 'witness', parent: 'root', title: 'witness extraction', kind: 'proof', weight: 5000, specid: `SPEC_PIN:${DRAFTS_STANDALONE_SPEC_KEY}` },
          { id: 'review', parent: 'root', title: 'semantic review', kind: 'proof', weight: 3000, specid: `SPEC_PIN:${DRAFTS_REVIEW_SPEC_KEY}` },
        ],
        policy: { claimTtlHours: 48, verifyQuorum: 2, verifyWindowHours: 72 },
        tags: ['metatask', 'jsp'],
      },
    },
  ],
});

const withDraftsFile = async (fixture, run) => {
  const root = mkdtempTempRootSync('oac-metatask-drafts-');
  const draftsFile = path.join(root, 'drafts.json');
  fs.writeFileSync(draftsFile, JSON.stringify(fixture), 'utf8');
  try {
    await run(draftsFile, root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

test('publish-spec: draftsFile+specKey publishes the file spec byte-for-byte', async () => {
  const { verbs, writes } = buildHarness([]);
  await withDraftsFile(buildDraftsFixture(), async (draftsFile) => {
    const result = await verbs.publishSpec({ draftsFile, specKey: DRAFTS_STANDALONE_SPEC_KEY });
    assert.equal(result.ok, true);
    assert.equal(writes.length, 1, 'one spec pin, no tree/task');
    assert.equal(writes[0].pinPath, '/protocols/metatask/spec');

    const expected = buildDraftsFixture().specs[DRAFTS_STANDALONE_SPEC_KEY];
    assert.equal(writes[0].metaidData.payload, JSON.stringify(expected), 'payload bytes equal the drafts entry');

    assert.equal(result.data.specPinId, writes[0].pinId);
    assert.equal(result.data.source, 'draftsFile');
    assert.equal(result.data.specKey, DRAFTS_STANDALONE_SPEC_KEY);
    assert.equal(result.data.hasValidation, true);
  });
});

test('publish-spec: refuse when both modes are supplied, or one half is missing', async () => {
  const { verbs, writes } = buildHarness([]);
  await withDraftsFile(buildDraftsFixture(), async (draftsFile) => {
    const both = refusalOf(await verbs.publishSpec({
      draftsFile,
      specKey: DRAFTS_STANDALONE_SPEC_KEY,
      name: 'hand-typed-name',
    }));
    assert.match(both, /not both/);

    const fileOnly = refusalOf(await verbs.publishSpec({ draftsFile }));
    assert.match(fileOnly, /draftsFile and specKey must be passed together/);

    const keyOnly = refusalOf(await verbs.publishSpec({ specKey: DRAFTS_STANDALONE_SPEC_KEY }));
    assert.match(keyOnly, /draftsFile and specKey must be passed together/);

    const unknownKey = refusalOf(await verbs.publishSpec({ draftsFile, specKey: 'nope-301' }));
    assert.match(unknownKey, /specs\["nope-301"\] not found/);
    assert.match(unknownKey, /witness-extraction-301/);

    assert.equal(writes.length, 0, 'every file-mode refusal precedes any spend');
  });
});

test('publish-spec: unreadable draftsFile or non-object JSON is refused', async () => {
  const { verbs, writes } = buildHarness([]);
  await withDraftsFile(buildDraftsFixture(), async (draftsFile, dir) => {
    const missing = refusalOf(await verbs.publishSpec({
      draftsFile: path.join(dir, 'missing-file.json'),
      specKey: DRAFTS_STANDALONE_SPEC_KEY,
    }));
    assert.match(missing, /cannot read draftsFile/);

    const relative = refusalOf(await verbs.publishSpec({
      draftsFile: 'scripts/metatask-campaign/wave1-task-drafts.json',
      specKey: DRAFTS_STANDALONE_SPEC_KEY,
    }));
    assert.match(relative, /must be an absolute path/);

    const arrayFile = path.join(dir, 'array.json');
    fs.writeFileSync(arrayFile, '[]', 'utf8');
    const notObject = refusalOf(await verbs.publishSpec({ draftsFile: arrayFile, specKey: 'x' }));
    assert.match(notObject, /must contain a JSON object/);

    assert.equal(writes.length, 0);
  });
});

test('publish: draftsFile+taskId substitutes SPEC_PIN placeholders and refuses unmapped ones', async () => {
  const { verbs, writes } = buildHarness([]);
  await withDraftsFile(buildDraftsFixture(), async (draftsFile) => {
    const unmapped = refusalOf(await verbs.publish({ draftsFile, taskId: DRAFTS_TASK_ID }));
    assert.match(unmapped, /SPEC_PIN:semantic-review-301/);
    assert.match(unmapped, /SPEC_PIN:witness-extraction-301/);
    assert.equal(writes.length, 0, 'no spend with an unresolved placeholder');

    const result = refusalOf(await verbs.publish({
      draftsFile,
      taskId: DRAFTS_TASK_ID,
      specPinByKey: {
        [DRAFTS_STANDALONE_SPEC_KEY]: 'pin://witnessspec0000000000000000000000000000000000001i0',
      },
    }));
    assert.match(result, /SPEC_PIN:semantic-review-301/);
    assert.ok(!/SPEC_PIN:witness-extraction-301/.test(result), 'mapped placeholder is not reported');
    assert.equal(writes.length, 0);

    const ok = await verbs.publish({
      draftsFile,
      taskId: DRAFTS_TASK_ID,
      specPinByKey: {
        [DRAFTS_STANDALONE_SPEC_KEY]: 'pin://witnessspec0000000000000000000000000000000000001i0',
        [DRAFTS_REVIEW_SPEC_KEY]: 'pin://reviewspec0000000000000000000000000000000000001i0',
      },
    });
    assert.equal(ok.ok, true);
    const paths = writes.map((write) => write.pinPath);
    assert.deepEqual(paths, [
      '/protocols/metatask-roster',
      '/protocols/metatask/tree',
      '/protocols/metatask/spec',
      '/protocols/metatask/task',
    ]);
    const treePayload = JSON.parse(writes[1].metaidData.payload);
    assert.equal(treePayload.root, 'root');
    assert.deepEqual(
      treePayload.nodes.map((node) => [node.id, node.specid]),
      [
        ['root', null],
        ['witness', 'pin://witnessspec0000000000000000000000000000000000001i0'],
        ['review', 'pin://reviewspec0000000000000000000000000000000000001i0'],
      ]
    );
    const taskPayload = JSON.parse(writes[3].metaidData.payload);
    assert.equal(taskPayload.title, 'formalize JSP-000301 (drafts fixture)');
    assert.equal(taskPayload.brief, 'fixture brief');
    assert.equal(taskPayload.policy.verify_quorum, 2);
    assert.deepEqual(taskPayload.tags, ['metatask', 'jsp']);
    // The root spec is written by this call from the drafts' rootSpec entry.
    const specPayload = JSON.parse(writes[2].metaidData.payload);
    assert.equal(specPayload.name, DRAFTS_ROOT_SPEC_KEY);
    assert.equal(specPayload.script, buildDraftsFixture().specs[DRAFTS_ROOT_SPEC_KEY].script);
    assert.equal(ok.data.source, 'draftsFile');
    assert.equal(ok.data.taskId, DRAFTS_TASK_ID);
  });
});

test('publish: both modes, unknown taskId and stray specPinByKey are refused', async () => {
  const { verbs, writes } = buildHarness([]);
  await withDraftsFile(buildDraftsFixture(), async (draftsFile) => {
    const both = refusalOf(await verbs.publish({
      draftsFile,
      taskId: DRAFTS_TASK_ID,
      title: 'hand-typed title',
    }));
    assert.match(both, /not both/);

    const missingTaskId = refusalOf(await verbs.publish({ draftsFile }));
    assert.match(missingTaskId, /draftsFile and taskId must be passed together/);

    const unknownTask = refusalOf(await verbs.publish({
      draftsFile,
      taskId: 'T9-JSP-000999',
      specPinByKey: {},
    }));
    assert.match(unknownTask, /no tasks\[\] entry with id "T9-JSP-000999"/);
    assert.match(unknownTask, /T1-JSP-000301/);

    const strayMap = refusalOf(await verbs.publish({
      title: 'inline',
      nodes: [
        { id: 'root', parent: null, title: 'root', kind: 'aggregate', weight: 10000 },
      ],
      spec: { name: 'x', lang: 'bash', entry: 'x.sh', script: 'echo pass' },
      policy: { claimTtlHours: 1, verifyQuorum: 1, verifyWindowHours: 1 },
      specPinByKey: {},
    }));
    assert.match(strayMap, /specPinByKey only applies in draftsFile mode/);

    assert.equal(writes.length, 0);
  });
});

// ── competitive mode (v1.3 draft): writer-side discipline ────────────────────
// The replay engine has no H_ACT3 gate (pre-activation fixtures must replay);
// the WRITER side is where competitive tasks are shaped, validated and gated.

const COMP_REVIEWER_A = 'idq1creviewerA0000000000000000000';
const COMP_REVIEWER_B = 'idq1creviewerB0000000000000000000';
const COMP_SUBMITTER = 'idq1csubmitterX0000000000000000000';
const COMMIT_A = 'a'.repeat(40);
const COMMIT_B = 'b'.repeat(40);

/** Competitive fixture: entry a (deps []) -> terminal r (deps [a]); r is the unique sink = finalnode. */
const compFixture = (over = {}) => {
  const treePinId = nextPinId();
  const rootPinId = nextPinId();
  const author = over.author ?? FOREIGN_PUBLISHER;
  const nodes = over.nodes ?? [
    { id: 'r', parent: null, title: 'terminal', kind: 'aggregate', specid: null, params: { rubric: ['rubric for r'] }, deps: ['a'], weight: 4000 },
    { id: 'a', parent: 'r', title: 'entry a', kind: 'proof', specid: null, params: { rubric: ['rubric for a'] }, deps: [], weight: 6000 },
  ];
  const tree = ev('tree', { root: 'r', nodes }, { pinId: treePinId, author, height: 191_590 });
  const task = ev(
    'task',
    {
      title: 'competitive fixture',
      brief: '',
      treeid: treePinId,
      ...(over.specid ? { specid: over.specid } : {}),
      policy: {
        mode: 'competitive',
        finalnode: 'r',
        verify_quorum: 2,
        claim_ttl_hours: 0,
        verify_window_hours: 0,
        ...(over.policyExtra ?? {}),
      },
      tags: [],
    },
    { pinId: rootPinId, author, height: 191_591 },
  );
  return { events: [tree, task], treePinId, rootPinId };
};

const compVote = (targetPinId, author, height, verdict = 'pass') =>
  ev(
    'verify',
    {
      targetid: targetPinId,
      verdict,
      method: `spec rerun ${verdict}`,
      semantic_check: 'checked the rubric items',
      ...(verdict === 'fail' ? { failreason: 'rubric item 1 unmet' } : {}),
    },
    { author, height },
  );

/** A foreign submission on entry node a plus the two pass votes that verify it (quorum 2). */
const verifiedParentOnA = (rootPinId) => {
  const sub = ev(
    'submission',
    {
      taskid: rootPinId,
      node: 'a',
      result: { type: 'metafile' },
      hash: '5'.repeat(64),
      contentType: 'application/json;utf-8',
      attachment: null,
      childids: [],
    },
    { author: COMP_SUBMITTER, height: 191_600 },
  );
  return {
    sub,
    events: [sub, compVote(sub.pinId, COMP_REVIEWER_A, 191_601), compVote(sub.pinId, COMP_REVIEWER_B, 191_602)],
  };
};

test('publish: competitive mode is H_ACT3-gated, with an explicit pre-activation escape hatch', async () => {
  const compArgs = (policyExtra = {}) => ({
    title: 'competitive task',
    nodes: [
      { id: 'r', parent: null, title: 'terminal', kind: 'aggregate', weight: 4000, deps: ['a'], params: { rubric: ['rubric r'] } },
      { id: 'a', parent: 'r', title: 'entry', kind: 'proof', weight: 6000, params: { rubric: ['rubric a'] } },
    ],
    spec: { name: 'check', lang: 'bash', entry: 'check.sh', script: 'echo pass' },
    policy: { mode: 'competitive', finalnode: 'r', verifyQuorum: 2, ...policyExtra },
  });

  // H_ACT3 unannounced locally: refused, no spend.
  {
    const { verbs, writes } = buildHarness([]);
    const refused = refusalOf(await verbs.publish(compArgs()));
    assert.match(refused, /H_ACT3/);
    assert.match(refused, /allowPreActivation/);
    assert.equal(writes.length, 0);
  }

  // Announced height, boundary below it: refused.
  {
    const { verbs, writes } = buildHarness([], {
      activation: { hAct3: 200_000, boundaryBlock: 199_999 },
    });
    const refused = refusalOf(await verbs.publish(compArgs()));
    assert.match(refused, /H_ACT3=200000/);
    assert.match(refused, /199999/);
    assert.equal(writes.length, 0);
  }

  // Announced height reached: publishes without the escape hatch.
  {
    const { verbs, writes } = buildHarness([], {
      activation: { hAct3: 200_000, boundaryBlock: 200_000 },
    });
    const ok = await verbs.publish(compArgs());
    assert.equal(ok.ok, true);
    const taskPayload = JSON.parse(writes[writes.length - 1].metaidData.payload);
    assert.equal(taskPayload.policy.mode, 'competitive');
    assert.equal(taskPayload.policy.finalnode, 'r');
    assert.equal(ok.data.mode, 'competitive');
    assert.equal(ok.data.finalnode, 'r');
    assert.equal(ok.data.preActivationOverride, undefined);
  }

  // Not announced but explicitly overridden: the escape hatch publishes and is reported.
  {
    const { verbs, writes } = buildHarness([]);
    const ok = await verbs.publish({ ...compArgs(), allowPreActivation: true });
    assert.equal(ok.ok, true);
    assert.equal(ok.data.preActivationOverride, true);
    assert.match(ok.data.activationNote, /H_ACT3/);
    assert.ok(writes.length > 0);
  }

  // Announced but boundary unknown (never refreshed): refused without the override.
  {
    const { verbs, writes } = buildHarness([], {
      activation: { hAct3: 200_000, boundaryBlock: null },
    });
    const refused = refusalOf(await verbs.publish(compArgs()));
    assert.match(refused, /boundary block is unknown/);
    assert.equal(writes.length, 0);
  }
});

test('publish: competitive invariants are enforced before the first pin', async () => {
  const base = () => ({
    title: 'competitive task',
    spec: { name: 'check', lang: 'bash', entry: 'check.sh', script: 'echo pass' },
    policy: { mode: 'competitive', finalnode: 'r', verifyQuorum: 2 },
    allowPreActivation: true,
  });
  const rubric = { rubric: ['acceptance criterion'] };
  const twoNodes = (over = {}) => [
    { id: 'r', parent: null, title: 'terminal', kind: 'aggregate', weight: 4000, deps: ['a'], params: rubric, ...(over.r ?? {}) },
    { id: 'a', parent: 'r', title: 'entry', kind: 'proof', weight: 6000, params: rubric, ...(over.a ?? {}) },
  ];

  // finalnode missing
  {
    const { verbs, writes } = buildHarness([]);
    const args = base();
    delete args.policy.finalnode;
    const refused = refusalOf(await verbs.publish({ ...args, nodes: twoNodes() }));
    assert.match(refused, /requires policy\.finalnode/);
    assert.equal(writes.length, 0);
  }

  // finalnode names no live node
  {
    const { verbs, writes } = buildHarness([]);
    const args = base();
    args.policy.finalnode = 'nope';
    const refused = refusalOf(await verbs.publish({ ...args, nodes: twoNodes() }));
    assert.match(refused, /"nope" is not a node/);
    assert.equal(writes.length, 0);
  }

  // deps cycle
  {
    const { verbs, writes } = buildHarness([]);
    const refused = refusalOf(await verbs.publish({
      ...base(),
      nodes: [
        { id: 'r', parent: null, title: 'terminal', kind: 'aggregate', weight: 5000, deps: ['a'], params: rubric },
        { id: 'a', parent: 'r', title: 'entry', kind: 'proof', weight: 5000, deps: ['r'], params: rubric },
      ],
    }));
    assert.match(refused, /deps graph is cyclic/);
    assert.equal(writes.length, 0);
  }

  // multiple sinks (a stray branch that never feeds the final node)
  {
    const { verbs, writes } = buildHarness([]);
    const refused = refusalOf(await verbs.publish({
      ...base(),
      nodes: [
        ...twoNodes(),
        { id: 'x', parent: 'r', title: 'stray', kind: 'proof', weight: 1, params: rubric },
      ].map((node) => (node.id === 'a' ? { ...node, weight: 5999 } : node)),
    }));
    assert.match(refused, /exactly ONE deps sink/);
    assert.match(refused, /r, x/);
    assert.equal(writes.length, 0);
  }

  // single sink but finalnode points elsewhere
  {
    const { verbs, writes } = buildHarness([]);
    const args = base();
    args.policy.finalnode = 'a';
    const refused = refusalOf(await verbs.publish({ ...args, nodes: twoNodes() }));
    assert.match(refused, /unique deps sink is "r"/);
    assert.equal(writes.length, 0);
  }

  // rubric missing / empty
  {
    const { verbs, writes } = buildHarness([]);
    const noRubric = refusalOf(await verbs.publish({
      ...base(),
      nodes: [
        { id: 'r', parent: null, title: 'terminal', kind: 'aggregate', weight: 4000, deps: ['a'], params: rubric },
        { id: 'a', parent: 'r', title: 'entry', kind: 'proof', weight: 6000 },
      ],
    }));
    assert.match(noRubric, /node a has no rubric/);
    assert.match(noRubric, /params\.rubric/);

    const emptyRubric = refusalOf(await verbs.publish({
      ...base(),
      nodes: twoNodes({ a: { params: { rubric: ['   '] } } }),
    }));
    assert.match(emptyRubric, /no non-empty entry/);
    assert.equal(writes.length, 0);
  }

  // unknown dep reference (the shared pre-v1.3 check, still first)
  {
    const { verbs, writes } = buildHarness([]);
    const refused = refusalOf(await verbs.publish({
      ...base(),
      nodes: twoNodes({ a: { deps: ['ghost'] } }),
    }));
    assert.match(refused, /unknown dep ghost/);
    assert.equal(writes.length, 0);
  }

  // unknown mode / finalnode in tree mode
  {
    const { verbs, writes } = buildHarness([]);
    const badMode = refusalOf(await verbs.publish({
      ...base(),
      nodes: twoNodes(),
      policy: { mode: 'race', finalnode: 'r', verifyQuorum: 2 },
    }));
    assert.match(badMode, /must be "tree" or "competitive"/);

    const treeFinalnode = refusalOf(await verbs.publish({
      title: 'tree task',
      nodes: [{ id: 'r', parent: null, title: 'root', kind: 'aggregate', weight: 10000, params: {} }],
      spec: { name: 'check', lang: 'bash', entry: 'check.sh', script: 'echo pass' },
      policy: { claimTtlHours: 1, verifyQuorum: 1, verifyWindowHours: 1, finalnode: 'r' },
    }));
    assert.match(treeFinalnode, /only applies to competitive mode/);
    assert.equal(writes.length, 0);
  }
});

test('publish: competitive ttl/window normalize to 0 with a warning, not a refusal', async () => {
  const { verbs, writes } = buildHarness([]);
  const ok = await verbs.publish({
    title: 'competitive task',
    nodes: [
      { id: 'r', parent: null, title: 'terminal', kind: 'aggregate', weight: 4000, deps: ['a'], params: { rubric: ['rubric r'] } },
      { id: 'a', parent: 'r', title: 'entry', kind: 'proof', weight: 6000, params: { rubric: ['rubric a'] } },
    ],
    spec: { name: 'check', lang: 'bash', entry: 'check.sh', script: 'echo pass' },
    policy: { mode: 'competitive', finalnode: 'r', verifyQuorum: 2, claimTtlHours: 48, verifyWindowHours: 72 },
    allowPreActivation: true,
  });
  assert.equal(ok.ok, true);
  const taskPayload = JSON.parse(writes[writes.length - 1].metaidData.payload);
  assert.equal(taskPayload.policy.claim_ttl_hours, 0);
  assert.equal(taskPayload.policy.verify_window_hours, 0);
  assert.equal(ok.data.policyWarnings.length, 2);
  assert.match(ok.data.policyWarnings[0], /claim_ttl_hours normalized to 0/);
  assert.match(ok.data.policyWarnings[1], /verify_window_hours normalized to 0/);
});

test('submit: competitive parentRefs validation and optimistic flagging', async () => {
  // entry node must omit parentRefs (an empty object counts as omitted)
  {
    const { events, rootPinId } = compFixture();
    const { verbs, writes } = buildHarness(events);
    const refused = refusalOf(await verbs.submit({
      rootPinId,
      node: 'a',
      result: { type: 'metafile' },
      parentRefs: { a: 'somepin' },
    }));
    assert.match(refused, /entry node/);
    assert.match(refused, /invalid_reference/);
    const omitted = await verbs.submit({
      rootPinId,
      node: 'a',
      result: { type: 'metafile' },
      parentRefs: {},
    });
    assert.equal(omitted.ok, true);
    assert.equal(writes.length, 1);
  }

  // dep node: missing key / extra key
  {
    const { events, rootPinId } = compFixture();
    const { verbs, writes } = buildHarness(events);
    const missing = refusalOf(await verbs.submit({ rootPinId, node: 'r', result: { type: 'aggregate' } }));
    assert.match(missing, /missing: a/);
    const extra = refusalOf(await verbs.submit({
      rootPinId,
      node: 'r',
      result: { type: 'aggregate' },
      parentRefs: { a: nextPinId(), zzz: nextPinId() },
    }));
    assert.match(extra, /extra: zzz/);
    assert.equal(writes.length, 0);
  }

  // ghost pin / pin on the wrong node — invalid_reference parity, refused pre-spend
  {
    const { events, rootPinId } = compFixture();
    const foreignSubOnR = ev(
      'submission',
      {
        taskid: rootPinId,
        node: 'r',
        result: { type: 'aggregate' },
        hash: '6'.repeat(64),
        contentType: 'application/json;utf-8',
        attachment: null,
        childids: [],
      },
      { author: COMP_SUBMITTER, height: 191_600 },
    );
    const { verbs, writes } = buildHarness([...events, foreignSubOnR]);
    const ghost = refusalOf(await verbs.submit({
      rootPinId,
      node: 'r',
      result: { type: 'aggregate' },
      parentRefs: { a: 'ghostpin000000000000000000000000000000i0' },
    }));
    assert.match(ghost, /not a submission of this task/);
    const wrongNode = refusalOf(await verbs.submit({
      rootPinId,
      node: 'r',
      result: { type: 'aggregate' },
      parentRefs: { a: foreignSubOnR.pinId },
    }));
    assert.match(wrongNode, /sits on node "r", not on dep node "a"/);
    assert.equal(writes.length, 0);
  }

  // happy path: no claimPinId needed, entry submission then an optimistic join
  {
    const { events, rootPinId } = compFixture();
    const { verbs, writes } = buildHarness(events);
    const subA = await verbs.submit({ rootPinId, node: 'a', result: { type: 'metafile', note: 'work' } });
    assert.equal(subA.ok, true);
    assert.equal(subA.data.mode, 'competitive');
    assert.equal(subA.data.optimistic, false);
    const payloadA = JSON.parse(writes[0].metaidData.payload);
    assert.equal(payloadA.claimid, undefined, 'competitive submissions carry no claimid');
    assert.equal('parentrefs' in payloadA, false, 'entry node omits parentrefs');
    assert.deepEqual(payloadA.childids, []);

    // the harness folds the write back into the pool synchronously
    const join = await verbs.submit({
      rootPinId,
      node: 'r',
      result: { type: 'aggregate' },
      parentRefs: { a: subA.data.submissionPinId },
    });
    assert.equal(join.ok, true);
    assert.equal(join.data.optimistic, true);
    assert.deepEqual(join.data.optimisticParents, [{ parent: 'a', pinId: subA.data.submissionPinId, state: 'unverified' }]);
    assert.match(join.data.note, /OPTIMISTIC PIPELINE/);
    const payloadR = JSON.parse(writes[1].metaidData.payload);
    assert.deepEqual(payloadR.parentrefs, { a: subA.data.submissionPinId });
  }

  // a VERIFIED parent clears the optimistic flag
  {
    const { events, rootPinId } = compFixture();
    const parent = verifiedParentOnA(rootPinId);
    const { verbs } = buildHarness([...events, ...parent.events]);
    const join = await verbs.submit({
      rootPinId,
      node: 'r',
      result: { type: 'aggregate' },
      parentRefs: { a: parent.sub.pinId },
    });
    assert.equal(join.ok, true);
    assert.equal(join.data.optimistic, false);
    assert.equal(join.data.optimisticParents, undefined);
    assert.match(join.data.note, /verified and chain-valid/);
  }

  // a parent killed by a fail verdict can never be chain-valid: refused
  {
    const { events, rootPinId } = compFixture();
    const sub = ev(
      'submission',
      {
        taskid: rootPinId,
        node: 'a',
        result: { type: 'metafile' },
        hash: '7'.repeat(64),
        contentType: 'application/json;utf-8',
        attachment: null,
        childids: [],
      },
      { author: COMP_SUBMITTER, height: 191_600 },
    );
    const fail = compVote(sub.pinId, COMP_REVIEWER_A, 191_601, 'fail');
    const { verbs, writes } = buildHarness([...events, sub, fail]);
    const refused = refusalOf(await verbs.submit({
      rootPinId,
      node: 'r',
      result: { type: 'aggregate' },
      parentRefs: { a: sub.pinId },
    }));
    assert.match(refused, /can never become chain-valid/);
    assert.match(refused, /fail verdict/);
    assert.equal(writes.length, 0);
  }

  // the publisher is refused its own competitive task (§12 item 6)
  {
    const { events, rootPinId } = compFixture({ author: SESSION_BOT });
    const { verbs, writes } = buildHarness(events);
    const refused = refusalOf(await verbs.submit({ rootPinId, node: 'a', result: { type: 'metafile' } }));
    assert.match(refused, /§12 item 6/);
    assert.equal(writes.length, 0);
  }

  // a passed claimPinId is ignored (and reported), childIds are refused
  {
    const { events, rootPinId } = compFixture();
    const { verbs, writes } = buildHarness(events);
    const withClaim = await verbs.submit({
      rootPinId,
      node: 'a',
      result: { type: 'metafile' },
      claimPinId: 'claim-not-needed',
    });
    assert.equal(withClaim.ok, true);
    assert.equal(withClaim.data.claimPinIdIgnored, true);
    const withChildren = refusalOf(await verbs.submit({
      rootPinId,
      node: 'a',
      result: { type: 'metafile' },
      childIds: ['childpin'],
    }));
    assert.match(withChildren, /parentRefs instead/);
    assert.equal(writes.length, 1);
  }

  // tree mode still refuses a missing claimPinId (the holder check did not move)
  {
    const { events, rootPinId } = buildForeignTask();
    const { verbs, writes } = buildHarness(events);
    const refused = refusalOf(await verbs.submit({ rootPinId, node: 't1', result: { type: 'triage' } }));
    assert.match(refused, /claim-rejected:t1/);
    assert.equal(writes.length, 0);
  }
});

test('submit: git workspace specs force git-bundle artifacts', async () => {
  const specPinId = nextPinId();
  const gitSpec = ev(
    'spec',
    {
      name: 'git-check',
      lang: 'bash',
      entry: 'check.sh',
      script: 'make test',
      input: '',
      output: '',
      workspace: { type: 'git', baseCommit: COMMIT_B },
    },
    { pinId: specPinId, author: FOREIGN_PUBLISHER, height: 191_589 },
  );
  const { events, rootPinId } = compFixture({ specid: specPinId });
  const { verbs, writes } = buildHarness([gitSpec, ...events]);

  const wrongType = refusalOf(await verbs.submit({ rootPinId, node: 'a', result: { type: 'metafile' } }));
  assert.match(wrongType, /result\.type must be "git-bundle"/);

  const noCommit = refusalOf(await verbs.submit({ rootPinId, node: 'a', result: { type: 'git-bundle' } }));
  assert.match(noCommit, /commit must be the full commit hash/);

  const badCommit = refusalOf(await verbs.submit({
    rootPinId,
    node: 'a',
    result: { type: 'git-bundle', commit: 'abc', baseCommit: COMMIT_B },
  }));
  assert.match(badCommit, /40 hex/);

  const badAttachment = refusalOf(await verbs.submit({
    rootPinId,
    node: 'a',
    result: { type: 'git-bundle', commit: COMMIT_A, baseCommit: COMMIT_B },
    attachment: 'https://github.com/x/y',
  }));
  assert.match(badAttachment, /metafile:\/\//);
  assert.equal(writes.length, 0, 'every artifact refusal precedes any spend');

  const ok = await verbs.submit({
    rootPinId,
    node: 'a',
    result: { type: 'git-bundle', commit: COMMIT_A, baseCommit: COMMIT_B },
    attachment: 'metafile://bundle0001',
  });
  assert.equal(ok.ok, true);
  assert.equal(writes.length, 1);

  // greenfield: baseCommit null is allowed (draft §4.4)
  const greenfield = await verbs.submit({
    rootPinId,
    node: 'a',
    result: { type: 'git-bundle', commit: COMMIT_B, baseCommit: null },
    attachment: 'metafile://bundle0002',
  });
  assert.equal(greenfield.ok, true);
  assert.equal(writes.length, 2);
});

test('claim/release: competitive claims are intent-only; release is refused as a no-op', async () => {
  const { events, rootPinId } = compFixture();
  const parent = verifiedParentOnA(rootPinId); // node a already satisfied
  const { verbs, writes } = buildHarness([...events, ...parent.events]);

  // A tree-mode guard would refuse a satisfied node; competitive claims never gate.
  const intent = await verbs.claim({ rootPinId, node: 'a' });
  assert.equal(intent.ok, true);
  assert.equal(intent.data.intentOnly, true);
  assert.match(intent.data.note, /INTENT SIGNAL/);
  assert.equal(writes[0].pinPath, '/protocols/metatask/claim');

  const released = refusalOf(await verbs.release({ rootPinId, node: 'a', claimPinId: intent.data.claimPinId }));
  assert.match(released, /no claim locks/);
  assert.match(released, /supersedePinId/);
  assert.equal(writes.length, 1, 'the release refusal must not spend a pin');

  // the publisher self-claim refusal still applies in competitive mode
  const own = compFixture({ author: SESSION_BOT });
  const mine = buildHarness(own.events);
  const refused = refusalOf(await mine.verbs.claim({ rootPinId: own.rootPinId, node: 'a' }));
  assert.match(refused, /§12 item 6/);
  assert.equal(mine.writes.length, 0);
});

test('amend: competitive freeze is satisfaction, not "ever claimed"', async () => {
  // A claim alone freezes NOTHING in competitive mode (intent only, §3.2/§3.9).
  {
    const { events, rootPinId } = compFixture({ author: SESSION_BOT });
    const intentClaim = ev('claim', { taskid: rootPinId, node: 'a' }, { author: COMP_SUBMITTER, height: 191_600 });
    const { verbs, writes } = buildHarness([...events, intentClaim]);
    const ok = await verbs.amend({
      rootPinId,
      ops: [
        { op: 'reweight', node: 'a', weight: 5000 },
        { op: 'reweight', node: 'r', weight: 5000 },
      ],
    });
    assert.equal(ok.ok, true);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].pinPath, '/protocols/metatask/amend');
  }

  // A satisfied node (chain-valid verified submission) IS frozen (§3.9).
  {
    const { events, rootPinId } = compFixture({ author: SESSION_BOT });
    const parent = verifiedParentOnA(rootPinId);
    const { verbs, writes } = buildHarness([...events, ...parent.events]);
    const refused = refusalOf(await verbs.amend({
      rootPinId,
      ops: [{ op: 'reweight', node: 'a', weight: 5000 }],
    }));
    assert.match(refused, /node a is satisfied/);
    assert.equal(writes.length, 0);
  }

  // remove_node is rejected while another node lists the target in deps (§3.9).
  {
    const { events, rootPinId } = compFixture({ author: SESSION_BOT });
    const { verbs, writes } = buildHarness(events);
    const refused = refusalOf(await verbs.amend({ rootPinId, ops: [{ op: 'remove_node', node: 'a' }] }));
    assert.match(refused, /listed in deps by r/);
    assert.equal(writes.length, 0);
  }
});

test('amend: competitive add_node deps/rubric rules and post-fold invariants', async () => {
  // add_node with a deps edge onto a SATISFIED node is refused (§3.9)
  {
    const { events, rootPinId } = compFixture({ author: SESSION_BOT });
    const parent = verifiedParentOnA(rootPinId);
    const { verbs, writes } = buildHarness([...events, ...parent.events]);
    const refused = refusalOf(await verbs.amend({
      rootPinId,
      ops: [
        { op: 'add_node', node: { id: 'c', parent: 'r', title: 'c', kind: 'proof', weight: 1000, deps: ['a'], params: { rubric: ['c rubric'] } } },
        { op: 'reweight', node: 'a', weight: 5000 },
      ],
    }));
    assert.match(refused, /may not depend on a/);
    assert.equal(writes.length, 0);
  }

  // add_node needs a rubric in competitive mode (the publish invariant, §3.3)
  {
    const { events, rootPinId } = compFixture({ author: SESSION_BOT });
    const { verbs, writes } = buildHarness(events);
    const refused = refusalOf(await verbs.amend({
      rootPinId,
      ops: [
        { op: 'add_node', node: { id: 'c', parent: 'r', title: 'c', kind: 'proof', weight: 1000, deps: ['r'] } },
        { op: 'reweight', node: 'a', weight: 5000 },
      ],
    }));
    assert.match(refused, /no rubric/);
    assert.equal(writes.length, 0);
  }

  // add_node ABOVE the finalnode is refused (v1.3 pins the sink at finalnode)
  {
    const { events, rootPinId } = compFixture({ author: SESSION_BOT });
    const { verbs, writes } = buildHarness(events);
    const refused = refusalOf(await verbs.amend({
      rootPinId,
      ops: [
        { op: 'add_node', node: { id: 'c', parent: 'r', title: 'c', kind: 'proof', weight: 1000, deps: ['r'], params: { rubric: ['c rubric'] } } },
        { op: 'reweight', node: 'a', weight: 5000 },
      ],
    }));
    assert.match(refused, /moves the deps sink off policy\.finalnode "r"/);
    assert.match(refused, /§9 Q1/);
    assert.equal(writes.length, 0);
  }

  // a middle-layer add_node (deps onto an unsatisfied non-final node; the sink
  // stays the finalnode) goes through (§3.9)
  {
    const { events, rootPinId, treePinId } = compFixture({ author: SESSION_BOT });
    const { verbs, writes } = buildHarness(events);
    const ok = await verbs.amend({
      rootPinId,
      ops: [
        { op: 'add_node', node: { id: 'c', parent: 'r', title: 'c', kind: 'proof', weight: 1000, deps: ['a'], params: { rubric: ['c rubric'] } } },
        { op: 'reweight', node: 'a', weight: 5000 },
      ],
    });
    assert.equal(ok.ok, true);
    const payload = JSON.parse(writes[0].metaidData.payload);
    assert.equal(payload.bases, treePinId);
    assert.deepEqual(payload.ops[0].node.deps, ['a']);
  }

  // remove_node of the finalnode is refused (the terminal node must stay a live sink)
  {
    const { events, rootPinId } = compFixture({ author: SESSION_BOT });
    const { verbs, writes } = buildHarness(events);
    const refused = refusalOf(await verbs.amend({
      rootPinId,
      ops: [
        { op: 'remove_node', node: 'r' },
        { op: 'reweight', node: 'a', weight: 10000 },
      ],
    }));
    assert.match(refused, /keep the designated terminal node "r" alive/);
    assert.equal(writes.length, 0);
  }
});
