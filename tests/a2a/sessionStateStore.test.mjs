import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
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

function createProfileHome(prefix, slug = 'test-profile') {
  const systemHome = mkdtempSync(path.join(tmpdir(), prefix));
  const homeDir = path.join(systemHome, '.metabot', 'profiles', slug);
  mkdirSync(homeDir, { recursive: true });
  return homeDir;
}

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

test('session state store persists sessions and task runs in .runtime/sessions/a2a-session-state.json', async () => {
  const homeDir = createProfileHome('metabot-a2a-session-store-');
  const store = createSessionStateStore(homeDir);

  await store.writeSession(createSessionRecord());
  await store.writeTaskRun(createTaskRunRecord());

  const state = await store.readState();
  assert.equal(state.version, 1);
  assert.equal(state.sessions.length, 1);
  assert.equal(state.sessions[0].sessionId, 'session-1');
  assert.equal(state.taskRuns.length, 1);
  assert.equal(state.taskRuns[0].runId, 'run-1');
  assert.equal(store.sessionStatePath, store.paths.sessionStatePath);
  assert.match(readFileSync(store.sessionStatePath, 'utf8'), /session-1/);
  assert.equal(store.sessionStatePath.startsWith(store.paths.sessionsRoot), true);
  assert.equal(store.sessionStatePath.startsWith(store.paths.runtimeRoot), true);
});

test('session state store persists caller and provider loop cursors', async () => {
  const homeDir = createProfileHome('metabot-a2a-cursors-');
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
  const homeDir = createProfileHome('metabot-a2a-transcript-');
  const store = createSessionStateStore(homeDir);

  const firstAppend = await store.appendTranscriptItems([
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
  assert.equal(firstAppend.length, 2);

  const firstSnapshots = await store.appendPublicStatusSnapshots([
    {
      sessionId: 'session-1',
      taskRunId: 'run-1',
      status: 'remote_executing',
      mapped: true,
      rawEvent: 'provider_executing',
      resolvedAt: 1_744_444_444_300,
    },
  ]);
  assert.equal(firstSnapshots.length, 1);

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
  const dedupedTranscriptItems = await store.appendTranscriptItems([
    {
      id: 'tx-2',
      sessionId: 'session-1',
      timestamp: 1_744_444_444_600,
      type: 'result',
      sender: 'provider',
      content: 'duplicate from same batch should be ignored',
      metadata: null,
    },
    {
      id: 'tx-2',
      sessionId: 'session-1',
      timestamp: 1_744_444_444_601,
      type: 'result',
      sender: 'provider',
      content: 'duplicate from same batch should also be ignored',
      metadata: null,
    },
  ]);
  assert.equal(dedupedTranscriptItems.length, 0);
  assert.equal((await store.readState()).transcriptItems.length, 2);

  const dedupedSnapshots = await store.appendPublicStatusSnapshots([
    {
      sessionId: 'session-1',
      taskRunId: 'run-1',
      status: 'remote_executing',
      mapped: true,
      rawEvent: 'provider_executing',
      resolvedAt: 1_744_444_444_300,
    },
  ]);
  assert.equal(dedupedSnapshots.length, 0);
});

test('session state store does not mutate runtime-state identity/services/traces storage', async () => {
  const homeDir = createProfileHome('metabot-a2a-runtime-separation-');
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
  const homeDir = createProfileHome('metabot-a2a-concurrency-');
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

test('session state store serializes concurrent updates across processes', async () => {
  const homeDir = createProfileHome('metabot-a2a-multiprocess-');
  const distModulePath = path.join(process.cwd(), 'dist/core/a2a/sessionStateStore.js');

  const runWorker = (id) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          '-e',
          `
            const { createSessionStateStore } = require(${JSON.stringify(distModulePath)});
            const store = createSessionStateStore(${JSON.stringify(homeDir)});
            const suffix = ${JSON.stringify(id)};
            store.appendTranscriptItems([{
              id: 'tx-' + suffix,
              sessionId: 'session-1',
              timestamp: Date.now(),
              type: 'message',
              sender: 'caller',
              content: 'from-' + suffix,
              metadata: null,
            }]).then(() => process.exit(0)).catch((error) => {
              console.error(error && error.stack ? error.stack : String(error));
              process.exit(1);
            });
          `,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );

      let stderr = '';
      child.stderr.on('data', chunk => {
        stderr += chunk.toString();
      });
      child.on('exit', code => {
        if (code === 0) {
          resolve(undefined);
          return;
        }
        reject(new Error(stderr || `worker ${id} exited with code ${code}`));
      });
      child.on('error', reject);
    });

  await Promise.all([runWorker('one'), runWorker('two')]);

  const store = createSessionStateStore(homeDir);
  const state = await store.readState();
  assert.deepEqual(
    state.transcriptItems.map(item => item.id).sort(),
    ['tx-one', 'tx-two'],
  );
});

test('session state store treats invalid json as empty state instead of bricking reads', async () => {
  const homeDir = createProfileHome('metabot-a2a-corrupt-state-');
  const store = createSessionStateStore(homeDir);

  await store.ensureLayout();
  writeFileSync(store.sessionStatePath, '{"broken":', 'utf8');

  const state = await store.readState();
  assert.equal(state.version, 1);
  assert.deepEqual(state.sessions, []);
  assert.deepEqual(state.taskRuns, []);
  assert.deepEqual(state.transcriptItems, []);
  assert.ok(
    readdirSync(path.dirname(store.sessionStatePath)).some(entry => entry.startsWith('a2a-session-state.json.corrupt-'))
  );
});

test('session state store recovers from a stale lock owned by a dead process', async () => {
  const homeDir = createProfileHome('metabot-a2a-stale-lock-');
  const store = createSessionStateStore(homeDir);

  await store.ensureLayout();
  const lockPath = `${store.sessionStatePath}.lock`;
  writeFileSync(lockPath, JSON.stringify({ pid: -1, acquiredAt: Date.now() - (10 * 60 * 1000) }), 'utf8');
  const staleTimestamp = (Date.now() - (10 * 60 * 1000)) / 1000;
  utimesSync(lockPath, staleTimestamp, staleTimestamp);

  await store.writeSession(createSessionRecord());

  const state = await store.readState();
  assert.equal(state.sessions.length, 1);
  assert.equal(state.sessions[0].sessionId, 'session-1');
});

test('session state store recovers from a stale lock without pid metadata', async () => {
  const homeDir = createProfileHome('metabot-a2a-stale-lock-no-pid-');
  const store = createSessionStateStore(homeDir);

  await store.ensureLayout();
  const lockPath = `${store.sessionStatePath}.lock`;
  writeFileSync(lockPath, '{}', 'utf8');
  const staleTimestamp = (Date.now() - (2 * 60 * 1000)) / 1000;
  utimesSync(lockPath, staleTimestamp, staleTimestamp);

  await store.writeTaskRun(createTaskRunRecord());

  const state = await store.readState();
  assert.equal(state.taskRuns.length, 1);
  assert.equal(state.taskRuns[0].runId, 'run-1');
});

test('session state store caps transcript and public status history in canonical storage', async () => {
  const homeDir = createProfileHome('metabot-a2a-caps-');
  const store = createSessionStateStore(homeDir);

  await store.appendTranscriptItems(
    Array.from({ length: 2_005 }, (_, index) => ({
      id: `tx-${index}`,
      sessionId: 'session-1',
      timestamp: 1_744_444_444_000 + index,
      type: 'message',
      sender: 'caller',
      content: `message-${index}`,
      metadata: null,
    }))
  );
  await store.appendPublicStatusSnapshots(
    Array.from({ length: 1_005 }, (_, index) => ({
      sessionId: 'session-1',
      taskRunId: 'run-1',
      status: 'remote_executing',
      mapped: true,
      rawEvent: `provider_executing_${index}`,
      resolvedAt: 1_744_444_445_000 + index,
    }))
  );

  const state = await store.readState();
  assert.equal(state.transcriptItems.length, 2_000);
  assert.equal(state.transcriptItems[0].id, 'tx-5');
  assert.equal(state.publicStatusSnapshots.length, 1_000);
  assert.equal(state.publicStatusSnapshots[0].rawEvent, 'provider_executing_5');

  const persistedTranscriptItems = await store.appendTranscriptItems(
    Array.from({ length: 2_005 }, (_, index) => ({
      id: `tx-overflow-${index}`,
      sessionId: 'session-1',
      timestamp: 1_744_444_446_000 + index,
      type: 'message',
      sender: 'caller',
      content: `overflow-${index}`,
      metadata: null,
    }))
  );
  const persistedSnapshots = await store.appendPublicStatusSnapshots(
    Array.from({ length: 1_005 }, (_, index) => ({
      sessionId: 'session-1',
      taskRunId: 'run-1',
      status: 'remote_executing',
      mapped: true,
      rawEvent: `provider_overflow_${index}`,
      resolvedAt: 1_744_444_447_000 + index,
    }))
  );

  assert.equal(persistedTranscriptItems.length, 2_000);
  assert.equal(persistedSnapshots.length, 1_000);
});
