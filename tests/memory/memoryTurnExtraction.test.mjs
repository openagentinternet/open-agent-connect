import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  isSubstantiveMemoryText,
  buildTurnMemoryExtractionPrompts,
  parseTurnMemoryExtractionPayload,
} = require('../../dist/core/memory/memoryTurnExtraction.js');

test('isSubstantiveMemoryText ignores code blocks and requires 8 chars', () => {
  assert.equal(isSubstantiveMemoryText('remember this please'), true);
  assert.equal(isSubstantiveMemoryText('短的'), false);
  assert.equal(isSubstantiveMemoryText('```\nnpm install foo\n```'), false);
  assert.equal(isSubstantiveMemoryText('```\ncode\n``` 请记住一下这些偏好'), true);
});

test('buildTurnMemoryExtractionPrompts carries guard + implicit mode', () => {
  const prompts = buildTurnMemoryExtractionPrompts({
    userText: 'olvida que soy alérgico a los frutos secos',
    assistantText: 'entendido',
    guardLevel: 'relaxed',
    implicitEnabled: false,
  });
  assert.match(prompts.system, /ANY language/);
  assert.match(prompts.system, /relaxed: plausible durable facts are fine too/);
  assert.match(prompts.system, /Explicit-only mode/);
  const parsed = JSON.parse(prompts.user);
  assert.equal(parsed.guard_level, 'relaxed');
  assert.equal(parsed.implicit_enabled, false);
  assert.equal(parsed.user_message, 'olvida que soy alérgico a los frutos secos');
});

test('parseTurnMemoryExtractionPayload tolerates fences, drops junk, caps 2/2/2', () => {
  const payload = '```json\n' + JSON.stringify({
    changes: [
      { action: 'add', text: 'A', is_explicit: true },
      { action: 'add', text: 'B', is_explicit: true },
      { action: 'add', text: 'C', is_explicit: true },
      { action: 'add', text: 'D' },
      { action: 'add', text: '' },
      { action: 'delete', text: 'old fact' },
      { action: 'nonsense', text: 'x' },
    ],
  }) + '\n```';
  const changes = parseTurnMemoryExtractionPayload(payload);
  assert.deepEqual(changes, [
    { action: 'add', text: 'A', isExplicit: true },
    { action: 'add', text: 'B', isExplicit: true },
    { action: 'add', text: 'D', isExplicit: false },
    { action: 'delete', text: 'old fact', isExplicit: false },
  ]);

  assert.equal(parseTurnMemoryExtractionPayload('no json'), null);
  assert.equal(parseTurnMemoryExtractionPayload(''), null);
  assert.equal(parseTurnMemoryExtractionPayload('{"changes": []}').length, 0);
});
