import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  joinGroupChat,
  sendGroupChatMessage,
  formatJoinGroupResult,
  formatSendGroupResult,
  GroupChatPublishError,
  SIMPLE_GROUP_JOIN_PATH,
  SIMPLE_GROUP_CHAT_PATH,
} = require('../../dist/core/group/groupChatPins.js');
const { encryptGroupMessage } = require('../../dist/core/group/groupCrypto.js');

const GROUP_ID = '4ffab5a80123456789abcdef0123456789abcdef0123456789abcdef01234567i0';

function fakeSigner() {
  const calls = [];
  const signer = {
    writePin: async (input) => {
      calls.push(input);
      return {
        pinId: 'group-pin-1',
        txids: ['tx-1', 'tx-2'],
        totalCost: 421,
        network: input.network,
        operation: 'create',
        path: input.path,
        contentType: input.contentType,
        encoding: 'utf-8',
        globalMetaId: 'gm-local-alice',
        mvcAddress: '1alice',
      };
    },
  };
  return { calls, signer };
}

test('joinGroupChat writes the omission-form join body — empty referrer/k omitted, not ""', async () => {
  const { calls, signer } = fakeSigner();
  const result = await joinGroupChat(signer, { groupId: GROUP_ID });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].operation, 'create');
  assert.equal(calls[0].path, SIMPLE_GROUP_JOIN_PATH);
  assert.equal(calls[0].path, '/protocols/simplegroupjoin');
  assert.equal(calls[0].encryption, '0');
  assert.equal(calls[0].version, '1.0');
  assert.equal(calls[0].contentType, 'application/json');
  assert.equal(calls[0].network, 'mvc', 'network defaults to mvc');

  const body = JSON.parse(calls[0].payload);
  // Base body: exactly the two IDBots tool-path fields (main.ts joinGroup
  // omission form); empty referrer/k must not ride as "".
  assert.deepEqual(body, {
    groupId: GROUP_ID,
    state: 1,
  });
  assert.ok(!('referrer' in body), 'empty referrer is omitted, not carried as ""');
  assert.ok(!('k' in body), 'public-group k is omitted, not carried as ""');

  assert.deepEqual(result, {
    pinId: 'group-pin-1',
    txids: ['tx-1', 'tx-2'],
    totalCost: 421,
    network: 'mvc',
    groupId: GROUP_ID,
  });

  // Whitespace-only values normalize to empty and are omitted as well
  // (normalize-then-omit, same as the IDBots tool's truthiness gate).
  await joinGroupChat(signer, { groupId: GROUP_ID, referrer: '   ', k: '  ' });
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[1].payload), { groupId: GROUP_ID, state: 1 });
});

test('joinGroupChat passes referrer and the private-group k through', async () => {
  const { calls, signer } = fakeSigner();
  await joinGroupChat(signer, {
    groupId: GROUP_ID,
    referrer: 'idq1inviter',
    k: 'encoded-key-material',
    network: 'doge',
  });
  const body = JSON.parse(calls[0].payload);
  assert.deepEqual(body, {
    groupId: GROUP_ID,
    state: 1,
    referrer: 'idq1inviter',
    k: 'encoded-key-material',
  });
  assert.equal(calls[0].network, 'doge');
});

test('joinGroupChat rejects a bare task number ("65") and other non-pinid shapes before any write', async () => {
  const { calls, signer } = fakeSigner();
  for (const bad of ['65', '', 'not-a-group-id', '4FFAB5A80123456789ABCDEF0123456789ABCDEF0123456789ABCDEF01234567I0']) {
    await assert.rejects(
      () => joinGroupChat(signer, { groupId: bad }),
      (error) => error instanceof GroupChatPublishError
        && error.code === 'invalid_group_id'
        && /TASK number, not a group id/.test(error.message),
    );
  }
  assert.equal(calls.length, 0, 'no writePin call may happen on validation failure');
});

test('sendGroupChatMessage writes the encrypted body with millisecond timestamp', async () => {
  const { calls, signer } = fakeSigner();
  const ciphertext = encryptGroupMessage('hello group', GROUP_ID);
  assert.equal(ciphertext, '62c543cdbbf7ec3115c55b20cc4ebdfe', 'test premise: pinned openssl vector');

  const before = Date.now();
  const result = await sendGroupChatMessage(signer, {
    groupId: GROUP_ID,
    content: ciphertext,
    nickName: 'Alice',
  });
  const after = Date.now();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].operation, 'create');
  assert.equal(calls[0].path, SIMPLE_GROUP_CHAT_PATH);
  assert.equal(calls[0].path, '/protocols/simplegroupchat');
  assert.equal(calls[0].encryption, '0', 'PIN-level encryption is 0 (body carries the aes marker)');
  assert.equal(calls[0].version, '1.0');
  assert.equal(calls[0].contentType, 'application/json');
  assert.equal(calls[0].network, 'mvc');

  const body = JSON.parse(calls[0].payload);
  // Base body: exactly the six IDBots fields, optional fields omitted.
  assert.deepEqual(Object.keys(body).sort(), [
    'content', 'contentType', 'encryption', 'groupId', 'nickName', 'timestamp',
  ]);
  assert.equal(body.groupId, GROUP_ID);
  assert.equal(body.nickName, 'Alice');
  assert.equal(body.content, ciphertext, 'content stays the ciphertext, byte for byte');
  assert.equal(body.contentType, 'text/plain');
  assert.equal(body.encryption, 'aes');
  assert.ok(
    Number.isInteger(body.timestamp) && body.timestamp >= before && body.timestamp <= after,
    'timestamp is a millisecond integer stamped at construction time',
  );

  assert.deepEqual(result, {
    pinId: 'group-pin-1',
    txids: ['tx-1', 'tx-2'],
    totalCost: 421,
    network: 'mvc',
    groupId: GROUP_ID,
  });
});

test('sendGroupChatMessage carries replyPin/channelId/mention only when non-empty', async () => {
  const { calls, signer } = fakeSigner();
  const ciphertext = encryptGroupMessage('reply', GROUP_ID);

  // Empty optionals stay omitted.
  await sendGroupChatMessage(signer, {
    groupId: GROUP_ID,
    content: ciphertext,
    nickName: '',
    replyPin: '',
    channelId: '   ',
    mention: ['', '  '],
  });
  let body = JSON.parse(calls[0].payload);
  assert.equal(body.nickName, '', 'empty nickName is carried as the empty string');
  assert.ok(!('replyPin' in body));
  assert.ok(!('channelId' in body));
  assert.ok(!('mention' in body));

  // Non-empty optionals ride along.
  await sendGroupChatMessage(signer, {
    groupId: GROUP_ID,
    content: ciphertext,
    nickName: 'Alice',
    replyPin: 'rp1',
    channelId: 'ch9',
    mention: ['idq1peer', 'idq1other'],
    network: 'btc',
  });
  body = JSON.parse(calls[1].payload);
  assert.equal(body.replyPin, 'rp1');
  assert.equal(body.channelId, 'ch9');
  assert.deepEqual(body.mention, ['idq1peer', 'idq1other']);
  assert.equal(calls[1].network, 'btc');
});

test('sendGroupChatMessage refuses plaintext content before any write', async () => {
  const { calls, signer } = fakeSigner();
  await assert.rejects(
    () => sendGroupChatMessage(signer, { groupId: GROUP_ID, content: 'hello group' }),
    (error) => error instanceof GroupChatPublishError
      && error.code === 'content_not_encrypted'
      && /would leak the message/.test(error.message),
  );
  // Valid hex but not whole 16-byte blocks — still rejected.
  await assert.rejects(
    () => sendGroupChatMessage(signer, { groupId: GROUP_ID, content: 'deadbeef' }),
    (error) => error instanceof GroupChatPublishError && error.code === 'content_not_encrypted',
  );
  // Empty content is a missing field.
  await assert.rejects(
    () => sendGroupChatMessage(signer, { groupId: GROUP_ID, content: '  ' }),
    (error) => error instanceof GroupChatPublishError && error.code === 'missing_field',
  );
  // Bad group id.
  await assert.rejects(
    () => sendGroupChatMessage(signer, { groupId: '65', content: '62c543cdbbf7ec3115c55b20cc4ebdfe' }),
    (error) => error instanceof GroupChatPublishError && error.code === 'invalid_group_id',
  );
  assert.equal(calls.length, 0, 'no writePin call may happen on validation failure');
});

test('formatJoinGroupResult / formatSendGroupResult render the IDBots-shaped sheets', () => {
  const join = formatJoinGroupResult({ pinId: 'g1', txids: ['t1'], totalCost: 90 });
  assert.match(join, /^Joined group on-chain \(SimpleGroupJoin\)\./);
  assert.match(join, /- pinId: g1/);
  assert.match(join, /- txids: t1/);
  assert.match(join, /- cost: 90 sats/);
  assert.match(join, /- pin link: \[pin:\/\/g1\]\(pin:\/\/g1\)/);

  const send = formatSendGroupResult({ pinId: 'g2', txids: ['t2', 't3'], totalCost: 120 });
  assert.match(send, /^Group message sent \(SimpleGroupChat\)\./);
  assert.match(send, /- pinId: g2/);
  assert.match(send, /- txids: t2, t3/);
  assert.match(send, /- cost: 120 sats/);
  assert.match(send, /- pin link: \[pin:\/\/g2\]\(pin:\/\/g2\)/);
});
