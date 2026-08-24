import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRootSync } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { createGroupTaskEngine, GROUP_TASK_DRIVER_KV_PREFIX, GROUP_TASK_PLANNED_KV_PREFIX }
  = require('../../dist/core/grouptask/engine.js');
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

function createHarness(prefix) {
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
  const seedTask = async (status = 'planning') => {
    const task = await chairStore.createTask({
      groupId: 'grp-engine',
      title: 'Engine test task',
      goal: 'Ship the engine',
      acceptanceCriteria: 'All tests pass',
      chairSlug: 'twin-bot',
      chairGlobalMetaId: 'IDTWIN',
      createdBy: 'user',
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
  h.pushHistory('IDWORKER1', '[WORKING] on it, 10 min');
  h.llmTurns.push('[NO_REPLY]'); // chair floor-control turn opts out
  await h.engine.tick();
  const members = await h.chairStore.listMembers(task.id);
  assert.equal(members.find((m) => m.slug === 'worker-1').status, 'working');
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

test('engine: chair [STATUS:REVIEW] closes checkpoints, persists the acceptance summary, and posts the review notice', async () => {
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
  const notice = h.pins.find((pin) => pinPlaintext(pin).includes('[GROUP_TASK_NOTICE:review_summary]'));
  assert.ok(notice, 'review summary notice posted');
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

test('engine: checkpoint open/resolve lifecycle gates the room', async () => {
  const h = createHarness('metabot-gt-engine-ckpt-');
  const task = await h.seedTask('executing');

  h.pushHistory('IDTWIN', 'Owner decision needed. [CHECKPOINT: budget approval]');
  await h.engine.tick();

  let checkpoints = await h.chairStore.listCheckpoints(task.id);
  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0].status, 'open');
  assert.equal(checkpoints[0].topic, 'budget approval');
  assert.ok(
    h.pins.some((pin) => pinPlaintext(pin).includes('[GROUP_TASK_NOTICE:checkpoint_open]')),
    'pause notice posted',
  );

  // Worker mentioned while the checkpoint is open: silent.
  h.pushHistory('IDOWNER', 'worker do more', { mention: ['IDWORKER1'] });
  h.llmTurns.push('chair ack to owner');
  await h.engine.tick();
  assert.equal(h.pins.filter((pin) => pin.label === 'worker-1').length, 0);

  // Chair resolves; work resumes.
  h.pushHistory('IDTWIN', '[CHECKPOINT_RESOLVED: owner approved plan B]');
  await h.engine.tick();
  checkpoints = await h.chairStore.listCheckpoints(task.id);
  assert.equal(checkpoints[0].status, 'resolved');
  assert.equal(checkpoints[0].resolution, 'owner approved plan B');
  assert.ok(
    h.pins.some((pin) => pinPlaintext(pin).includes('[GROUP_TASK_NOTICE:checkpoint_resolved]')),
    'resume notice posted',
  );
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

test('engine: [DEPENDS_ON] holds the worker reply until the upstream deliverable exists', async () => {
  const h = createHarness('metabot-gt-engine-depends-');
  const task = await h.seedTask('executing');
  const upstreamPin = 'a'.repeat(64) + 'i0';

  // Dispatch with an unsatisfied dependency: the reply is held, cursor stays.
  h.pushHistory('IDTWIN', `@worker 1 build the poster [DEPENDS_ON:${upstreamPin}]`, { mention: ['IDWORKER1'] });
  h.llmTurns.push('starting now');
  await h.engine.tick();
  assert.equal(h.pins.filter((pin) => pin.label === 'worker-1').length, 0, 'no reply while upstream missing');
  assert.equal((await h.chairStore.getTaskById(task.id)).lastProcessedIndex, -1, 'cursor held');

  // Upstream deliverable already on-chain when the dispatch is processed:
  // the dependency is satisfied and the worker replies.
  const h2 = createHarness('metabot-gt-engine-depends-met-');
  const task2 = await h2.seedTask('executing');
  h2.pushHistory('IDWORKER1', `upstream ready [DELIVERABLE] pin: pin://${upstreamPin}`);
  await h2.engine.tick();
  h2.pushHistory('IDTWIN', `@worker 1 build the poster [DEPENDS_ON:${upstreamPin}]`, { mention: ['IDWORKER1'] });
  h2.llmTurns.push('verified, thanks', 'starting now');
  await h2.engine.tick();
  await h2.engine.tick();
  assert.ok(h2.pins.some((pin) => pin.label === 'worker-1'), 'worker replied once upstream landed');
});

test('engine: stale pending ACK triggers exactly one chair reminder', async () => {
  const h = createHarness('metabot-gt-engine-ack-');
  const task = await h.seedTask('executing');
  // Worker took work (working status) but the assignment ACK went stale.
  await h.chairStore.setMemberStatus(task.id, 'worker-1', 'working', 'IDWORKER1');
  const pendingKey = `group_task_ack_pending:${task.id}:worker-1`;
  await h.chairStore.kvSet(pendingKey, JSON.stringify({ assignedAt: Date.now() - 4 * 60_000, msgIndex: 0 }));

  await h.engine.tick();
  await h.engine.tick();
  const reminders = h.pins.filter((pin) => pin.label === 'twin-bot'
    && pinPlaintext(pin).includes('ack_reminder'));
  assert.equal(reminders.length, 1, 'chair posted the ACK reminder exactly once');

  // A roll-call mention never arms the watch (P5 exemption).
  h.pushHistory('IDTWIN', '@worker 1 请确认在线', { mention: ['IDWORKER1'] });
  await h.engine.tick();
  const rollPending = await h.chairStore.kvGet(`group_task_ack_pending:${task.id}:worker-1`);
  assert.ok(!String(rollPending ?? '').includes('请确认在线'));
});
