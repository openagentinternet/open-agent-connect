import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  createPrivateChatAutoReplyProfileDispatcher,
  replayUnhandledA2AOrderMessagesForProfiles,
} = require('../../dist/cli/runtime.js');
const { createA2AConversationStore } = require('../../dist/core/a2a/conversationStore.js');
const { persistA2AConversationMessage } = require('../../dist/core/a2a/conversationPersistence.js');
const { upsertIdentityProfile } = require('../../dist/core/identity/identityProfiles.js');

async function createProfileHome(t, slug) {
  const systemHomeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-auto-reply-dispatcher-'));
  const homeDir = path.join(systemHomeDir, '.metabot', 'profiles', slug);
  await mkdir(homeDir, { recursive: true });
  t.after(async () => {
    await rm(systemHomeDir, { recursive: true, force: true });
  });
  return homeDir;
}

async function createRegisteredProfile(t, systemHomeDir, input) {
  const homeDir = path.join(systemHomeDir, '.metabot', 'profiles', input.slug);
  await mkdir(homeDir, { recursive: true });
  await upsertIdentityProfile({
    systemHomeDir,
    name: input.name,
    homeDir,
    globalMetaId: input.globalMetaId,
    mvcAddress: input.mvcAddress ?? `mvc-${input.slug}`,
    now: () => input.createdAt ?? 1_777_000_000_000,
  });
  t.after(async () => {
    await rm(systemHomeDir, { recursive: true, force: true });
  });
  return homeDir;
}

test('auto-reply dispatcher handles inbound private chat for non-active local profiles', async (t) => {
  const betaHomeDir = await createProfileHome(t, 'beta-bot');
  const handled = [];

  const dispatcher = createPrivateChatAutoReplyProfileDispatcher({
    autoReplyConfig: {
      enabled: true,
      acceptPolicy: 'accept_all',
      defaultStrategyId: null,
    },
    resolvePeerChatPublicKey: async () => 'peer-chat-key',
    llmExecutor: {
      execute: async () => 'unused-session',
      getSession: async () => null,
    },
    createSignerForHome: (homeDir) => ({
      getIdentity: async () => ({
        globalMetaId: `identity-for-${path.basename(homeDir)}`,
        mvcAddress: `mvc-${path.basename(homeDir)}`,
      }),
      getPrivateChatIdentity: async () => ({
        globalMetaId: `identity-for-${path.basename(homeDir)}`,
        privateKeyHex: 'private-key',
        chatPublicKey: 'chat-public-key',
      }),
      writePin: async () => ({
        txids: ['tx-1'],
        pinId: 'pin-1',
        totalCost: 1,
        network: 'mvc',
        operation: 'create',
        path: '/protocols/simplemsg',
        contentType: 'application/json',
        encoding: 'utf-8',
        globalMetaId: `identity-for-${path.basename(homeDir)}`,
        mvcAddress: `mvc-${path.basename(homeDir)}`,
      }),
    }),
    createOrchestrator: (deps, config) => ({
      handleInboundMessage: async (message) => {
        handled.push({
          profileRoot: deps.paths.profileRoot,
          selfGlobalMetaId: await deps.selfGlobalMetaId(),
          config,
          message,
        });
      },
    }),
  });

  await dispatcher.handleInboundMessage({
    name: 'Beta Bot',
    slug: 'beta-bot',
    aliases: ['beta-bot'],
    homeDir: betaHomeDir,
    globalMetaId: 'idq1beta00000000000000000000000000000',
    mvcAddress: 'mvc-beta',
    createdAt: 1_777_000_000_000,
    updatedAt: 1_777_000_000_000,
  }, {
    fromGlobalMetaId: 'idq1peer00000000000000000000000000000',
    content: 'hello beta',
    messagePinId: 'incoming-pin-1',
    fromChatPublicKey: 'peer-chat-key',
    timestamp: 1_777_000_000_001,
    rawMessage: null,
  });

  assert.equal(handled.length, 1);
  assert.equal(handled[0].profileRoot, betaHomeDir);
  assert.equal(handled[0].selfGlobalMetaId, 'idq1beta00000000000000000000000000000');
  assert.equal(handled[0].message.content, 'hello beta');
});

test('auto-reply dispatcher routes inbound ORDER for non-active profiles to order handler', async (t) => {
  const betaHomeDir = await createProfileHome(t, 'beta-bot');
  const orderCalls = [];
  const genericCalls = [];

  const dispatcher = createPrivateChatAutoReplyProfileDispatcher({
    autoReplyConfig: {
      enabled: true,
      acceptPolicy: 'accept_all',
      defaultStrategyId: null,
    },
    resolvePeerChatPublicKey: async () => 'peer-chat-key',
    llmExecutor: {
      execute: async () => 'unused-session',
      getSession: async () => null,
    },
    handleOrderProtocolMessageForProfile: async (profile, message) => {
      orderCalls.push({
        slug: profile.slug,
        content: message.content,
        messagePinId: message.messagePinId,
      });
      return { ok: true, data: { handled: true } };
    },
    createSignerForHome: (homeDir) => ({
      getIdentity: async () => ({
        globalMetaId: `identity-for-${path.basename(homeDir)}`,
        mvcAddress: `mvc-${path.basename(homeDir)}`,
      }),
      getPrivateChatIdentity: async () => ({
        globalMetaId: `identity-for-${path.basename(homeDir)}`,
        privateKeyHex: 'private-key',
        chatPublicKey: 'chat-public-key',
      }),
      writePin: async () => ({
        txids: ['tx-1'],
        pinId: 'pin-1',
        totalCost: 1,
        network: 'mvc',
        operation: 'create',
        path: '/protocols/simplemsg',
        contentType: 'application/json',
        encoding: 'utf-8',
        globalMetaId: `identity-for-${path.basename(homeDir)}`,
        mvcAddress: `mvc-${path.basename(homeDir)}`,
      }),
    }),
    createOrchestrator: () => ({
      handleInboundMessage: async (message) => {
        genericCalls.push(message.content);
      },
    }),
  });

  await dispatcher.handleInboundMessage({
    name: 'Beta Bot',
    slug: 'beta-bot',
    aliases: ['beta-bot'],
    homeDir: betaHomeDir,
    globalMetaId: 'idq1beta00000000000000000000000000000',
    mvcAddress: 'mvc-beta',
    createdAt: 1_777_000_000_000,
    updatedAt: 1_777_000_000_000,
  }, {
    fromGlobalMetaId: 'idq1peer00000000000000000000000000000',
    content: '[ORDER] please run beta skill',
    messagePinId: `${'6'.repeat(64)}i0`,
    fromChatPublicKey: 'peer-chat-key',
    timestamp: 1_777_000_000_001,
    rawMessage: null,
  });

  assert.deepEqual(orderCalls, [{
    slug: 'beta-bot',
    content: '[ORDER] please run beta skill',
    messagePinId: `${'6'.repeat(64)}i0`,
  }]);
  assert.deepEqual(genericCalls, []);
});

test('startup recovery replays persisted inbound ORDER messages without provider sessions', async (t) => {
  const systemHomeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-a2a-order-replay-'));
  const didiGlobalMetaId = 'idq1didi00000000000000000000000000000';
  const ericGlobalMetaId = 'idq1eric00000000000000000000000000000';
  const didiHomeDir = await createRegisteredProfile(t, systemHomeDir, {
    name: 'didi',
    slug: 'didi',
    globalMetaId: didiGlobalMetaId,
  });
  const ericHomeDir = await createRegisteredProfile(t, systemHomeDir, {
    name: 'eric',
    slug: 'eric',
    globalMetaId: ericGlobalMetaId,
  });
  const orderTxid = '7'.repeat(64);
  const paymentTxid = '8'.repeat(64);
  const content = [
    '[ORDER] 用户请求获取最新微博热搜榜数据',
    '<raw_request>',
    '获取最新微博热搜',
    '</raw_request>',
    '支付金额 0.00001 SPACE',
    `txid: ${paymentTxid}`,
    'payment chain: mvc',
    'settlement kind: native',
    `service id: ${'9'.repeat(64)}i0`,
    'skill name: weibo-hot-trend',
    'output type: text',
  ].join('\n');

  await persistA2AConversationMessage({
    homeDir: ericHomeDir,
    local: {
      profileSlug: 'eric',
      globalMetaId: ericGlobalMetaId,
      name: 'eric',
      chatPublicKey: 'eric-chat-key',
    },
    peer: {
      globalMetaId: didiGlobalMetaId,
      name: 'didi',
      chatPublicKey: 'didi-chat-key',
    },
    message: {
      messageId: `${orderTxid}i0`,
      direction: 'incoming',
      content,
      pinId: `${orderTxid}i0`,
      txid: orderTxid,
      timestamp: 1_777_000_000,
      raw: { protocol: '/protocols/simplemsg' },
    },
  });

  const calls = [];
  const result = await replayUnhandledA2AOrderMessagesForProfiles({
    systemHomeDir,
    activeHomeDir: didiHomeDir,
    handleOrderProtocolMessage: async (message) => {
      calls.push(message);
      return { ok: true, data: { handled: true } };
    },
  });

  assert.equal(result.replayed, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].localProfileSlug, 'eric');
  assert.equal(calls[0].fromGlobalMetaId, didiGlobalMetaId);
  assert.equal(calls[0].content, content);
  assert.equal(calls[0].messagePinId, `${orderTxid}i0`);
});

test('startup recovery skips persisted ORDER messages that already have provider sessions', async (t) => {
  const systemHomeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-a2a-order-replay-'));
  const didiGlobalMetaId = 'idq1didi00000000000000000000000000000';
  const ericGlobalMetaId = 'idq1eric00000000000000000000000000000';
  const didiHomeDir = await createRegisteredProfile(t, systemHomeDir, {
    name: 'didi',
    slug: 'didi',
    globalMetaId: didiGlobalMetaId,
  });
  const ericHomeDir = await createRegisteredProfile(t, systemHomeDir, {
    name: 'eric',
    slug: 'eric',
    globalMetaId: ericGlobalMetaId,
  });
  const orderTxid = 'a'.repeat(64);
  const content = '[ORDER] already handled order';

  await persistA2AConversationMessage({
    homeDir: ericHomeDir,
    local: {
      profileSlug: 'eric',
      globalMetaId: ericGlobalMetaId,
      name: 'eric',
      chatPublicKey: 'eric-chat-key',
    },
    peer: {
      globalMetaId: didiGlobalMetaId,
      name: 'didi',
      chatPublicKey: 'didi-chat-key',
    },
    message: {
      messageId: `${orderTxid}i0`,
      direction: 'incoming',
      content,
      pinId: `${orderTxid}i0`,
      txid: orderTxid,
      timestamp: 1_777_000_000,
      raw: { protocol: '/protocols/simplemsg' },
    },
  });
  const store = createA2AConversationStore({
    homeDir: ericHomeDir,
    local: {
      profileSlug: 'eric',
      globalMetaId: ericGlobalMetaId,
      name: 'eric',
      chatPublicKey: 'eric-chat-key',
    },
    peer: {
      globalMetaId: didiGlobalMetaId,
      name: 'didi',
      chatPublicKey: 'didi-chat-key',
    },
  });
  await store.upsertSession({
    sessionId: `a2a-order-${orderTxid}`,
    type: 'service_order',
    role: 'provider',
    state: 'completed',
    orderTxid,
    paymentTxid: null,
    servicePinId: null,
    serviceName: null,
    outputType: null,
    createdAt: 1_777_000_000,
    updatedAt: 1_777_000_001,
  });

  const result = await replayUnhandledA2AOrderMessagesForProfiles({
    systemHomeDir,
    activeHomeDir: didiHomeDir,
    handleOrderProtocolMessage: async () => {
      throw new Error('already-handled order should not be replayed');
    },
  });

  assert.equal(result.replayed, 0);
  assert.equal(result.skipped, 1);
});
