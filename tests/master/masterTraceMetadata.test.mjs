import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { buildSessionTrace } = require('../../dist/core/chat/sessionTrace.js');
const {
  buildMasterTraceMetadata,
} = require('../../dist/core/master/masterTrace.js');

test('ask master traces include askMaster.flow and askMaster.canonicalStatus', () => {
  const exportRoot = path.join(mkdtempSync(path.join(tmpdir(), 'metabot-master-trace-')), '.metabot', 'exports');
  const askMaster = buildMasterTraceMetadata({
    role: 'caller',
    latestEvent: 'master_preview_ready',
    publicStatus: 'awaiting_confirmation',
    requestId: 'master-req-1',
    masterKind: 'debug',
    servicePinId: 'master-pin-1',
    providerGlobalMetaId: 'idq1provider',
    displayName: 'Official Debug Master',
    triggerMode: 'manual',
    contextMode: 'standard',
    confirmationMode: 'always',
    preview: {
      userTask: 'Diagnose the failing local build.',
      question: 'Why does the local build fail only in this workspace?',
    },
  });

  const trace = buildSessionTrace({
    traceId: 'trace-master-preview-1',
    channel: 'a2a',
    exportRoot,
    session: {
      id: 'master-trace-preview-1',
      title: 'Official Debug Master Ask',
      type: 'a2a',
      metabotId: 7,
      peerGlobalMetaId: 'idq1provider',
      peerName: 'Official Debug Master',
      externalConversationId: 'master:idq1caller:idq1provider:trace-master-preview-1',
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
    askMaster,
  });

  assert.equal(trace.askMaster.flow, 'master');
  assert.equal(trace.askMaster.transport, 'simplemsg');
  assert.equal(trace.askMaster.canonicalStatus, 'awaiting_confirmation');
  assert.equal(trace.askMaster.requestId, 'master-req-1');
  assert.equal(trace.askMaster.masterKind, 'debug');
  assert.equal(trace.askMaster.displayName, 'Official Debug Master');
  assert.deepEqual(trace.askMaster.preview, {
    userTask: 'Diagnose the failing local build.',
    question: 'Why does the local build fail only in this workspace?',
  });
});

test('suggested ask master traces keep the suggested canonical status and preview summary', () => {
  const exportRoot = path.join(mkdtempSync(path.join(tmpdir(), 'metabot-master-trace-suggested-')), '.metabot', 'exports');
  const askMaster = buildMasterTraceMetadata({
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
      userTask: 'Diagnose the repeated failing test loop.',
      question: 'Should I ask the Debug Master for help?',
    },
  });

  const trace = buildSessionTrace({
    traceId: 'trace-master-suggested-1',
    channel: 'a2a',
    exportRoot,
    session: {
      id: 'master-trace-suggested-1',
      title: 'Official Debug Master Ask',
      type: 'a2a',
      metabotId: 7,
      peerGlobalMetaId: 'idq1provider',
      peerName: 'Official Debug Master',
      externalConversationId: 'master:idq1caller:idq1provider:trace-master-suggested-1',
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
    askMaster,
  });

  assert.equal(trace.askMaster.flow, 'master');
  assert.equal(trace.askMaster.canonicalStatus, 'suggested');
  assert.equal(trace.askMaster.requestId, null);
  assert.equal(trace.askMaster.triggerMode, 'suggest');
  assert.deepEqual(trace.askMaster.preview, {
    userTask: 'Diagnose the repeated failing test loop.',
    question: 'Should I ask the Debug Master for help?',
  });
});

test('completed ask master traces preserve suggest trigger metadata after suggestion acceptance', () => {
  const exportRoot = path.join(mkdtempSync(path.join(tmpdir(), 'metabot-master-trace-completed-suggest-')), '.metabot', 'exports');
  const askMaster = buildMasterTraceMetadata({
    role: 'caller',
    latestEvent: 'provider_completed',
    publicStatus: 'completed',
    requestId: 'master-req-suggest-1',
    masterKind: 'debug',
    servicePinId: 'master-pin-1',
    providerGlobalMetaId: 'idq1provider',
    displayName: 'Official Debug Master',
    triggerMode: 'suggest',
    contextMode: 'standard',
    confirmationMode: 'always',
    preview: {
      userTask: 'Diagnose the repeated preview/confirm loop.',
      question: 'Should I ask the Debug Master for help with this blocked flow?',
    },
    response: {
      status: 'completed',
      summary: 'The blocked flow needs a persisted preview snapshot before confirmation.',
      followUpQuestion: null,
      findings: ['The suggestion was accepted and the provider completed normally.'],
      recommendations: ['Keep triggerMode=suggest in the trace metadata after completion.'],
      risks: ['Losing the original suggest provenance makes trace review harder.'],
    },
  });

  const trace = buildSessionTrace({
    traceId: 'trace-master-completed-suggest-1',
    channel: 'a2a',
    exportRoot,
    session: {
      id: 'master-trace-completed-suggest-1',
      title: 'Official Debug Master Ask',
      type: 'a2a',
      metabotId: 7,
      peerGlobalMetaId: 'idq1provider',
      peerName: 'Official Debug Master',
      externalConversationId: 'master:idq1caller:idq1provider:trace-master-completed-suggest-1',
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
    askMaster,
  });

  assert.equal(trace.askMaster.flow, 'master');
  assert.equal(trace.askMaster.canonicalStatus, 'completed');
  assert.equal(trace.askMaster.triggerMode, 'suggest');
  assert.equal(trace.askMaster.response?.status, 'completed');
  assert.equal(trace.askMaster.response?.summary, 'The blocked flow needs a persisted preview snapshot before confirmation.');
});
