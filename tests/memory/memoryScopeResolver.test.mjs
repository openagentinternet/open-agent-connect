import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { resolveMemoryScopes } = require('../../dist/core/memory/memoryScopeResolver.js');
const { extractTurnMemoryChanges } = require('../../dist/core/memory/memoryExtractor.js');

test('local channels resolve to the owner scope with full read access', () => {
  for (const channel of [undefined, '', 'dsh', 'cowork_ui']) {
    const resolved = resolveMemoryScopes({ sourceChannel: channel });
    assert.equal(resolved.writeScope.kind, 'owner');
    assert.equal(resolved.writeScope.key, 'owner:self');
    assert.equal(resolved.ownerReadPolicy, 'all');
    assert.equal(resolved.resolutionReason, 'owner_default');
  }
});

test('direct external channels resolve to a contact scope with restricted owner reads', () => {
  const resolved = resolveMemoryScopes({
    sourceChannel: 'metaweb_private',
    peerGlobalMetaId: 'gm-bob',
  });
  assert.equal(resolved.writeScope.kind, 'contact');
  assert.equal(resolved.writeScope.key, 'metaweb_private:peer:gm-bob');
  assert.equal(resolved.ownerReadPolicy, 'operational_preference_only');
  assert.equal(resolved.resolutionReason, 'contact_direct');
});

test('group/shared channels resolve to a conversation scope', () => {
  const resolved = resolveMemoryScopes({
    sourceChannel: 'metaweb_group_task',
    externalConversationId: 'task-42',
  });
  assert.equal(resolved.writeScope.kind, 'conversation');
  assert.equal(resolved.writeScope.key, 'metaweb_group_task:conversation:task-42');
  assert.equal(resolved.ownerReadPolicy, 'operational_preference_only');
  assert.equal(resolved.resolutionReason, 'conversation_fallback');
});

test('direct channel without a peer falls back to conversation scope, then owner', () => {
  const withConversation = resolveMemoryScopes({
    sourceChannel: 'metaweb_private',
    externalConversationId: 'conv-1',
  });
  assert.equal(withConversation.writeScope.kind, 'conversation');

  const noIds = resolveMemoryScopes({ sourceChannel: 'metaweb_private' });
  assert.equal(noIds.writeScope.kind, 'owner');
});

test('extractor: explicit remember/forget commands win at 0.99 confidence', () => {
  const changes = extractTurnMemoryChanges({
    userText: '请记住：我喜欢喝美式咖啡。\n忘掉：我不喜欢甜的',
    assistantText: '好的，已记住。',
    guardLevel: 'strict',
  });
  const add = changes.find((change) => change.action === 'add');
  const del = changes.find((change) => change.action === 'delete');
  assert.ok(add);
  assert.equal(add.confidence, 0.99);
  assert.equal(add.isExplicit, true);
  assert.ok(add.text.includes('美式咖啡'));
  assert.ok(del);
  assert.equal(del.isExplicit, true);
});

test('extractor: implicit signals respect guard-level thresholds and caps', () => {
  const text = '我叫老张。我喜欢喝美式咖啡。我女儿今年上小学。我养了一只猫。';
  const strict = extractTurnMemoryChanges({ userText: text, assistantText: '', guardLevel: 'strict' });
  // 0.93 (profile), 0.9 (ownership), 0.88 (preference) all >= 0.85, but capped at 2.
  assert.ok(strict.length <= 2);
  assert.ok(strict.every((change) => !change.isExplicit));

  const relaxed = extractTurnMemoryChanges({ userText: text, assistantText: '', guardLevel: 'relaxed' });
  assert.ok(relaxed.length <= 2);

  const disabled = extractTurnMemoryChanges({ userText: text, assistantText: '', guardLevel: 'strict', maxImplicitAdds: 0 });
  assert.equal(disabled.length, 0);
});

test('extractor: questions, small talk, transient news and procedural text are rejected', () => {
  const changes = extractTurnMemoryChanges({
    userText: '好的\n你今天怎么样？\n请帮我执行以下命令 npm run build\n我叫老张',
    assistantText: '',
    guardLevel: 'standard',
  });
  assert.equal(changes.length, 1);
  assert.ok(changes[0].text.includes('老张'));
});
