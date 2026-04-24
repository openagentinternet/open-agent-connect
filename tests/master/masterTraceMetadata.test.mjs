import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { buildSessionTrace } = require('../../dist/core/chat/sessionTrace.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const {
  buildMasterTraceMetadata,
} = require('../../dist/core/master/masterTrace.js');

function createProfileHome(prefix, slug = 'test-profile') {
  const systemHome = mkdtempSync(path.join(tmpdir(), prefix));
  const homeDir = path.join(systemHome, '.metabot', 'profiles', slug);
  mkdirSync(homeDir, { recursive: true });
  return homeDir;
}

test('ask master traces include askMaster.flow and askMaster.canonicalStatus', () => {
  const homeDir = createProfileHome('metabot-master-trace-');
  const exportRoot = resolveMetabotPaths(homeDir).exportsRoot;
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
  const homeDir = createProfileHome('metabot-master-trace-suggested-');
  const exportRoot = resolveMetabotPaths(homeDir).exportsRoot;
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
  const homeDir = createProfileHome('metabot-master-trace-completed-suggest-');
  const exportRoot = resolveMetabotPaths(homeDir).exportsRoot;
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

test('auto ask master traces preserve auto metadata on the trace record', () => {
  const homeDir = createProfileHome('metabot-master-trace-auto-');
  const exportRoot = resolveMetabotPaths(homeDir).exportsRoot;
  const askMaster = buildMasterTraceMetadata({
    role: 'caller',
    latestEvent: 'auto_preview_prepared',
    publicStatus: 'awaiting_confirmation',
    requestId: 'master-req-auto-1',
    masterKind: 'debug',
    servicePinId: 'master-pin-1',
    providerGlobalMetaId: 'idq1provider',
    displayName: 'Official Debug Master',
    triggerMode: 'auto',
    contextMode: 'standard',
    confirmationMode: 'always',
    preview: {
      userTask: 'Diagnose why the caller remains blocked after repeated tool failures.',
      question: 'Should the Debug Master inspect the blocked caller flow now?',
    },
    auto: {
      reason: 'Repeated failures and a trusted Master make automatic Ask Master entry viable.',
      confidence: 0.85,
      frictionMode: 'preview_confirm',
      detectorVersion: 'phase3-v1',
      selectedMasterTrusted: true,
      sensitivity: {
        isSensitive: false,
        reasons: [],
      },
    },
  });

  const trace = buildSessionTrace({
    traceId: 'trace-master-auto-preview-1',
    channel: 'a2a',
    exportRoot,
    session: {
      id: 'master-trace-auto-preview-1',
      title: 'Official Debug Master Ask',
      type: 'a2a',
      metabotId: 7,
      peerGlobalMetaId: 'idq1provider',
      peerName: 'Official Debug Master',
      externalConversationId: 'master:idq1caller:idq1provider:trace-master-auto-preview-1',
    },
    a2a: {
      role: 'caller',
      publicStatus: 'awaiting_confirmation',
      latestEvent: 'auto_preview_prepared',
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
  assert.equal(trace.askMaster.triggerMode, 'auto');
  assert.deepEqual(trace.askMaster.auto, {
    reason: 'Repeated failures and a trusted Master make automatic Ask Master entry viable.',
    confidence: 0.85,
    frictionMode: 'preview_confirm',
    detectorVersion: 'phase3-v1',
    selectedMasterTrusted: true,
    sensitivity: {
      isSensitive: false,
      reasons: [],
    },
  });
});
