import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createAgentGameRuntime } from '../../dist/core/appSession/runtime.js';
import { createAppSessionStore } from '../../dist/core/appSession/store.js';
import { createAdapterSandbox } from '../../dist/core/appSession/adapterSandbox.js';
import { sha256Hex } from '../../dist/core/appSession/gamePackage.js';
import {
  decryptGroupContent,
  encryptGroupContent,
  parseAgentGameEnvelope,
} from '../../dist/core/appSession/groupChat.js';
import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const GROUP_ID = 'room1234567890abcdef';
const GAME_ID = 'testgame';
const RULES_HASH = `sha256:${'a'.repeat(64)}`;
const ME = 'idq1me0000000000000000000000000000000000000000000000';
const OPPONENT = 'idq1opp000000000000000000000000000000000000000000000';
const CREATOR = 'idq1creator000000000000000000000000000000000000000';

const ADAPTER = `
export function createMatch(config) {
  return initialState(config);
}
export function initialState(config = {}) {
  return { phase: 'lobby', turn: 'red', actionSeq: 1, seats: { red: null, black: null }, plies: [] };
}
export function getSeat(state, agentId) {
  if (state.seats.red === agentId) return 'red';
  if (state.seats.black === agentId) return 'black';
  return null;
}
export function reduce(state, event) {
  if (event.type === 'seat.claimed') {
    const seat = event.payload && event.payload.requestedRole;
    if ((seat === 'red' || seat === 'black') && !state.seats[seat]) {
      state.seats[seat] = event.meta.senderMetaId;
      if (state.seats.red && state.seats.black) state.phase = 'playing';
    }
    return state;
  }
  if (event.type === 'action') {
    const move = event.payload && event.payload.move;
    if (typeof move !== 'string' || !move) return state;
    if (event.actionSeq !== state.actionSeq) return state;
    state.plies.push({ move, by: event.meta.senderMetaId, seq: event.actionSeq });
    state.actionSeq += 1;
    state.turn = state.turn === 'red' ? 'black' : 'red';
    if (state.plies.length >= 4) state.phase = 'finished';
    return state;
  }
  return state;
}
export function getTurn(state) {
  if (state.phase === 'finished') return { phase: 'finished', seat: null, actionSeq: 0 };
  return { phase: state.phase, seat: state.turn, actionSeq: state.actionSeq };
}
export function getObservation(state, seat) {
  return { state, seat };
}
export function getActionSchema(state, seat) {
  return { type: 'object', properties: { move: { type: 'string' } }, required: ['move'] };
}
export function parseAction(llmText, context = {}) {
  const text = String(llmText || '').trim();
  if (!/^[a-z]\\d$/u.test(text)) return { error: 'expected a move like a1' };
  return { action: { move: text.toLowerCase() } };
}
export function validateAction(state, action, context = {}) {
  const move = action && action.move;
  if (typeof move !== 'string' || !/^[a-z]\\d$/u.test(move)) {
    return { ok: false, code: 'invalid_action', message: 'invalid move' };
  }
  return { ok: true, normalizedAction: { move } };
}
export function serializeState(state) {
  return JSON.parse(JSON.stringify(state));
}
export function getResult(state) {
  return { winner: null, finished: state.phase === 'finished' };
}
`;

const ADAPTER_HASH = `sha256:${sha256Hex(ADAPTER)}`;

function envelope(type, extra = {}, payload = {}) {
  return JSON.stringify({
    protocol: 'agent-game/1',
    gameId: GAME_ID,
    matchId: GROUP_ID,
    rulesHash: RULES_HASH,
    type,
    payload,
    ...extra,
  });
}

class MemoryGroupChat {
  constructor({ groupId = GROUP_ID, now } = {}) {
    this.groupId = groupId;
    this.now = now;
    this.messages = [];
    this.failWrites = 0;
    this.failActionWrites = 0;
    this.fetchError = null;
  }

  push(senderMetaId, plaintext) {
    const message = {
      index: this.messages.length,
      senderMetaId,
      timestamp: this.now(),
      content: encryptGroupContent(plaintext, this.groupId),
      encryption: 'aes',
      protocol: '/protocols/simplegroupchat',
      pinId: `pin-${this.messages.length}`,
      groupId: this.groupId,
    };
    this.messages.push(message);
    return message;
  }

  fetchSince(startIndex) {
    if (this.fetchError) {
      const error = new Error(this.fetchError.message);
      error.status = this.fetchError.status;
      throw error;
    }
    return this.messages
      .filter((message) => message.index >= startIndex)
      .map((message) => ({ ...message }));
  }

  actionEvents() {
    const events = [];
    for (const message of this.messages) {
      const parsed = parseAgentGameEnvelope(decryptGroupContent(message.content, this.groupId));
      if (parsed && parsed.type === 'action') events.push({ message, parsed });
    }
    return events;
  }
}

function createHarness(options = {}) {
  const storeDir = options.storeDir;
  const groupChat = options.groupChat ?? new MemoryGroupChat({ now: options.now });
  const llmTexts = [...(options.llmTexts ?? ['a1'])];
  const llmErrors = [...(options.llmErrors ?? [])];
  const llmCalls = [];
  const writeCalls = [];
  const auditEvents = [];
  const runtime = createAgentGameRuntime({
    store: createAppSessionStore(storeDir),
    fetchGroupMessages: async ({ groupId, startIndex, size }) => {
      if (groupId !== groupChat.groupId) return [];
      return groupChat.fetchSince(startIndex);
    },
    loadGamePackage: async ({ manifestUri }) => ({
      manifestUri,
      manifest: {
        protocol: 'agent-game/1',
        appId: 'llmchess.v2',
        gameId: GAME_ID,
        adapter: './adapter.js',
        adapterHash: ADAPTER_HASH,
        maxPlayers: 2,
      },
      adapterCode: ADAPTER,
      adapterHash: ADAPTER_HASH,
    }),
    createAdapterSandbox,
    llmComplete: async ({ actorId, messages }) => {
      llmCalls.push(messages);
      if (llmErrors.length) {
        const next = llmErrors.shift();
        if (next) throw next;
      }
      return { text: llmTexts.shift() ?? 'a1', model: 'fake' };
    },
    writeGroupChat: async ({ actorId, groupId, payload }) => {
      writeCalls.push(payload);
      const plaintext = decryptGroupContent(payload.content, groupId);
      const parsedPayload = parseAgentGameEnvelope(plaintext);
      if (parsedPayload && parsedPayload.type === 'action' && groupChat.failActionWrites > 0) {
        groupChat.failActionWrites -= 1;
        return { ok: false, code: 'write_failed', message: 'simulated broadcast failure' };
      }
      if (groupChat.failWrites > 0) {
        groupChat.failWrites -= 1;
        return { ok: false, code: 'write_failed', message: 'simulated broadcast failure' };
      }
      groupChat.push(ME, plaintext);
      return { ok: true, pinId: `pin-${groupChat.messages.length - 1}` };
    },
    audit: async (event) => {
      auditEvents.push(event);
    },
    now: options.now,
    logger: options.logger,
    leaseTtlMs: 3_600_000,
    heartbeatIntervalMs: 0,
    llmRetryBaseMs: 5,
    llmRetryMaxMs: 20,
    maxLlmAttempts: 2,
    writeRetryBaseMs: 5,
    writeRetryMaxMs: 20,
    maxWriteAttempts: 4,
  });
  return { runtime, groupChat, llmCalls, writeCalls, auditEvents };
}

const startParams = (overrides = {}) => ({
  appId: 'llmchess.v2',
  sessionType: 'agent-game',
  groupId: GROUP_ID,
  gameId: GAME_ID,
  manifestUri: 'metafile://abc123.zip',
  rulesHash: RULES_HASH,
  seat: 'red',
  agentId: ME,
  ttlMs: 86_400_000,
  budget: { llmCalls: 500, writes: 500 },
  ...overrides,
});

const actorBinding = {
  resourceUri: 'metaapp://llmchess.v2',
  actorId: 'me-profile',
  actorGlobalMetaId: ME,
};

function seedMatch(groupChat, { withOpponent = true } = {}) {
  groupChat.push(CREATOR, envelope('match.created', {}, {
    title: 'test match',
    manifestUri: 'metafile://abc123.zip',
    rulesHash: RULES_HASH,
    maxPlayers: 2,
    turnModel: 'sequential',
  }));
  if (withOpponent) {
    groupChat.push(OPPONENT, envelope('seat.claimed', { eventId: `${OPPONENT}:seat` }, {
      requestedRole: 'black',
      name: OPPONENT,
      model: 'host-llm',
      avatar: '',
    }));
  }
}

async function waitFor(predicate, timeoutMs = 3_000, intervalMs = 10) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) {
      throw new Error('waitFor timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function replayAdapterState(groupChat, adapterCode = ADAPTER) {
  const sandbox = createAdapterSandbox({
    adapterCode,
    adapterHash: `sha256:${sha256Hex(adapterCode)}`,
  });
  try {
    let state = await sandbox.call('initialState', [{ gameId: GAME_ID, rulesHash: RULES_HASH }]);
    for (const message of groupChat.messages) {
      const parsed = parseAgentGameEnvelope(decryptGroupContent(message.content, groupChat.groupId));
      if (!parsed || parsed.gameId !== GAME_ID || parsed.rulesHash !== RULES_HASH) continue;
      state = await sandbox.call('reduce', [state, {
        ...parsed,
        meta: { index: message.index, senderMetaId: message.senderMetaId, timestamp: message.timestamp },
      }]);
    }
    return { sandbox, state };
  } catch (error) {
    sandbox.dispose();
    throw error;
  }
}

async function pushOpponentAction(groupChat, now) {
  const { sandbox, state } = await replayAdapterState(groupChat);
  try {
    const turn = await sandbox.call('getTurn', [state]);
    const prevStateHash = `sha256:${sha256Hex(JSON.stringify(await sandbox.call('serializeState', [state])))}`;
    const actionSeq = turn.actionSeq;
    let draft = structuredClone(state);
    const move = `z${actionSeq}`;
    draft = await sandbox.call('reduce', [draft, {
      protocol: 'agent-game/1',
      gameId: GAME_ID,
      matchId: groupChat.groupId,
      rulesHash: RULES_HASH,
      type: 'action',
      actionSeq,
      prevStateHash,
      stateHash: '',
      payload: { move },
      meta: { index: Number.MAX_SAFE_INTEGER, senderMetaId: OPPONENT, timestamp: now() },
    }]);
    const stateHash = `sha256:${sha256Hex(JSON.stringify(await sandbox.call('serializeState', [draft])))}`;
    groupChat.push(OPPONENT, envelope('action', {
      eventId: `${OPPONENT}:evt-${actionSeq}`,
      actionSeq,
      prevStateHash,
      stateHash,
    }, { move }));
  } finally {
    sandbox.dispose();
  }
}

test('start creates a session, claims the seat and plays one action', async () => {
  let currentTime = 1_700_000_000_000;
  const now = () => currentTime;
  const storeDir = await mkdtempTempRoot('app-session-runtime-store-');
  const groupChat = new MemoryGroupChat({ now });
  seedMatch(groupChat);
  const harness = createHarness({ storeDir, groupChat, now });

  const session = await harness.runtime.start({ ...startParams(), ...actorBinding });
  assert.equal(session.status, 'running');
  assert.equal(session.seat, 'red');
  assert.equal(session.agentId, ME);
  assert.equal(session.adapterHash, ADAPTER_HASH);
  assert.equal(session.rulesHash, RULES_HASH);
  assert.equal(session.budget.llmCalls, 500);
  assert.equal(session.budget.writes, 500);

  await waitFor(() => harness.writeCalls.length >= 2);
  const events = groupChat.actionEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].parsed.actionSeq, 1);
  assert.match(events[0].parsed.eventId, new RegExp(`^${ME}:`));
  assert.equal(events[0].parsed.payload.move, 'a1');
  assert.ok(events[0].parsed.prevStateHash);
  assert.ok(events[0].parsed.stateHash);

  let latest = null;
  await waitFor(async () => {
    latest = await harness.runtime.status(session.sessionId, actorBinding);
    return latest.budget.writesUsed >= 2
      && latest.budget.llmCallsUsed >= 1
      && latest.lastActionSeq >= 1;
  });
  assert.equal(latest.status, 'running');
  assert.equal(latest.lastActionSeq, 1);
  assert.equal(latest.budget.writesUsed, 2);
  assert.equal(latest.budget.llmCallsUsed, 1);
  await harness.runtime.dispose();
});

test('start is idempotent for the same (groupId, seat, agentId, rulesHash)', async () => {
  const storeDir = await mkdtempTempRoot('app-session-runtime-store-');
  const groupChat = new MemoryGroupChat({ now: () => 1_700_000_000_000 });
  seedMatch(groupChat);
  const harness = createHarness({ storeDir, groupChat });
  const first = await harness.runtime.start({ ...startParams(), ...actorBinding });
  const second = await harness.runtime.start({ ...startParams(), ...actorBinding });
  assert.equal(second.sessionId, first.sessionId);
  await waitFor(() => harness.writeCalls.length >= 2);
  const writesAfterIdempotentStart = harness.writeCalls.length;
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(harness.writeCalls.length, writesAfterIdempotentStart);
  await harness.runtime.dispose();
});

test('realtime notification catches up and plays a second action', async () => {
  let currentTime = 1_700_000_000_000;
  const now = () => currentTime;
  const storeDir = await mkdtempTempRoot('app-session-runtime-store-');
  const groupChat = new MemoryGroupChat({ now });
  seedMatch(groupChat);
  const harness = createHarness({ storeDir, groupChat, now, llmTexts: ['a1', 'b2'] });
  const session = await harness.runtime.start({ ...startParams(), ...actorBinding });
  await waitFor(() => groupChat.actionEvents().length === 1);

  await pushOpponentAction(groupChat, now);
  harness.runtime.notifyGroupActivity(GROUP_ID);
  await waitFor(() => groupChat.actionEvents().length === 3);
  const events = groupChat.actionEvents();
  assert.equal(events[1].parsed.actionSeq, 2);
  assert.equal(events[2].parsed.actionSeq, 3);
  assert.equal(events[2].parsed.payload.move, 'b2');
  assert.equal(events[1].parsed.prevStateHash, events[0].parsed.stateHash);
  await harness.runtime.dispose();
});

test('rules_hash_mismatch is returned when the request differs from match.created', async () => {
  const storeDir = await mkdtempTempRoot('app-session-runtime-store-');
  const groupChat = new MemoryGroupChat({ now: () => 1_700_000_000_000 });
  seedMatch(groupChat);
  const harness = createHarness({ storeDir, groupChat });
  const preflight = await harness.runtime.validateStart({
    ...startParams({ rulesHash: `sha256:${'b'.repeat(64)}` }),
    ...actorBinding,
  });
  assert.equal(preflight.ok, false);
  assert.equal(preflight.error.code, 'rules_hash_mismatch');
  await harness.runtime.dispose();
});

test('group_not_found is returned when history is not accessible', async () => {
  const storeDir = await mkdtempTempRoot('app-session-runtime-store-');
  const groupChat = new MemoryGroupChat({ now: () => 1_700_000_000_000 });
  groupChat.fetchError = { status: 404, message: 'group not found' };
  const harness = createHarness({ storeDir, groupChat });
  const preflight = await harness.runtime.validateStart({ ...startParams(), ...actorBinding });
  assert.equal(preflight.ok, false);
  assert.equal(preflight.error.code, 'group_not_found');
  await harness.runtime.dispose();
});

test('seat_unavailable is returned when the requested seat is occupied', async () => {
  const storeDir = await mkdtempTempRoot('app-session-runtime-store-');
  const groupChat = new MemoryGroupChat({ now: () => 1_700_000_000_000 });
  groupChat.push(CREATOR, envelope('match.created', {}, {
    title: 'test match',
    manifestUri: 'metafile://abc123.zip',
    rulesHash: RULES_HASH,
    maxPlayers: 2,
    turnModel: 'sequential',
  }));
  groupChat.push(OPPONENT, envelope('seat.claimed', { eventId: `${OPPONENT}:seat-red` }, {
    requestedRole: 'red',
    name: OPPONENT,
    model: 'host-llm',
    avatar: '',
  }));
  const harness = createHarness({ storeDir, groupChat });
  await assert.rejects(
    harness.runtime.start({ ...startParams(), ...actorBinding }),
    (error) => error.code === 'seat_unavailable',
  );
  const sessions = await harness.runtime.list({ ...actorBinding });
  assert.equal(sessions.length, 0);
  await harness.runtime.dispose();
});

test('a second runner on the same (groupId, seat) is rejected with session_conflict', async () => {
  const storeDir = await mkdtempTempRoot('app-session-runtime-store-');
  const groupChat = new MemoryGroupChat({ now: () => 1_700_000_000_000 });
  seedMatch(groupChat);
  const harnessA = createHarness({ storeDir, groupChat });
  const sessionA = await harnessA.runtime.start({ ...startParams(), ...actorBinding });
  await waitFor(() => harnessA.writeCalls.length >= 2);

  // A different agent tries to run the same seat while A holds the lease.
  const otherAgent = 'idq1other00000000000000000000000000000000000000000000';
  const harnessB = createHarness({ storeDir, groupChat });
  await assert.rejects(
    harnessB.runtime.start({
      ...startParams({ agentId: otherAgent }),
      ...actorBinding,
      actorGlobalMetaId: otherAgent,
    }),
    (error) => error.code === 'session_conflict',
  );
  const statusA = await harnessA.runtime.status(sessionA.sessionId, actorBinding);
  assert.equal(statusA.status, 'running');
  await harnessA.runtime.dispose();
  await harnessB.runtime.dispose();
});

test('pause stops actions but keeps the lease; resume continues; stop releases', async () => {
  let currentTime = 1_700_000_000_000;
  const now = () => currentTime;
  const storeDir = await mkdtempTempRoot('app-session-runtime-store-');
  const groupChat = new MemoryGroupChat({ now });
  seedMatch(groupChat);
  const harness = createHarness({ storeDir, groupChat, now, llmTexts: ['a1', 'b2'] });
  const session = await harness.runtime.start({ ...startParams(), ...actorBinding });
  await waitFor(() => groupChat.actionEvents().length === 1);

  const paused = await harness.runtime.pause(session.sessionId, actorBinding);
  assert.equal(paused.status, 'paused');
  await pushOpponentAction(groupChat, now);
  harness.runtime.notifyGroupActivity(GROUP_ID);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const myEvents = groupChat.actionEvents().filter((entry) => entry.message.senderMetaId === ME);
  assert.equal(myEvents.length, 1, 'paused sessions must not write');
  const pausedAgain = await harness.runtime.pause(session.sessionId, actorBinding);
  assert.equal(pausedAgain.status, 'paused', 'pause is idempotent');

  const resumed = await harness.runtime.resume(session.sessionId, actorBinding);
  assert.equal(resumed.status, 'running');
  await waitFor(() => groupChat.actionEvents().length === 3);
  const events = groupChat.actionEvents();
  assert.equal(events[1].parsed.actionSeq, 2);
  assert.equal(events[2].parsed.actionSeq, 3);
  assert.equal(events[2].parsed.payload.move, 'b2');

  const stopped = await harness.runtime.stop(session.sessionId, actorBinding);
  assert.equal(stopped.status, 'stopped');
  const afterStop = await harness.runtime.resume(session.sessionId, actorBinding);
  assert.equal(afterStop.status, 'stopped', 'resume after stop must not restart');
  await harness.runtime.dispose();
});

test('write failures retry with the same eventId and never duplicate an action', async () => {
  const storeDir = await mkdtempTempRoot('app-session-runtime-store-');
  const groupChat = new MemoryGroupChat({ now: () => 1_700_000_000_000 });
  seedMatch(groupChat);
  const harness = createHarness({ storeDir, groupChat });
  groupChat.failActionWrites = 1; // the action write fails once, then retries
  const session = await harness.runtime.start({ ...startParams(), ...actorBinding });
  await waitFor(() => groupChat.actionEvents().length === 1);
  const events = groupChat.actionEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].parsed.actionSeq, 1);
  const actionWrites = [];
  for (const payload of harness.writeCalls) {
    const parsed = parseAgentGameEnvelope(decryptGroupContent(payload.content, GROUP_ID));
    if (parsed && parsed.type === 'action') actionWrites.push(parsed);
  }
  assert.equal(actionWrites.length, 2, 'the action must be retried with the same eventId');
  assert.equal(actionWrites[0].eventId, actionWrites[1].eventId);
  const status = await harness.runtime.status(session.sessionId, actorBinding);
  assert.equal(status.status, 'running');
  await harness.runtime.dispose();
});

test('budget exhaustion auto-pauses with budget_exhausted', async () => {
  const storeDir = await mkdtempTempRoot('app-session-runtime-store-');
  const groupChat = new MemoryGroupChat({ now: () => 1_700_000_000_000 });
  seedMatch(groupChat);
  const harness = createHarness({ storeDir, groupChat });
  const session = await harness.runtime.start({
    ...startParams({ budget: { llmCalls: 1, writes: 500 } }),
    ...actorBinding,
  });
  await waitFor(async () => {
    const status = await harness.runtime.status(session.sessionId, actorBinding);
    return status.status === 'paused';
  }, 3_000, 20);
  const status = await harness.runtime.status(session.sessionId, actorBinding);
  assert.equal(status.lastError.code, 'budget_exhausted');
  await harness.runtime.dispose();
});

test('authorization expiry auto-pauses with authorization_expired', async () => {
  let currentTime = 1_700_000_000_000;
  const now = () => currentTime;
  const storeDir = await mkdtempTempRoot('app-session-runtime-store-');
  const groupChat = new MemoryGroupChat({ now });
  seedMatch(groupChat);
  const harness = createHarness({ storeDir, groupChat, now, llmTexts: ['a1'] });
  const session = await harness.runtime.start({
    ...startParams({ ttlMs: 60_000 }),
    ...actorBinding,
  });
  await waitFor(() => groupChat.actionEvents().length === 1);
  currentTime += 61_000;
  harness.runtime.notifyGroupActivity(GROUP_ID);
  await waitFor(async () => {
    const status = await harness.runtime.status(session.sessionId, actorBinding);
    return status.status === 'paused';
  }, 3_000, 20);
  const status = await harness.runtime.status(session.sessionId, actorBinding);
  assert.equal(status.lastError.code, 'authorization_expired');
  await harness.runtime.dispose();
});

test('restart restores running sessions, catches up and keeps playing', async () => {
  let currentTime = 1_700_000_000_000;
  const now = () => currentTime;
  const storeDir = await mkdtempTempRoot('app-session-runtime-store-');
  const groupChat = new MemoryGroupChat({ now });
  seedMatch(groupChat);
  const harnessA = createHarness({ storeDir, groupChat, now, llmTexts: ['a1', 'b2'] });
  const sessionA = await harnessA.runtime.start({ ...startParams(), ...actorBinding });
  await waitFor(() => groupChat.actionEvents().length === 1);
  await harnessA.runtime.dispose();

  const harnessB = createHarness({ storeDir, groupChat, now, llmTexts: ['b2'] });
  const report = await harnessB.runtime.startRuntime();
  assert.equal(report.restored, 1);
  assert.equal(report.running, 1);
  const restored = await harnessB.runtime.status(sessionA.sessionId, actorBinding);
  assert.equal(restored.status, 'running');

  await pushOpponentAction(groupChat, now);
  harnessB.runtime.notifyGroupActivity(GROUP_ID);
  await waitFor(() => groupChat.actionEvents().length === 3);
  const events = groupChat.actionEvents();
  assert.equal(events[1].parsed.actionSeq, 2);
  assert.equal(events[2].parsed.actionSeq, 3);
  assert.equal(events[2].parsed.payload.move, 'b2');
  await harnessB.runtime.dispose();
});

test('restart marks running sessions paused with session_conflict when the seat is leased', async () => {
  const storeDir = await mkdtempTempRoot('app-session-runtime-store-');
  const groupChat = new MemoryGroupChat({ now: () => 1_700_000_000_000 });
  seedMatch(groupChat);
  const harnessA = createHarness({ storeDir, groupChat });
  const sessionA = await harnessA.runtime.start({ ...startParams(), ...actorBinding });
  await waitFor(() => harnessA.writeCalls.length >= 2);

  // A foreign daemon holds a live lease for the same (groupId, seat).
  const storePath = path.join(storeDir, 'app-session', 'runtime.json');
  const persisted = JSON.parse(await readFile(storePath, 'utf8'));
  persisted.leases = [{
    key: `${GROUP_ID}|red`,
    sessionId: 'sess-foreign-daemon',
    leaseId: 'lease-foreign',
    ownerId: 'other-daemon',
    expiresAt: Date.now() + 3_600_000,
    updatedAt: Date.now(),
  }];
  await writeFile(storePath, JSON.stringify(persisted), 'utf8');

  const harnessB = createHarness({ storeDir, groupChat });
  const report = await harnessB.runtime.startRuntime();
  assert.equal(report.conflicts, 1);
  const restored = await harnessB.runtime.status(sessionA.sessionId, actorBinding);
  assert.equal(restored.status, 'paused');
  assert.equal(restored.lastError.code, 'session_conflict');
  await harnessA.runtime.dispose();
  await harnessB.runtime.dispose();
});

test('finished sessions stop writing and release the lease', async () => {
  let currentTime = 1_700_000_000_000;
  const now = () => currentTime;
  const storeDir = await mkdtempTempRoot('app-session-runtime-store-');
  const groupChat = new MemoryGroupChat({ now });
  seedMatch(groupChat);
  const harness = createHarness({ storeDir, groupChat, llmTexts: ['a1', 'b2', 'a3', 'b4'] });
  const session = await harness.runtime.start({ ...startParams(), ...actorBinding });
  await waitFor(() => groupChat.actionEvents().length === 1);
  await pushOpponentAction(groupChat, now);
  harness.runtime.notifyGroupActivity(GROUP_ID);
  await waitFor(async () => {
    const status = await harness.runtime.status(session.sessionId, actorBinding);
    return status.lastActionSeq >= 2; // the opponent move was applied
  });
  await waitFor(() => groupChat.actionEvents().length === 3);
  await pushOpponentAction(groupChat, now);
  harness.runtime.notifyGroupActivity(GROUP_ID);
  await waitFor(async () => {
    const status = await harness.runtime.status(session.sessionId, actorBinding);
    return status.status === 'finished';
  }, 3_000, 20);
  assert.equal(groupChat.actionEvents().length, 4);
  const writesAtFinish = harness.writeCalls.length;
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(harness.writeCalls.length, writesAtFinish, 'finished sessions must not write');

  // Lease released, match finished: a fresh start on the same seat is refused.
  const harnessB = createHarness({ storeDir, groupChat });
  await harnessB.runtime.startRuntime();
  await assert.rejects(
    harnessB.runtime.start({ ...startParams(), ...actorBinding }),
    (error) => error.code === 'seat_unavailable',
  );
  await harness.runtime.dispose();
  await harnessB.runtime.dispose();
});

test('foreign game traffic and non-game messages are ignored', async () => {
  const storeDir = await mkdtempTempRoot('app-session-runtime-store-');
  const groupChat = new MemoryGroupChat({ now: () => 1_700_000_000_000 });
  seedMatch(groupChat);
  groupChat.push(ME, '{"protocol":"agent-game/1","gameId":"other-game","matchId":"' + GROUP_ID + '","rulesHash":"sha256:' + 'c'.repeat(64) + '","type":"action","actionSeq":99,"payload":{}}');
  groupChat.push(ME, 'ordinary group chat text');
  const harness = createHarness({ storeDir, groupChat });
  const session = await harness.runtime.start({ ...startParams(), ...actorBinding });
  await waitFor(() => harness.writeCalls.length >= 2);
  const status = await harness.runtime.status(session.sessionId, actorBinding);
  assert.equal(status.lastActionSeq, 1, 'foreign events must not affect the game state');
  await harness.runtime.dispose();
});

test('sessions are only visible to their owning actor', async () => {
  const storeDir = await mkdtempTempRoot('app-session-runtime-store-');
  const groupChat = new MemoryGroupChat({ now: () => 1_700_000_000_000 });
  seedMatch(groupChat);
  const harness = createHarness({ storeDir, groupChat });
  const session = await harness.runtime.start({ ...startParams(), ...actorBinding });
  await waitFor(() => harness.writeCalls.length >= 2);

  const otherActor = {
    resourceUri: 'metaapp://llmchess.v2',
    actorId: 'other-profile',
    actorGlobalMetaId: OPPONENT,
  };
  const visible = await harness.runtime.list(otherActor);
  assert.deepEqual(visible, []);
  await assert.rejects(
    harness.runtime.status(session.sessionId, otherActor),
    (error) => error.code === 'session_not_found',
  );
  await harness.runtime.dispose();
});

test('LLM failures pause with llm_unavailable after bounded retries', async () => {
  const storeDir = await mkdtempTempRoot('app-session-runtime-store-');
  const groupChat = new MemoryGroupChat({ now: () => 1_700_000_000_000 });
  seedMatch(groupChat);
  const harness = createHarness({
    storeDir,
    groupChat,
    llmErrors: [
      Object.assign(new Error('llm down'), { code: 'llm_unavailable' }),
      Object.assign(new Error('llm down'), { code: 'llm_unavailable' }),
    ],
  });
  const session = await harness.runtime.start({ ...startParams(), ...actorBinding });
  await waitFor(async () => {
    const status = await harness.runtime.status(session.sessionId, actorBinding);
    return status.status === 'paused';
  }, 3_000, 20);
  const status = await harness.runtime.status(session.sessionId, actorBinding);
  assert.equal(status.lastError.code, 'llm_unavailable');
  await harness.runtime.dispose();
});
