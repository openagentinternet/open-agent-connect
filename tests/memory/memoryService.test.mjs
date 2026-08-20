import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createMemoryStore } = require('../../dist/core/memory/memoryStore.js');
const { createMemoryPolicyStore } = require('../../dist/core/memory/memoryPolicy.js');
const {
  applyTurnMemoryExtraction,
  buildMemoryBlocksForRequest,
} = require('../../dist/core/memory/memoryService.js');

async function createTempProfileHome() {
  const base = await mkdtempTempRoot('metabot-memory-svc-');
  const profileRoot = path.join(base, '.metabot', 'profiles', 'test-slug');
  await fs.mkdir(profileRoot, { recursive: true });
  await fs.mkdir(path.join(base, '.metabot', 'manager'), { recursive: true });
  return resolveMetabotPaths(profileRoot);
}

test('blocks: local DSH turn injects owner memories plus self-identity', async () => {
  const paths = await createTempProfileHome();
  const store = createMemoryStore(paths);
  await store.create({ text: '我喜欢喝美式咖啡', isExplicit: true });
  await store.create({
    text: '我是一个稳定可靠的助手，逐渐形成了自己的风格。',
    usageClass: 'self_identity',
    origin: 'dream',
  });

  const result = await buildMemoryBlocksForRequest(paths, {
    channel: 'dsh',
    userText: '我想喝点咖啡',
  });
  assert.match(result.xml, /<ownerMemories>/);
  assert.match(result.xml, /美式咖啡/);
  assert.match(result.xml, /<metabot_self_identity>/);
  assert.match(result.xml, /稳定可靠的助手/);
  assert.equal(result.resolution.resolutionReason, 'owner_default');
});

test('blocks: external A2A turn hides owner facts, keeps contact + external_safe ops prefs', async () => {
  const paths = await createTempProfileHome();
  const store = createMemoryStore(paths);
  await store.create({ text: '我叫老张', isExplicit: true });
  await store.create({ text: '以后回复请用简洁的 markdown 格式', isExplicit: true });
  await store.create({
    text: '对方喜欢简短直接的回复',
    scopeKind: 'contact',
    scopeKey: 'metaweb_private:peer:gm-bob',
  });

  const result = await buildMemoryBlocksForRequest(paths, {
    channel: 'metaweb_private',
    peerGlobalMetaId: 'gm-bob',
    userText: '你好',
  });
  assert.ok(!result.xml.includes('我叫老张'));
  assert.match(result.xml, /<contactMemories>/);
  assert.match(result.xml, /简短直接的回复/);
  assert.match(result.xml, /<ownerOperationalPreferences>/);
  assert.match(result.xml, /简洁的 markdown 格式/);
  assert.equal(result.resolution.resolutionReason, 'contact_direct');
});

test('blocks: memoryEnabled=false injects nothing', async () => {
  const paths = await createTempProfileHome();
  const store = createMemoryStore(paths);
  await store.create({ text: '我喜欢喝美式咖啡' });
  const policy = createMemoryPolicyStore(paths);
  await policy.setOverride({ memoryEnabled: false });

  const result = await buildMemoryBlocksForRequest(paths, { channel: 'dsh', userText: '咖啡' });
  assert.equal(result.xml, '');
  assert.equal(result.policy.memoryEnabled, false);
  assert.equal(result.policy.source, 'profile');
});

test('extract: explicit remember lands in the store; repeat turn updates; forget deletes', async () => {
  const paths = await createTempProfileHome();
  const store = createMemoryStore(paths);

  const first = await applyTurnMemoryExtraction(paths, {
    userText: '请记住：我喜欢喝美式咖啡',
    assistantText: '好的，已记住。',
    channel: 'dsh',
    sessionId: 'sess-1',
    userMessageId: 'msg-1',
  });
  assert.equal(first.created, 1);
  assert.equal((await store.list()).length, 1);

  const second = await applyTurnMemoryExtraction(paths, {
    userText: '请记住：我喜欢喝美式咖啡',
    assistantText: '收到。',
    channel: 'dsh',
    sessionId: 'sess-1',
    userMessageId: 'msg-2',
  });
  assert.equal(second.created, 0);
  assert.equal(second.updated, 1);
  assert.equal((await store.list()).length, 1);

  const third = await applyTurnMemoryExtraction(paths, {
    userText: '请忘掉：我喜欢喝美式咖啡',
    assistantText: '已经忘了。',
    channel: 'dsh',
    sessionId: 'sess-1',
    userMessageId: 'msg-3',
  });
  assert.equal(third.deleted, 1);
  assert.equal((await store.list()).length, 0);
});

test('extract: implicit profile facts are captured, transient questions are not', async () => {
  const paths = await createTempProfileHome();
  const store = createMemoryStore(paths);

  const result = await applyTurnMemoryExtraction(paths, {
    userText: '我叫老张，我住在杭州。今天天气怎么样？',
    assistantText: '你好老张！杭州今天晴。',
    channel: 'dsh',
  });
  assert.ok(result.created >= 1);
  const texts = (await store.list()).map((entry) => entry.text).join('\n');
  assert.match(texts, /老张/);
  assert.ok(!/天气怎么样/.test(texts));
});

test('extract: contact-channel turns write into the contact scope, never the owner scope', async () => {
  const paths = await createTempProfileHome();
  const store = createMemoryStore(paths);

  await applyTurnMemoryExtraction(paths, {
    userText: '请记住：我喜欢用英文沟通',
    assistantText: 'Sure.',
    channel: 'metaweb_private',
    peerGlobalMetaId: 'gm-bob',
    sessionId: 'a2a-1',
  });
  assert.equal((await store.list()).length, 0);
  const contactEntries = await store.list({
    scopeKind: 'contact',
    scopeKey: 'metaweb_private:peer:gm-bob',
  });
  assert.ok(contactEntries.length >= 1);
  assert.ok(contactEntries.some((entry) => entry.text.includes('英文')));
  assert.ok(contactEntries.every((entry) => entry.visibility === 'local_only'));
});

test('extract: memory policy gates implicit writes', async () => {
  const paths = await createTempProfileHome();
  const store = createMemoryStore(paths);
  const policy = createMemoryPolicyStore(paths);
  await policy.setOverride({ memoryImplicitUpdateEnabled: false });

  const result = await applyTurnMemoryExtraction(paths, {
    userText: '我叫老张',
    assistantText: '你好',
    channel: 'dsh',
  });
  assert.equal(result.created, 0);
  assert.equal((await store.list()).length, 0);
});
