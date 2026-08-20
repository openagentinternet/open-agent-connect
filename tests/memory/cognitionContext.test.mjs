import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createMemoryStore } = require('../../dist/core/memory/memoryStore.js');
const { createKnowledgeStore } = require('../../dist/core/memory/knowledgeStore.js');
const { createExperienceStore } = require('../../dist/core/memory/experienceStore.js');
const { createImpressionStore } = require('../../dist/core/memory/impressionStore.js');
const { buildMemoryBlocksForRequest } = require('../../dist/core/memory/memoryService.js');
const { buildKnowledgeBlock } = require('../../dist/core/memory/knowledgePromptBlocks.js');
const { buildCognitionPromptBlock } = require('../../dist/core/memory/cognitionContext.js');

const OBSERVER = 'gm-self-bot';
const SUBJECT = 'gm-peer-bot';

async function createTempProfileHome() {
  const base = await mkdtempTempRoot('metabot-cognition-test-');
  const profileRoot = path.join(base, '.metabot', 'profiles', 'test-slug');
  await fs.mkdir(profileRoot, { recursive: true });
  await fs.mkdir(path.join(base, '.metabot', 'manager'), { recursive: true });
  return resolveMetabotPaths(profileRoot);
}

test('knowledge block renders bounded XML with the reuse instruction', () => {
  const xml = buildKnowledgeBlock([
    { topic: '用户喜欢的设计风格', summary: '极简、大留白', kind: 'know_how', category: '设计', version: 2 },
    { topic: '某框架升级坑', summary: '升级后必须释放 worker', kind: 'pitfall' },
  ]);
  assert.match(xml, /<knowledge>/);
  assert.match(xml, /<know_how category="设计" topic="用户喜欢的设计风格">/);
  assert.match(xml, /<pitfall topic="某框架升级坑">/);
  assert.match(xml, /knowledge_upsert/);
  assert.equal(buildKnowledgeBlock([]), '');
});

test('local DSH turns inject the knowledge hot layer; external turns do not', async () => {
  const paths = await createTempProfileHome();
  const knowledge = createKnowledgeStore(paths);
  await knowledge.upsertKnowledge({ topic: '发布清单整理法', summary: '先排序再标风险', kind: 'know_how' });

  const local = await buildMemoryBlocksForRequest(paths, { channel: 'dsh', userText: '帮我整理清单' });
  assert.match(local.xml, /<knowledge>/);
  assert.match(local.xml, /发布清单整理法/);

  const external = await buildMemoryBlocksForRequest(paths, {
    channel: 'metaweb_private',
    peerGlobalMetaId: SUBJECT,
    userText: 'hello',
  });
  assert.ok(!external.xml.includes('<knowledge>'));
});

test('cognition block summarizes the observer-owned impression with trust framing', async () => {
  const paths = await createTempProfileHome();
  const experience = createExperienceStore(paths);
  const episode = await experience.createEpisode({
    ownerGlobalMetaId: OBSERVER,
    episodeType: 'direct_interaction',
    sourceChannel: 'metaweb_private',
    sourceKey: 'conv-1',
    startedAt: Date.now(),
  });
  await experience.addParticipant({ episodeId: episode.id, globalMetaId: SUBJECT, role: 'peer', source: 'a2a' });
  await experience.addEvidence({
    episodeId: episode.id,
    evidenceType: 'message',
    sourceKey: 'm1',
    pinId: 'pin-1',
    publisherGlobalMetaId: SUBJECT,
    contentHash: 'hash1',
    occurredAt: Date.now(),
  });
  const impressions = createImpressionStore(paths, { experienceStore: experience });
  await impressions.appendObservation({
    observerGlobalMetaId: OBSERVER,
    subjectGlobalMetaId: SUBJECT,
    episodeId: episode.id,
    evidenceIds: [],
    observationText: '观察',
    interpretationText: '对方是一个高效但话少的协作者',
    dimensions: { styleDescriptors: ['简短'] },
    dreamDate: '2026-08-19',
    dreamVersion: 1,
    sourceHash: 'h1',
  });
  await impressions.rebuildSnapshot(OBSERVER, SUBJECT);

  const xml = await buildCognitionPromptBlock(
    { experienceStore: experience, impressionStore: impressions },
    { observerGlobalMetaId: OBSERVER, subjectGlobalMetaId: SUBJECT },
  );
  assert.match(xml, /<metaid_cognition_context mode="descriptive" trust="context-only">/);
  assert.match(xml, /Contact state: prior_direct_interaction/);
  assert.match(xml, /高效但话少/);
  assert.match(xml, /pinId=pin-1/);
  assert.match(xml, /Impressions are not permissions/);

  // First contact still renders, framed as "no prior interaction" context.
  const empty = await buildCognitionPromptBlock(
    { experienceStore: experience, impressionStore: impressions },
    { observerGlobalMetaId: OBSERVER, subjectGlobalMetaId: 'gm-stranger' },
  );
  assert.match(empty, /Contact state: first_contact/);
  assert.match(empty, /current impression: none yet/i);
});
