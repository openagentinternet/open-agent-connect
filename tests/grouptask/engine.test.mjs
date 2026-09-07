import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRootSync } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { createGroupTaskEngine, GROUP_TASK_DRIVER_KV_PREFIX, GROUP_TASK_PLANNED_KV_PREFIX,
  GROUP_TASK_PLAN_ATTEMPTS_KV_PREFIX, GROUP_TASK_PLANNING_DEFERRED_KV_PREFIX }
  = require('../../dist/core/grouptask/engine.js');
const { openteamStoreFor } = require('../../dist/core/grouptask/service.js');
const { createGroupTaskStore } = require('../../dist/core/grouptask/store.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { decryptGroupContent } = require('../../dist/core/appSession/groupChat.js');

/** Group message pins carry AES ciphertext; decode for content assertions. */
function pinPlaintext(pin) {
  try {
    const payload = JSON.parse(pin.payload);
    return decryptGroupContent(String(payload.content ?? ''), String(payload.groupId ?? ''));
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Harness: offline ctx + scripted LLM + fake indexer with mutable history
// ---------------------------------------------------------------------------

function jsonResponse(body) {
  return { ok: true, json: async () => body };
}

function createHarness(prefix, options = {}) {
  const systemHome = mkdtempTempRootSync(prefix);
  const pins = [];
  let pinSeq = 0;

  const makeProfile = (slug, botType, gmid) => {
    const homeDir = path.join(systemHome, '.metabot', 'profiles', slug);
    mkdirSync(homeDir, { recursive: true });
    return {
      slug,
      homeDir,
      name: slug.replace(/-/gu, ' '),
      globalMetaId: gmid,
      metaId: `meta-${slug}`,
      botType,
      avatar: null,
    };
  };
  const profiles = [
    makeProfile('twin-bot', 'twin', 'IDTWIN'),
    makeProfile('worker-1', 'worker', 'IDWORKER1'),
  ];

  const makeSigner = (label) => ({
    async writePin(request) {
      pinSeq += 1;
      const pinId = `pin-${label}-${pinSeq}`;
      pins.push({ label, pinId, ...request });
      return { pinId, txId: `tx-${pinSeq}` };
    },
  });

  const history = [];
  const fetchImpl = async (input) => {
    const url = String(input);
    if (url.includes('/group-chat-list-by-index')) {
      const parsed = new URL(url);
      const start = Number(parsed.searchParams.get('startIndex'));
      const size = Number(parsed.searchParams.get('size'));
      const slice = history.filter((item) => item.index >= start).slice(0, size);
      return jsonResponse({ code: 0, data: { list: slice } });
    }
    if (url.includes('/group-info')) {
      return jsonResponse({ code: 0, data: { groupId: new URL(url).searchParams.get('groupId') } });
    }
    if (url.includes('/group-member-list')) {
      return jsonResponse({ code: 0, data: { list: [] } });
    }
    throw new Error(`Unexpected fake indexer URL: ${url}`);
  };

  const stores = new Map();
  const storeForProfile = (profile) => {
    let store = stores.get(profile.slug);
    if (!store) {
      store = createGroupTaskStore(resolveMetabotPaths(profile.homeDir));
      stores.set(profile.slug, store);
    }
    return store;
  };

  /** Scripted LLM: an array of { match?, reply } consumed per call. */
  const llmTurns = [];
  const llmCalls = [];
  const runLlmTurn = async (turn) => {
    llmCalls.push(turn);
    const script = llmTurns.shift();
    if (!script) throw new Error(`Unscripted LLM turn for ${turn.profile.slug}`);
    if (typeof script === 'function') return script(turn);
    return script;
  };

  const ctx = {
    listProfiles: async () => profiles,
    getProfile: async (slug) => profiles.find((profile) => profile.slug === slug) ?? null,
    signerForSlug: async (slug) => makeSigner(slug),
    ownerIdentity: async () => ({
      globalMetaId: 'IDOWNER', metaId: 'meta-owner', name: 'Owner', signer: makeSigner('owner'),
    }),
    storeForProfile,
    transport: { indexerHosts: ['https://fake-indexer.test'], fetchImpl },
  };

  const engine = createGroupTaskEngine({
    ctx,
    runLlmTurn,
    loadPersona: async () => ({}),
    workerCooldownMs: 0,
    chairCooldownMs: 0,
    // Existing tests exercise the bare-LLM responder (the fallback path);
    // Phase 3 work-request tests opt in explicitly.
    workerSessions: options.workerSessions === true,
    ...(options.engineNow ? { now: options.engineNow } : {}),
  });

  let historyIndex = 0;
  const pushHistory = (gmid, content, opts = {}) => {
    const index = historyIndex;
    historyIndex += 1;
    history.push({
      index,
      txId: `tx-h${index}`,
      pinId: `hpin-${index}`,
      groupId: opts.groupId ?? 'grp-engine',
      globalMetaId: gmid,
      metaId: `meta-h${index}`,
      content,
      contentType: 'text/plain',
      encryption: '0',
      timestamp: Math.floor(Date.now() / 1000) - 600 + index,
      userInfo: { name: gmid.toLowerCase() },
      ...(opts.mention ? { mention: opts.mention } : {}),
    });
    return index;
  };

  const chairStore = storeForProfile(profiles[0]);
  const seedTask = async (status = 'planning', opts = {}) => {
    const task = await chairStore.createTask({
      groupId: 'grp-engine',
      title: 'Engine test task',
      goal: 'Ship the engine',
      acceptanceCriteria: 'All tests pass',
      chairSlug: 'twin-bot',
      chairGlobalMetaId: 'IDTWIN',
      createdBy: 'user',
      ...(opts.sourceSessionId ? { sourceSessionId: opts.sourceSessionId } : {}),
    });
    await chairStore.addMember({ taskId: task.id, slug: 'twin-bot', globalMetaId: 'IDTWIN', role: 'chair' });
    await chairStore.addMember({ taskId: task.id, slug: 'worker-1', globalMetaId: 'IDWORKER1', role: 'worker' });
    if (status !== 'planning') {
      await chairStore.updateTaskStatus(task.id, status);
      // Skip the one-shot planning turn for tasks seeded past planning.
      await chairStore.kvSet(`${GROUP_TASK_PLANNED_KV_PREFIX}${task.id}`, '1');
    }
    return (await chairStore.getTaskById(task.id));
  };

  return { ctx, engine, pins, llmTurns, llmCalls, pushHistory, chairStore, seedTask, profiles };
}

// ---------------------------------------------------------------------------
// Planning + dispatch round trip
// ---------------------------------------------------------------------------

test('engine: planning turn posts the chair plan once; round-trip [STATUS:EXECUTING] transitions; mentioned worker replies', async () => {
  const h = createHarness('metabot-gt-engine-plan-');
  const task = await h.seedTask('planning');
  h.pushHistory('IDTWIN', '[GROUP TASK] Engine test task');

  const planText = '@worker 1 please ship it\n[STATUS:EXECUTING]';
  h.llmTurns.push(planText);
  await h.engine.tick();

  const planPins = h.pins.filter((pin) => pin.label === 'twin-bot');
  assert.equal(planPins.length, 1, 'chair posted exactly one plan message');
  assert.ok(String(planPins[0].payload ?? planPins[0].content ?? JSON.stringify(planPins[0])).length > 0);
  assert.ok(await h.chairStore.kvGet(`${GROUP_TASK_PLANNED_KV_PREFIX}${task.id}`), 'planned kv guard set');
  assert.equal((await h.chairStore.getTaskById(task.id)).status, 'planning', 'transition waits for round-trip');
  assert.equal(h.llmCalls[0].role, 'chair');
  assert.ok(h.llmCalls[0].prompt.includes('[SYSTEM planning directive'), 'planning directive prompt used');

  // No second planning turn on the next tick.
  await h.engine.tick();
  assert.equal(h.pins.filter((pin) => pin.label === 'twin-bot').length, 1);

  // Round-trip: the plan lands on chain, mentioning the worker.
  h.pushHistory('IDTWIN', planText, { mention: ['IDWORKER1'] });
  h.llmTurns.push('[WORKING] on it, 10 min');
  await h.engine.tick();

  const updated = await h.chairStore.getTaskById(task.id);
  assert.equal(updated.status, 'executing', 'chair [STATUS:EXECUTING] applied on round-trip');
  const workerPins = h.pins.filter((pin) => pin.label === 'worker-1');
  assert.equal(workerPins.length, 1, 'mentioned worker replied');
  assert.equal(updated.lastProcessedIndex, 1, 'cursor advanced');

  // Worker reply round-trips with [WORKING]: member status flips to working.
  // The ceremony-ack gate: a bare [WORKING] progress note pulls NO chair
  // floor-control turn (no LLM call at all).
  h.pushHistory('IDWORKER1', '[WORKING] on it, 10 min');
  const callsBefore = h.llmCalls.length;
  await h.engine.tick();
  const members = await h.chairStore.listMembers(task.id);
  assert.equal(members.find((m) => m.slug === 'worker-1').status, 'working');
  assert.equal(h.llmCalls.length, callsBefore, 'a ceremony ACK pulls no chair turn');
});

// ---------------------------------------------------------------------------
// Deliverables + review ceremony
// ---------------------------------------------------------------------------

test('engine: worker [DELIVERABLE] records rows and pulls a chair verification turn; [NO_REPLY] suppresses the send', async () => {
  const h = createHarness('metabot-gt-engine-deliver-');
  const task = await h.seedTask('executing');
  h.pushHistory('IDWORKER1', '[DELIVERABLE] https://example.com/report done');

  h.llmTurns.push('[NO_REPLY]');
  await h.engine.tick();

  const deliverables = await h.chairStore.listDeliverables(task.id);
  assert.equal(deliverables.length, 1);
  assert.equal(deliverables[0].kind, 'link');
  assert.equal(deliverables[0].uri, 'https://example.com/report');
  assert.equal(h.llmCalls.length, 1, 'chair verification turn ran');
  assert.equal(h.llmCalls[0].role, 'chair');
  assert.equal(h.pins.length, 0, '[NO_REPLY] suppressed the on-chain send');
  assert.equal((await h.chairStore.getTaskById(task.id)).lastProcessedIndex, 0, 'cursor advanced');

  // Re-syncing the same message must not duplicate the deliverable.
  h.pushHistory('IDOWNER', 'nice');
  h.llmTurns.push('[NO_REPLY]');
  await h.engine.tick();
  assert.equal((await h.chairStore.listDeliverables(task.id)).length, 1);
});

test('engine: chair [STATUS:REVIEW] closes checkpoints and persists the acceptance summary (no host post)', async () => {
  const h = createHarness('metabot-gt-engine-review-');
  const task = await h.seedTask('executing');
  await h.chairStore.addDeliverable({
    taskId: task.id, msgPinId: 'pin-x', authorGlobalMetaId: 'IDWORKER1', kind: 'link', uri: 'https://example.com/r',
  });
  h.pushHistory('IDTWIN', 'All acceptance criteria met. [STATUS:REVIEW]');

  await h.engine.tick();

  const updated = await h.chairStore.getTaskById(task.id);
  assert.equal(updated.status, 'review');
  const summary = await h.chairStore.getLatestAcceptanceSummary(task.id);
  assert.ok(summary, 'acceptance summary persisted');
  assert.equal(summary.deliverables.length, 1);
  assert.ok(summary.conclusion.includes('All acceptance criteria met'));
  // Single-commander: review entry posts NOTHING into the group — the chair's
  // own [STATUS:REVIEW] message is the wrap-up; the owner hears privately.
  assert.equal(h.pins.length, 0, 'no host review summary post (single-commander)');
  assert.equal(h.llmCalls.length, 0, 'no LLM turn needed for the host ceremony');

  // Workers stay silent in review, even when mentioned.
  h.pushHistory('IDOWNER', 'worker please continue', { mention: ['IDWORKER1'] });
  h.llmTurns.push('ok — closing out');
  await h.engine.tick();
  assert.equal(h.pins.filter((pin) => pin.label === 'worker-1').length, 0, 'worker gated');
  assert.equal(h.pins.filter((pin) => pin.label === 'twin-bot').length >= 1, true, 'chair answered the owner');
});

// ---------------------------------------------------------------------------
// Checkpoints
// ---------------------------------------------------------------------------

test('engine: checkpoint open/resolve lifecycle gates the room (no host posts)', async () => {
  const h = createHarness('metabot-gt-engine-ckpt-');
  const task = await h.seedTask('executing');

  h.pushHistory('IDTWIN', 'Owner decision needed. [CHECKPOINT: budget approval]');
  await h.engine.tick();

  let checkpoints = await h.chairStore.listCheckpoints(task.id);
  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0].status, 'open');
  assert.equal(checkpoints[0].topic, 'budget approval');
  // Single-commander: the host posts NO pause line — the chair's [CHECKPOINT]
  // message itself is the group-facing signal; the owner hears privately.
  assert.equal(h.pins.length, 0, 'no host checkpoint post');

  // Worker mentioned while the checkpoint is open: silent.
  h.pushHistory('IDOWNER', 'worker do more', { mention: ['IDWORKER1'] });
  h.llmTurns.push('chair ack to owner');
  await h.engine.tick();
  assert.equal(h.pins.filter((pin) => pin.label === 'worker-1').length, 0);

  // Chair resolves; work resumes — again no host post.
  h.pushHistory('IDTWIN', '[CHECKPOINT_RESOLVED: owner approved plan B]');
  await h.engine.tick();
  checkpoints = await h.chairStore.listCheckpoints(task.id);
  assert.equal(checkpoints[0].status, 'resolved');
  assert.equal(checkpoints[0].resolution, 'owner approved plan B');
  assert.equal(h.pins.filter((pin) => pinPlaintext(pin).includes('GROUP_TASK_NOTICE')).length, 0,
    'the host never posted a notice');
});

// ---------------------------------------------------------------------------
// Attribution, mutex, poison messages
// ---------------------------------------------------------------------------

test('engine: suspect senders get no side effects and no replies', async () => {
  const h = createHarness('metabot-gt-engine-suspect-');
  const task = await h.seedTask('executing');
  h.pushHistory('IDSTRANGER', '[DELIVERABLE] https://example.com/spam [STATUS:REVIEW]');

  await h.engine.tick();

  assert.equal((await h.chairStore.listDeliverables(task.id)).length, 0);
  assert.equal((await h.chairStore.getTaskById(task.id)).status, 'executing');
  assert.equal(h.llmCalls.length, 0);
  assert.equal(h.pins.length, 0);
  assert.equal((await h.chairStore.getTaskById(task.id)).lastProcessedIndex, 0, 'cursor still advances');
});

test('engine: fresh foreign driver claim yields the whole task tick', async () => {
  const h = createHarness('metabot-gt-engine-mutex-');
  const task = await h.seedTask('executing');
  h.pushHistory('IDOWNER', 'hello team');
  await h.chairStore.kvSet(`${GROUP_TASK_DRIVER_KV_PREFIX}${task.id}`, `other-instance|${Date.now()}`);

  await h.engine.tick();
  assert.equal(h.llmCalls.length, 0);
  assert.equal((await h.chairStore.getTaskById(task.id)).lastProcessedIndex, -1, 'nothing processed');

  // Stale claim: engine takes over.
  await h.chairStore.kvSet(`${GROUP_TASK_DRIVER_KV_PREFIX}${task.id}`, `other-instance|${Date.now() - 60_000}`);
  h.llmTurns.push('welcome, owner');
  await h.engine.tick();
  assert.equal((await h.chairStore.getTaskById(task.id)).lastProcessedIndex, 0);
});

test('engine: a poison message advances the cursor after five failures', async () => {
  const h = createHarness('metabot-gt-engine-poison-');
  const task = await h.seedTask('executing');
  h.pushHistory('IDOWNER', 'this turn always crashes');

  for (let attempt = 0; attempt < 5; attempt += 1) {
    h.llmTurns.push(() => { throw new Error('llm down'); });
    await h.engine.tick();
  }
  const updated = await h.chairStore.getTaskById(task.id);
  assert.equal(updated.lastProcessedIndex, 0, 'cursor moved past the poison message');

  // Later messages flow normally again.
  h.pushHistory('IDOWNER', 'are we good?');
  h.llmTurns.push('all good, owner');
  await h.engine.tick();
  assert.equal((await h.chairStore.getTaskById(task.id)).lastProcessedIndex, 1);
  assert.equal(h.pins.filter((pin) => pin.label === 'twin-bot').length, 1);
});

test('engine: [DEPENDS_ON] is declarative under single-commander — the worker turn runs immediately', async () => {
  const h = createHarness('metabot-gt-engine-depends-');
  const task = await h.seedTask('executing');
  const upstreamPin = 'a'.repeat(64) + 'i0';

  // The dispatch names an upstream pin that has NOT landed: the host does NOT
  // hold or re-order the dispatch — sequencing is the chair's judgment (the
  // marker only keeps timeout flags off a legitimately-waiting member).
  h.pushHistory('IDTWIN', `@worker 1 build the poster [DEPENDS_ON:${upstreamPin}]`, { mention: ['IDWORKER1'] });
  h.llmTurns.push('waiting on the upstream asset — will start when it lands');
  await h.engine.tick();
  assert.equal(h.pins.filter((pin) => pin.label === 'worker-1').length, 1, 'worker answered immediately');
  assert.equal((await h.chairStore.getTaskById(task.id)).lastProcessedIndex, 0, 'cursor advanced');
});

test('engine: stale pending ACK records exactly one no_ack host note; the chair speaks in its own voice', async () => {
  const h = createHarness('metabot-gt-engine-ack-');
  const task = await h.seedTask('executing');
  // Worker took work (working status) but the assignment ACK went stale.
  await h.chairStore.setMemberStatus(task.id, 'worker-1', 'working', 'IDWORKER1');
  const pendingKey = `group_task_ack_pending:${task.id}:worker-1`;
  await h.chairStore.kvSet(pendingKey, JSON.stringify({ assignedAt: Date.now() - 4 * 60_000, msgIndex: 0 }));

  // The host-notes turn fires in the same tick: the chair decides what to say.
  h.llmTurns.push('@worker 1 still with me? Please ACK the assignment.');
  await h.engine.tick();

  assert.equal(h.pins.filter((pin) => pinPlaintext(pin).includes('ack_reminder')).length, 0,
    'no ack_reminder host notice (single-commander)');
  const notes = await h.chairStore.listHostNotes(task.id);
  assert.equal(notes.length, 1, 'exactly one no_ack host note');
  assert.equal(notes[0].kind, 'no_ack');
  assert.equal(notes[0].target, 'worker-1');
  assert.ok(notes[0].consumedAt != null, 'note consumed by the chair turn');
  assert.ok(notes[0].chairResponsePinId != null, 'consumption carries the chair reply pin');
  const chairPins = h.pins.filter((pin) => pin.label === 'twin-bot');
  assert.equal(chairPins.length, 1, 'chair spoke once in its own voice');
  assert.ok(h.llmCalls[0].prompt.includes('[SYSTEM host environment notes'), 'host-notes directive used');
  assert.ok(h.llmCalls[0].prompt.includes('no_ack'), 'note kind surfaced to the chair');

  // A second tick records no duplicate note and wakes no second turn.
  await h.engine.tick();
  assert.equal((await h.chairStore.listHostNotes(task.id)).length, 1);
  assert.equal(h.llmCalls.length, 1);

  // A roll-call mention never arms the watch (P5 exemption).
  h.pushHistory('IDTWIN', '@worker 1 请确认在线', { mention: ['IDWORKER1'] });
  await h.engine.tick();
  const rollPending = await h.chairStore.kvGet(`group_task_ack_pending:${task.id}:worker-1`);
  assert.ok(!String(rollPending ?? '').includes('请确认在线'));
});

test('engine: local-file deliverables upgrade to metafile URIs through the upload seam', async () => {
  const h = createHarness('metabot-gt-engine-upload-');
  const uploads = [];
  h.engineOptions = h.engineOptions || {};
  const task = await h.seedTask('executing');
  // Recreate the engine with the upload seam is awkward post-hoc; instead
  // exercise the seam through a fresh engine instance sharing the store.
  const { createGroupTaskEngine } = require('../../dist/core/grouptask/engine.js');
  const engine = createGroupTaskEngine({
    ctx: h.ctx,
    runLlmTurn: async () => '',
    loadPersona: async () => ({}),
    uploadDeliverableFile: async ({ slug, filePath }) => {
      uploads.push({ slug, filePath });
      return { metafileUri: `metafile://up-${uploads.length}.png`, pinId: `up-${uploads.length}` };
    },
  });
  h.pushHistory('IDWORKER1', '[DELIVERABLE] file: /tmp/poster-draft.png');
  await engine.tick();
  assert.equal(uploads.length, 1, 'local path went through the upload seam');
  assert.equal(uploads[0].filePath, '/tmp/poster-draft.png');
  assert.equal(uploads[0].slug, 'worker-1');
  const rows = await h.chairStore.listDeliverables(task.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].uri, 'metafile://up-1.png');
  assert.equal(rows[0].kind, 'metafile');
});

test('engine: an on-chain pin deliverable is recorded WITHOUT touching the upload seam', async () => {
  const h = createHarness('metabot-gt-engine-pinuri-');
  const uploads = [];
  const task = await h.seedTask('executing');
  const { createGroupTaskEngine } = require('../../dist/core/grouptask/engine.js');
  const engine = createGroupTaskEngine({
    ctx: h.ctx,
    runLlmTurn: async () => '',
    loadPersona: async () => ({}),
    uploadDeliverableFile: async ({ slug, filePath }) => {
      uploads.push({ slug, filePath });
      return { metafileUri: 'metafile://never', pinId: 'never' };
    },
  });
  // Task-67 regression: "pin://<id>" stripped to "//<id>" used to fake an
  // absolute local path and hit the workspace upload gate.
  const pinId = `${'a'.repeat(64)}i0`;
  h.pushHistory('IDWORKER1', `[DELIVERABLE] pin://${pinId} 《脚本》已上链`);
  await engine.tick();
  assert.equal(uploads.length, 0, 'pin:// deliverable never enters the upload seam');
  const rows = await h.chairStore.listDeliverables(task.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'pin');
  assert.ok(rows[0].uri?.includes(pinId), 'row keeps the pin uri');
});

test('engine: a plan that never mentions a seated worker raises a plan_coverage host note', async () => {
  const h = createHarness('metabot-gt-engine-coverage-');
  const task = await h.seedTask('planning');
  await h.chairStore.addMember({ taskId: task.id, slug: 'worker-2', globalMetaId: 'IDWORKER2', role: 'worker' });
  h.pushHistory('IDTWIN', '[GROUP TASK] Engine test task');
  // The chair plan assigns ONLY worker 1 — worker-2 is never named.
  h.llmTurns.push('@worker 1 does everything\n[STATUS:EXECUTING]');
  await h.engine.tick();
  const coverage = (await h.chairStore.listHostNotes(task.id))
    .filter((note) => note.kind === 'plan_coverage');
  assert.equal(coverage.length, 1, 'uncovered worker raised exactly one plan_coverage note');
  assert.match(coverage[0].body, /worker-2/, 'the missing worker is named');
  assert.ok(!coverage[0].body.includes('worker 1'), 'the covered worker is not flagged');
  assert.equal(coverage[0].consumedAt, null, 'note pending for the chair');
});

test('engine: a plan covering every seated worker raises no plan_coverage note', async () => {
  const h = createHarness('metabot-gt-engine-coverage-ok-');
  const task = await h.seedTask('planning');
  await h.chairStore.addMember({ taskId: task.id, slug: 'worker-2', globalMetaId: 'IDWORKER2', role: 'worker' });
  h.pushHistory('IDTWIN', '[GROUP TASK] Engine test task');
  h.llmTurns.push('@worker 1 ships content; @worker-2 you are [STANDBY] for design\n[STATUS:EXECUTING]');
  await h.engine.tick();
  const coverage = (await h.chairStore.listHostNotes(task.id))
    .filter((note) => note.kind === 'plan_coverage');
  assert.equal(coverage.length, 0, 'full coverage records nothing');
});


// ---------------------------------------------------------------------------
// Roster-settle gate + OpenTeam join wake (live DSH round-trip 2026-09-05)
// ---------------------------------------------------------------------------

test('engine: planning defers while an OpenTeam invite is pending and runs once it resolves', async () => {
  const h = createHarness('metabot-gt-engine-settle-');
  const task = await h.seedTask('planning');
  h.pushHistory('IDTWIN', '[GROUP TASK] Engine test task');

  const openteam = openteamStoreFor(h.ctx, h.profiles[0]);
  await openteam.createInvite({
    taskId: task.id,
    groupId: task.groupId,
    inviteId: 'inv-settle-1',
    inviteeGlobalMetaId: 'IDREMOTE1',
    inviteeName: 'Remote Designer',
    requiredSkills: ['design'],
    sentPinId: 'pin-invite-1',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  });

  await h.engine.tick();
  assert.equal(h.pins.length, 0, 'no planning post while an invite is pending');
  assert.equal(h.llmCalls.length, 0, 'no planning LLM turn while an invite is pending');
  assert.ok(!(await h.chairStore.kvGet(`${GROUP_TASK_PLANNED_KV_PREFIX}${task.id}`)));
  assert.ok(await h.chairStore.kvGet(`${GROUP_TASK_PLANNING_DEFERRED_KV_PREFIX}${task.id}`),
    'deferral logged once');

  await openteam.updateInvite('inv-settle-1', { status: 'accepted', respondedAt: Date.now() });
  h.llmTurns.push('@worker 1 ship it\n[STATUS:EXECUTING]');
  await h.engine.tick();
  assert.equal(h.pins.filter((pin) => pin.label === 'twin-bot').length, 1,
    'planning ran after the roster settled');
  assert.ok(await h.chairStore.kvGet(`${GROUP_TASK_PLANNED_KV_PREFIX}${task.id}`));
});

test('engine: the roster-settle cap forces planning even with a pending invite', async () => {
  const h = createHarness('metabot-gt-engine-settle-cap-', {
    engineNow: () => Date.now() + 11 * 60_000,
  });
  const task = await h.seedTask('planning');
  h.pushHistory('IDTWIN', '[GROUP TASK] Engine test task');

  const openteam = openteamStoreFor(h.ctx, h.profiles[0]);
  await openteam.createInvite({
    taskId: task.id,
    groupId: task.groupId,
    inviteId: 'inv-settle-cap',
    inviteeGlobalMetaId: 'IDREMOTE1',
    inviteeName: 'Slow Responder',
    requiredSkills: [],
    sentPinId: null,
    expiresAt: Math.floor((Date.now() + 11 * 60_000) / 1000) + 3600,
  });

  h.llmTurns.push('@worker 1 ship it\n[STATUS:EXECUTING]');
  await h.engine.tick();
  assert.equal(h.pins.filter((pin) => pin.label === 'twin-bot').length, 1,
    'cap passed: planning ran despite the pending invite');
});

test('engine: a remote join rides a join host note; the chair greets once (no host broadcast)', async () => {
  const h = createHarness('metabot-gt-engine-join-');
  const task = await h.seedTask('executing');

  // What maintainInviterInvites records on a confirmed remote join.
  await h.chairStore.addMember({
    taskId: task.id, slug: null, globalMetaId: 'IDREMOTE1', role: 'worker', displayName: 'Remote Designer',
  });
  await h.chairStore.recordHostNote({
    taskId: task.id,
    kind: 'join',
    target: 'Remote Designer',
    body: 'Remote Designer just joined the task as a remote OpenTeam teammate. Invited for: design. '
      + 'Greet them in the group and fold them into the plan (or state why the current plan already covers '
      + 'their seat) — never leave a joiner unacknowledged.',
    dedupeKey: `join:${task.id}:idremote1`,
  });

  h.llmTurns.push('Welcome @Remote Designer — please take the cover visual');
  await h.engine.tick();

  assert.equal(h.pins.filter((pin) => pinPlaintext(pin).includes('GROUP_TASK_NOTICE')).length, 0,
    'no host notice posted (single-commander)');
  const chairPins = h.pins.filter((pin) => pin.label === 'twin-bot');
  assert.equal(chairPins.length, 1, 'the chair greeted the joiner itself, once');
  assert.ok(h.llmCalls[0].prompt.includes('[SYSTEM host environment notes'), 'host-notes directive used');
  assert.ok(h.llmCalls[0].prompt.includes('Remote Designer'), 'join fact surfaced');
  assert.ok(h.llmCalls[0].prompt.includes('design'), 'invited-for skills surfaced');
  const notes = await h.chairStore.listHostNotes(task.id);
  assert.ok(notes[0].consumedAt != null, 'join note consumed');

  // The consumed note never wakes the chair again.
  await h.engine.tick();
  assert.equal(h.llmCalls.length, 1, 'no duplicate wake');

  // A HISTORICAL pre-upgrade openteam_joined notice stays inert: no wake.
  h.pushHistory('IDTWIN',
    '[GROUP_TASK_NOTICE:openteam_joined] Remote Designer joined this task as a remote OpenTeam member (skills: design).');
  await h.engine.tick();
  assert.equal(h.llmCalls.length, 1, 'historical notice triggers no wake');
  assert.equal(h.pins.filter((pin) => pin.label === 'twin-bot').length, 1, 'no reply to the historical notice');
});

test('engine: planning with a clean roster is never deferred (no invites, no wait)', async () => {
  const h = createHarness('metabot-gt-engine-settle-none-');
  const task = await h.seedTask('planning');
  h.pushHistory('IDTWIN', '[GROUP TASK] Engine test task');
  h.llmTurns.push('@worker 1 ship it\n[STATUS:EXECUTING]');
  await h.engine.tick();
  assert.equal(h.pins.filter((pin) => pin.label === 'twin-bot').length, 1,
    'local-only planning ran on the first tick');
  assert.ok(!(await h.chairStore.kvGet(`${GROUP_TASK_PLANNING_DEFERRED_KV_PREFIX}${task.id}`)));
});

// ---------------------------------------------------------------------------
// Owner supervision: dispatch pause + supervisor wakes (Phase 2)
// ---------------------------------------------------------------------------

test('engine: a dispatch pause silences mentioned workers but the owner still reaches the chair', async () => {
  const h = createHarness('metabot-gt-engine-pause-');
  const task = await h.seedTask('executing');
  await h.chairStore.setTaskDispatchPaused(task.id, Date.now());

  h.pushHistory('IDTWIN', '@worker 1 please continue', { mention: ['IDWORKER1'] });
  await h.engine.tick();
  assert.equal(h.pins.filter((pin) => pin.label === 'worker-1').length, 0, 'worker gated by the pause');
  assert.equal(h.llmCalls.length, 0, 'no turn for the silenced worker');

  h.pushHistory('IDOWNER', 'keep going but hold the publish step');
  h.llmTurns.push('understood — holding the publish step\n[STATUS:EXECUTING]');
  await h.engine.tick();
  assert.equal(h.pins.filter((pin) => pin.label === 'twin-bot').length, 1, 'chair answered the owner while paused');
});

test('engine: resume queues a supervisor wake and the chair re-engages the roster', async () => {
  const h = createHarness('metabot-gt-engine-resume-');
  const task = await h.seedTask('executing');
  // What superviseGroupTask(resume) leaves behind: pause cleared + request kv.
  await h.chairStore.setTaskDispatchPaused(task.id, Date.now());
  await h.chairStore.setTaskDispatchPaused(task.id, null);
  await h.chairStore.kvSet(`group_task_nudge_request:${task.id}`,
    JSON.stringify({ kind: 'resume', at: Date.now(), attempts: 0 }));

  h.llmTurns.push('work resumes — @worker 1 please continue with the visual pass\n[STATUS:EXECUTING]');
  await h.engine.tick();

  const chairPins = h.pins.filter((pin) => pin.label === 'twin-bot');
  assert.equal(chairPins.length, 1, 'resume wake produced one chair message');
  assert.equal(h.llmCalls.length, 1);
  assert.ok(h.llmCalls[0].prompt.includes('[SYSTEM supervisor directive'), 'wake directive used');
  assert.ok(h.llmCalls[0].prompt.includes('RESUMED'), 'resume variant used');
  assert.ok(!(await h.chairStore.kvGet(`group_task_nudge_request:${task.id}`)), 'request kv consumed');
});

test('engine: a nudge request drives the chair to ping the silent member', async () => {
  const h = createHarness('metabot-gt-engine-nudge-');
  const task = await h.seedTask('executing');
  await h.chairStore.kvSet(`group_task_nudge_request:${task.id}`,
    JSON.stringify({ kind: 'nudge', memberSlug: 'worker-1', name: 'worker 1', note: 'still no ACK', at: Date.now(), attempts: 0 }));

  h.llmTurns.push('@worker 1 status check — please ACK your assignment\n[STATUS:EXECUTING]');
  await h.engine.tick();

  const chairPins = h.pins.filter((pin) => pin.label === 'twin-bot');
  assert.equal(chairPins.length, 1, 'nudge produced one chair message');
  assert.ok(h.llmCalls[0].prompt.includes('worker 1'), 'nudge target surfaced to the chair');
  assert.ok(h.llmCalls[0].prompt.includes('still no ACK'), 'owner note surfaced to the chair');
});

test('engine: dispatch and review milestones emit relay rows for the source session', async () => {
  const { createGroupTaskRelayStore } = require('../../dist/core/grouptask/relayStore.js');
  const h = createHarness('metabot-gt-engine-relay-');
  const task = await h.seedTask('planning', { sourceSessionId: 'sess-origin-1' });
  h.pushHistory('IDTWIN', '[GROUP TASK] Engine test task');

  h.llmTurns.push('@worker 1 ship it\n[STATUS:EXECUTING]');
  await h.engine.tick();
  // Round-trip applies [STATUS:EXECUTING] → dispatch relay row.
  h.pushHistory('IDTWIN', '@worker 1 ship it\n[STATUS:EXECUTING]', { mention: ['IDWORKER1'] });
  h.llmTurns.push('[WORKING] on it');
  await h.engine.tick();
  const relayStore = createGroupTaskRelayStore(resolveMetabotPaths(h.profiles[0].homeDir));
  let pending = await relayStore.listPending();
  assert.deepEqual(pending.map((row) => row.kind), ['dispatch'], 'dispatch row emitted once');
  assert.equal(pending[0].sessionId, 'sess-origin-1');
  // Stamped origin notice (IDBots EP33 P3①): the event time rides the text.
  assert.ok(/\(event at \d{4}-\d{2}-\d{2} \d{2}:\d{2} local\)$/u.test(pending[0].text),
    'relay text carries the event-at stamp');

  // Review entry emits the review row.
  h.pushHistory('IDTWIN', 'All criteria met.\n[STATUS:REVIEW]');
  await h.engine.tick();
  pending = await relayStore.listPending();
  assert.deepEqual(pending.map((row) => row.kind), ['dispatch', 'review'], 'review row appended');

  // A task without a source session never emits.
  const plain = await h.chairStore.createTask({
    groupId: 'grp-engine-2', title: 'No origin', goal: 'g', chairSlug: 'twin-bot', createdBy: 'user',
  });
  await h.chairStore.addMember({ taskId: plain.id, slug: 'twin-bot', globalMetaId: 'IDTWIN', role: 'chair' });
  await h.chairStore.updateTaskStatus(plain.id, 'executing');
  await h.chairStore.kvSet(`${GROUP_TASK_PLANNED_KV_PREFIX}${plain.id}`, '1');
  h.pushHistory('IDTWIN', 'done\n[STATUS:REVIEW]', { groupId: 'grp-engine-2' });
  await h.engine.tick();
  pending = await relayStore.listPending();
  assert.equal(pending.filter((row) => row.taskId === plain.id).length, 0, 'no rows without a source session');
});

// ---------------------------------------------------------------------------
// Phase 3: worker work requests (DSH sub-session handoff)
// ---------------------------------------------------------------------------

test('engine: a worker turn becomes a work request and defers until the host completes it', async () => {
  const h = createHarness('metabot-gt-engine-work-', { workerSessions: true });
  const task = await h.seedTask('executing');
  h.pushHistory('IDTWIN', '@worker 1 please draft the copy', { mention: ['IDWORKER1'] });

  await h.engine.tick();
  let requests = await h.chairStore.listWorkRequests({ status: 'pending' });
  assert.equal(requests.length, 1, 'one work request created');
  assert.equal(requests[0].workerSlug, 'worker-1');
  assert.equal(requests[0].targetIndex, 0);
  assert.equal(h.pins.length, 0, 'engine did not reply on its own');
  assert.equal((await h.chairStore.getTaskById(task.id)).lastProcessedIndex, -1, 'cursor deferred');

  // The host claims it: still deferred, no duplicate request.
  await h.chairStore.updateWorkRequest(requests[0].id, { status: 'claimed' });
  await h.engine.tick();
  requests = await h.chairStore.listWorkRequests({ status: 'pending' });
  assert.equal(requests.length, 0);
  assert.equal(h.chairStore.listWorkRequests.length > 0, true);
  const all = await h.chairStore.listWorkRequests();
  assert.equal(all.length, 1, 'no duplicate request while claimed');
  assert.equal(h.llmCalls.length, 0, 'no bare-LLM turn while the session owns the work');
  assert.equal((await h.chairStore.getTaskById(task.id)).lastProcessedIndex, -1);

  // The host submits: its on-chain reply round-trips; the cursor advances
  // past the target without a second engine reply. The round-tripped
  // [WORKING] line is a ceremony ACK — it pulls NO chair turn at all.
  await h.chairStore.updateWorkRequest(requests[0] ? all[0].id : all[0].id, { status: 'completed', handoff: '[WORKING] copy drafted' });
  h.pushHistory('IDWORKER1', '[WORKING] copy drafted, delivering next');
  await h.engine.tick();
  const workerTurns = h.llmCalls.filter((call) => call.role === 'worker');
  assert.equal(workerTurns.length, 0, 'no engine worker reply for a host-completed turn');
  assert.equal(h.llmCalls.length, 0, 'a ceremony ACK pulls no chair floor-control turn');
  assert.equal((await h.chairStore.getTaskById(task.id)).lastProcessedIndex, 1, 'cursor advanced past the target');
  const members = await h.chairStore.listMembers(task.id);
  assert.equal(members.find((member) => member.slug === 'worker-1').status, 'working', 'host reply processed');
});

test('engine: an unclaimed work request expires (TTL) and the bare-LLM fallback replies', async () => {
  const h = createHarness('metabot-gt-engine-work-ttl-', {
    engineNow: () => Date.now() + 9 * 60_000,
    workerSessions: true,
  });
  const task = await h.seedTask('executing');
  h.pushHistory('IDTWIN', '@worker 1 please draft the copy', { mention: ['IDWORKER1'] });

  // First tick creates the request whose createdAt is already past the TTL.
  await h.engine.tick();
  const requests = await h.chairStore.listWorkRequests();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].status, 'pending');

  // Second tick expires it and falls back to the bare-LLM turn.
  h.llmTurns.push('@worker 1 on it\n[WORKING] drafting');
  await h.engine.tick();
  const expired = await h.chairStore.listWorkRequests();
  assert.equal(expired[0].status, 'expired');
  assert.equal(h.pins.filter((pin) => pin.label === 'worker-1').length, 1, 'fallback reply posted');
  assert.equal((await h.chairStore.getTaskById(task.id)).lastProcessedIndex, 0, 'cursor advanced');
});

test('engine: a failed work request falls back to the bare-LLM turn', async () => {
  const h = createHarness('metabot-gt-engine-work-fail-', { workerSessions: true });
  const task = await h.seedTask('executing');
  h.pushHistory('IDTWIN', '@worker 1 please draft the copy', { mention: ['IDWORKER1'] });
  await h.engine.tick();
  const request = (await h.chairStore.listWorkRequests())[0];
  await h.chairStore.updateWorkRequest(request.id, { status: 'failed', error: 'WORKER_EMPTY_HANDOFF: no handoff text' });

  h.llmTurns.push('[WORKING] taking over the draft');
  await h.engine.tick();
  assert.equal(h.pins.filter((pin) => pin.label === 'worker-1').length, 1, 'fallback reply posted');
  assert.equal((await h.chairStore.getTaskById(task.id)).lastProcessedIndex, 0);
});

// ---------------------------------------------------------------------------
// Single-commander contract: host notes, deadlines, chain health, dedupe
// ---------------------------------------------------------------------------

test('engine: the chair consumes host notes silently with [NO_REPLY]', async () => {
  const h = createHarness('metabot-gt-engine-notes-quiet-');
  const task = await h.seedTask('executing');
  await h.chairStore.recordHostNote({
    taskId: task.id,
    kind: 'long_turn',
    target: 'worker-1',
    body: "worker-1's [WORKING] signal has been silent for 25 min.",
    dedupeKey: `long_turn:${task.id}:worker-1:test`,
  });

  h.llmTurns.push('[NO_REPLY]');
  await h.engine.tick();

  assert.equal(h.pins.length, 0, 'nothing posted — silence is a valid answer');
  const notes = await h.chairStore.listHostNotes(task.id);
  assert.equal(notes.length, 1);
  assert.ok(notes[0].consumedAt != null, 'consumed silently');
  assert.equal(notes[0].chairResponsePinId, null);
});

test('engine: host notes are dropped with an alert relay after 3 failed chair turns', async () => {
  const { createGroupTaskRelayStore } = require('../../dist/core/grouptask/relayStore.js');
  const h = createHarness('metabot-gt-engine-notes-drop-');
  const task = await h.seedTask('executing', { sourceSessionId: 'sess-alerts' });
  await h.chairStore.recordHostNote({
    taskId: task.id, kind: 'no_ack', target: 'worker-1', body: 'no ACK for 5 min',
    dedupeKey: `no_ack:${task.id}:worker-1:test`,
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    h.llmTurns.push(() => { throw new Error('llm down'); });
    await h.engine.tick();
  }
  assert.equal((await h.chairStore.listHostNotes(task.id))[0].consumedAt, null, 'still pending through retries');

  await h.engine.tick(); // 4th tick: the attempt budget is exhausted → drop + alert
  const notes = await h.chairStore.listHostNotes(task.id);
  assert.ok(notes[0].consumedAt != null, 'dropped (consumed) after the attempt budget');
  const relayStore = createGroupTaskRelayStore(resolveMetabotPaths(h.profiles[0].homeDir));
  const pending = await relayStore.listPending();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].kind, 'alert');
  assert.ok(pending[0].text.includes('dropped 1 environment note'));
});

test('engine: the chair [DEADLINE] tag arms on the worker ACK and rings one deadline host note', async () => {
  let clock = Date.now();
  const h = createHarness('metabot-gt-engine-deadline-', { engineNow: () => clock });
  const task = await h.seedTask('executing');

  // The chair assigns with a 30-minute deadline; the clock is NOT armed yet.
  h.pushHistory('IDTWIN', '@worker 1 draft the post [DEADLINE: 30m]', { mention: ['IDWORKER1'] });
  h.llmTurns.push('[WORKING] drafting, ETA 20 min');
  await h.engine.tick();
  let deadlineRaw = await h.chairStore.kvGet(`group_task_deadline:${task.id}:worker-1`);
  assert.ok(deadlineRaw, 'deadline entry recorded from the chair tag');
  assert.equal(JSON.parse(deadlineRaw).armedAt, null, 'not armed before the ACK');

  // The worker ACK round-trips: the clock starts now. (A bare [WORKING] note
  // is ceremony-shaped: it pulls no chair floor-control turn.)
  h.pushHistory('IDWORKER1', '[WORKING] drafting, ETA 20 min');
  await h.engine.tick();
  deadlineRaw = await h.chairStore.kvGet(`group_task_deadline:${task.id}:worker-1`);
  const armed = JSON.parse(deadlineRaw);
  assert.equal(armed.minutes, 30);
  assert.ok(armed.armedAt != null && armed.dueAt != null, 'clock armed by the [WORKING] ACK');

  // 31 minutes pass with no [DELIVERABLE]: the bell rings once (a note, never
  // a host post), and the chair answers in its own voice. (The stale [WORKING]
  // signal also records a long_turn note; both ride the SAME notes turn.)
  clock += 31 * 60_000;
  h.llmTurns.push('@worker 1 the 30-minute mark passed — status?');
  await h.engine.tick();
  const notes = (await h.chairStore.listHostNotes(task.id)).filter((note) => note.kind === 'deadline');
  assert.equal(notes.length, 1, 'exactly one deadline note');
  assert.ok(notes[0].body.includes('30-min') && notes[0].body.includes('worker-1'));
  assert.ok(notes[0].consumedAt != null, 'the chair consumed the note');
  assert.equal(h.pins.filter((pin) => pinPlaintext(pin).includes('GROUP_TASK_NOTICE')).length, 0);
  assert.equal(h.pins.filter((pin) => pin.label === 'twin-bot').length, 1,
    'one chair notes turn; the worker turn posted as the worker');
  assert.equal(await h.chairStore.kvGet(`group_task_deadline:${task.id}:worker-1`), undefined,
    'the clock is done after the ring');
});

test('engine: a delivered [DELIVERABLE] settles the armed deadline silently', async () => {
  let clock = Date.now();
  const h = createHarness('metabot-gt-engine-deadline-ok-', { engineNow: () => clock });
  const task = await h.seedTask('executing');

  h.pushHistory('IDTWIN', '@worker 1 draft the post [DEADLINE: 30m]', { mention: ['IDWORKER1'] });
  h.llmTurns.push('[WORKING] drafting, ETA 10 min');
  await h.engine.tick();
  // (A bare [WORKING] round-trip is ceremony-shaped: no chair turn needed.)
  h.pushHistory('IDWORKER1', '[WORKING] drafting, ETA 10 min');
  await h.engine.tick();

  // The deliverable lands before the deadline: the clock clears, no note.
  clock += 5 * 60_000;
  h.pushHistory('IDWORKER1', '[DELIVERABLE] https://example.com/post final draft');
  h.llmTurns.push('[NO_REPLY]'); // chair verification turn
  await h.engine.tick();
  clock += 30 * 60_000;
  h.llmTurns.push('[NO_REPLY]'); // the long_turn note (stale [WORKING]) is consumed silently
  await h.engine.tick();
  assert.equal((await h.chairStore.listHostNotes(task.id)).filter((note) => note.kind === 'deadline').length, 0,
    'no deadline note when the deliverable landed');
});

test('engine: consecutive chain send failures record one chain_health note; recovery is noted', async () => {
  const h = createHarness('metabot-gt-engine-chain-');
  const task = await h.seedTask('executing');
  const realSignerFor = h.ctx.signerForSlug;
  h.ctx.signerForSlug = async () => ({
    writePin: async () => { throw new Error('chain backend unreachable'); },
  });

  h.pushHistory('IDOWNER', 'status?');
  h.llmTurns.push('working on it'); // tick 1: chair reply; the post fails (1)
  await h.engine.tick();
  assert.equal((await h.chairStore.listHostNotes(task.id)).length, 0, 'one failure does not alarm');

  h.llmTurns.push('working on it'); // tick 2: chair reply; the post fails (2) → the bell rings
  h.llmTurns.push('[NO_REPLY]');    // tick 2: the notes turn consumes the down note silently
  await h.engine.tick();
  let notes = await h.chairStore.listHostNotes(task.id);
  assert.equal(notes.filter((note) => note.kind === 'chain_health').length, 1, 'the bell rang once');
  assert.ok(notes[0].body.includes('failed 2 consecutive times'));
  assert.ok(notes[0].body.includes('chain backend'));

  h.ctx.signerForSlug = realSignerFor;
  h.llmTurns.push('working on it'); // tick 3: the retried chair reply posts → recovery note
  h.llmTurns.push('[NO_REPLY]');    // tick 3: the notes turn consumes the recovery note
  await h.engine.tick();
  notes = await h.chairStore.listHostNotes(task.id);
  assert.deepEqual(
    notes.map((note) => `${note.kind}:${note.body.includes('RECOVERED') ? 'up' : 'down'}`),
    ['chain_health:down', 'chain_health:up'],
  );
});

test('engine: planning never duplicates an active chair — one minimal directive completes it', async () => {
  // [NO_REPLY] variant: nothing is missing, nothing posts, planning completes.
  const h = createHarness('metabot-gt-engine-plan-dedupe-');
  const task = await h.seedTask('planning');
  h.pushHistory('IDTWIN', '[GROUP TASK] Engine test task');
  h.pushHistory('IDTWIN', 'Welcome! @worker 1 please draft the announcement first', { mention: ['IDWORKER1'] });

  h.llmTurns.push('[NO_REPLY]');            // the minimal planning turn
  h.llmTurns.push('[WORKING] starting');    // the already-dispatched worker answers
  await h.engine.tick();
  assert.ok(h.llmCalls[0].prompt.includes('already contains chair-authored opening content'),
    'minimal directive used');
  assert.equal(h.pins.filter((pin) => pin.label === 'twin-bot').length, 0, 'the chair posted nothing');
  assert.ok(await h.chairStore.kvGet(`${GROUP_TASK_PLANNED_KV_PREFIX}${task.id}`), 'planning completed minimally');
  assert.equal(await h.chairStore.kvGet(`${GROUP_TASK_PLAN_ATTEMPTS_KV_PREFIX}${task.id}`), undefined,
    'the minimal path never burns the attempt budget');

  // Posted variant: a reply without a status tag gets the deterministic
  // [STATUS:EXECUTING] footer (the bootstrap must move the task).
  const h2 = createHarness('metabot-gt-engine-plan-footer-');
  await h2.seedTask('planning');
  h2.pushHistory('IDTWIN', '[GROUP TASK] Engine test task');
  h2.pushHistory('IDTWIN', 'Welcome! @worker 1 please draft the announcement first', { mention: ['IDWORKER1'] });
  h2.llmTurns.push('Adding only the missing transition.');
  h2.llmTurns.push('[WORKING] on it');
  await h2.engine.tick();
  const chairPins = h2.pins.filter((pin) => pin.label === 'twin-bot');
  assert.equal(chairPins.length, 1);
  assert.ok(pinPlaintext(chairPins[0]).trim().endsWith('[STATUS:EXECUTING]'),
    'deterministic [STATUS:EXECUTING] footer appended');
});

test('engine: a supervisor nudge in REVIEW wakes the chair (review exception); an open checkpoint defers it', async () => {
  const h = createHarness('metabot-gt-engine-review-nudge-');
  const task = await h.seedTask('executing');
  await h.chairStore.updateTaskStatus(task.id, 'review');
  await h.chairStore.kvSet(`group_task_nudge_request:${task.id}`,
    JSON.stringify({ kind: 'nudge', name: 'worker 1', note: 'verify the numbers again', at: Date.now(), attempts: 0 }));

  h.llmTurns.push('Re-checked: the numbers hold — the review stands.');
  await h.engine.tick();
  assert.equal(h.llmCalls.length, 1, 'review-phase nudge woke the chair (teeth)');
  assert.ok(h.llmCalls[0].prompt.includes('EXCEPTION — this task is in REVIEW'), 'review exception present');
  assert.ok(h.llmCalls[0].prompt.includes('verify the numbers again'), 'owner note surfaced');
  assert.equal(h.pins.filter((pin) => pin.label === 'twin-bot').length, 1);
  assert.equal((await h.chairStore.getTaskById(task.id)).status, 'review', 'no status tag — review stands');

  // An open checkpoint defers the wake entirely (the owner is mid-decision).
  const h2 = createHarness('metabot-gt-engine-ckpt-defer-');
  const task2 = await h2.seedTask('executing');
  await h2.chairStore.openCheckpoint(task2.id, 'budget approval', null);
  await h2.chairStore.kvSet(`group_task_nudge_request:${task2.id}`,
    JSON.stringify({ kind: 'nudge', name: 'worker 1', note: null, at: Date.now(), attempts: 0 }));
  await h2.engine.tick();
  assert.equal(h2.llmCalls.length, 0, 'an open checkpoint defers the supervisor wake');
  assert.ok(await h2.chairStore.kvGet(`group_task_nudge_request:${task2.id}`), 'the request stays queued');
});

test('engine: a dropped chair status tag records a parse host note (stuck-review feedback loop closed)', async () => {
  const h = createHarness('metabot-gt-engine-parse-note-');
  const task = await h.seedTask('planning');
  await h.chairStore.kvSet(`${GROUP_TASK_PLANNED_KV_PREFIX}${task.id}`, '1'); // skip the planning turn
  // planning → review is an ILLEGAL transition: the tag must not apply, and
  // the chair learns the verdict through its environment notes.
  h.pushHistory('IDTWIN', 'Everything is done.\n[STATUS:REVIEW]');
  h.llmTurns.push('[NO_REPLY]'); // the host-notes turn consumes the parse note
  await h.engine.tick();

  assert.equal((await h.chairStore.getTaskById(task.id)).status, 'planning', 'illegal transition not applied');
  const notes = await h.chairStore.listHostNotes(task.id);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].kind, 'parse');
  assert.ok(notes[0].body.includes('NOT applied'));
  assert.ok(notes[0].consumedAt != null, 'consumed by the notes turn');
});

test('engine: a markdown-wrapped chair status tag on its own line still applies', async () => {
  const h = createHarness('metabot-gt-engine-md-status-');
  const task = await h.seedTask('executing');
  // The 2026-09-06 incident shape: a bolded verdict on its own line.
  h.pushHistory('IDTWIN', 'All acceptance criteria met.\n**[STATUS:REVIEW]**');
  await h.engine.tick();
  assert.equal((await h.chairStore.getTaskById(task.id)).status, 'review',
    'markdown-wrapped status tag honored (IDBots 4b996374 parity)');
  // Mid-prose mentions stay inert.
  const h2 = createHarness('metabot-gt-engine-md-prose-');
  const task2 = await h2.seedTask('executing');
  h2.pushHistory('IDTWIN', 'Next step: 汇总后我会发出 [STATUS:REVIEW] 收尾。');
  await h2.engine.tick();
  assert.equal((await h2.chairStore.getTaskById(task2.id)).status, 'executing',
    'a mid-prose mention never transitions');
});
