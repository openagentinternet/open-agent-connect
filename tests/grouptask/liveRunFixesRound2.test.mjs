import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRootSync } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { createGroupTaskEngine, GROUP_TASK_PLANNED_KV_PREFIX, GROUP_TASK_DEADLINE_KV_PREFIX,
  GROUP_TASK_ACK_PENDING_KV_PREFIX }
  = require('../../dist/core/grouptask/engine.js');
const { createGroupTask, postGroupTaskMessage, submitGroupTaskWork }
  = require('../../dist/core/grouptask/service.js');
const { createGroupTaskStore } = require('../../dist/core/grouptask/store.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { decryptGroupContent } = require('../../dist/core/appSession/groupChat.js');

// Round-2 regression coverage for the 2026-09-12 evening live run (task 180):
// F8 mention resolution, F9 delivered-member watch, F10 tool-call markup,
// F11 unreachable/undrivable host notes, P3 mid-URI truncation. See
// docs/superpowers/specs/2026-09-12-dsh-grouptask-live-run-fixes.md.

function pinPlaintext(pin) {
  try {
    const payload = JSON.parse(pin.payload);
    return decryptGroupContent(String(payload.content ?? ''), String(payload.groupId ?? ''));
  } catch {
    return '';
  }
}

function jsonResponse(body) {
  return { ok: true, json: async () => body };
}

function createHarness(prefix, options = {}) {
  const systemHome = mkdtempTempRootSync(prefix);
  const pins = [];
  const logs = [];
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
    makeProfile('worker-2', 'worker', 'IDWORKER2'),
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

  const llmTurns = [];
  const llmCalls = [];
  const runLlmTurn = async (turn) => {
    llmCalls.push(turn);
    const script = llmTurns.shift();
    if (!script) throw new Error(`Unscripted LLM turn for ${turn.profile.slug}`);
    if (typeof script === 'function') return script(turn);
    return script;
  };

  const clock = { t: Date.now() };
  const ctx = {
    listProfiles: async () => profiles,
    getProfile: async (slug) => profiles.find((profile) => profile.slug === slug) ?? null,
    signerForSlug: async (slug) => makeSigner(slug),
    ownerIdentity: async () => ({
      globalMetaId: 'IDOWNER', metaId: 'meta-owner', name: 'Owner', signer: makeSigner('owner'),
    }),
    storeForProfile,
    transport: { indexerHosts: ['https://fake-indexer.test'], fetchImpl },
    log: (message) => logs.push(String(message)),
  };

  const engine = createGroupTaskEngine({
    ctx,
    runLlmTurn,
    loadPersona: async () => ({}),
    workerCooldownMs: 0,
    chairCooldownMs: 0,
    workerSessions: options.workerSessions === true,
    now: () => clock.t,
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
      timestamp: Math.floor(clock.t / 1000) + (opts.atOffsetSeconds ?? 0),
      userInfo: { name: gmid.toLowerCase() },
      ...(opts.mention ? { mention: opts.mention } : {}),
    });
    return index;
  };

  const chairStore = storeForProfile(profiles[0]);
  const seedTask = async (status = 'planning') => {
    const task = await chairStore.createTask({
      groupId: 'grp-engine',
      title: 'Round-2 fixes task',
      goal: 'Ship the round-2 fixes',
      acceptanceCriteria: 'All round-2 findings covered',
      chairSlug: 'twin-bot',
      chairGlobalMetaId: 'IDTWIN',
      createdBy: 'user',
    });
    await chairStore.addMember({ taskId: task.id, slug: 'twin-bot', globalMetaId: 'IDTWIN', role: 'chair', displayName: 'twin bot' });
    await chairStore.addMember({ taskId: task.id, slug: 'worker-1', globalMetaId: 'IDWORKER1', role: 'worker', displayName: 'worker 1' });
    await chairStore.addMember({ taskId: task.id, slug: 'worker-2', globalMetaId: 'IDWORKER2', role: 'worker', displayName: 'worker 2' });
    if (status !== 'planning') {
      await chairStore.updateTaskStatus(task.id, status);
      await chairStore.kvSet(`${GROUP_TASK_PLANNED_KV_PREFIX}${task.id}`, '1');
    }
    return chairStore.getTaskById(task.id);
  };

  return {
    ctx, engine, pins, logs, llmTurns, llmCalls, pushHistory, chairStore, seedTask, profiles, clock,
    systemHome,
  };
}

// ---------------------------------------------------------------------------
// F8: mention resolution
// ---------------------------------------------------------------------------

test('F8: postGroupTaskMessage resolves @Name tokens into the on-chain mention array', async () => {
  const h = createHarness('metabot-gt-r2-mention-');
  const { task } = await createGroupTask(h.ctx, {
    title: 'Mentions',
    goal: 'Resolve mentions',
    workerSlugs: ['worker-1', 'worker-2'],
  });
  h.pins.length = 0;

  await postGroupTaskMessage(h.ctx, 'twin-bot', task.id, {
    content: '@worker 1 please take stage A; worker 2 waits (no @).',
  });

  const chatPins = h.pins.filter((pin) => pin.path === '/protocols/simplegroupchat');
  assert.equal(chatPins.length, 1);
  const mention = JSON.parse(chatPins[0].payload).mention ?? [];
  assert.deepEqual(mention, ['IDWORKER1'], 'only the @-named member lands in the mention array');
});

test('F8: the ACK watch and [DEADLINE] clock arm from the @Name body form (no mention array)', async () => {
  const h = createHarness('metabot-gt-r2-ack-');
  const task = await h.seedTask('executing');
  // Chair dispatch with a per-seat deadline but NO resolved mention array.
  h.pushHistory('IDTWIN', '@worker 1 stage A please. [DEADLINE: 5m]');

  h.llmTurns.push('[WORKING] on it'); // worker reply turn
  await h.engine.tick();

  const deadline = await h.chairStore.kvGet(`${GROUP_TASK_DEADLINE_KV_PREFIX}${task.id}:worker-1`);
  assert.ok(deadline, 'deadline clock armed from the @Name form');
  assert.ok(JSON.parse(deadline).minutes === 5);
  const ackPendingKey = `${GROUP_TASK_ACK_PENDING_KV_PREFIX}${task.id}:worker-1`;
  assert.ok((await h.chairStore.kvGet(ackPendingKey)) != null, 'ACK watch armed from the @Name form');

  // The worker's [WORKING] round-trips: the watch clears.
  h.pushHistory('IDWORKER1', '[WORKING] on it');
  await h.engine.tick();
  assert.ok((await h.chairStore.kvGet(ackPendingKey)) == null, 'worker ACK cleared the watch');
});

// ---------------------------------------------------------------------------
// F9: a delivery resets the stale-working watch
// ---------------------------------------------------------------------------

test('F9: a member who delivered after [WORKING] is never flagged long_turn or unreachable', async () => {
  const h = createHarness('metabot-gt-r2-longturn-');
  const task = await h.seedTask('executing');
  const t0 = h.clock.t;

  h.pushHistory('IDWORKER1', '[WORKING] stage A', { atOffsetSeconds: 0 });
  h.pushHistory('IDWORKER2', '[WORKING] stage B', { atOffsetSeconds: 0 });
  await h.engine.tick(); // ceremony ACKs: no turns needed

  h.clock.t = t0 + 5 * 60_000;
  h.pushHistory('IDWORKER1', '[DELIVERABLE] https://example.com/a done');
  h.llmTurns.push('[NO_REPLY]'); // chair verification turn for the deliverable
  await h.engine.tick();

  // 24 min after the [WORKING] claims: worker-1 delivered (19 min ago, inside
  // the window), worker-2 went silent (24 min, past it).
  h.clock.t = t0 + 24 * 60_000;
  h.llmTurns.push('[NO_REPLY]'); // host-notes delivery turn (worker-2 note)
  await h.engine.tick();

  const notes = await h.chairStore.listHostNotes(task.id);
  const longTurns = notes.filter((note) => note.kind === 'long_turn');
  assert.equal(longTurns.length, 1, 'exactly one long_turn note');
  assert.equal(longTurns[0].target, 'worker 2', 'only the silent member is flagged');
  const members = await h.chairStore.listMembers(task.id);
  assert.notEqual(members.find((m) => m.slug === 'worker-1').status, 'unreachable', 'delivered member stays reachable');
  assert.equal(members.find((m) => m.slug === 'worker-2').status, 'unreachable', 'genuinely silent member is marked');
});

// ---------------------------------------------------------------------------
// F10: tool-call markup never reaches the chain
// ---------------------------------------------------------------------------

test('F10: a DSML chair reply is retried in plain text; persistent markup posts nothing', async () => {
  const h = createHarness('metabot-gt-r2-dsml-');
  await h.seedTask('executing');
  h.pushHistory('IDWORKER1', '[DELIVERABLE] https://example.com/report done');

  const dsml = '<｜｜DSML｜｜ calls>\n<｜｜DSML｜｜ invoke name="read_metaweb_pin">\n</｜｜DSML｜｜ invoke>\n</｜｜DSML｜｜ calls>';
  h.llmTurns.push(dsml);
  h.llmTurns.push('[NO_REPLY]');
  await h.engine.tick();

  assert.equal(h.llmCalls.length, 2, 'markup reply retried once');
  assert.ok(h.llmCalls[1].prompt.includes('plain text'), 'retry prompt demands plain text');
  assert.equal(h.pins.filter((pin) => pin.label === 'twin-bot').length, 0, '[NO_REPLY] retry posts nothing');

  // Persistent markup: nothing is posted at all.
  h.pushHistory('IDWORKER1', '[DELIVERABLE] https://example.com/report-v2 done');
  h.llmTurns.push(dsml);
  h.llmTurns.push(dsml);
  await h.engine.tick();
  assert.equal(h.pins.filter((pin) => pin.label === 'twin-bot').length, 0, 'persistent markup dropped');
  assert.ok(h.logs.some((line) => line.includes('still tool-call markup')), 'drop logged');
});

test('F10: a DSML work handoff fails the request instead of posting on-chain', async () => {
  const h = createHarness('metabot-gt-r2-dsmlhandoff-');
  const store = h.chairStore;
  const task = await store.createTask({
    groupId: 'grp-engine',
    title: 'Handoff guard',
    goal: 'No markup on chain',
    chairSlug: 'twin-bot',
    chairGlobalMetaId: 'IDTWIN',
    createdBy: 'user',
  });
  const request = await store.createWorkRequest({
    taskId: task.id,
    groupId: task.groupId,
    workerSlug: 'worker-1',
    targetIndex: 0,
    targetPinId: null,
  });

  const result = await submitGroupTaskWork(h.ctx, {
    requestId: request.id,
    handoff: '<｜｜DSML｜｜ calls>\n<｜｜DSML｜｜ invoke name="search_metaweb">\n</｜｜DSML｜｜ invoke>\n</｜｜DSML｜｜ calls>',
  });
  assert.equal(result.status, 'failed');
  assert.ok(result.error.includes('TOOLCALL'), `markup named in the failure (${result.error})`);
  assert.equal((await store.getWorkRequest(request.id)).status, 'failed');
  assert.equal(h.pins.filter((pin) => pin.path === '/protocols/simplegroupchat').length, 0, 'nothing posted');
});

// ---------------------------------------------------------------------------
// F11: unreachable + undrivable host notes
// ---------------------------------------------------------------------------

test('F11: a 30-min-silent member is marked unreachable AND the chair gets a host note', async () => {
  const h = createHarness('metabot-gt-r2-unreachable-');
  const task = await h.seedTask('executing');
  // worker-1 never speaks; 31 min pass.
  h.clock.t += 31 * 60_000;
  h.llmTurns.push('[NO_REPLY]'); // host-notes delivery turn
  await h.engine.tick();

  const members = await h.chairStore.listMembers(task.id);
  assert.equal(members.find((m) => m.slug === 'worker-1').status, 'unreachable');
  const notes = await h.chairStore.listHostNotes(task.id);
  const unreachable = notes.filter((note) => note.kind === 'unreachable');
  assert.equal(unreachable.length, 2, 'both silent members earn an unreachable note');
  assert.deepEqual(unreachable.map((note) => note.target).sort(), ['worker 1', 'worker 2']);
  assert.ok(unreachable.every((note) => note.consumedAt != null), 'notes delivered to the chair');
});

test('F11: addressing an unavailable (undrivable) roster member earns a host note', async () => {
  const h = createHarness('metabot-gt-r2-undrivable-');
  const task = await h.seedTask('executing');
  // Simulate worker-2 becoming unavailable mid-task: the daemon's availability
  // filter drops it from the engine profile list.
  const idx = h.profiles.findIndex((profile) => profile.slug === 'worker-2');
  h.profiles.splice(idx, 1);

  h.pushHistory('IDTWIN', '@worker 2 please take stage B');
  h.llmTurns.push('[NO_REPLY]'); // host-notes delivery turn
  await h.engine.tick();

  const notes = await h.chairStore.listHostNotes(task.id);
  const undrivable = notes.filter((note) => note.kind === 'undrivable');
  assert.equal(undrivable.length, 1, 'one undrivable note');
  assert.equal(undrivable[0].target, 'worker 2');
  assert.ok(undrivable[0].body.includes('unavailable'));
  assert.ok(h.logs.some((line) => line.includes('not drivable')), 'skip logged');
});

// ---------------------------------------------------------------------------
// P3: mid-URI truncation
// ---------------------------------------------------------------------------

test('P3: a chair reply cut mid-URI is retried; a complete trailing URI is not', async () => {
  const h = createHarness('metabot-gt-r2-uri-');
  await h.seedTask('executing');
  h.pushHistory('IDWORKER1', '[DELIVERABLE] https://example.com/report done');

  const fullUri = 'pin://99e980c2e96e685097c0b425c6ec201f4cf4e494b03edc8b8712bfcacd5331efi0';
  h.llmTurns.push('verdict: pin://99e980c'); // cut mid-pinId
  h.llmTurns.push(`verified — ${fullUri}\n[NO_REPLY]`);
  await h.engine.tick();

  assert.equal(h.llmCalls.length, 2, 'mid-URI cut retried once');
  assert.ok(h.llmCalls[1].prompt.includes('cut off mid-structure'));

  // A reply ending with a COMPLETE pin URI is not a truncation.
  h.pushHistory('IDWORKER1', '[DELIVERABLE] https://example.com/report-v3 done');
  h.llmTurns.push(`verified — ${fullUri}\n[NO_REPLY]`);
  await h.engine.tick();
  const verificationCalls = h.llmCalls.length;
  assert.equal(verificationCalls, 3, 'no spurious retry for a complete URI');
});
