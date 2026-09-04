import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { buildKnowledgeBasesPromptBlock, KNOWLEDGE_BASES_PROMPT_MAX_ITEMS }
  = require('../../dist/core/knowledgebase/promptBlocks.js');

test('KB prompt block lists corpora with counts and the query/save instruction', () => {
  const block = buildKnowledgeBasesPromptBlock([
    { name: 'Law', description: '法律条文摘录', docCount: 3, chunkCount: 12, isDefault: true },
    { name: 'Food', description: '', docCount: 0, chunkCount: 0 },
  ]);
  assert.match(block, /<knowledge_bases>/);
  assert.match(block, /<kb name="Law" default="true" docs="3" chunks="12">法律条文摘录<\/kb>/);
  assert.match(block, /<kb name="Food" docs="0" chunks="0"><\/kb>/, 'zero-doc KBs still listed');
  assert.match(block, /knowledge_base_query/);
  assert.match(block, /knowledge_base_add_document/);
  assert.match(block, /<\/knowledge_bases>/);
});

test('KB prompt block is bounded, escaped, and empty when no KBs exist', () => {
  const records = Array.from({ length: KNOWLEDGE_BASES_PROMPT_MAX_ITEMS + 2 }, (_, index) => ({
    name: `KB-${index}`,
    docCount: index,
    chunkCount: index,
  }));
  const block = buildKnowledgeBasesPromptBlock(records);
  assert.equal(block.match(/<kb /gu)?.length, KNOWLEDGE_BASES_PROMPT_MAX_ITEMS, 'top-N bounded');

  const escaped = buildKnowledgeBasesPromptBlock([{ name: '<Weird & Co>', description: '"quoted"' }]);
  assert.match(escaped, /&lt;Weird &amp; Co&gt;/);
  assert.match(escaped, /&quot;quoted&quot;/);
  assert.doesNotMatch(escaped, /<Weird/);

  assert.equal(buildKnowledgeBasesPromptBlock([]), '');
  assert.equal(buildKnowledgeBasesPromptBlock([{ name: '   ', docCount: 1 }]), '');
});
