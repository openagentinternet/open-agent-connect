import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const {
  createPrivateChatAutoReplyProfileDispatcher,
  replayUnhandledA2AOrderMessagesForProfiles,
} = require('../../dist/cli/runtime.js');
const { createDefaultMetabotDaemonHandlers } = require('../../dist/daemon/defaultHandlers.js');
const { createLlmBindingStore } = require('../../dist/core/llm/llmBindingStore.js');
const { createLlmRuntimeStore } = require('../../dist/core/llm/llmRuntimeStore.js');
const { createA2AConversationStore } = require('../../dist/core/a2a/conversationStore.js');
const { persistA2AConversationMessage } = require('../../dist/core/a2a/conversationPersistence.js');
const { upsertIdentityProfile } = require('../../dist/core/identity/identityProfiles.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');

function healthyRuntime(id = 'runtime-codex', provider = 'codex') {
  const now = '2026-05-07T00:00:00.000Z';
  return {
    id,
    provider,
    displayName: `${provider} runtime`,
    binaryPath: `/bin/${provider}`,
    version: '1.0.0',
    authState: 'authenticated',
    health: 'healthy',
    capabilities: ['tool-use'],
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function healthyBinding(id, slug, runtimeId, role = 'primary') {
  const now = '2026-05-07T00:00:00.000Z';
  return {
    id,
    metaBotSlug: slug,
    llmRuntimeId: runtimeId,
    role,
    priority: 0,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

function chatRunnerInput() {
  return {
    conversation: {
      conversationId: 'pc-self-peer',
      peerGlobalMetaId: 'peer-gm-1',
      peerName: 'PeerBot',
      topic: null,
      strategyId: null,
      state: 'active',
      turnCount: 1,
      lastDirection: 'inbound',
      createdAt: 1000,
      updatedAt: 2000,
    },
    recentMessages: [
      { conversationId: 'pc-self-peer', messageId: 'm1', direction: 'inbound', senderGlobalMetaId: 'peer', content: 'weather?', messagePinId: null, extensions: null, timestamp: 1000 },
    ],
    persona: { role: 'Local bot', soul: 'Concise', goal: 'Help peers' },
    strategy: null,
    inboundMessage: {
      conversationId: 'pc-self-peer',
      messageId: 'm1',
      direction: 'inbound',
      senderGlobalMetaId: 'peer',
      content: 'weather?',
      messagePinId: null,
      extensions: null,
      timestamp: 1000,
    },
  };
}

async function configureAllowedChatSkillProfile(systemHomeDir, profileHomeDir, slug) {
  const paths = resolveMetabotPaths(profileHomeDir);
  await mkdir(path.dirname(paths.chatSkillPolicyPath), { recursive: true });
  await writeFile(paths.chatSkillPolicyPath, `${JSON.stringify({ allowChatSkills: ['metabot-weather'] }, null, 2)}\n`, 'utf8');

  const runtimeStore = createLlmRuntimeStore(paths);
  const bindingStore = createLlmBindingStore(paths);
  await runtimeStore.write({
    version: 1,
    runtimes: [healthyRuntime('runtime-codex', 'codex')],
  });
  await bindingStore.write({
    version: 1,
    bindings: [healthyBinding('binding-codex-primary', slug, 'runtime-codex')],
  });

  const skillRoot = path.join(systemHomeDir, '.codex', 'skills', 'metabot-weather');
  await mkdir(skillRoot, { recursive: true });
  await writeFile(path.join(skillRoot, 'SKILL.md'), '# metabot-weather\n', 'utf8');
  return paths;
}

async function createProfileHome(t, slug) {
  const systemHomeDir = await mkdtempTempRoot('metabot-auto-reply-dispatcher-');
  const homeDir = path.join(systemHomeDir, '.metabot', 'profiles', slug);
  await mkdir(homeDir, { recursive: true });
  t.after(async () => {
    await rm(systemHomeDir, { recursive: true, force: true });
  });
  return homeDir;
}

function readOnlySigner() {
  return {
    getIdentity: async () => ({}),
    getPrivateChatIdentity: async () => ({}),
    writePin: async () => {
      throw new Error('writePin should not be called by auto-reply config handlers');
    },
  };
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

test('auto-reply dispatcher routes outbound recovery through the target profile orchestrator', async (t) => {
  const betaHomeDir = await createProfileHome(t, 'beta-bot');
  const recoveryCalls = [];
  const profile = {
    name: 'Beta Bot',
    slug: 'beta-bot',
    aliases: ['beta-bot'],
    homeDir: betaHomeDir,
    globalMetaId: 'idq1beta00000000000000000000000000000',
    mvcAddress: 'mvc-beta',
    createdAt: 1_777_000_000_000,
    updatedAt: 1_777_000_000_000,
  };
  const outboundMessage = {
    conversationId: 'pc-beta-peer',
    messageId: 'logical-outbound-1',
    direction: 'outbound',
    senderGlobalMetaId: profile.globalMetaId,
    content: 'retry this message',
    messagePinId: 'dropped-pin',
    extensions: null,
    timestamp: 1_777_000_000_000,
  };
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
    createSignerForHome: () => readOnlySigner(),
    createOrchestrator: (deps) => ({
      retryOutboundMessage: async (peerGlobalMetaId, message) => {
        recoveryCalls.push({
          profileRoot: deps.paths.profileRoot,
          peerGlobalMetaId,
          message,
        });
        return true;
      },
      handleInboundMessage: async () => {},
      handleLocalGuidedTurn: async () => {},
    }),
  });

  const recovered = await dispatcher.retryOutboundMessage(
    profile,
    'idq1peer00000000000000000000000000000',
    outboundMessage,
  );

  assert.equal(recovered, true);
  assert.equal(recoveryCalls.length, 1);
  assert.equal(recoveryCalls[0].profileRoot, betaHomeDir);
  assert.equal(recoveryCalls[0].message.messageId, 'logical-outbound-1');
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

test('auto-reply dispatcher default runner wires allowed chat skills for non-active profiles', async (t) => {
  const systemHomeDir = await mkdtempTempRoot('metabot-auto-reply-allowed-skills-');
  const betaHomeDir = await createRegisteredProfile(t, systemHomeDir, {
    name: 'Beta Bot',
    slug: 'beta-bot',
    globalMetaId: 'idq1beta00000000000000000000000000000',
  });
  await configureAllowedChatSkillProfile(systemHomeDir, betaHomeDir, 'beta-bot');
  const executorCalls = [];

  const dispatcher = createPrivateChatAutoReplyProfileDispatcher({
    autoReplyConfig: {
      enabled: true,
      acceptPolicy: 'accept_all',
      defaultStrategyId: null,
    },
    resolvePeerChatPublicKey: async () => 'peer-chat-key',
    llmExecutor: {
      execute: async (request) => {
        executorCalls.push(request);
        return 'llm-session-allowed-skills';
      },
      getSession: async (sessionId) => ({
        sessionId,
        status: 'completed',
        result: {
          status: 'completed',
          output: 'Weather reply.',
          durationMs: 1,
        },
      }),
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
    createOrchestrator: (deps) => ({
      handleInboundMessage: async () => {
        await deps.replyRunner(chatRunnerInput());
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
    content: 'weather?',
    messagePinId: 'incoming-pin-allowed',
    fromChatPublicKey: 'peer-chat-key',
    timestamp: 1_777_000_000_001,
    rawMessage: null,
  });

  assert.equal(executorCalls.length, 1);
  assert.deepEqual(executorCalls[0].skills, ['metabot-weather']);
  assert.match(executorCalls[0].skillSourcePaths['metabot-weather'], /\.codex[/\\]skills[/\\]metabot-weather$/);
  assert.equal(executorCalls[0].skillIsolation, 'strict');
});

test('startup recovery replays persisted inbound ORDER messages without provider sessions', async (t) => {
  const systemHomeDir = await mkdtempTempRoot('metabot-a2a-order-replay-');
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

test('startup recovery counts failed ORDER handler envelopes as replay failures', async (t) => {
  const systemHomeDir = await mkdtempTempRoot('metabot-a2a-order-replay-');
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
  const orderTxid = 'b'.repeat(64);
  const content = [
    '[ORDER] missing payment metadata',
    '支付金额 0.00001 SPACE',
    'service id: service-pin-1',
    'skill name: metabot-weather-oracle',
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

  const warnings = [];
  const result = await replayUnhandledA2AOrderMessagesForProfiles({
    systemHomeDir,
    activeHomeDir: didiHomeDir,
    handleOrderProtocolMessage: async () => ({
      ok: false,
      state: 'failed',
      code: 'order_payment_unverified',
      message: 'Inbound ORDER is missing payment txid or free order reference.',
    }),
    logWarning: (label, error) => warnings.push([label, error]),
  });

  assert.equal(result.replayed, 0);
  assert.equal(result.failed, 1);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0], '[A2A order replay handler]');
  assert.match(String(warnings[0][1]), /order_payment_unverified/);
});

test('startup recovery skips persisted ORDER messages that already have provider sessions', async (t) => {
  const systemHomeDir = await mkdtempTempRoot('metabot-a2a-order-replay-');
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

// Regression: toggling Auto-Reply off (via the UI or the CLI) for a non-default
// bot profile must actually stop that profile's orchestrator from replying.
// Previously the dispatcher's per-profile orchestrator closed over the daemon-
// default shared config, while setAutoReply mutated a detached per-home copy,
// so the toggle was silently ignored for every bot except the active one.
test('setAutoReply off for a non-default profile is observed by the dispatcher orchestrator', async (t) => {
  const systemHomeDir = await mkdtempTempRoot('metabot-auto-reply-toggle-regression-');
  const daemonHomeDir = await createRegisteredProfile(t, systemHomeDir, {
    name: 'Daemon Active',
    slug: 'daemon-active',
    globalMetaId: 'idq1actv00000000000000000000000000000',
  });
  const betaHomeDir = await createRegisteredProfile(t, systemHomeDir, {
    name: 'Beta Bot',
    slug: 'beta-bot',
    globalMetaId: 'idq1beta00000000000000000000000000000',
  });
  t.after(async () => {
    await rm(systemHomeDir, { recursive: true, force: true });
  });

  const sharedAutoReplyConfig = {
    enabled: true,
    acceptPolicy: 'accept_all',
    defaultStrategyId: null,
  };
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: daemonHomeDir,
    systemHomeDir,
    signer: readOnlySigner(),
    getDaemonRecord: () => null,
    autoReplyConfig: sharedAutoReplyConfig,
  });

  const handled = [];
  const dispatcher = createPrivateChatAutoReplyProfileDispatcher({
    autoReplyConfig: sharedAutoReplyConfig,
    resolveAutoReplyConfigForHome: (homeDir) => handlers.resolveAutoReplyConfigForHome(homeDir),
    resolvePeerChatPublicKey: async () => 'peer-chat-key',
    llmExecutor: { execute: async () => 'session', getSession: async () => null },
    createOrchestrator: (_deps, config) => ({
      handleInboundMessage: async () => {
        // Mirror the real orchestrator's enabled gate.
        if (!config.enabled) return;
        handled.push(true);
      },
    }),
  });

  const betaProfile = {
    name: 'Beta Bot',
    slug: 'beta-bot',
    aliases: ['beta-bot'],
    homeDir: betaHomeDir,
    globalMetaId: 'idq1beta00000000000000000000000000000',
    mvcAddress: 'mvc-beta',
    createdAt: 1_777_000_000_000,
    updatedAt: 1_777_000_000_000,
  };
  const inbound = {
    fromGlobalMetaId: 'idq1peer00000000000000000000000000000',
    content: 'hi beta',
    messagePinId: 'incoming-pin-toggle',
    fromChatPublicKey: 'peer-chat-key',
    timestamp: 1_777_000_000_001,
    rawMessage: null,
  };

  // Prime the orchestrator (lazily created, closes over the live per-home config).
  await dispatcher.handleInboundMessage(betaProfile, inbound);
  assert.equal(handled.length, 1, 'orchestrator handled the inbound message while enabled');

  // Toggle Auto-Reply off for the non-default profile via the same handler the
  // UI and CLI use.
  const disabled = await handlers.chat.setAutoReply({ from: 'beta-bot', enabled: false });
  assert.equal(disabled.ok, true);
  assert.equal(disabled.data.enabled, false);

  // The very same orchestrator instance must now observe enabled=false and skip.
  await dispatcher.handleInboundMessage(betaProfile, inbound);
  assert.equal(handled.length, 1, 'orchestrator skipped the inbound message after toggle off');
});
