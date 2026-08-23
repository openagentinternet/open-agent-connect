import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { cleanupProfileHome, createProfileHome, deriveSystemHome } from '../helpers/profileHome.mjs';

const require = createRequire(import.meta.url);
const { createDefaultMetabotDaemonHandlers } = require('../../dist/daemon/defaultHandlers.js');
const { createSessionStateStore } = require('../../dist/core/a2a/sessionStateStore.js');
const { buildSessionTrace } = require('../../dist/core/chat/sessionTrace.js');
const { upsertIdentityProfile } = require('../../dist/core/identity/identityProfiles.js');
const { createRuntimeStateStore } = require('../../dist/core/state/runtimeStateStore.js');

async function writeUtf8(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
}

async function createStaleTerminalTraceFixture(t) {
  const homeDir = await createProfileHome('metabot-trace-artifact-refresh-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const runtimeStateStore = createRuntimeStateStore(homeDir);
  const sessionStateStore = createSessionStateStore(homeDir);
  const traceId = 'trace-stale-terminal-artifacts';
  const sessionId = 'session-stale-terminal-artifacts';
  const taskRunId = 'run-stale-terminal-artifacts';
  const baseTime = 1_776_000_000_000;
  const replyText = 'Tomorrow will be bright with a light wind.';
  await upsertIdentityProfile({
    systemHomeDir,
    name: 'Caller Bot',
    homeDir,
    globalMetaId: 'idq1caller',
    mvcAddress: 'mvc-caller',
    now: () => baseTime,
  });

  const staleTrace = buildSessionTrace({
    traceId,
    channel: 'a2a',
    exportRoot: runtimeStateStore.paths.exportsRoot,
    createdAt: baseTime,
    session: {
      id: sessionId,
      title: 'Weather Oracle Call',
      type: 'a2a',
      metabotId: 1,
      peerGlobalMetaId: 'idq1provider',
      peerName: 'Provider Bot',
      externalConversationId: 'trace-artifact-refresh-test',
    },
    a2a: {
      sessionId,
      taskRunId,
      role: 'caller',
      publicStatus: 'requesting_remote',
      latestEvent: 'request_sent',
      taskRunState: 'running',
      callerGlobalMetaId: 'idq1caller',
      callerName: 'Caller Bot',
      providerGlobalMetaId: 'idq1provider',
      providerName: 'Provider Bot',
      servicePinId: 'service-pin-1',
    },
  });

  await runtimeStateStore.writeState({
    identity: null,
    services: [],
    traces: [staleTrace],
    sellerOrders: [],
  });
  await writeUtf8(
    staleTrace.artifacts.transcriptMarkdownPath,
    '# Weather Oracle Call\nPublic Status: requesting_remote\n\n[assistant] Waiting for provider.\n',
  );
  await sessionStateStore.writeState({
    version: 1,
    sessions: [
      {
        sessionId,
        traceId,
        role: 'caller',
        state: 'completed',
        createdAt: baseTime,
        updatedAt: baseTime + 4,
        callerGlobalMetaId: 'idq1caller',
        providerGlobalMetaId: 'idq1provider',
        servicePinId: 'service-pin-1',
        currentTaskRunId: taskRunId,
        latestTaskRunState: 'completed',
      },
    ],
    taskRuns: [
      {
        runId: taskRunId,
        sessionId,
        state: 'completed',
        createdAt: baseTime + 1,
        updatedAt: baseTime + 4,
        startedAt: baseTime + 2,
        completedAt: baseTime + 4,
        failureCode: null,
        failureReason: null,
        clarificationRounds: [],
      },
    ],
    transcriptItems: [
      {
        id: `${traceId}-request`,
        sessionId,
        taskRunId,
        timestamp: baseTime + 1,
        type: 'user_task',
        sender: 'caller',
        content: 'Tell me tomorrow weather.',
        metadata: null,
      },
      {
        id: `${traceId}-delivery`,
        sessionId,
        taskRunId,
        timestamp: baseTime + 4,
        type: 'delivery',
        sender: 'provider',
        content: replyText,
        metadata: {
          event: 'provider_completed',
          publicStatus: 'completed',
          deliveryPinId: 'delivery-pin-1',
        },
      },
    ],
    cursors: { caller: null, provider: null },
    publicStatusSnapshots: [
      {
        sessionId,
        taskRunId,
        status: 'completed',
        mapped: true,
        rawEvent: 'provider_completed',
        resolvedAt: baseTime + 4,
      },
    ],
  });

  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
  });

  return {
    handlers,
    traceId,
    sessionId,
    replyText,
  };
}

async function assertFreshTranscriptArtifact(result, replyText) {
  assert.equal(result.ok, true);
  assert.equal(result.data.a2a.publicStatus, 'completed');
  assert.equal(result.data.resultText, replyText);
  const transcriptMarkdown = await readFile(result.data.artifacts.transcriptMarkdownPath, 'utf8');
  assert.match(transcriptMarkdown, /Public Status: completed/);
  assert.match(transcriptMarkdown, new RegExp(replyText));
}

test('trace get refreshes stale terminal A2A artifacts before returning', async (t) => {
  const { handlers, traceId, replyText } = await createStaleTerminalTraceFixture(t);

  const result = await handlers.trace.getTrace({ traceId });

  await assertFreshTranscriptArtifact(result, replyText);
});

test('trace session get refreshes stale terminal A2A artifacts before returning', async (t) => {
  const { handlers, sessionId, replyText } = await createStaleTerminalTraceFixture(t);

  const result = await handlers.trace.getSession({ sessionId });

  await assertFreshTranscriptArtifact(result, replyText);
});
