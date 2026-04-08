import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  createSessionStateStore,
} = require('../../dist/core/a2a/sessionStateStore.js');
const {
  createRuntimeStateStore,
} = require('../../dist/core/state/runtimeStateStore.js');

function createSessionRecord() {
  return {
    sessionId: 'session-1',
    traceId: 'trace-1',
    role: 'caller',
    state: 'requesting_remote',
    createdAt: 1_744_444_444_000,
    updatedAt: 1_744_444_444_000,
    callerGlobalMetaId: 'idq-caller',
    providerGlobalMetaId: 'idq-provider',
    servicePinId: 'service-pin-1',
    currentTaskRunId: 'run-1',
    latestTaskRunState: 'running',
  };
}

function createTaskRunRecord() {
  return {
    runId: 'run-1',
    sessionId: 'session-1',
    state: 'running',
    createdAt: 1_744_444_444_000,
    updatedAt: 1_744_444_444_111,
    startedAt: 1_744_444_444_050,
    completedAt: null,
    failureCode: null,
    failureReason: null,
    clarificationRounds: [],
  };
}

test('session state store persists sessions and task runs in a dedicated hot file', async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-a2a-session-store-'));
  const store = createSessionStateStore(homeDir);

  await store.writeSession(createSessionRecord());
  await store.writeTaskRun(createTaskRunRecord());

  const state = await store.readState();
  assert.equal(state.version, 1);
  assert.equal(state.sessions.length, 1);
  assert.equal(state.sessions[0].sessionId, 'session-1');
  assert.equal(state.taskRuns.length, 1);
  assert.equal(state.taskRuns[0].runId, 'run-1');
  assert.match(store.sessionStatePath, /\.metabot\/hot\/a2a-session-state\.json$/);
  assert.match(readFileSync(store.sessionStatePath, 'utf8'), /session-1/);
});

test('session state store persists caller and provider loop cursors', async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-a2a-cursors-'));
  const store = createSessionStateStore(homeDir);

  await store.setLoopCursor('caller', 'caller-cursor-1');
  await store.setLoopCursor('provider', 42);

  assert.equal(await store.readLoopCursor('caller'), 'caller-cursor-1');
  assert.equal(await store.readLoopCursor('provider'), 42);
  assert.deepEqual((await store.readState()).cursors, {
    caller: 'caller-cursor-1',
    provider: 42,
  });
});

test('session state store appends transcript items and public status snapshots', async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-a2a-transcript-'));
  const store = createSessionStateStore(homeDir);

  await store.appendTranscriptItems([
    {
      id: 'tx-1',
      sessionId: 'session-1',
      taskRunId: 'run-1',
      timestamp: 1_744_444_444_100,
      type: 'message',
      sender: 'caller',
      content: 'hello remote metabot',
      metadata: { turn: 1 },
    },
    {
      id: 'tx-2',
      sessionId: 'session-1',
      timestamp: 1_744_444_444_200,
      type: 'result',
      sender: 'provider',
      content: 'done',
      metadata: null,
    },
  ]);
  await store.appendPublicStatusSnapshots([
    {
      sessionId: 'session-1',
      taskRunId: 'run-1',
      status: 'remote_executing',
      mapped: true,
      rawEvent: 'provider_executing',
      resolvedAt: 1_744_444_444_300,
    },
  ]);

  const state = await store.readState();
  assert.equal(state.transcriptItems.length, 2);
  assert.equal(state.transcriptItems[0].taskRunId, 'run-1');
  assert.equal(state.publicStatusSnapshots.length, 1);
  assert.equal(state.publicStatusSnapshots[0].status, 'remote_executing');
  assert.equal(state.publicStatusSnapshots[0].mapped, true);

  await store.appendTranscriptItems([
    {
      id: 'tx-1',
      sessionId: 'session-1',
      timestamp: 1_744_444_444_500,
      type: 'message',
      sender: 'caller',
      content: 'duplicate should be ignored',
      metadata: null,
    },
  ]);
  assert.equal((await store.readState()).transcriptItems.length, 2);
});

test('session state store does not mutate runtime-state identity/services/traces storage', async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-a2a-runtime-separation-'));
  const runtimeStore = createRuntimeStateStore(homeDir);
  const sessionStore = createSessionStateStore(homeDir);

  await runtimeStore.writeState({
    identity: {
      metabotId: 1,
      name: 'Alice',
      createdAt: 1_744_444_444_000,
      path: "m/44'/10001'/0'/0/0",
      publicKey: 'pubkey',
      chatPublicKey: 'chat-pubkey',
      mvcAddress: 'mvc-address',
      btcAddress: 'btc-address',
      dogeAddress: 'doge-address',
      metaId: 'meta-id',
      globalMetaId: 'idq123',
    },
    services: [],
    traces: [
      {
        traceId: 'trace-1',
        channel: 'codex->claude-code',
        createdAt: 1_744_444_444_000,
        session: {
          id: 'session-trace-1',
          title: 'Trace Session',
          type: 'a2a',
          metabotId: 1,
          peerGlobalMetaId: 'idq-provider',
          peerName: 'Provider',
          externalConversationId: 'ext-1',
        },
        order: null,
        artifacts: {
          transcriptMarkdownPath: '/tmp/transcript.md',
          traceMarkdownPath: '/tmp/trace.md',
          traceJsonPath: '/tmp/trace.json',
        },
      },
    ],
  });

  await sessionStore.writeSession(createSessionRecord());

  const runtimeState = await runtimeStore.readState();
  assert.equal(runtimeState.identity?.name, 'Alice');
  assert.equal(runtimeState.traces.length, 1);
  assert.match(readFileSync(runtimeStore.paths.runtimeStatePath, 'utf8'), /Trace Session/);
  assert.doesNotMatch(readFileSync(runtimeStore.paths.runtimeStatePath, 'utf8'), /session-1/);
  assert.match(readFileSync(sessionStore.sessionStatePath, 'utf8'), /session-1/);
});

test('session state store serializes concurrent updates without dropping data', async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-a2a-concurrency-'));
  const store = createSessionStateStore(homeDir);

  await Promise.all([
    store.appendTranscriptItems([
      {
        id: 'tx-a',
        sessionId: 'session-1',
        timestamp: 1_744_444_444_100,
        type: 'message',
        sender: 'caller',
        content: 'a',
        metadata: null,
      },
    ]),
    store.appendTranscriptItems([
      {
        id: 'tx-b',
        sessionId: 'session-1',
        timestamp: 1_744_444_444_101,
        type: 'message',
        sender: 'provider',
        content: 'b',
        metadata: null,
      },
    ]),
    store.setLoopCursor('caller', 'cursor-a'),
    store.setLoopCursor('provider', 'cursor-b'),
  ]);

  const state = await store.readState();
  assert.deepEqual(
    state.transcriptItems.map(item => item.id).sort(),
    ['tx-a', 'tx-b'],
  );
  assert.deepEqual(state.cursors, {
    caller: 'cursor-a',
    provider: 'cursor-b',
  });
});

test('session state store treats invalid json as empty state instead of bricking reads', async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-a2a-corrupt-state-'));
  const store = createSessionStateStore(homeDir);

  await store.ensureLayout();
  writeFileSync(store.sessionStatePath, '{"broken":', 'utf8');

  const state = await store.readState();
  assert.equal(state.version, 1);
  assert.deepEqual(state.sessions, []);
  assert.deepEqual(state.taskRuns, []);
  assert.deepEqual(state.transcriptItems, []);
});
