import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const {
  buildConversationsPageViewModel,
  buildConversationsPageViewModelRuntimeSource,
} = require('../../dist/ui/pages/conversations/viewModel.js');

const LOCAL_GLOBAL_META_ID = 'idq1j3yu9vmwxkqdqrrt39qxl8u69vs0esjhwg6l5k';
const PEER_GLOBAL_META_ID = 'idq1x3yu9vmwxkqdqrrt39qxl8u69vs0esjhwg6l5k';
const FIXTURE_TIMESTAMP = 1776836184000;

function formatLocalTimestamp(value) {
  const date = new Date(value);
  const pad = (part) => String(part).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-') + ' ' + [pad(date.getHours()), pad(date.getMinutes())].join(':');
}

test('buildConversationsPageViewModel maps peer conversations into local-Bot scoped summaries', () => {
  const expectedTimestampLabel = formatLocalTimestamp(FIXTURE_TIMESTAMP);
  const model = buildConversationsPageViewModel({
    localBots: [
      {
        name: 'Alice Bot',
        slug: 'alice-bot',
        globalMetaId: 'gm-local',
        avatarDataUrl: 'data:image/png;base64,alice',
      },
      {
        name: 'Eric Bot',
        slug: 'eric-bot',
        globalMetaId: 'gm-eric',
        avatar: 'https://example.test/eric.png',
      },
    ],
    selectedLocalGlobalMetaId: 'gm-local',
    conversations: [
      {
        conversationId: 'peer-gm-local-gm-bob',
        localGlobalMetaId: 'gm-local',
        localBotName: 'Alice Bot',
        localAvatar: 'data:image/png;base64,alice',
        peerGlobalMetaId: 'gm-bob',
        peerName: 'Bob Bot',
        peerAvatar: 'https://example.test/bob.png',
        peerLlmPrimaryProvider: 'claude-code',
        latestText: 'Order accepted',
        latestAt: FIXTURE_TIMESTAMP,
        messageCount: 4,
        kinds: ['private_chat', 'order_protocol'],
      },
    ],
    selectedPeerGlobalMetaId: 'gm-bob',
    messages: [
      {
        messageId: 'msg-1',
        direction: 'incoming',
        kind: 'private_chat',
        sender: { globalMetaId: 'gm-bob', name: 'Bob Bot', avatar: 'https://example.test/bob.png' },
        recipient: { globalMetaId: 'gm-local', name: 'Alice Bot', avatar: 'data:image/png;base64,alice' },
        content: '**Can** you check the weather?',
        contentType: 'text/markdown',
        txid: 'a'.repeat(64),
        txids: ['a'.repeat(64)],
        timestamp: FIXTURE_TIMESTAMP,
      },
      {
        messageId: 'msg-2',
        direction: 'outgoing',
        kind: 'order_protocol',
        protocolTag: 'ORDER_STATUS',
        sender: { globalMetaId: 'gm-local', name: 'Alice Bot', avatar: 'data:image/png;base64,alice' },
        recipient: { globalMetaId: 'gm-bob', name: 'Bob Bot', avatar: 'https://example.test/bob.png' },
        content: 'Order accepted',
        contentType: 'text/plain',
        pinId: `${'b'.repeat(64)}i0`,
        timestamp: FIXTURE_TIMESTAMP + 6000,
      },
    ],
  });

  assert.deepEqual(model.localBots, [
    {
      label: 'Alice Bot',
      slug: 'alice-bot',
      globalMetaId: 'gm-local',
      avatar: 'data:image/png;base64,alice',
      isSelected: true,
    },
    {
      label: 'Eric Bot',
      slug: 'eric-bot',
      globalMetaId: 'gm-eric',
      avatar: 'https://example.test/eric.png',
      isSelected: false,
    },
  ]);
  assert.equal(model.selectedLocalGlobalMetaId, 'gm-local');
  assert.deepEqual(model.conversations, [
    {
      conversationId: 'peer-gm-local-gm-bob',
      conversationIdPreview: 'peer-gm-local-gm-bob',
      localGlobalMetaId: 'gm-local',
      localAvatar: 'data:image/png;base64,alice',
      peerLabel: 'Bob Bot',
      peerGlobalMetaId: 'gm-bob',
      peerAvatar: 'https://example.test/bob.png',
      peerLlmPrimaryProvider: 'claude-code',
      peerLlmPrimaryProviderLabel: 'Claude Code',
      latestText: 'Order accepted',
      latestAt: FIXTURE_TIMESTAMP,
      latestAtLabel: expectedTimestampLabel,
      kinds: ['Chat', 'Service'],
      stateLabel: 'Active',
      messageCountLabel: '4 messages',
      localBotLabel: 'Alice Bot',
      isSelected: true,
    },
  ]);
  assert.equal(model.emptyState.title, 'No conversations yet');
  assert.deepEqual(model.messages.map((message) => ({
      messageId: message.messageId,
      directionLabel: message.directionLabel,
      kindLabel: message.kindLabel,
      content: message.content,
      contentType: message.contentType,
      senderLabel: message.senderLabel,
      senderAvatar: message.senderAvatar,
      txid: message.txid,
      txidPreview: message.txidPreview,
      isMarkdown: message.isMarkdown,
      timestampLabel: message.timestampLabel,
    })), [
    {
      messageId: 'msg-1',
      directionLabel: 'Peer',
      kindLabel: 'Chat',
      content: '**Can** you check the weather?',
      contentType: 'text/markdown',
      senderLabel: 'Bob Bot',
      senderAvatar: 'https://example.test/bob.png',
      txid: 'a'.repeat(64),
      txidPreview: `${'a'.repeat(8)}...${'a'.repeat(6)}`,
      isMarkdown: true,
      timestampLabel: expectedTimestampLabel,
    },
    {
      messageId: 'msg-2',
      directionLabel: 'Bot',
      kindLabel: 'Service',
      content: 'Order accepted',
      contentType: 'text/plain',
      senderLabel: 'Alice Bot',
      senderAvatar: 'data:image/png;base64,alice',
      txid: 'b'.repeat(64),
      txidPreview: `${'b'.repeat(8)}...${'b'.repeat(6)}`,
      isMarkdown: false,
      timestampLabel: formatLocalTimestamp(FIXTURE_TIMESTAMP + 6000),
    },
  ]);
});

test('buildConversationsPageViewModel selects only the requested peer when switching conversations', () => {
  const model = buildConversationsPageViewModel({
    conversations: [
      {
        conversationId: 'peer-gm-local-gm-first',
        localGlobalMetaId: 'gm-local',
        peerGlobalMetaId: 'gm-first',
        peerName: 'First Bot',
        latestText: 'first message',
        latestAt: 1776836200000,
      },
      {
        conversationId: 'peer-gm-local-gm-second',
        localGlobalMetaId: 'gm-local',
        peerGlobalMetaId: 'gm-second',
        peerName: 'Second Bot',
        latestText: 'second message',
        latestAt: 1776836100000,
      },
    ],
    selectedPeerGlobalMetaId: 'gm-second',
  });

  assert.deepEqual(model.conversations.map((conversation) => ({
    peerGlobalMetaId: conversation.peerGlobalMetaId,
    isSelected: conversation.isSelected,
  })), [
    { peerGlobalMetaId: 'gm-first', isSelected: false },
    { peerGlobalMetaId: 'gm-second', isSelected: true },
  ]);
  assert.equal(model.selectedConversation.peerGlobalMetaId, 'gm-second');
  assert.equal(model.selectedConversation.conversationIdPreview, 'peer-gm-local-gm-second');
});

test('keeps selected peer when conversation has no history', () => {
  const model = buildConversationsPageViewModel({
    localBots: [
      {
        name: 'Local Bot',
        slug: 'local-bot',
        globalMetaId: LOCAL_GLOBAL_META_ID,
      },
    ],
    selectedLocalGlobalMetaId: LOCAL_GLOBAL_META_ID,
    selectedPeerGlobalMetaId: PEER_GLOBAL_META_ID,
    conversations: [],
    messages: [],
  });

  assert.equal(model.selectedLocalGlobalMetaId, LOCAL_GLOBAL_META_ID);
  assert.equal(model.selectedPeerGlobalMetaId, PEER_GLOBAL_META_ID);
  assert.equal(model.selectedConversation.peerGlobalMetaId, PEER_GLOBAL_META_ID);
  assert.equal(model.selectedConversation.localGlobalMetaId, LOCAL_GLOBAL_META_ID);
  assert.equal(model.selectedConversation.isSelected, true);
  assert.deepEqual(model.conversations.map((conversation) => ({
    localGlobalMetaId: conversation.localGlobalMetaId,
    peerGlobalMetaId: conversation.peerGlobalMetaId,
    isSelected: conversation.isSelected,
  })), [
    {
      localGlobalMetaId: LOCAL_GLOBAL_META_ID,
      peerGlobalMetaId: PEER_GLOBAL_META_ID,
      isSelected: true,
    },
  ]);
});

test('buildConversationsPageViewModel does not split service trace sessions into separate conversation rows', () => {
  const model = buildConversationsPageViewModel({
    conversations: [
      {
        conversationId: 'peer-gm-local-gm-bob',
        localGlobalMetaId: 'gm-local',
        peerGlobalMetaId: 'gm-bob',
        peerName: 'Bob Bot',
        latestText: 'Latest peer message',
        latestAt: 1776836184000,
        messageCount: 4,
        kinds: ['private_chat'],
      },
    ],
    traceSessionsResponse: {
      data: {
        sessions: [
          {
            sessionId: 'session-weather-1',
            traceId: 'trace-weather-1',
            role: 'provider',
            state: 'completed',
            updatedAt: 1776836284000,
            localMetabotName: 'Alice Provider',
            localMetabotGlobalMetaId: 'gm-local',
            peerGlobalMetaId: 'gm-buyer',
            peerName: 'Buyer Bot',
            servicePinId: 'svc-weather',
            serviceName: 'Weather Oracle',
            order: {
              id: 'order-weather-1',
              status: 'refund_pending',
              refundRequestPinId: 'refund-request-pin',
            },
          },
        ],
      },
    },
    selectedPeerGlobalMetaId: 'gm-bob',
  });

  assert.equal(model.conversations.length, 1);
  assert.deepEqual(model.conversations.map((conversation) => conversation.peerGlobalMetaId), ['gm-bob']);
  assert.equal(model.selectedConversation.peerGlobalMetaId, 'gm-bob');
  assert.equal(model.detailEmptyState.title, 'No messages yet');
  assert.deepEqual(model.messages, []);
});

test('buildConversationsPageViewModel skips peer trace sessions without service or order context', () => {
  const model = buildConversationsPageViewModel({
    conversations: [
      {
        conversationId: 'peer-gm-local-gm-bob',
        localGlobalMetaId: 'gm-local',
        peerGlobalMetaId: 'gm-bob',
        peerName: 'Bob Bot',
        latestText: 'Hello',
        latestAt: 1776836184000,
        messageCount: 1,
        kinds: ['private_chat'],
      },
    ],
    traceSessions: [
      {
        sessionId: 'session-peer-only',
        traceId: 'trace-peer-only',
        role: 'caller',
        state: 'completed',
        updatedAt: 1776836284000,
        peerGlobalMetaId: 'gm-peer',
        peerName: 'Peer Bot',
      },
    ],
  });

  assert.deepEqual(
    model.conversations.map((conversation) => conversation.conversationId),
    ['peer-gm-local-gm-bob'],
  );
});

test('buildConversationsPageViewModelRuntimeSource executes in browser-like context', () => {
  const context = {
    input: {
      conversations: [
        {
          conversationId: 'pc-runtime',
          localGlobalMetaId: 'gm-local',
          peerGlobalMetaId: 'gm-runtime-peer',
          peerName: null,
          latestText: 'Runtime hello',
          latestAt: 1776836200000,
          messageCount: 1,
          kinds: ['private_chat'],
        },
      ],
      selectedPeerGlobalMetaId: 'gm-runtime-peer',
      messages: [],
    },
    result: null,
  };
  vm.createContext(context);
  vm.runInContext(
    `${buildConversationsPageViewModelRuntimeSource()}\nresult = buildConversationsPageViewModel(input);`,
    context,
  );

  assert.equal(context.result.conversations.length, 1);
  assert.equal(context.result.conversations[0].peerLabel, 'gm-runtime-peer');
  assert.equal(context.result.conversations[0].stateLabel, 'Active');
  assert.equal(context.result.conversations[0].latestText, 'Runtime hello');
  assert.deepEqual(context.result.conversations[0].kinds, ['Chat']);
});

test('buildConversationsPageViewModelRuntimeSource formats timestamps with local time accessors', () => {
  class FakeDate {
    constructor(value) {
      this.value = Number(value);
    }

    getTime() {
      return this.value;
    }

    getFullYear() {
      return 2026;
    }

    getMonth() {
      return 6;
    }

    getDate() {
      return 6;
    }

    getHours() {
      return 8;
    }

    getMinutes() {
      return 19;
    }

    getUTCFullYear() {
      return 2026;
    }

    getUTCMonth() {
      return 6;
    }

    getUTCDate() {
      return 6;
    }

    getUTCHours() {
      return 0;
    }

    getUTCMinutes() {
      return 19;
    }
  }

  const context = {
    Date: FakeDate,
    Number,
    String,
    Array,
    RegExp,
    Math,
    JSON,
    input: {
      conversations: [
        {
          conversationId: 'pc-runtime-local-time',
          localGlobalMetaId: 'gm-local',
          peerGlobalMetaId: 'gm-runtime-peer',
          peerName: 'Runtime Peer',
          latestText: 'Runtime hello',
          latestAt: 1776836184000,
          messageCount: 1,
          kinds: ['private_chat'],
        },
      ],
      selectedPeerGlobalMetaId: 'gm-runtime-peer',
      messages: [
        {
          messageId: 'msg-runtime',
          direction: 'incoming',
          kind: 'private_chat',
          sender: { globalMetaId: 'gm-runtime-peer', name: 'Runtime Peer' },
          content: 'Hello',
          contentType: 'text/plain',
          txid: 'c'.repeat(64),
          timestamp: 1776836184000,
        },
      ],
    },
    result: null,
  };
  vm.createContext(context);
  vm.runInContext(
    `${buildConversationsPageViewModelRuntimeSource()}\nresult = buildConversationsPageViewModel(input);`,
    context,
  );

  assert.equal(context.result.conversations[0].latestAtLabel, '2026-07-06 08:19');
  assert.equal(context.result.messages[0].timestampLabel, '2026-07-06 08:19');
});

test('buildConversationsPageViewModel collapses order progress heartbeats into the latest update', () => {
  const orderTxid = 'd'.repeat(64);
  const model = buildConversationsPageViewModel({
    selectedPeerGlobalMetaId: 'gm-bob',
    messages: [
      {
        messageId: 'msg-1',
        direction: 'incoming',
        kind: 'private_chat',
        sender: { globalMetaId: 'gm-bob', name: 'Bob Bot' },
        content: 'how is it going?',
        contentType: 'text/plain',
        timestamp: FIXTURE_TIMESTAMP,
      },
      {
        messageId: 'msg-2',
        direction: 'incoming',
        kind: 'order_protocol',
        protocolTag: 'ORDER_STATUS',
        orderTxid,
        sender: { globalMetaId: 'gm-bob', name: 'Bob Bot' },
        content: `[ORDER_STATUS:${orderTxid}] I received the order and started processing.`,
        contentType: 'text/plain',
        timestamp: FIXTURE_TIMESTAMP + 1000,
      },
      {
        messageId: 'msg-3',
        direction: 'incoming',
        kind: 'order_protocol',
        protocolTag: 'ORDER_STATUS',
        orderTxid,
        sender: { globalMetaId: 'gm-bob', name: 'Bob Bot' },
        content: `[ORDER_STATUS:${orderTxid}] The task is still processing after about 2 minutes.`,
        contentType: 'text/plain',
        timestamp: FIXTURE_TIMESTAMP + 2000,
      },
      {
        messageId: 'msg-4',
        direction: 'incoming',
        kind: 'order_protocol',
        protocolTag: 'ORDER_STATUS',
        orderTxid,
        sender: { globalMetaId: 'gm-bob', name: 'Bob Bot' },
        content: `[ORDER_STATUS:${orderTxid}] The task is still processing after about 4 minutes.`,
        contentType: 'text/plain',
        timestamp: FIXTURE_TIMESTAMP + 3000,
      },
      {
        messageId: 'msg-5',
        direction: 'incoming',
        kind: 'private_chat',
        sender: { globalMetaId: 'gm-bob', name: 'Bob Bot' },
        content: 'any update?',
        contentType: 'text/plain',
        timestamp: FIXTURE_TIMESTAMP + 4000,
      },
    ],
  });

  // The heartbeat run collapses into its latest notice instead of flooding
  // the thread, and the wire tag is stripped from the displayed content.
  assert.deepEqual(model.messages.map((message) => message.messageId), ['msg-1', 'msg-4', 'msg-5']);
  assert.equal(model.messages[1].content, 'The task is still processing after about 4 minutes.');
  assert.equal(model.messages[1].kindLabel, 'Service');
});

test('buildConversationsPageViewModel keeps separate orders and other protocol records apart', () => {
  const orderA = 'e'.repeat(64);
  const orderB = 'f'.repeat(64);
  const model = buildConversationsPageViewModel({
    selectedPeerGlobalMetaId: 'gm-bob',
    messages: [
      {
        messageId: 'msg-1',
        direction: 'incoming',
        kind: 'order_protocol',
        protocolTag: 'ORDER_STATUS',
        orderTxid: orderA,
        content: `[ORDER_STATUS:${orderA}] accepted A`,
        timestamp: FIXTURE_TIMESTAMP + 1000,
      },
      {
        messageId: 'msg-2',
        direction: 'incoming',
        kind: 'order_protocol',
        protocolTag: 'ORDER_STATUS',
        orderTxid: orderB,
        content: `[ORDER_STATUS:${orderB}] accepted B`,
        timestamp: FIXTURE_TIMESTAMP + 2000,
      },
      {
        messageId: 'msg-3',
        direction: 'incoming',
        kind: 'order_protocol',
        protocolTag: 'ORDER_STATUS',
        orderTxid: orderA,
        content: `[ORDER_STATUS:${orderA}] A still processing`,
        timestamp: FIXTURE_TIMESTAMP + 3000,
      },
      {
        messageId: 'msg-4',
        direction: 'incoming',
        kind: 'order_protocol',
        protocolTag: 'DELIVERY',
        orderTxid: orderA,
        content: `[DELIVERY:${orderA}] {"result":"done"}`,
        timestamp: FIXTURE_TIMESTAMP + 4000,
      },
    ],
  });

  // Different orders do not merge, non-consecutive repeats stay, and DELIVERY
  // payloads are neither stripped nor collapsed.
  assert.deepEqual(model.messages.map((message) => message.messageId), ['msg-1', 'msg-2', 'msg-3', 'msg-4']);
  assert.equal(model.messages[0].content, 'accepted A');
  assert.equal(model.messages[1].content, 'accepted B');
  assert.equal(model.messages[2].content, 'A still processing');
  assert.equal(model.messages[3].content, `[DELIVERY:${orderA}] {"result":"done"}`);
});

test('buildConversationsPageViewModelRuntimeSource collapses heartbeats in browser-like context', () => {
  const orderTxid = 'd'.repeat(64);
  const context = {
    input: {
      selectedPeerGlobalMetaId: 'gm-bob',
      messages: [
        {
          messageId: 'msg-1',
          direction: 'incoming',
          kind: 'order_protocol',
          protocolTag: 'ORDER_STATUS',
          orderTxid,
          content: `[ORDER_STATUS:${orderTxid}] accepted`,
          timestamp: 1776836184000,
        },
        {
          messageId: 'msg-2',
          direction: 'incoming',
          kind: 'order_protocol',
          protocolTag: 'ORDER_STATUS',
          orderTxid,
          content: `[ORDER_STATUS:${orderTxid}] still processing`,
          timestamp: 1776836185000,
        },
      ],
    },
    result: null,
  };
  vm.createContext(context);
  vm.runInContext(
    `${buildConversationsPageViewModelRuntimeSource()}\nresult = buildConversationsPageViewModel(input);`,
    context,
  );

  assert.equal(context.result.messages.length, 1);
  assert.equal(context.result.messages[0].content, 'still processing');
});
