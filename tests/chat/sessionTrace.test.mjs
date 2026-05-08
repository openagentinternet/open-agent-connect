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

function createFixtureTrace(homeDir) {
  const paths = resolveMetabotPaths(homeDir);
  return buildSessionTrace({
    traceId: 'trace-weather-order-1',
    channel: 'metaweb_order',
    session: {
      id: 'session-weather-1',
      title: 'Weather Order',
      type: 'a2a',
      metabotId: 7,
      peerGlobalMetaId: 'seller-global-metaid',
      peerName: 'Seller Bot',
      externalConversationId: `metaweb_order:buyer:7:seller-global-metaid:${'a'.repeat(16)}`,
    },
    order: {
      id: 'order-weather-1',
      role: 'buyer',
      serviceId: 'service-weather',
      serviceName: 'Weather Oracle',
      paymentTxid: 'a'.repeat(64),
      paymentCurrency: 'SPACE',
      paymentAmount: '0.0001',
    },
    exportRoot: paths.exportsRoot,
  });
}

test('buildSessionTrace keeps explicit a2a session and task-run identity separate from chat session identity', () => {
  const homeDir = createProfileHome('metabot-chat-trace-');
  const paths = resolveMetabotPaths(homeDir);
  const trace = buildSessionTrace({
    traceId: 'trace-a2a-timeout-1',
    channel: 'a2a',
    session: {
      id: 'chat-session-timeout-1',
      title: 'Weather Timeout',
      type: 'a2a',
      metabotId: 11,
      peerGlobalMetaId: 'idq-provider-weather',
      peerName: 'Weather Oracle',
      externalConversationId: 'a2a-session:idq-provider-weather:trace-a2a-time',
    },
    order: {
      id: 'order-a2a-timeout-1',
      role: 'buyer',
      serviceId: 'service-weather',
      serviceName: 'Weather Oracle',
      paymentTxid: 'b'.repeat(64),
      paymentCurrency: 'SPACE',
      paymentAmount: '0.0001',
    },
    a2a: {
      sessionId: 'a2a-session-timeout-1',
      taskRunId: 'run-timeout-1',
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

  assert.equal(trace.session.id, 'chat-session-timeout-1');
  assert.equal(trace.a2a.sessionId, 'a2a-session-timeout-1');
  assert.equal(trace.a2a.taskRunId, 'run-timeout-1');
  assert.equal(trace.a2a.role, 'caller');
  assert.equal(trace.a2a.publicStatus, 'timeout');
  assert.equal(trace.a2a.latestEvent, 'clarification_needed');
  assert.equal(trace.a2a.taskRunState, 'needs_clarification');
  assert.equal(trace.a2a.callerGlobalMetaId, 'idq-caller-alice');
  assert.equal(trace.a2a.providerGlobalMetaId, 'idq-provider-weather');
  assert.equal(trace.a2a.servicePinId, 'service-weather');
});

test('buildSessionTrace preserves nullable refund order fields as null', () => {
  const homeDir = createProfileHome('metabot-chat-trace-');
  const paths = resolveMetabotPaths(homeDir);
  const trace = buildSessionTrace({
    traceId: 'trace-null-refund-fields',
    channel: 'a2a',
    session: {
      id: 'session-null-refund-fields',
      title: 'Refund Field Normalization',
      type: 'a2a',
    },
    order: {
      id: 'order-null-refund-fields',
      role: 'buyer',
      serviceId: 'service-weather',
      serviceName: 'Weather Oracle',
      paymentTxid: 'c'.repeat(64),
      paymentCurrency: 'SPACE',
      paymentAmount: '0.0001',
      failedAt: null,
      refundRequestedAt: null,
      refundCompletedAt: null,
      refundApplyRetryCount: null,
      nextRetryAt: null,
      refundedAt: null,
      updatedAt: null,
    },
    exportRoot: paths.exportsRoot,
  });

  assert.equal(trace.order.failedAt, null);
  assert.equal(trace.order.refundRequestedAt, null);
  assert.equal(trace.order.refundCompletedAt, null);
  assert.equal(trace.order.refundApplyRetryCount, null);
  assert.equal(trace.order.nextRetryAt, null);
  assert.equal(trace.order.refundedAt, null);
  assert.equal(trace.order.updatedAt, null);
});

test('exportSessionArtifacts writes transcript markdown under exports/chats', async () => {
  const homeDir = createProfileHome('metabot-chat-trace-');
  const paths = resolveMetabotPaths(homeDir);
  const trace = createFixtureTrace(homeDir);

  const artifacts = await exportSessionArtifacts({
    trace,
    transcript: {
      sessionId: 'session-weather-1',
      title: 'Weather Order',
      messages: [
        {
          id: 'm1',
          type: 'user',
          timestamp: 1_744_444_444_000,
          content: '[ORDER] help me check tomorrow',
          metadata: { direction: 'outgoing' },
        },
        {
          id: 'm2',
          type: 'assistant',
          timestamp: 1_744_444_445_000,
          content: 'Tomorrow looks favorable.',
          metadata: { direction: 'incoming' },
        },
      ],
    },
  });

  assert.equal(
    artifacts.transcriptMarkdownPath,
    path.join(paths.exportsRoot, 'chats', 'session-weather-1.md')
  );

  const markdown = readFileSync(artifacts.transcriptMarkdownPath, 'utf8');
  assert.match(markdown, /# Weather Order/);
  assert.match(markdown, /Session ID: session-weather-1/);
  assert.match(markdown, /Peer: Seller Bot \(seller-global-metaid\)/);
  assert.match(markdown, /\[user\] \[ORDER\] help me check tomorrow/);
  assert.match(markdown, /\[assistant\] Tomorrow looks favorable\./);
});

test('exportSessionArtifacts writes linked trace json and markdown with order, session, and transcript paths', async () => {
  const homeDir = createProfileHome('metabot-chat-trace-');
  const paths = resolveMetabotPaths(homeDir);
  const trace = createFixtureTrace(homeDir);

  const artifacts = await exportSessionArtifacts({
    trace,
    transcript: {
      sessionId: 'session-weather-1',
      title: 'Weather Order',
      messages: [
        {
          id: 'm1',
          type: 'user',
          timestamp: 1_744_444_444_000,
          content: '[ORDER] help me check tomorrow',
        },
      ],
    },
  });

  assert.equal(
    artifacts.traceJsonPath,
    path.join(paths.exportsRoot, 'traces', 'trace-weather-order-1.json')
  );
  assert.equal(
    artifacts.traceMarkdownPath,
    path.join(paths.exportsRoot, 'traces', 'trace-weather-order-1.md')
  );

  const traceJson = JSON.parse(readFileSync(artifacts.traceJsonPath, 'utf8'));
  assert.equal(traceJson.traceId, 'trace-weather-order-1');
  assert.equal(traceJson.channel, 'metaweb_order');
  assert.equal(traceJson.session.id, 'session-weather-1');
  assert.equal(traceJson.session.externalConversationId, `metaweb_order:buyer:7:seller-global-metaid:${'a'.repeat(16)}`);
  assert.equal(traceJson.order.id, 'order-weather-1');
  assert.equal(traceJson.order.paymentTxid, 'a'.repeat(64));
  assert.equal(traceJson.artifacts.transcriptMarkdownPath, artifacts.transcriptMarkdownPath);
  assert.equal(traceJson.artifacts.traceMarkdownPath, artifacts.traceMarkdownPath);

  const traceMarkdown = readFileSync(artifacts.traceMarkdownPath, 'utf8');
  assert.match(traceMarkdown, /# Trace trace-weather-order-1/);
  assert.match(traceMarkdown, /Order ID: order-weather-1/);
  assert.match(traceMarkdown, /Payment TXID: a{64}/);
  assert.match(traceMarkdown, /Transcript: .*session-weather-1\.md/);
});
