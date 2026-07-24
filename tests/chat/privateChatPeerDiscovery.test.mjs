import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { createA2AConversationStore } = require('../../dist/core/a2a/conversationStore.js');
const {
  buildLocalA2AProjectedPeerIndex,
  listLocalA2AProjectedPeerGlobalMetaIds,
} = require('../../dist/core/chat/privateChatPeerDiscovery.js');

test('local A2A peer discovery indexes only profiles with outbound messages to the recipient', async () => {
  const base = await mkdtempTempRoot('metabot-private-peer-discovery-test-');
  const senderGlobalMetaId = 'idq1sender0000000000000000000000000000';
  const recipientGlobalMetaId = 'idq1recipient000000000000000000000000';
  const unrelatedGlobalMetaId = 'idq1unrelated000000000000000000000000';
  const profiles = [
    { slug: 'sender', globalMetaId: senderGlobalMetaId },
    { slug: 'recipient', globalMetaId: recipientGlobalMetaId },
    { slug: 'unrelated', globalMetaId: unrelatedGlobalMetaId },
  ].map((profile) => ({
    ...profile,
    name: profile.slug,
    aliases: [profile.slug],
    homeDir: path.join(base, '.metabot', 'profiles', profile.slug),
    mvcAddress: null,
    createdAt: 1,
    updatedAt: 1,
  }));

  const senderStore = createA2AConversationStore({
    homeDir: profiles[0].homeDir,
    local: { globalMetaId: senderGlobalMetaId },
    peer: { globalMetaId: recipientGlobalMetaId },
  });
  await senderStore.appendMessages([{
    messageId: 'sender-outbound',
    direction: 'outgoing',
    kind: 'private_chat',
    protocolTag: null,
    sender: { globalMetaId: senderGlobalMetaId },
    recipient: { globalMetaId: recipientGlobalMetaId },
    content: 'hello',
    contentType: 'text/plain',
    artifacts: [],
    pinId: 'sender-outbound',
    txid: null,
    txids: [],
    replyPinId: null,
    chain: 'mvc',
    timestamp: 1,
    chainTimestamp: null,
    sessionId: null,
    raw: null,
  }]);

  const unrelatedStore = createA2AConversationStore({
    homeDir: profiles[2].homeDir,
    local: { globalMetaId: unrelatedGlobalMetaId },
    peer: { globalMetaId: recipientGlobalMetaId },
  });
  await unrelatedStore.appendMessages([{
    messageId: 'unrelated-incoming',
    direction: 'incoming',
    kind: 'private_chat',
    protocolTag: null,
    sender: { globalMetaId: recipientGlobalMetaId },
    recipient: { globalMetaId: unrelatedGlobalMetaId },
    content: 'not an outbound projection',
    contentType: 'text/plain',
    artifacts: [],
    pinId: 'unrelated-incoming',
    txid: null,
    txids: [],
    replyPinId: null,
    chain: 'mvc',
    timestamp: 1,
    chainTimestamp: null,
    sessionId: null,
    raw: null,
  }]);

  const index = await buildLocalA2AProjectedPeerIndex(profiles);
  assert.deepEqual(index.get(recipientGlobalMetaId), [senderGlobalMetaId]);
  assert.deepEqual(
    await listLocalA2AProjectedPeerGlobalMetaIds({ profiles, selfGlobalMetaId: recipientGlobalMetaId }),
    [senderGlobalMetaId],
  );
});
