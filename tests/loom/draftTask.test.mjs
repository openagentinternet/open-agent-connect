import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { draftLoomTask } = require('../../dist/core/loom/index.js');

function validTaskPayload(overrides = {}) {
  return {
    title: 'Add Loom task drafting',
    requirementContentType: 'text/markdown',
    requirement: 'Implement an LLM-assisted Loom task draft command.',
    criteriaContentType: 'text/markdown',
    criteria: '- Produces a valid loom-task payload\n- Does not write chain data',
    projectBase: 'chain',
    project: {},
    bounty: {
      amount: '1',
      currency: 'SPACE',
    },
    tags: ['loom'],
    ...overrides,
  };
}

async function runDraft(output, options = {}) {
  const prompts = [];
  const result = await draftLoomTask({
    wish: options.wish ?? 'Draft a Loom task for CLI task drafting.',
    allowInvalid: options.allowInvalid ?? false,
    executePrompt: async (input) => {
      prompts.push(input);
      return output;
    },
  });
  return { result, prompts };
}

test('draftLoomTask extracts payload JSON from plain JSON output', async () => {
  const payload = validTaskPayload();
  const { result, prompts } = await runDraft(JSON.stringify(payload));

  assert.equal(result.ok, true);
  assert.equal(result.data.protocol, 'task');
  assert.equal(result.data.path, '/protocols/loom-task');
  assert.equal(result.data.valid, true);
  assert.deepEqual(result.data.payload, payload);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0].systemPrompt, /output JSON only/i);
  assert.match(prompts[0].prompt, /\/protocols\/loom-task/);
});

test('draftLoomTask extracts payload JSON from fenced JSON output', async () => {
  const payload = validTaskPayload({ title: 'Fenced draft' });
  const { result } = await runDraft(`Here is the payload:\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``);

  assert.equal(result.ok, true);
  assert.equal(result.data.valid, true);
  assert.deepEqual(result.data.payload, payload);
});

test('draftLoomTask reports invalid_llm_output for unparseable LLM output', async () => {
  const { result } = await runDraft('not json');

  assert.equal(result.ok, false);
  assert.equal(result.state, 'failed');
  assert.equal(result.code, 'invalid_llm_output');
  assert.match(result.message, /valid JSON/i);
  assert.equal(result.data.rawOutput, 'not json');
});

test('draftLoomTask returns a valid draft when parsed JSON passes validation', async () => {
  const payload = validTaskPayload({
    deadline: 1750000000000,
    attachments: ['metafile://draft-brief'],
  });
  const { result } = await runDraft(JSON.stringify(payload));

  assert.equal(result.ok, true);
  assert.deepEqual(result.data, {
    protocol: 'task',
    path: '/protocols/loom-task',
    valid: true,
    payload,
    validation: {
      valid: true,
      protocol: 'task',
      path: '/protocols/loom-task',
      errors: [],
    },
  });
});

test('draftLoomTask rejects invalid task JSON unless allowInvalid is true', async () => {
  const payload = validTaskPayload({ bounty: { amount: '0', currency: 'SPACE' } });

  const rejected = await runDraft(JSON.stringify(payload));
  assert.equal(rejected.result.ok, false);
  assert.equal(rejected.result.state, 'failed');
  assert.equal(rejected.result.code, 'invalid_payload');
  assert.deepEqual(rejected.result.data.payload, payload);
  assert.equal(rejected.result.data.validation.valid, false);
  assert.ok(rejected.result.data.validation.errors.some((error) => error.path === 'bounty.amount'));

  const allowed = await runDraft(JSON.stringify(payload), { allowInvalid: true });
  assert.equal(allowed.result.ok, true);
  assert.equal(allowed.result.data.valid, false);
  assert.deepEqual(allowed.result.data.payload, payload);
  assert.ok(allowed.result.data.validation.errors.some((error) => error.path === 'bounty.amount'));
});
