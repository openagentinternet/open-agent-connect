import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildMetabotIdentityBlock,
  METABOT_IDENTITY_ADHERENCE_LINE,
  METABOT_IDENTITY_INSTRUCTION,
} = require('../../dist/core/prompt/metabotIdentity.js');
const {
  composeSystemPrompt,
  SYSTEM_PROMPT_ORDER,
} = require('../../dist/core/prompt/compose.js');

test('buildMetabotIdentityBlock renders the shared XML block with fields in a fixed order', () => {
  const block = buildMetabotIdentityBlock({
    name: '火舞',
    globalMetaId: 'idq1abc',
    role: 'coding assistant',
    soul: 'curious and friendly',
    goal: 'explore collaboration',
    bio: 'a test bot',
  });
  const expectedOrder = [
    '<metabot_identity>',
    '<name>火舞</name>',
    '<globalmetaid>idq1abc</globalmetaid>',
    '<role>coding assistant</role>',
    '<soul>curious and friendly</soul>',
    '<goal>explore collaboration</goal>',
    '<bio>a test bot</bio>',
    '</metabot_identity>',
  ];
  let cursor = -1;
  for (const fragment of expectedOrder) {
    const index = block.indexOf(fragment);
    assert.ok(index > cursor, `missing or mis-ordered fragment: ${fragment}`);
    cursor = index;
  }
  assert.ok(block.includes(METABOT_IDENTITY_INSTRUCTION));
});

test('buildMetabotIdentityBlock skips empty fields and escapes XML', () => {
  const block = buildMetabotIdentityBlock({
    name: 'A "quoted" <bot>',
    role: '',
    soul: '  ',
    goal: null,
  });
  assert.ok(block.includes('<name>A &quot;quoted&quot; &lt;bot&gt;</name>'));
  assert.ok(!block.includes('<role>'));
  assert.ok(!block.includes('<soul>'));
  assert.ok(!block.includes('<goal>'));
  assert.ok(!block.includes('<globalmetaid>'));
});

test('buildMetabotIdentityBlock returns empty string when no field is present', () => {
  assert.equal(buildMetabotIdentityBlock({}), '');
  assert.equal(buildMetabotIdentityBlock({ name: '  ', role: null }), '');
});

test('the adherence instruction covers persona alignment and host-identity separation', () => {
  assert.match(METABOT_IDENTITY_ADHERENCE_LINE, /strictly adhere/);
  assert.match(METABOT_IDENTITY_ADHERENCE_LINE, /ALL behavior in this session/);
  assert.match(METABOT_IDENTITY_INSTRUCTION, /belongs to the execution host only/);
  assert.match(METABOT_IDENTITY_INSTRUCTION, /never invent, translate, or substitute another name/);
});

test('composeSystemPrompt sorts by order, drops empties, and dedupes by name (later shadows earlier)', () => {
  const composed = composeSystemPrompt([
    { name: 'identity', order: SYSTEM_PROMPT_ORDER.identity, text: 'first identity' },
    { name: 'scenario', order: SYSTEM_PROMPT_ORDER.scenario, text: 'scenario line' },
    { name: 'empty', order: 99, text: '   ' },
    { name: 'identity', order: SYSTEM_PROMPT_ORDER.identity, text: 'shadowing identity' },
    null,
    undefined,
  ]);
  assert.equal(composed, 'scenario line\n\nshadowing identity');
});
