import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createGroupChatListenerManager,
  normalizeGroupChatSocketPayload,
} from '../../dist/core/appSession/groupChatListener.js';

test('normalizeGroupChatSocketPayload parses the socket envelopes', () => {
  const message = {
    groupId: 'room1234567890abcdef',
    index: 7,
    content: 'abcd',
    encryption: 'aes',
    protocol: '/protocols/simplegroupchat',
    globalMetaId: 'idq1peer',
    timestamp: 1700000000,
  };

  const wrapper = normalizeGroupChatSocketPayload({ M: 'WS_SERVER_NOTIFY_GROUP_CHAT', D: message });
  assert.equal(wrapper.groupId, 'room1234567890abcdef');
  assert.equal(wrapper.index, 7);
  assert.equal(wrapper.senderMetaId, 'idq1peer');
  assert.equal(wrapper.timestamp, 1700000000000);

  const arrayForm = normalizeGroupChatSocketPayload(['WS_SERVER_NOTIFY_GROUP_CHAT', message]);
  assert.equal(arrayForm.groupId, message.groupId);

  const raw = normalizeGroupChatSocketPayload(message);
  assert.equal(raw.groupId, message.groupId);

  assert.equal(normalizeGroupChatSocketPayload({ M: 'WS_SERVER_NOTIFY_PRIVATE_CHAT', D: message }), null);
  assert.equal(normalizeGroupChatSocketPayload({ M: 'OTHER', D: message }), null);
  assert.equal(normalizeGroupChatSocketPayload({ groupId: '', content: 'x' }), null);
  assert.equal(normalizeGroupChatSocketPayload('not json'), null);
  assert.equal(
    normalizeGroupChatSocketPayload({
      groupId: 'room1234567890abcdef',
      content: 'x',
      protocol: '/protocols/simplemsg',
    }),
    null,
  );
});

test('group chat listener manager connects profiles and routes group messages', async () => {
  const connected = [];
  const sockets = new Map();
  const handlers = new Map();
  const delivered = [];
  const skipped = [];

  const socketClientFactory = (endpoint, options) => {
    connected.push({ endpoint, metaid: options.query.metaid });
    const socket = {
      on(event, handler) {
        let map = handlers.get(socket);
        if (!map) {
          map = new Map();
          handlers.set(socket, map);
        }
        map.set(event, handler);
        return socket;
      },
      emit() {
        return undefined;
      },
      removeAllListeners() {
        return undefined;
      },
      disconnect() {
        return undefined;
      },
    };
    sockets.set(options.query.metaid, socket);
    return socket;
  };

  const manager = createGroupChatListenerManager({
    systemHomeDir: '/tmp/fake',
    listProfiles: async () => [
      { slug: 'alice', name: 'Alice', homeDir: '/tmp/a', globalMetaId: 'idq1alice' },
      { slug: 'bob', name: 'Bob', homeDir: '/tmp/b', globalMetaId: 'idq1bob' },
      { slug: 'ghost', name: 'Ghost', homeDir: '/tmp/g', globalMetaId: '' },
    ],
    resolveSocketEndpoints: async () => [
      { url: 'wss://so.metaid.io', path: '/socket/socket.io' },
    ],
    onGroupMessage: async (profile, message) => {
      delivered.push({ slug: profile.slug, groupId: message.groupId });
    },
    onError: (error) => {
      skipped.push(error.message);
    },
    socketClientFactory,
  });

  const report = await manager.start();
  assert.deepEqual(report.started, ['alice', 'bob']);
  assert.equal(report.skipped.length, 1);
  assert.match(report.skipped[0].reason, /globalMetaId/u);
  assert.equal(manager.isRunning(), true);
  assert.equal(connected.length, 2);

  const aliceSocket = sockets.get('idq1alice');
  const groupHandler = handlers.get(aliceSocket).get('WS_SERVER_NOTIFY_GROUP_CHAT');
  assert.equal(typeof groupHandler, 'function');
  await groupHandler({
    M: 'WS_SERVER_NOTIFY_GROUP_CHAT',
    D: { groupId: 'room1234567890abcdef', content: 'x', globalMetaId: 'idq1peer', timestamp: 1700000000 },
  });
  assert.deepEqual(delivered, [{ slug: 'alice', groupId: 'room1234567890abcdef' }]);

  const messageHandler = handlers.get(aliceSocket).get('message');
  await messageHandler({ M: 'WS_SERVER_NOTIFY_PRIVATE_CHAT', D: { to: 'idq1alice' } });
  assert.equal(delivered.length, 1, 'private chat notifications are not routed');

  manager.stop();
  assert.equal(manager.isRunning(), false);
});
