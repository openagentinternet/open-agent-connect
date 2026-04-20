import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { createRuntimeStateStore } = require('../../dist/core/state/runtimeStateStore.js');
const { createSessionStateStore } = require('../../dist/core/a2a/sessionStateStore.js');
const { createPendingMasterAskStateStore } = require('../../dist/core/master/masterPendingAskState.js');
const {
  createDefaultMetabotDaemonHandlers,
  rebuildTraceArtifactsFromSessionState,
} = require('../../dist/daemon/defaultHandlers.js');
const { buildSessionTrace } = require('../../dist/core/chat/sessionTrace.js');
const { buildMasterRequestJson, parseMasterRequest } = require('../../dist/core/master/masterMessageSchema.js');
const { buildMasterTraceMetadata } = require('../../dist/core/master/masterTrace.js');

function parseOutput(chunks) {
  return JSON.parse(chunks.join('').trim());
}

function buildRequest(traceId, requestId) {
  const parsed = parseMasterRequest(buildMasterRequestJson({
    type: 'master_request',
    version: '1.0.0',
    requestId,
    traceId,
    caller: {
      globalMetaId: 'idq1caller',
      name: 'Caller Bot',
      host: 'codex',
    },
    target: {
      masterServicePinId: 'master-pin-1',
      providerGlobalMetaId: 'idq1provider',
      masterKind: 'debug',
    },
    task: {
      userTask: 'Diagnose the failing local build.',
      question: 'Why does the local build fail only in this workspace?',
    },
    context: {
      workspaceSummary: 'Local workspace with a flaky build.',
      relevantFiles: ['src/index.ts'],
      artifacts: [],
    },
    trigger: {
      mode: 'manual',
      reason: 'Caller explicitly asked to consult the Master.',
    },
    desiredOutput: 'structured_help',
    extensions: {
      goal: 'Get a short diagnosis and next steps.',
      contextMode: 'standard',
      targetDisplayName: 'Official Debug Master',
    },
  }));

  assert.equal(parsed.ok, true);
  return parsed.value;
}

test('master trace reads ask master semantics instead of private chat wording', async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-master-trace-command-'));
  t.after(async () => {
    await rm(homeDir, { recursive: true, force: true });
  });

  const traceId = 'trace-master-preview-1';
  const requestId = 'master-req-1';
  const runtimeStateStore = createRuntimeStateStore(homeDir);
  const pendingStore = createPendingMasterAskStateStore(homeDir);
  const request = buildRequest(traceId, requestId);

  await runtimeStateStore.writeState({
    identity: {
      metabotId: 7,
      name: 'Caller Bot',
      createdAt: 1_776_000_000_000,
      path: "m/44'/10001'/0'/0/0",
      publicKey: 'pubkey',
      chatPublicKey: 'chat-pubkey',
      mvcAddress: 'mvc-address',
      btcAddress: 'btc-address',
      dogeAddress: 'doge-address',
      metaId: 'metaid-caller',
      globalMetaId: 'idq1caller',
    },
    services: [],
    traces: [
      buildSessionTrace({
        traceId,
        channel: 'a2a',
        exportRoot: runtimeStateStore.paths.exportRoot,
        session: {
          id: `master-${traceId}`,
          title: 'Official Debug Master Ask',
          type: 'a2a',
          metabotId: 7,
          peerGlobalMetaId: 'idq1provider',
          peerName: 'Official Debug Master',
          externalConversationId: `master:idq1caller:idq1provider:${traceId}`,
        },
        a2a: {
          role: 'caller',
          publicStatus: 'awaiting_confirmation',
          latestEvent: 'master_preview_ready',
          taskRunState: 'queued',
          callerGlobalMetaId: 'idq1caller',
          callerName: 'Caller Bot',
          providerGlobalMetaId: 'idq1provider',
          providerName: 'Official Debug Master',
          servicePinId: 'master-pin-1',
        },
        askMaster: buildMasterTraceMetadata({
          role: 'caller',
          latestEvent: 'master_preview_ready',
          publicStatus: 'awaiting_confirmation',
          requestId,
          masterKind: 'debug',
          servicePinId: 'master-pin-1',
          providerGlobalMetaId: 'idq1provider',
          displayName: 'Official Debug Master',
          triggerMode: 'manual',
          contextMode: 'standard',
          confirmationMode: 'always',
          preview: {
            userTask: request.task.userTask,
            question: request.task.question,
          },
        }),
      }),
    ],
  });

  await pendingStore.put({
    traceId,
    requestId,
    createdAt: 1_776_000_000_000,
    updatedAt: 1_776_000_000_000,
    confirmationState: 'awaiting_confirmation',
    requestJson: buildMasterRequestJson(request),
    request,
    target: {
      displayName: 'Official Debug Master',
      masterKind: 'debug',
      providerGlobalMetaId: 'idq1provider',
      servicePinId: 'master-pin-1',
    },
    preview: {
      intent: {
        userTask: request.task.userTask,
        question: request.task.question,
      },
    },
  });

  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    getDaemonRecord: () => null,
  });

  const stdout = [];
  const exitCode = await runCli(['master', 'trace', '--id', traceId], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      master: {
        trace: handlers.master.trace,
      },
    },
  });

  assert.equal(exitCode, 0);
  const payload = parseOutput(stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.flow, 'master');
  assert.equal(payload.data.display.title, 'Official Debug Master Ask');
  assert.equal(payload.data.display.statusText, 'Waiting for your confirmation');
  assert.equal(payload.data.canonicalStatus, 'awaiting_confirmation');
  assert.equal(payload.data.requestId, requestId);
  assert.equal(payload.data.preview.question, 'Why does the local build fail only in this workspace?');
  assert.equal(payload.data.response, null);
  assert.doesNotMatch(JSON.stringify(payload.data), /Private Chat|refund|rating|payment/i);
});

test('master trace renders suggested ask master traces before confirmation', async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-master-trace-suggested-command-'));
  t.after(async () => {
    await rm(homeDir, { recursive: true, force: true });
  });

  const traceId = 'trace-master-suggested-command-1';
  const runtimeStateStore = createRuntimeStateStore(homeDir);

  await runtimeStateStore.writeState({
    identity: {
      metabotId: 7,
      name: 'Caller Bot',
      createdAt: 1_776_000_000_000,
      path: "m/44'/10001'/0'/0/0",
      publicKey: 'pubkey',
      chatPublicKey: 'chat-pubkey',
      mvcAddress: 'mvc-address',
      btcAddress: 'btc-address',
      dogeAddress: 'doge-address',
      metaId: 'metaid-caller',
      globalMetaId: 'idq1caller',
    },
    services: [],
    traces: [
      buildSessionTrace({
        traceId,
        channel: 'a2a',
        exportRoot: runtimeStateStore.paths.exportRoot,
        session: {
          id: `master-${traceId}`,
          title: 'Official Debug Master Ask',
          type: 'a2a',
          metabotId: 7,
          peerGlobalMetaId: 'idq1provider',
          peerName: 'Official Debug Master',
          externalConversationId: `master:idq1caller:idq1provider:${traceId}`,
        },
        a2a: {
          role: 'caller',
          publicStatus: 'discovered',
          latestEvent: 'master_suggested',
          taskRunState: 'queued',
          callerGlobalMetaId: 'idq1caller',
          callerName: 'Caller Bot',
          providerGlobalMetaId: 'idq1provider',
          providerName: 'Official Debug Master',
          servicePinId: 'master-pin-1',
        },
        askMaster: buildMasterTraceMetadata({
          role: 'caller',
          canonicalStatus: 'suggested',
          latestEvent: 'master_suggested',
          publicStatus: 'discovered',
          requestId: null,
          masterKind: 'debug',
          servicePinId: 'master-pin-1',
          providerGlobalMetaId: 'idq1provider',
          displayName: 'Official Debug Master',
          triggerMode: 'suggest',
          contextMode: 'standard',
          confirmationMode: 'always',
          preview: {
            userTask: 'Diagnose the repeated failing local build loop.',
            question: 'Should I ask the Debug Master for help?',
          },
        }),
      }),
    ],
  });

  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    getDaemonRecord: () => null,
  });

  const stdout = [];
  const exitCode = await runCli(['master', 'trace', '--id', traceId], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      master: {
        trace: handlers.master.trace,
      },
    },
  });

  assert.equal(exitCode, 0);
  const payload = parseOutput(stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.flow, 'master');
  assert.equal(payload.data.canonicalStatus, 'suggested');
  assert.equal(payload.data.display.statusText, 'Suggested');
  assert.equal(payload.data.requestId, null);
  assert.equal(payload.data.triggerMode, 'suggest');
  assert.equal(payload.data.preview.question, 'Should I ask the Debug Master for help?');
});

test('master trace retains ask master metadata after caller trace artifacts are rebuilt', async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-master-trace-rebuild-'));
  t.after(async () => {
    await rm(homeDir, { recursive: true, force: true });
  });

  const traceId = 'trace-master-rebuild-1';
  const requestId = 'master-req-rebuild-1';
  const runtimeStateStore = createRuntimeStateStore(homeDir);
  const sessionStateStore = createSessionStateStore(homeDir);
  const request = buildRequest(traceId, requestId);
  const baseTrace = buildSessionTrace({
    traceId,
    channel: 'a2a',
    exportRoot: runtimeStateStore.paths.exportRoot,
    createdAt: 1_776_000_000_000,
    session: {
      id: `master-${traceId}`,
      title: 'Official Debug Master Ask',
      type: 'a2a',
      metabotId: 7,
      peerGlobalMetaId: 'idq1provider',
      peerName: 'Official Debug Master',
      externalConversationId: `master:idq1caller:idq1provider:${traceId}`,
    },
    a2a: {
      sessionId: 'a2a-master-rebuild-1',
      taskRunId: 'task-master-rebuild-1',
      role: 'caller',
      publicStatus: 'requesting_remote',
      latestEvent: 'request_sent',
      taskRunState: 'running',
      callerGlobalMetaId: 'idq1caller',
      callerName: 'Caller Bot',
      providerGlobalMetaId: 'idq1provider',
      providerName: 'Official Debug Master',
      servicePinId: 'master-pin-1',
    },
    askMaster: buildMasterTraceMetadata({
      role: 'caller',
      latestEvent: 'request_sent',
      publicStatus: 'requesting_remote',
      requestId,
      masterKind: 'debug',
      servicePinId: 'master-pin-1',
      providerGlobalMetaId: 'idq1provider',
      displayName: 'Official Debug Master',
      triggerMode: 'manual',
      contextMode: 'standard',
      confirmationMode: 'always',
      preview: {
        userTask: request.task.userTask,
        question: request.task.question,
      },
    }),
  });

  await runtimeStateStore.writeState({
    identity: {
      metabotId: 7,
      name: 'Caller Bot',
      createdAt: 1_776_000_000_000,
      path: "m/44'/10001'/0'/0/0",
      publicKey: 'pubkey',
      chatPublicKey: 'chat-pubkey',
      mvcAddress: 'mvc-address',
      btcAddress: 'btc-address',
      dogeAddress: 'doge-address',
      metaId: 'metaid-caller',
      globalMetaId: 'idq1caller',
    },
    services: [],
    traces: [baseTrace],
  });

  await sessionStateStore.writeState({
    version: 1,
    sessions: [
      {
        sessionId: 'a2a-master-rebuild-1',
        traceId,
        role: 'caller',
        state: 'completed',
        createdAt: 1_776_000_000_000,
        updatedAt: 1_776_000_000_100,
        callerGlobalMetaId: 'idq1caller',
        providerGlobalMetaId: 'idq1provider',
        servicePinId: 'master-pin-1',
        currentTaskRunId: 'task-master-rebuild-1',
        latestTaskRunState: 'completed',
      },
    ],
    taskRuns: [
      {
        runId: 'task-master-rebuild-1',
        sessionId: 'a2a-master-rebuild-1',
        state: 'completed',
        createdAt: 1_776_000_000_000,
        updatedAt: 1_776_000_000_100,
        startedAt: 1_776_000_000_000,
        completedAt: 1_776_000_000_100,
        failureCode: null,
        failureReason: null,
        clarificationRounds: [],
      },
    ],
    transcriptItems: [
      {
        id: `${traceId}-user`,
        sessionId: 'a2a-master-rebuild-1',
        taskRunId: 'task-master-rebuild-1',
        timestamp: 1_776_000_000_000,
        type: 'user',
        sender: 'caller',
        content: request.task.question,
        metadata: null,
      },
      {
        id: `${traceId}-provider`,
        sessionId: 'a2a-master-rebuild-1',
        taskRunId: 'task-master-rebuild-1',
        timestamp: 1_776_000_000_100,
        type: 'assistant',
        sender: 'provider',
        content: 'The provider recommends re-adding the source.',
        metadata: {
          event: 'provider_completed',
        },
      },
    ],
    cursors: {
      caller: null,
      provider: null,
    },
    publicStatusSnapshots: [
      {
        sessionId: 'a2a-master-rebuild-1',
        taskRunId: 'task-master-rebuild-1',
        status: 'completed',
        mapped: true,
        rawEvent: 'provider_completed',
        resolvedAt: 1_776_000_000_100,
      },
    ],
  });

  await rebuildTraceArtifactsFromSessionState({
    baseTrace,
    runtimeStateStore,
    sessionStateStore,
  });

  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    getDaemonRecord: () => null,
  });

  const stdout = [];
  const exitCode = await runCli(['master', 'trace', '--id', traceId], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      master: {
        trace: handlers.master.trace,
      },
    },
  });

  assert.equal(exitCode, 0);
  const payload = parseOutput(stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.requestId, requestId);
  assert.equal(payload.data.masterKind, 'debug');
  assert.equal(payload.data.triggerMode, 'manual');
  assert.equal(payload.data.contextMode, 'standard');
  assert.equal(payload.data.confirmationMode, 'always');
  assert.equal(payload.data.preview.question, 'Why does the local build fail only in this workspace?');
});

test('master trace renders completed ask master traces that originated from an accepted suggestion', async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-master-trace-suggest-completed-command-'));
  t.after(async () => {
    await rm(homeDir, { recursive: true, force: true });
  });

  const traceId = 'trace-master-suggest-completed-command-1';
  const requestId = 'master-req-suggest-completed-1';
  const runtimeStateStore = createRuntimeStateStore(homeDir);

  await runtimeStateStore.writeState({
    identity: {
      metabotId: 7,
      name: 'Caller Bot',
      createdAt: 1_776_000_000_000,
      path: "m/44'/10001'/0'/0/0",
      publicKey: 'pubkey',
      chatPublicKey: 'chat-pubkey',
      mvcAddress: 'mvc-address',
      btcAddress: 'btc-address',
      dogeAddress: 'doge-address',
      metaId: 'metaid-caller',
      globalMetaId: 'idq1caller',
    },
    services: [],
    traces: [
      buildSessionTrace({
        traceId,
        channel: 'a2a',
        exportRoot: runtimeStateStore.paths.exportRoot,
        session: {
          id: `master-${traceId}`,
          title: 'Official Debug Master Ask',
          type: 'a2a',
          metabotId: 7,
          peerGlobalMetaId: 'idq1provider',
          peerName: 'Official Debug Master',
          externalConversationId: `master:idq1caller:idq1provider:${traceId}`,
        },
        a2a: {
          role: 'caller',
          publicStatus: 'completed',
          latestEvent: 'provider_completed',
          taskRunState: 'completed',
          callerGlobalMetaId: 'idq1caller',
          callerName: 'Caller Bot',
          providerGlobalMetaId: 'idq1provider',
          providerName: 'Official Debug Master',
          servicePinId: 'master-pin-1',
        },
        askMaster: buildMasterTraceMetadata({
          role: 'caller',
          latestEvent: 'provider_completed',
          publicStatus: 'completed',
          requestId,
          masterKind: 'debug',
          servicePinId: 'master-pin-1',
          providerGlobalMetaId: 'idq1provider',
          displayName: 'Official Debug Master',
          triggerMode: 'suggest',
          contextMode: 'standard',
          confirmationMode: 'always',
          preview: {
            userTask: 'Diagnose the repeated blocked preview/confirm loop.',
            question: 'Should I ask the Debug Master for help with this blocked flow?',
          },
          response: {
            status: 'completed',
            summary: 'Persist the preview snapshot before confirmation so accepted suggestions can send normally.',
            followUpQuestion: null,
            findings: ['The accepted suggestion completed normally.'],
            recommendations: ['Keep suggest provenance in the completed trace.'],
            risks: ['Dropping suggest metadata hides why this trace exists.'],
          },
        }),
      }),
    ],
  });

  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    getDaemonRecord: () => null,
  });

  const stdout = [];
  const exitCode = await runCli(['master', 'trace', '--id', traceId], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      master: {
        trace: handlers.master.trace,
      },
    },
  });

  assert.equal(exitCode, 0);
  const payload = parseOutput(stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.flow, 'master');
  assert.equal(payload.data.canonicalStatus, 'completed');
  assert.equal(payload.data.triggerMode, 'suggest');
  assert.equal(payload.data.requestId, requestId);
  assert.equal(payload.data.response.status, 'completed');
  assert.match(payload.data.response.summary, /Persist the preview snapshot/i);
  assert.equal(payload.data.display.statusText, 'Completed');
});
