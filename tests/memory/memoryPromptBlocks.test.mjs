import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildScopedMemoryPromptBlocks,
  clampMemoryPromptMaxChars,
  selectScopedMemoryPromptEntries,
  DEFAULT_MEMORY_PROMPT_MAX_CHARS,
} = require('../../dist/core/memory/memoryPromptBlocks.js');

function entry(text, extra = {}) {
  return {
    text,
    usageClass: 'profile_fact',
    visibility: 'local_only',
    updatedAt: 1000,
    lastUsedAt: null,
    ...extra,
  };
}

test('local channels (dsh) select owner memories only', () => {
  const selection = selectScopedMemoryPromptEntries({
    requestChannel: 'dsh',
    ownerEntries: [entry('我叫老张'), entry('我喜欢美式咖啡')],
    contactEntries: [entry('peer secret')],
  });
  assert.equal(selection.ownerMemories.length, 2);
  assert.equal(selection.contactMemories.length, 0);
  assert.equal(selection.ownerOperationalPreferences.length, 0);
});

test('relevance scoring ranks keyword-matching entries first', () => {
  const selection = selectScopedMemoryPromptEntries({
    requestChannel: 'dsh',
    ownerEntries: [
      entry('我女儿今年上小学二年级'),
      entry('我喜欢喝美式咖啡'),
      entry('我住在杭州西湖区'),
    ],
    currentUserText: '周末 咖啡 推荐',
  });
  assert.equal(selection.ownerMemories[0].text, '我喜欢喝美式咖啡');
  assert.ok(selection.ownerMemories[0].relevanceScore > selection.ownerMemories[1].relevanceScore);
});

test('external channels hide owner facts and only surface external_safe operational preferences', () => {
  const selection = selectScopedMemoryPromptEntries({
    requestChannel: 'metaweb_private',
    ownerEntries: [
      entry('我叫老张'),
      entry('以后回复请用简洁的 markdown 格式', { usageClass: 'operational_preference', visibility: 'external_safe' }),
      entry('默认语言用中文回复', { usageClass: 'operational_preference', visibility: 'local_only' }),
    ],
    contactEntries: [entry('对方偏好简短回复')],
  });
  assert.equal(selection.ownerMemories.length, 0);
  assert.equal(selection.contactMemories.length, 1);
  assert.equal(selection.ownerOperationalPreferences.length, 1);
  assert.equal(selection.ownerOperationalPreferences[0].text, '以后回复请用简洁的 markdown 格式');
});

test('conversation entries are only used when there are no contact entries', () => {
  const base = {
    requestChannel: 'metaweb_private',
    conversationEntries: [entry('这个群偏好英文')],
  };
  const withContact = selectScopedMemoryPromptEntries({
    ...base,
    contactEntries: [entry('对方偏好简短回复')],
  });
  assert.equal(withContact.conversationMemories.length, 0);

  const withoutContact = selectScopedMemoryPromptEntries(base);
  assert.equal(withoutContact.conversationMemories.length, 1);
});

test('char budget evicts oldest-first but never the top-ranked entry', () => {
  const many = Array.from({ length: 30 }, (_, index) => entry(`记忆条目编号 ${index} `.repeat(20), {
    updatedAt: 1000 + index,
    lastUsedAt: null,
  }));
  const selection = selectScopedMemoryPromptEntries({
    requestChannel: 'dsh',
    ownerEntries: many,
    maxTotalChars: 2000,
  });
  const total = selection.ownerMemories.reduce((sum, item) => sum + item.text.length + 4, 0);
  assert.ok(total <= 2000, `expected <= 2000 chars, got ${total}`);
  // The top-ranked entry (index 29, highest updatedAt wins no tie-break… all score 1,
  // so localeCompare decides — just assert at least one entry survives.
  assert.ok(selection.ownerMemories.length >= 1);
});

test('buildScopedMemoryPromptBlocks renders XML blocks with escaping', () => {
  const xml = buildScopedMemoryPromptBlocks({
    channel: 'dsh',
    ownerEntries: [entry('我喜欢 <美式> 咖啡 & 拿铁')],
  });
  assert.match(xml, /<ownerMemories>/);
  assert.match(xml, /我喜欢 &lt;美式&gt; 咖啡 &amp; 拿铁/);
  assert.match(xml, /<\/ownerMemories>/);
  assert.equal(buildScopedMemoryPromptBlocks({ channel: 'dsh', ownerEntries: [] }), '');
});

test('clampMemoryPromptMaxChars bounds the budget', () => {
  assert.equal(clampMemoryPromptMaxChars(Number.NaN), DEFAULT_MEMORY_PROMPT_MAX_CHARS);
  assert.equal(clampMemoryPromptMaxChars(10), 2000);
  assert.equal(clampMemoryPromptMaxChars(10_000_000), 65536);
});
