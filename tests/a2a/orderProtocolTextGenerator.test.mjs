import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const {
  createHostLlmExecutorBridge,
  setActiveHostLlmExecutorBridge,
} = require('../../dist/core/llm/hostLlmExecutorBridge.js');
const {
  createLlmOrderProtocolTextGenerator,
} = require('../../dist/core/a2a/orderProtocolTextGenerator.js');
const {
  createChatSkillWaitNoticeGenerator,
} = require('../../dist/core/chat/chatSkillWaitNotice.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');

function persona() {
  return {
    soul: 'Concise and friendly.',
    goal: 'Deliver great service.',
    role: 'A service provider MetaBot.',
    identity: {
      name: 'SellerBot',
      globalMetaId: 'idq1seller0000000000000000000000000000000',
    },
  };
}

async function createPairedProfile(hostOutput) {
  const root = await mkdtempTempRoot('oac-order-host-first-');
  const profileRoot = path.join(root, '.metabot', 'profiles', 'sellerbot');
  const paths = resolveMetabotPaths(profileRoot);
  await fs.mkdir(path.dirname(paths.dshLlmPath), { recursive: true });
  await fs.writeFile(paths.dshLlmPath, JSON.stringify({
    dshLlmProvider: 'deepseek',
    dshLlmModel: 'deepseek-chat',
  }), 'utf8');
  const bridge = createHostLlmExecutorBridge();
  const requests = [];
  bridge.attach((request) => {
    requests.push(request);
    void bridge.submitResult({ requestId: request.requestId, ok: true, output: hostOutput });
  });
  setActiveHostLlmExecutorBridge(bridge);
  return { paths, requests, restore: () => setActiveHostLlmExecutorBridge(null) };
}

test('order protocol text resolves the DSH pair first when a host executor is connected', async () => {
  const { paths, requests, restore } = await createPairedProfile('Thanks for the order — starting now.');
  try {
    const generator = createLlmOrderProtocolTextGenerator({
      llmExecutor: {
        async execute() { throw new Error('local executor must not run'); },
        async getSession() { return null; },
      },
    });
    const text = await generator.generateBuyerRatingText({
      paths,
      persona: persona(),
      traceId: 'trace-1',
      providerGlobalMetaId: 'idq1provider00000000000000000000000000000',
      providerName: 'ProviderBot',
      originalRequest: 'Write a poem about the sea.',
      serviceResult: 'A poem was delivered.',
      expectedOutputType: 'text',
      ratingRequestText: null,
    });
    assert.equal(typeof text, 'string');
    assert.ok(text.length > 0);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].provider, 'deepseek');
    assert.equal(requests[0].botSlug, 'sellerbot');
    assert.match(requests[0].system, /A service provider MetaBot\./);
    assert.match(requests[0].prompt, /poem about the sea/);
  } finally {
    restore();
  }
});

test('order protocol text falls back to the local chain when the host output normalizes to nothing', async () => {
  const { paths, restore } = await createPairedProfile('   ');
  try {
    // The local chain needs one healthy runtime + primary binding.
    const now = '2026-09-08T00:00:00.000Z';
    await fs.mkdir(path.dirname(paths.llmRuntimesPath), { recursive: true });
    await fs.writeFile(paths.llmRuntimesPath, JSON.stringify({
      version: 1,
      runtimes: [{
        id: 'llm-codex-test',
        provider: 'codex',
        displayName: 'Codex',
        binaryPath: '/bin/codex',
        version: '1.0.0',
        authState: 'authenticated',
        health: 'healthy',
        capabilities: ['tool-use'],
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
        healthCheckedAt: now,
      }],
    }), 'utf8');
    await fs.writeFile(paths.llmBindingsPath, JSON.stringify({
      version: 1,
      bindings: [{
        id: 'lb-sellerbot-primary',
        metaBotSlug: 'sellerbot',
        llmRuntimeId: 'llm-codex-test',
        role: 'primary',
        priority: 0,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      }],
    }), 'utf8');
    let cliCalls = 0;
    const generator = createLlmOrderProtocolTextGenerator({
      llmExecutor: {
        async execute() {
          cliCalls += 1;
          return 'cli-session-1';
        },
        async getSession() {
          return {
            sessionId: 'cli-session-1',
            status: 'completed',
            result: { status: 'completed', output: 'Local chain order text.' },
          };
        },
      },
    });
    const text = await generator.generateBuyerRatingText({
      paths,
      persona: persona(),
      traceId: 'trace-2',
      providerGlobalMetaId: 'idq1provider00000000000000000000000000000',
    });
    assert.equal(text, 'Local chain order text.');
    assert.equal(cliCalls, 1);
  } finally {
    restore();
  }
});

test('chat skill wait notice resolves the DSH pair first when wired', async () => {
  const { paths, restore } = await createPairedProfile('Let me check that for you — one moment.');
  try {
    const generator = createChatSkillWaitNoticeGenerator({
      runtimeResolver: {
        async resolveRuntime() { throw new Error('local resolver must not run'); },
        async selectMetaBot() { return null; },
        async markBindingUsed() { /* unused */ },
        async markRuntimeUnavailable() { /* unused */ },
      },
      llmExecutor: {
        async execute() { throw new Error('local executor must not run'); },
        async getSession() { return null; },
      },
      metaBotSlug: 'sellerbot',
      dshLlmPath: paths.dshLlmPath,
    });
    assert.notEqual(generator, null);
    const notice = await generator({
      conversation: {
        conversationId: 'pc-1',
        peerGlobalMetaId: 'peer-gm',
        peerName: 'PeerBot',
        topic: null,
        strategyId: null,
        state: 'active',
        turnCount: 3,
        lastDirection: 'inbound',
        createdAt: 1000,
        updatedAt: 2000,
      },
      persona: persona(),
      inboundMessage: {
        conversationId: 'pc-1',
        messageId: 'm1',
        direction: 'inbound',
        senderGlobalMetaId: 'peer',
        content: 'Can you help me with a skill-powered task please?',
        messagePinId: null,
        extensions: null,
        timestamp: 1000,
      },
    });
    assert.equal(typeof notice, 'string');
    assert.ok(notice.length > 0);
    assert.notEqual(notice.includes('Let me check that for you'), false);
  } finally {
    restore();
  }
});
