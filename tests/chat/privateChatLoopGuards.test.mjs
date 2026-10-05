import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  isPrivateChatNoReplySentinel,
  shouldSkipPrivateChatAutoReplyText,
  wouldCreatePrivateChatEchoLoop,
  isRepeatInboundPrivateChatMessage,
  buildPrivateChatWakeNotice,
  buildPrivateChatEmptyReplyRetryNotice,
  selectPrivateChatPromptContextMessages,
  CHAT_NO_REPLY_EXTENSION,
  CHAT_SILENT_TAIL_EXTENSION,
} = require('../../dist/core/chat/privateChatLoopGuards.js');

function makeMessage(overrides) {
  return {
    conversationId: 'pc-self-peer',
    messageId: `msg-${Math.random().toString(36).slice(2, 8)}`,
    direction: 'inbound',
    senderGlobalMetaId: 'peer',
    content: 'hello',
    messagePinId: null,
    extensions: null,
    timestamp: 1_770_000_000_000,
    ...overrides,
  };
}

test('isPrivateChatNoReplySentinel matches the exact sentinel with tolerance', () => {
  assert.equal(isPrivateChatNoReplySentinel('[NO_REPLY]'), true);
  assert.equal(isPrivateChatNoReplySentinel('  [no_reply]. '), true);
  assert.equal(isPrivateChatNoReplySentinel('`[NO_REPLY]`'), true);
  assert.equal(isPrivateChatNoReplySentinel('[NO_REPLY]！'), true);
  assert.equal(isPrivateChatNoReplySentinel(''), false);
  assert.equal(isPrivateChatNoReplySentinel('[NO_REPLY] plus prose'), false);
  assert.equal(isPrivateChatNoReplySentinel('no reply'), false);
  assert.equal(isPrivateChatNoReplySentinel(null), false);
});

test('shouldSkipPrivateChatAutoReplyText recognizes placeholder chatter and silence markers', () => {
  assert.equal(shouldSkipPrivateChatAutoReplyText('Thinking...'), true);
  assert.equal(shouldSkipPrivateChatAutoReplyText('thinking…'), true);
  assert.equal(shouldSkipPrivateChatAutoReplyText('....'), true);
  assert.equal(shouldSkipPrivateChatAutoReplyText('  '), true);
  assert.equal(shouldSkipPrivateChatAutoReplyText('bye'), true);
  assert.equal(shouldSkipPrivateChatAutoReplyText('[NO_REPLY]'), true);
  assert.equal(shouldSkipPrivateChatAutoReplyText('real question'), false);
});

test('wouldCreatePrivateChatEchoLoop blocks a third verbatim delivery', () => {
  const delivered = [
    makeMessage({ direction: 'outbound', content: 'same answer' }),
    makeMessage({ direction: 'outbound', content: 'same answer' }),
  ];
  assert.equal(wouldCreatePrivateChatEchoLoop({ messages: delivered, replyText: 'same answer' }), true);
  assert.equal(wouldCreatePrivateChatEchoLoop({ messages: delivered, replyText: 'fresh answer' }), false);
});

test('wouldCreatePrivateChatEchoLoop ignores wait notices and host silence markers', () => {
  const messages = [
    makeMessage({ direction: 'outbound', content: 'same answer' }),
    makeMessage({
      direction: 'outbound',
      content: 'same answer',
      extensions: { chatSkillWaitNotice: true },
    }),
    makeMessage({
      direction: 'outbound',
      content: 'same answer',
      extensions: { [CHAT_NO_REPLY_EXTENSION]: true },
    }),
    makeMessage({
      direction: 'outbound',
      content: '',
      extensions: { [CHAT_SILENT_TAIL_EXTENSION]: true },
    }),
  ];
  assert.equal(wouldCreatePrivateChatEchoLoop({ messages, replyText: 'same answer' }), false);
});

test('isRepeatInboundPrivateChatMessage detects a verbatim retransmission inside the gap', () => {
  const now = 1_770_000_000_000;
  const prior = [makeMessage({ direction: 'inbound', content: 'please check this', timestamp: now - 60_000 })];
  assert.equal(isRepeatInboundPrivateChatMessage({
    messages: prior,
    content: 'please check this',
    now,
    gapMs: 300_000,
    defaultGapMs: 300_000,
  }), true);
  assert.equal(isRepeatInboundPrivateChatMessage({
    messages: prior,
    content: 'a different question',
    now,
    gapMs: 300_000,
    defaultGapMs: 300_000,
  }), false);
  const stale = [makeMessage({ direction: 'inbound', content: 'please check this', timestamp: now - 600_000 })];
  assert.equal(isRepeatInboundPrivateChatMessage({
    messages: stale,
    content: 'please check this',
    now,
    gapMs: 300_000,
    defaultGapMs: 300_000,
  }), false);
});

test('buildPrivateChatWakeNotice and retry notice carry their decision rules', () => {
  const wake = buildPrivateChatWakeNotice(2);
  assert.match(wake, /Host Wake Check 2/);
  assert.match(wake, /owe the peer an answer/);
  assert.match(wake, /\[NO_REPLY\]/);
  const retry = buildPrivateChatEmptyReplyRetryNotice(3);
  assert.match(retry, /Host Retry Notice \(attempt 3/);
  assert.match(retry, /no final reply text/);
});

test('selectPrivateChatPromptContextMessages keeps 80 active plus 20 previous across a gap boundary', () => {
  const base = 1_770_000_000_000;
  const previous = Array.from({ length: 30 }, (_, index) => makeMessage({
    messageId: `prev-${index}`,
    direction: 'inbound',
    content: `previous ${index}`,
    timestamp: base + index * 1_000,
  }));
  const active = Array.from({ length: 90 }, (_, index) => makeMessage({
    messageId: `active-${index}`,
    direction: 'outbound',
    content: `active ${index}`,
    timestamp: base + 10 * 60_000 + index * 1_000,
  }));
  const selected = selectPrivateChatPromptContextMessages([...previous, ...active], {
    activeLimit: 80,
    previousLimit: 20,
    gapMs: 300_000,
  });
  assert.equal(selected.length, 100);
  assert.ok(selected.includes(active[89]));
  assert.ok(selected.includes(active[10]));
  assert.ok(!selected.includes(active[9]));
  assert.ok(selected.includes(previous[10]));
  assert.ok(!selected.includes(previous[9]));
});

test('selectPrivateChatPromptContextMessages splits the previous segment at a closing Bye', () => {
  const base = 1_770_000_000_000;
  const messages = [
    makeMessage({ messageId: 'p1', direction: 'inbound', content: 'older topic', timestamp: base }),
    makeMessage({ messageId: 'p2', direction: 'outbound', content: 'done with that\nBye', timestamp: base + 1_000 }),
    makeMessage({ messageId: 'a1', direction: 'inbound', content: 'new topic', timestamp: base + 2_000 }),
  ];
  const selected = selectPrivateChatPromptContextMessages(messages, {
    activeLimit: 80,
    previousLimit: 20,
    gapMs: 300_000,
  });
  assert.deepEqual(
    selected.map((message) => message.messageId),
    ['p1', 'p2', 'a1'],
  );
});
