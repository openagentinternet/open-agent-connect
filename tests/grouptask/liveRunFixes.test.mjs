import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRootSync } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { createGroupTaskEngine, GROUP_TASK_PLANNED_KV_PREFIX }
  = require('../../dist/core/grouptask/engine.js');
const { createGroupTask } = require('../../dist/core/grouptask/service.js');
const { createGroupTaskStore } = require('../../dist/core/grouptask/store.js');
const { createGroupTaskRelayStore } = require('../../dist/core/grouptask/relayStore.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { decryptGroupContent } = require('../../dist/core/appSession/groupChat.js');

// Regression coverage for the 2026-09-12 live-run findings
// (docs/superpowers/specs/2026-09-12-dsh-grouptask-live-run-fixes.md):
// P1 roster race, P2 review flap, P3 truncated chair turns, P4 log spam,
// P5 seat roles in the roster.

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

function createEngineHarness(prefix, options = {}) {
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
      timestamp: Math.floor(clock.t / 1000) - 600 + index,
      userInfo: { name: gmid.toLowerCase() },
      ...(opts.mention ? { mention: opts.mention } : {}),
    });
    return index;
  };

  const chairStore = storeForProfile(profiles[0]);
  const seedTask = async (status = 'planning', opts = {}) => {
    const task = await chairStore.createTask({
      groupId: 'grp-engine',
      title: 'Live-run fixes task',
      goal: 'Ship the fix',
      acceptanceCriteria: 'All findings covered',
      chairSlug: 'twin-bot',
      chairGlobalMetaId: 'IDTWIN',
      createdBy: 'user',
      ...(opts.sourceSessionId ? { sourceSessionId: opts.sourceSessionId } : {}),
    });
    await chairStore.addMember({ taskId: task.id, slug: 'twin-bot', globalMetaId: 'IDTWIN', role: 'chair' });
    await chairStore.addMember({
      taskId: task.id, slug: 'worker-1', globalMetaId: 'IDWORKER1', role: 'worker',
      ...(opts.seatRole1 ? { seatRole: opts.seatRole1 } : {}),
    });
    await chairStore.addMember({
      taskId: task.id, slug: 'worker-2', globalMetaId: 'IDWORKER2', role: 'worker',
      ...(opts.seatRole2 ? { seatRole: opts.seatRole2 } : {}),
    });
    if (status !== 'planning') {
      await chairStore.updateTaskStatus(task.id, status);
      await chairStore.kvSet(`${GROUP_TASK_PLANNED_KV_PREFIX}${task.id}`, '1');
    }
    return chairStore.getTaskById(task.id);
  };

  const relayRows = async () => {
    const statePath = path.join(profiles[0].homeDir, '.runtime', 'grouptask', 'relay.json');
    try {
      return JSON.parse(readFileSync(statePath, 'utf8')).rows ?? [];
    } catch {
      return [];
    }
  };

  return {
    ctx, engine, pins, logs, llmTurns, llmCalls, pushHistory, chairStore, seedTask, profiles, clock,
    relayRows, systemHome,
  };
}

// ---------------------------------------------------------------------------
// P2: review ceremony deferral + rework relay
// ---------------------------------------------------------------------------

test('P2: a review/executing chair-tag backlog flaps nothing owner-visible; a settled review relays once, then reworks relay', async () => {
  const h = createEngineHarness('metabot-gt-fix-flap-');
  const task = await h.seedTask('executing', { sourceSessionId: 'session-src' });

  // The live-run flap: a stale [STATUS:REVIEW] and a newer [STATUS:EXECUTING]
  // drain in ONE pass. Both transitions are honest ledger history, but the
  // owner must see NOTHING (no relay, no acceptance summary).
  h.pushHistory('IDTWIN', 'v1 accepted. [STATUS:REVIEW]');
  h.pushHistory('IDTWIN', 'actually back to work. [STATUS:EXECUTING]');
  await h.engine.tick();

  let updated = await h.chairStore.getTaskById(task.id);
  assert.equal(updated.status, 'executing', 'latest chair intent wins');
  assert.equal(await h.chairStore.getLatestAcceptanceSummary(task.id), null, 'no acceptance summary from a flap');
  assert.equal((await h.relayRows()).length, 0, 'no relay rows from a flap');
  const transitions = await h.chairStore.listTransitions(task.id);
  assert.deepEqual(
    transitions.map((row) => `${row.fromStatus}->${row.toStatus}`),
    ['planning->executing', 'executing->review', 'review->executing'],
    'ledger keeps the honest transition history',
  );
  assert.ok(
    h.logs.some((line) => line.includes('reverted to executing within the same message pass')),
    'skip logged',
  );

  // A SETTLED review entry relays + persists the summary at end of pass.
  h.clock.t += 61_000; // past the rework re-entry debounce
  h.pushHistory('IDTWIN', 'v2 verified against the ledger. [STATUS:REVIEW]');
  await h.engine.tick();
  updated = await h.chairStore.getTaskById(task.id);
  assert.equal(updated.status, 'review');
  assert.ok(await h.chairStore.getLatestAcceptanceSummary(task.id), 'settled review persists the summary');
  assert.deepEqual((await h.relayRows()).map((row) => row.kind), ['review']);

  // A rework AFTER the settled review reaches the origin chat (F2 relay gap).
  h.clock.t += 61_000;
  h.pushHistory('IDTWIN', 'one more defect found — back to work. [STATUS:EXECUTING]');
  await h.engine.tick();
  updated = await h.chairStore.getTaskById(task.id);
  assert.equal(updated.status, 'executing');
  assert.deepEqual(
    (await h.relayRows()).map((row) => row.kind),
    ['review', 'rework'],
    'rework relay emitted only because the review had been delivered',
  );
});

// ---------------------------------------------------------------------------
// P3: truncation resilience
// ---------------------------------------------------------------------------

test('P3: a truncated chair reply is retried once and the complete retry is posted', async () => {
  const h = createEngineHarness('metabot-gt-fix-trunc-');
  await h.seedTask('executing');
  h.pushHistory('IDWORKER1', '[DELIVERABLE] https://example.com/report done');

  h.llmTurns.push('verdict table:\n| item | pass |\n|---|---|\n| 1 | 2'); // cut mid-table
  h.llmTurns.push('verified against the ledger — entering review\n[STATUS:REVIEW]');
  await h.engine.tick();

  assert.equal(h.llmCalls.length, 2, 'chair turn retried once');
  assert.ok(
    h.llmCalls[1].prompt.includes('cut off mid-structure'),
    'retry prompt carries the truncation instruction',
  );
  const chairPins = h.pins.filter((pin) => pin.label === 'twin-bot');
  assert.equal(chairPins.length, 1, 'exactly one chair post');
  assert.ok(
    pinPlaintext(chairPins[0]).includes('verified against the ledger'),
    'the complete retry is what got posted',
  );
});

test('P3: a chair message that still lands truncated earns a re-issue host note', async () => {
  const h = createEngineHarness('metabot-gt-fix-truncnote-');
  const task = await h.seedTask('executing');
  h.pushHistory('IDTWIN', 'acceptance table:\n| item | pass |\n|---|---|\n| 1 | 2');

  h.llmTurns.push('[NO_REPLY]'); // host-notes delivery turn
  await h.engine.tick();

  const notes = await h.chairStore.listHostNotes(task.id);
  const truncated = notes.filter((note) => note.dedupeKey === `truncated:${task.id}:0`);
  assert.equal(truncated.length, 1, 'one deduped truncation note');
  assert.equal(truncated[0].kind, 'parse');
  assert.ok(truncated[0].body.includes('cut off mid-structure'));
  assert.ok(truncated[0].consumedAt != null, 'note delivered to the chair');
});

// ---------------------------------------------------------------------------
// P4: completed work request logs once
// ---------------------------------------------------------------------------

test('P4: a completed work request logs its completion once, not every tick', async () => {
  const h = createEngineHarness('metabot-gt-fix-log-', { workerSessions: true });
  await h.seedTask('executing');
  h.pushHistory('IDTWIN', '@worker 1 @worker 2 both please report', { mention: ['IDWORKER1', 'IDWORKER2'] });

  await h.engine.tick(); // request for worker-1 created; deferred
  let requests = await h.chairStore.listWorkRequests();
  assert.equal(requests.length, 1);
  await h.chairStore.updateWorkRequest(requests[0].id, { status: 'completed', handoff: 'done-1' });

  await h.engine.tick(); // worker-1 done (logs), worker-2 request created; deferred
  await h.engine.tick(); // worker-1 done again (must NOT re-log), worker-2 pending
  requests = await h.chairStore.listWorkRequests();
  assert.equal(requests.length, 2);
  await h.chairStore.updateWorkRequest(requests[1].id, { status: 'completed', handoff: 'done-2' });
  await h.engine.tick(); // both done; cursor advances

  const completionLogs = h.logs.filter((line) => line.includes('completed by the host'));
  assert.equal(completionLogs.length, 2, 'each request logged exactly once');
  assert.ok(completionLogs[0] !== completionLogs[1] || requests.length === 2);
});

// ---------------------------------------------------------------------------
// P1: roster race — members-first create + coverage re-check
// ---------------------------------------------------------------------------

test('P1: createGroupTask persists the full roster before the first on-chain join lands', async () => {
  const systemHome = mkdtempTempRootSync('metabot-gt-fix-roster-');
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
    makeProfile('worker-2', 'worker', 'IDWORKER2'),
  ];
  const statePath = path.join(
    profiles[0].homeDir, '.runtime', 'grouptask', 'state.json',
  );
  const memberCountsAtJoin = [];
  const makeSigner = (label) => ({
    async writePin(request) {
      pinSeq += 1;
      if (request.path === '/protocols/simplegroupjoin') {
        // Member-row count at the moment this join pin is written.
        memberCountsAtJoin.push(JSON.parse(readFileSync(statePath, 'utf8')).members.length);
      }
      const pinId = `pin-${label}-${pinSeq}`;
      pins.push({ label, pinId, ...request });
      return { pinId, txId: `tx-${pinSeq}` };
    },
  });
  const fetchImpl = async (input) => {
    const url = String(input);
    if (url.includes('/group-info')) {
      return jsonResponse({ code: 0, data: { groupId: new URL(url).searchParams.get('groupId') } });
    }
    if (url.includes('/group-member-list')) return jsonResponse({ code: 0, data: { list: [] } });
    if (url.includes('/group-chat-list-by-index')) return jsonResponse({ code: 0, data: { list: [] } });
    throw new Error(`Unexpected fake indexer URL: ${url}`);
  };
  const ctx = {
    listProfiles: async () => profiles,
    getProfile: async (slug) => profiles.find((profile) => profile.slug === slug) ?? null,
    signerForSlug: async (slug) => makeSigner(slug),
    ownerIdentity: async () => ({
      globalMetaId: 'IDOWNER', metaId: 'meta-owner', name: 'Owner', signer: makeSigner('owner'),
    }),
    transport: { indexerHosts: ['https://fake-indexer.test'], fetchImpl },
  };

  const { task } = await createGroupTask(ctx, {
    title: 'Roster race',
    goal: 'Every seat visible from the first tick',
    workerSlugs: ['worker-1', 'worker-2'],
    seatRoles: { 'worker-1': 'content', 'worker-2': 'domain:design' },
  });

  assert.equal(task.members.length, 3);
  assert.ok(memberCountsAtJoin.length >= 2, 'worker joins observed');
  assert.ok(
    memberCountsAtJoin.every((count) => count === 3),
    `every join landed after the full roster was persisted (saw ${memberCountsAtJoin.join(',')})`,
  );
  // P5: seat roles persisted on the member rows.
  const roles = Object.fromEntries(task.members.map((member) => [member.slug, member.seatRole ?? null]));
  assert.equal(roles['worker-1'], 'content');
  assert.equal(roles['worker-2'], 'domain:design');
});

test('P1: the planning coverage net names the seats a stale plan dropped', async () => {
  const h = createEngineHarness('metabot-gt-fix-coverage-');
  const task = await h.seedTask('planning');
  h.pushHistory('IDTWIN', '[GROUP TASK] Live-run fixes task');

  const planText = '@worker 1 you do everything\n[STATUS:EXECUTING]';
  h.llmTurns.push(planText); // planning turn
  h.llmTurns.push('[NO_REPLY]'); // host-notes delivery turn (coverage note)
  await h.engine.tick();

  // Round-trip: the plan lands; the transition-time re-check sees the same gap.
  h.pushHistory('IDTWIN', planText, { mention: ['IDWORKER1'] });
  h.llmTurns.push('[WORKING] on it'); // worker reply turn
  h.llmTurns.push('[NO_REPLY]'); // host-notes delivery turn (second coverage note)
  await h.engine.tick();

  assert.equal((await h.chairStore.getTaskById(task.id)).status, 'executing');
  const notes = await h.chairStore.listHostNotes(task.id);
  const coverage = notes.filter((note) => note.kind === 'plan_coverage');
  assert.ok(coverage.length >= 1, 'coverage note recorded');
  assert.ok(
    coverage.every((note) => note.target.includes('worker 2')),
    `dropped seat named (targets: ${coverage.map((note) => note.target).join(' | ')})`,
  );
});

// ---------------------------------------------------------------------------
// P5: seat roles reach the chair's roster profiles
// ---------------------------------------------------------------------------

test('P5: member seat roles render into the chair system prompt roster profiles', async () => {
  const h = createEngineHarness('metabot-gt-fix-seatrole-');
  await h.seedTask('planning', { seatRole1: 'content', seatRole2: 'domain:design' });
  h.pushHistory('IDTWIN', '[GROUP TASK] Live-run fixes task');

  h.llmTurns.push('@worker 1 research; @worker 2 design\n[STATUS:EXECUTING]');
  await h.engine.tick();

  assert.equal(h.llmCalls.length >= 1, true);
  const systemPrompt = h.llmCalls[0].systemPrompt;
  assert.ok(systemPrompt.includes('## Roster profiles'), 'profiles section rendered');
  assert.ok(systemPrompt.includes('worker 1 (worker) — Role: content'), 'seat role for worker-1 rendered');
  assert.ok(systemPrompt.includes('worker 2 (worker) — Role: domain:design'), 'seat role for worker-2 rendered');
});
