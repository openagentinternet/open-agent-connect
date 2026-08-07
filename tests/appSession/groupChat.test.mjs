import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGroupChatWritePayload,
  decryptGroupContent,
  encryptGroupContent,
  fetchGroupMessages,
  groupIdToSecretKey,
  normalizeGroupChatMessage,
  parseAgentGameEnvelope,
} from '../../dist/core/appSession/groupChat.js';

const GROUP_ID = 'g1234567890abcdef';

test('group message AES round trip matches the public idchat scheme', () => {
  assert.equal(groupIdToSecretKey(GROUP_ID), GROUP_ID.slice(0, 16));
  assert.equal(groupIdToSecretKey('short'), 'short00000000000');
  const plaintext = '{"protocol":"agent-game/1"}';
  const cipher = encryptGroupContent(plaintext, GROUP_ID);
  assert.match(cipher, /^[0-9a-f]+$/u);
  assert.equal(decryptGroupContent(cipher, GROUP_ID), plaintext);
  // Undecryptable content returns the original text (idchat convention).
  assert.equal(decryptGroupContent('not-hex', GROUP_ID), 'not-hex');
  assert.equal(decryptGroupContent('abcdef', GROUP_ID), 'abcdef');
});

test('buildGroupChatWritePayload matches the chess MetaApp write shape', () => {
  const payload = buildGroupChatWritePayload({
    groupId: GROUP_ID,
    plaintext: 'hello',
    nickName: 'player',
    mention: ['idq1peer'],
    now: 1700000000000,
  });
  assert.equal(payload.groupId, GROUP_ID);
  assert.equal(payload.nickName, 'player');
  assert.equal(payload.contentType, 'text/plain');
  assert.equal(payload.encryption, 'aes');
  assert.equal(payload.timestamp, 1700000000000);
  assert.deepEqual(payload.mention, ['idq1peer']);
  assert.equal(decryptGroupContent(payload.content, GROUP_ID), 'hello');
});

test('parseAgentGameEnvelope accepts and validates agent-game/1 envelopes', () => {
  const envelope = {
    protocol: 'agent-game/1',
    gameId: 'xiangqi',
    matchId: GROUP_ID,
    rulesHash: 'sha256:' + 'a'.repeat(64),
    type: 'action',
    eventId: 'idq1:sess',
    actionSeq: 3,
    prevStateHash: 'sha256:' + 'b'.repeat(64),
    stateHash: 'sha256:' + 'c'.repeat(64),
    payload: { move: 'h2e2' },
  };
  const parsed = parseAgentGameEnvelope(JSON.stringify(envelope));
  assert.deepEqual(parsed, envelope);
  assert.equal(parseAgentGameEnvelope('not json'), null);
  assert.equal(parseAgentGameEnvelope('{"protocol":"simplemsg"}'), null);
  assert.equal(parseAgentGameEnvelope('{"protocol":"agent-game/1","gameId":"","matchId":"","rulesHash":"","type":""}'), null);
  const bare = parseAgentGameEnvelope('{"protocol":"agent-game/1","gameId":"x","matchId":"m","rulesHash":"r","type":"action"}');
  assert.deepEqual(bare.payload, {});
  assert.equal(bare.eventId, undefined);
  assert.equal(bare.actionSeq, undefined);
});

test('normalizeGroupChatMessage extracts backend-authoritative fields', () => {
  const message = normalizeGroupChatMessage({
    index: 12,
    groupId: GROUP_ID,
    content: 'abcd',
    encryption: 'aes',
    protocol: '/protocols/simplegroupchat',
    fromUserInfo: { globalMetaId: 'idq1peer' },
    timestamp: 1700000000,
    pinId: 'pin1',
  });
  assert.deepEqual(message, {
    index: 12,
    senderMetaId: 'idq1peer',
    timestamp: 1700000000000,
    content: 'abcd',
    encryption: 'aes',
    protocol: '/protocols/simplegroupchat',
    pinId: 'pin1',
    groupId: GROUP_ID,
  });
  assert.equal(normalizeGroupChatMessage(null), null);
  assert.equal(normalizeGroupChatMessage({ content: '' }), null);
  assert.equal(normalizeGroupChatMessage({ content: 'x', groupId: '', senderMetaId: '' }), null);
});

test('fetchGroupMessages handles the chat-api list shapes and sorting', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        data: {
          list: [
            { index: 1, groupId: GROUP_ID, content: 'b', globalMetaId: 'idq1peer', timestamp: 1700000001 },
            { index: 0, groupId: GROUP_ID, content: 'a', globalMetaId: 'idq1peer', timestamp: 1700000000 },
          ],
        },
      }),
    };
  };
  const messages = await fetchGroupMessages({
    chatApiBaseUrl: 'https://so.metaid.io/chat-api/group-chat',
    groupId: GROUP_ID,
    startIndex: 5,
    size: 50,
    fetchImpl,
  });
  assert.deepEqual(messages.map((message) => message.index), [0, 1]);
  assert.equal(messages[0].content, 'a');
  assert.ok(calls[0].includes('/group-chat-list-by-index'));
  assert.ok(calls[0].includes('startIndex=5'));
  assert.ok(calls[0].includes('size=50'));
});

test('fetchGroupMessages surfaces 404 as an HTTP status error', async () => {
  await assert.rejects(
    fetchGroupMessages({
      chatApiBaseUrl: 'https://so.metaid.io/chat-api/group-chat',
      groupId: GROUP_ID,
      startIndex: 0,
      fetchImpl: async () => ({ ok: false, status: 404 }),
    }),
    (error) => error.status === 404,
  );
});
