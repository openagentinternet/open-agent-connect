import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const {
  buildConversationsPageViewModel,
  buildConversationsPageViewModelRuntimeSource,
} = require('../../dist/ui/pages/conversations/viewModel.js');

test('buildConversationsPageViewModel maps private chats into Bot conversation summaries', () => {
  const model = buildConversationsPageViewModel({
    conversations: [
      {
        conversationId: 'pc-gm-local-gm-bob',
        peerGlobalMetaId: 'gm-bob',
        peerName: 'Bob Bot',
        topic: null,
        strategyId: null,
        state: 'active',
        turnCount: 4,
        lastDirection: 'inbound',
        createdAt: 1776836100000,
        updatedAt: 1776836184000,
      },
    ],
    selectedConversationId: 'pc-gm-local-gm-bob',
    messages: [
      {
        conversationId: 'pc-gm-local-gm-bob',
        messageId: 'msg-1',
        direction: 'inbound',
        senderGlobalMetaId: 'gm-bob',
        content: 'Can you check the weather?',
        messagePinId: 'pin-msg-1',
        extensions: null,
        timestamp: 1776836184000,
      },
      {
        conversationId: 'pc-gm-local-gm-bob',
        messageId: 'msg-2',
        direction: 'outbound',
        senderGlobalMetaId: 'gm-local',
        content: 'I can do that.',
        messagePinId: 'pin-msg-2',
        extensions: null,
        timestamp: 1776836190000,
      },
    ],
  });

  assert.deepEqual(model.conversations, [
    {
      conversationId: 'pc-gm-local-gm-bob',
      peerLabel: 'Bob Bot',
      peerGlobalMetaId: 'gm-bob',
      source: 'private_chat',
      latestText: 'Inbound private chat with Bob Bot',
      latestAt: 1776836184000,
      latestAtLabel: '2026-04-22 05:36',
      kinds: ['Chat'],
      stateLabel: 'Active',
      turnCountLabel: '4 turns',
      localBotLabel: '',
      serviceName: '',
      traceHref: '',
      sessionHref: '',
      refundHref: '',
      advancedActions: [],
      isSelected: true,
    },
  ]);
  assert.equal(model.emptyState.title, 'No conversations yet');
  assert.deepEqual(model.messages.map((message) => ({
    messageId: message.messageId,
    directionLabel: message.directionLabel,
    content: message.content,
    timestampLabel: message.timestampLabel,
  })), [
    {
      messageId: 'msg-1',
      directionLabel: 'Peer',
      content: 'Can you check the weather?',
      timestampLabel: '2026-04-22 05:36',
    },
    {
      messageId: 'msg-2',
      directionLabel: 'Bot',
      content: 'I can do that.',
      timestampLabel: '2026-04-22 05:36',
    },
  ]);
});

test('buildConversationsPageViewModel adds service trace sessions as service conversation rows', () => {
  const model = buildConversationsPageViewModel({
    conversations: [
      {
        conversationId: 'pc-gm-local-gm-bob',
        peerGlobalMetaId: 'gm-bob',
        peerName: 'Bob Bot',
        state: 'active',
        turnCount: 4,
        lastDirection: 'inbound',
        updatedAt: 1776836184000,
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
    selectedConversationId: 'service-session-weather-1',
  });

  assert.equal(model.conversations.length, 2);
  assert.deepEqual(model.conversations[0], {
    conversationId: 'service-session-weather-1',
    peerLabel: 'Buyer Bot',
    peerGlobalMetaId: 'gm-buyer',
    source: 'service_trace',
    latestText: 'Weather Oracle service session with Buyer Bot',
    latestAt: 1776836284000,
    latestAtLabel: '2026-04-22 05:38',
    kinds: ['Service'],
    stateLabel: 'Completed',
    turnCountLabel: 'session-weather-1',
    localBotLabel: 'Alice Provider',
    serviceName: 'Weather Oracle',
    traceHref: '/ui/trace?traceId=trace-weather-1',
    sessionHref: '/ui/trace?sessionId=session-weather-1',
    refundHref: '/ui/refund?orderId=order-weather-1',
    advancedActions: [
      { label: 'Trace', href: '/ui/trace?traceId=trace-weather-1' },
      { label: 'Session', href: '/ui/trace?sessionId=session-weather-1' },
      { label: 'Refund', href: '/ui/refund?orderId=order-weather-1' },
    ],
    isSelected: true,
  });
  assert.equal(model.selectedConversation.source, 'service_trace');
  assert.equal(model.detailEmptyState.title, 'Service conversation');
  assert.deepEqual(model.messages, []);
});

test('buildConversationsPageViewModel skips peer trace sessions without service or order context', () => {
  const model = buildConversationsPageViewModel({
    conversations: [
      {
        conversationId: 'pc-gm-local-gm-bob',
        peerGlobalMetaId: 'gm-bob',
        peerName: 'Bob Bot',
        state: 'active',
        turnCount: 1,
        lastDirection: 'inbound',
        updatedAt: 1776836184000,
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
    ['pc-gm-local-gm-bob'],
  );
});

test('buildConversationsPageViewModelRuntimeSource executes in browser-like context', () => {
  const context = {
    input: {
      conversations: [
        {
          conversationId: 'pc-runtime',
          peerGlobalMetaId: 'gm-runtime-peer',
          peerName: null,
          state: 'paused',
          turnCount: 1,
          lastDirection: 'outbound',
          createdAt: 1776836100000,
          updatedAt: 1776836200000,
        },
      ],
      selectedConversationId: 'pc-runtime',
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
  assert.equal(context.result.conversations[0].stateLabel, 'Paused');
  assert.equal(context.result.conversations[0].latestText, 'Outbound private chat with gm-runtime-peer');
  assert.equal(context.result.conversations[0].source, 'private_chat');
});
