import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRootSync } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { createGroupTaskEngine, GROUP_TASK_CHAIR_FAILURE_SINCE_KV_PREFIX,
  GROUP_TASK_CHAIR_RETRY_AFTER_KV_PREFIX, GROUP_TASK_PLAN_ATTEMPTS_KV_PREFIX,
  GROUP_TASK_PLANNED_KV_PREFIX }
  = require('../../dist/core/grouptask/engine.js');
const { drainGroupTaskRelay } = require('../../dist/core/grouptask/service.js');
const { createGroupTaskStore } = require('../../dist/core/grouptask/store.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { decryptGroupContent } = require('../../dist/core/appSession/groupChat.js');

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

const LLM_DOWN = 'No healthy LLM runtime is available for MetaBot twin-bot.';

function createHarness(prefix, { engineNow } = {}) {
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
    workerSessions: false,
    ...(engineNow ? { now: engineNow } : {}),
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
      title: 'Chair outage test task',
      goal: 'Survive the outage',
      acceptanceCriteria: 'No silent wedges',
      chairSlug: 'twin-bot',
      chairGlobalMetaId: 'IDTWIN',
      createdBy: 'user',
      sourceSessionId: 'session-outage-origin',
    });
    await chairStore.addMember({ taskId: task.id, slug: 'twin-bot', globalMetaId: 'IDTWIN', role: 'chair' });
    await chairStore.addMember({ taskId: task.id, slug: 'worker-1', globalMetaId: 'IDWORKER1', role: 'worker' });
    if (status !== 'planning') {
      await chairStore.updateTaskStatus(task.id, status);
      await chairStore.kvSet(`${GROUP_TASK_PLANNED_KV_PREFIX}${task.id}`, '1');
    }
    return (await chairStore.getTaskById(task.id));
  };

  return { ctx, engine, pins, llmTurns, llmCalls, pushHistory, chairStore, seedTask, profiles };
}

// ---------------------------------------------------------------------------
// OT-01: chair LLM outage — defer, degrade, recover
// ---------------------------------------------------------------------------

test('outage: an LLM-unavailable chair turn defers instead of poisoning, and auto-resumes after recovery', async () => {
  let clock = 1_700_000_000_000;
  const h = createHarness('metabot-gt-outage-defer-', { engineNow: () => clock });
  const task = await h.seedTask('executing');
  h.pushHistory('IDOWNER', 'status update from the owner');

  h.llmTurns.push(() => { throw new Error(LLM_DOWN); });
  await h.engine.tick();
  let updated = await h.chairStore.getTaskById(task.id);
  assert.equal(updated.lastProcessedIndex, -1, 'cursor stays on the message');
  assert.ok(await h.chairStore.kvGet(`${GROUP_TASK_CHAIR_FAILURE_SINCE_KV_PREFIX}${task.id}`), 'outage clock armed');
  assert.equal(updated.chairDegradedAt, null, 'short streak does not degrade');
  assert.equal((await drainGroupTaskRelay(h.ctx)).length, 0, 'no alert on the first failure');

  // Backoff gate: an immediate retry tick is suppressed entirely.
  h.llmTurns.push(() => { throw new Error(LLM_DOWN); });
  await h.engine.tick();
  assert.equal(h.llmCalls.length, 2, 'gate did not yet reopen');

  clock += 31_000;
  h.llmTurns.push(() => { throw new Error(LLM_DOWN); });
  await h.engine.tick();
  updated = await h.chairStore.getTaskById(task.id);
  assert.equal(updated.lastProcessedIndex, -1, 'still deferred');
  assert.equal(updated.chairDegradedAt, null, 'streak below the window');

  // Recovery: the very same message is processed exactly once.
  clock += 61_000;
  h.llmTurns.push('noted, owner — resuming now');
  await h.engine.tick();
  updated = await h.chairStore.getTaskById(task.id);
  assert.equal(updated.lastProcessedIndex, 0, 'cursor advanced past the recovered message');
  assert.equal(updated.chairDegradedAt, null, 'never degraded (streak too short)');
  assert.equal(await h.chairStore.kvGet(`${GROUP_TASK_CHAIR_FAILURE_SINCE_KV_PREFIX}${task.id}`), undefined,
    'outage clock cleared on success');
  assert.equal(await h.chairStore.kvGet(`${GROUP_TASK_CHAIR_RETRY_AFTER_KV_PREFIX}${task.id}`), undefined,
    'backoff gate cleared on success');
  assert.equal(h.pins.filter((pin) => pin.label === 'twin-bot').length, 1, 'exactly one chair reply');
});

test('outage: a sustained outage degrades the task, alerts the owner once, posts a group notice, and recovery revives', async () => {
  let clock = 1_700_000_000_000;
  const h = createHarness('metabot-gt-outage-degrade-', { engineNow: () => clock });
  const task = await h.seedTask('executing');
  h.pushHistory('IDOWNER', 'deliverable follow-up');

  const alwaysThrow = () => { throw new Error(LLM_DOWN); };
  h.llmTurns.push(alwaysThrow);
  await h.engine.tick();
  clock += 35_000;
  h.llmTurns.push(alwaysThrow);
  await h.engine.tick();
  clock += 95_000;
  h.llmTurns.push(alwaysThrow);
  await h.engine.tick();
  clock += 340_000;
  h.llmTurns.push(alwaysThrow);
  await h.engine.tick();
  let updated = await h.chairStore.getTaskById(task.id);
  assert.equal(updated.chairDegradedAt, null, 'not yet past the 10-minute window');

  clock += 310_000; // > 10 min since the first failure
  h.llmTurns.push(alwaysThrow);
  await h.engine.tick();
  updated = await h.chairStore.getTaskById(task.id);
  assert.ok(updated.chairDegradedAt, 'degraded once the window passed');
  assert.equal(updated.status, 'executing', 'status unchanged — degraded is a marker, not a new state');

  const notices = h.pins
    .filter((pin) => pin.label === 'twin-bot')
    .map((pin) => pinPlaintext(pin));
  assert.ok(notices.some((text) => text.includes('[GROUP_TASK_NOTICE:chair_degraded]')),
    'a group-facing system notice rode the host-notice channel');

  // Recovery: the next successful chair turn clears the marker and relays.
  clock += 300_000;
  h.llmTurns.push('back online — apologies for the silence');
  await h.engine.tick();
  updated = await h.chairStore.getTaskById(task.id);
  assert.equal(updated.chairDegradedAt, null, 'revived on the successful turn');
  assert.equal(updated.lastProcessedIndex, 0, 'the deferred message finally processed');

  const alerts = (await drainGroupTaskRelay(h.ctx)).filter((row) => row.kind === 'alert');
  assert.equal(alerts.length, 2, 'one degrade alert + one recovery alert');
  assert.match(alerts[0].text, /LLM runtime has been unavailable/);
  assert.match(alerts[1].text, /has recovered/);
});

test('outage: a sub-window blip never alerts — failure clock and backoff clear on the next success', async () => {
  let clock = 1_700_000_000_000;
  const h = createHarness('metabot-gt-outage-blip-', { engineNow: () => clock });
  const task = await h.seedTask('executing');
  h.pushHistory('IDOWNER', 'quick question');

  h.llmTurns.push(() => { throw new Error(LLM_DOWN); });
  await h.engine.tick();
  clock += 31_000;
  h.llmTurns.push('answered in one line');
  await h.engine.tick();

  const updated = await h.chairStore.getTaskById(task.id);
  assert.equal(updated.lastProcessedIndex, 0);
  assert.equal(updated.chairDegradedAt, null, 'no degrade marker');
  assert.equal(await h.chairStore.kvGet(`${GROUP_TASK_CHAIR_FAILURE_SINCE_KV_PREFIX}${task.id}`), undefined);
  const alerts = (await drainGroupTaskRelay(h.ctx)).filter((row) => row.kind === 'alert');
  assert.equal(alerts.length, 0, 'silent blip');
});

test('outage: non-LLM failures still poison after five attempts (existing contract)', async () => {
  let clock = 1_700_000_000_000;
  const h = createHarness('metabot-gt-outage-poison-', { engineNow: () => clock });
  const task = await h.seedTask('executing');
  h.pushHistory('IDOWNER', 'this crashes deterministically');

  for (let attempt = 0; attempt < 5; attempt += 1) {
    h.llmTurns.push(() => { throw new Error('chain write exploded'); });
    await h.engine.tick();
  }
  const updated = await h.chairStore.getTaskById(task.id);
  assert.equal(updated.lastProcessedIndex, 0, 'poison path intact for non-LLM errors');
});

test('outage: an LLM outage during planning does not burn planning attempts', async () => {
  let clock = 1_700_000_000_000;
  const h = createHarness('metabot-gt-outage-plan-', { engineNow: () => clock });
  const task = await h.seedTask('planning');

  h.llmTurns.push(() => { throw new Error(LLM_DOWN); });
  await h.engine.tick();
  assert.equal(
    Number(await h.chairStore.kvGet(`${GROUP_TASK_PLAN_ATTEMPTS_KV_PREFIX}${task.id}`) ?? '0'),
    0, 'attempt reverted');

  clock += 31_000;
  h.llmTurns.push(() => { throw new Error(LLM_DOWN); });
  await h.engine.tick();
  assert.equal(
    Number(await h.chairStore.kvGet(`${GROUP_TASK_PLAN_ATTEMPTS_KV_PREFIX}${task.id}`) ?? '0'),
    0, 'still zero after a second outage turn');

  clock += 61_000;
  h.llmTurns.push('plan: worker 1 builds the thing [STATUS:EXECUTING]');
  await h.engine.tick();
  const updated = await h.chairStore.getTaskById(task.id);
  assert.ok(await h.chairStore.kvGet(`${GROUP_TASK_PLANNED_KV_PREFIX}${task.id}`),
    'planning completed after recovery (one-shot planned marker set)');
  assert.equal(updated.chairDegradedAt, null, 'recovery cleared the degraded marker');
  assert.equal(h.pins.filter((pin) => pin.label === 'twin-bot').length, 1, 'the plan was posted');
});
