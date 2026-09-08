import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { buildGroupTaskSystemPrompt } = require('../../dist/core/grouptask/prompts.js');

function makeInput(role) {
  return {
    identity: { name: 'Bob' },
    task: { title: 'Demo task', goal: 'Ship the thing', acceptanceCriteria: null },
    seats: [
      { name: 'Bob', role: 'chair', remote: false },
      { name: 'Carol', role: 'worker', remote: false },
    ],
    chairName: 'Bob',
    ownerGlobalMetaId: null,
    role,
  };
}

test('group-task system prompt carries the full-form MetaWeb URI rule for chair and worker', () => {
  for (const role of ['chair', 'worker']) {
    const prompt = buildGroupTaskSystemPrompt(makeInput(role));
    assert.match(prompt, /MetaWeb URIs are ALWAYS written in FULL/, `${role} prompt missing the rule`);
    assert.match(prompt, /never abbreviated, truncated, or shortened with an ellipsis/);
    assert.match(prompt, /metaid:\/\/.*pin:\/\/.*metafile:\/\/.*metaapp:\/\/.*map:\/\//s);
    assert.match(prompt, /64 lowercase hex chars/);
  }
});
