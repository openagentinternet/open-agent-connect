import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createPrivateChatAutoReplyProfileDispatcher } = require('../../dist/cli/runtime.js');

async function createProfileHome(t, slug) {
  const systemHomeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-auto-reply-dispatcher-'));
  const homeDir = path.join(systemHomeDir, '.metabot', 'profiles', slug);
  await mkdir(homeDir, { recursive: true });
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
