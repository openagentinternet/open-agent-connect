import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createMemoryStore } = require('../../dist/core/memory/memoryStore.js');
const { createExperienceStore } = require('../../dist/core/memory/experienceStore.js');
const { createPrivateChatAutoReplyOrchestrator } = require('../../dist/core/chat/privateChatAutoReply.js');
const { createPrivateChatStateStore } = require('../../dist/core/chat/privateChatStateStore.js');
const { createChatStrategyStore } = require('../../dist/core/chat/chatStrategyStore.js');
const { buildChatPrompt } = require('../../dist/core/chat/hostLlmChatReplyRunner.js');

const LOCAL_GMID = 'idq1localbot0000000000000000000000000';
const PEER_GMID = 'idq1peerbot00000000000000000000000000';

function createIdentityPair() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    privateKeyHex: ecdh.getPrivateKey('hex'),
    publicKeyHex: ecdh.getPublicKey('hex', 'uncompressed'),
  };
}

async function createTempProfileHome() {
  const base = await mkdtempTempRoot('metabot-a2a-mem-');
  const profileRoot = path.join(base, '.metabot', 'profiles', 'test-slug');
  await fs.mkdir(profileRoot, { recursive: true });
  await fs.mkdir(path.join(base, '.metabot', 'manager'), { recursive: true });
  return { base, profileRoot };
}

test('buildChatPrompt renders the scoped memory section when memoryContext is present', () => {
  const prompt = buildChatPrompt({
    conversation: { turnCount: 1, state: 'active' },
    recentMessages: [],
    persona: { role: '角色', soul: '风格', goal: '目标' },
    strategy: null,
    memoryContext: '<contactMemories>\n- 对方偏好简短回复\n</contactMemories>',
  });
  assert.match(prompt, /## Scoped Memory & Experience/);
  assert.match(prompt, /contactMemories/);
  assert.match(prompt, /对方偏好简短回复/);

  const without = buildChatPrompt({
    conversation: { turnCount: 1, state: 'active' },
    recentMessages: [],
    persona: { role: '', soul: '', goal: '' },
    strategy: null,
  });
  assert.ok(!without.includes('Scoped Memory'));
});

test('A2A auto-reply injects contact-scope memory and records the turn', async () => {
  const { profileRoot } = await createTempProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const localKeys = createIdentityPair();
  const peerKeys = createIdentityPair();
  const runnerInputs = [];

  // Seed: an owner profile fact (private), an external_safe ops preference,
  // and a contact-scope fact about this peer.
  const memoryStore = createMemoryStore(paths);
  await memoryStore.create({ text: '我叫老张', isExplicit: true });
  await memoryStore.create({ text: '以后回复请用简洁的 markdown 格式', isExplicit: true });
  await memoryStore.create({
    text: '对方喜欢直奔主题',
    scopeKind: 'contact',
    scopeKey: `metaweb_private:peer:${PEER_GMID}`,
  });

  const orchestrator = createPrivateChatAutoReplyOrchestrator({
    stateStore: createPrivateChatStateStore(paths),
    strategyStore: createChatStrategyStore(paths),
    paths,
    signer: {
      async getIdentity() {
        throw new Error('not used');
      },
      async getPrivateChatIdentity() {
        return {
          globalMetaId: LOCAL_GMID,
          chatPublicKey: localKeys.publicKeyHex,
          privateKeyHex: localKeys.privateKeyHex,
        };
      },
      async writePin(input) {
        return {
          txids: ['reply-tx-1'],
          pinId: 'reply-pin-1',
          totalCost: 0,
          network: 'mvc',
          operation: 'create',
          path: input.path,
          contentType: input.contentType,
          encoding: 'utf-8',
          globalMetaId: LOCAL_GMID,
          mvcAddress: 'mvc-local',
        };
      },
    },
    selfGlobalMetaId: async () => LOCAL_GMID,
    resolvePeerChatPublicKey: async () => peerKeys.publicKeyHex,
    replyRunner: async (input) => {
      runnerInputs.push(input);
      return { state: 'reply', content: 'reply from LLM' };
    },
    now: () => 1_770_000_000_000,
  }, {
    enabled: true,
    acceptPolicy: 'accept_all',
    defaultStrategyId: null,
  });

  await orchestrator.handleInboundMessage({
    fromGlobalMetaId: PEER_GMID,
    content: '请记住：我偏好简短的回复',
    messagePinId: 'incoming-pin-1',
    fromChatPublicKey: peerKeys.publicKeyHex,
    timestamp: 1_770_000_000_000,
    rawMessage: { pinId: 'incoming-pin-1', txid: 'incoming-tx-1' },
  });

  // Injection: contact memory + external_safe ops pref, never the owner fact.
  assert.equal(runnerInputs.length, 1);
  const memoryContext = runnerInputs[0].memoryContext ?? '';
  assert.match(memoryContext, /对方喜欢直奔主题/);
  assert.match(memoryContext, /简洁的 markdown 格式/);
  assert.ok(!memoryContext.includes('我叫老张'));

  // Extraction: the explicit command landed in the contact scope.
  const contactEntries = await memoryStore.list({
    scopeKind: 'contact',
    scopeKey: `metaweb_private:peer:${PEER_GMID}`,
  });
  assert.ok(contactEntries.some((entry) => entry.text.includes('简短')));

  // Experience ledger: one episode with the peer participant + hash-only evidence.
  const experience = createExperienceStore(paths);
  const episodes = await experience.listEpisodes({ ownerGlobalMetaId: LOCAL_GMID });
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].episodeType, 'direct_interaction');
  const participants = await experience.listParticipants(episodes[0].id);
  assert.ok(participants.some((participant) => participant.globalMetaId === PEER_GMID));
  const evidence = await experience.listEvidence(episodes[0].id);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].pinId, 'incoming-pin-1');
  assert.ok(evidence[0].contentHash.length > 0);
  assert.ok(!JSON.stringify(evidence[0]).includes('请记住'));
});
