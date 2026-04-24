import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildSessionTrace,
} = require('../../dist/core/chat/sessionTrace.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const {
  exportSessionArtifacts,
} = require('../../dist/core/chat/transcriptExport.js');

function createProfileHome(prefix, slug = 'test-profile') {
  const systemHome = mkdtempSync(path.join(tmpdir(), prefix));
  const homeDir = path.join(systemHome, '.metabot', 'profiles', slug);
  mkdirSync(homeDir, { recursive: true });
  return homeDir;
}

function createTimeoutTrace(homeDir) {
  const paths = resolveMetabotPaths(homeDir);
  return buildSessionTrace({
    traceId: 'trace-a2a-timeout-2',
    channel: 'a2a',
    session: {
      id: 'chat-session-timeout-2',
      title: 'Weather Clarification',
      type: 'a2a',
      metabotId: 21,
      peerGlobalMetaId: 'idq-provider-weather',
      peerName: 'Weather Oracle',
      externalConversationId: 'a2a-session:idq-provider-weather:trace-a2a-time',
    },
    order: {
      id: 'order-a2a-timeout-2',
      role: 'buyer',
      serviceId: 'service-weather',
      serviceName: 'Weather Oracle',
      paymentTxid: 'c'.repeat(64),
      paymentCurrency: 'SPACE',
      paymentAmount: '0.0001',
    },
    a2a: {
      sessionId: 'a2a-session-timeout-2',
      taskRunId: 'run-timeout-2',
      role: 'caller',
      publicStatus: 'timeout',
      latestEvent: 'clarification_needed',
      taskRunState: 'needs_clarification',
      callerGlobalMetaId: 'idq-caller-alice',
      callerName: 'Alice',
      providerGlobalMetaId: 'idq-provider-weather',
      providerName: 'Weather Oracle',
      servicePinId: 'service-weather',
    },
    exportRoot: paths.exportsRoot,
  });
}

test('exportSessionArtifacts renders caller/remote identity and timeout semantics without hiding pending clarification flow', async () => {
  const homeDir = createProfileHome('metabot-chat-export-');
  const trace = createTimeoutTrace(homeDir);

  const artifacts = await exportSessionArtifacts({
    trace,
    transcript: {
      sessionId: trace.session.id,
      title: trace.session.title,
      messages: [
        {
          id: 'm1',
          type: 'user',
          timestamp: 1_744_444_444_000,
          content: 'Help me check tomorrow.',
        },
        {
          id: 'm2',
          type: 'clarification_request',
          timestamp: 1_744_444_445_000,
          content: 'Please tell me your timezone first.',
        },
        {
          id: 'm3',
          type: 'clarification_answer',
          timestamp: 1_744_444_446_000,
          content: 'UTC+8',
        },
        {
          id: 'm4',
          type: 'assistant',
          timestamp: 1_744_444_447_000,
          content: 'Foreground wait timed out while the remote MetaBot was still processing.',
        },
      ],
    },
  });

  const transcriptMarkdown = readFileSync(artifacts.transcriptMarkdownPath, 'utf8');
  assert.match(transcriptMarkdown, /Caller MetaBot: Alice \(idq-caller-alice\)/);
  assert.match(transcriptMarkdown, /Remote MetaBot: Weather Oracle \(idq-provider-weather\)/);
  assert.match(transcriptMarkdown, /A2A Session ID: a2a-session-timeout-2/);
  assert.match(transcriptMarkdown, /Task Run ID: run-timeout-2/);
  assert.match(transcriptMarkdown, /Public Status: timeout/);
  assert.match(
    transcriptMarkdown,
    /Foreground timeout reached; the remote MetaBot may still continue processing\./
  );

  const clarificationRequestIndex = transcriptMarkdown.indexOf('Please tell me your timezone first.');
  const clarificationAnswerIndex = transcriptMarkdown.indexOf('UTC+8');
  const timeoutIndex = transcriptMarkdown.indexOf('Foreground wait timed out while the remote MetaBot was still processing.');
  assert.notEqual(clarificationRequestIndex, -1);
  assert.notEqual(clarificationAnswerIndex, -1);
  assert.notEqual(timeoutIndex, -1);
  assert.ok(clarificationRequestIndex < clarificationAnswerIndex);
  assert.ok(clarificationAnswerIndex < timeoutIndex);

  const traceMarkdown = readFileSync(artifacts.traceMarkdownPath, 'utf8');
  assert.match(traceMarkdown, /Public Status: timeout/);
  assert.match(traceMarkdown, /Latest Event: clarification_needed/);
  assert.match(traceMarkdown, /Task Run State: needs_clarification/);
  assert.match(traceMarkdown, /Trace remains inspectable after timeout; remote completion may still arrive later\./);
  assert.doesNotMatch(traceMarkdown, /Public Status: completed/);
});
