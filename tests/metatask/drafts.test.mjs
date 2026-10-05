import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildParticipateDraft, suggestParticipateNode } = require('../../dist/core/metatask/drafts.js');

/**
 * Participation drafts (UI reference F13): the IDBots templates ported with
 * `metabot metatask …` verbs, mode-aware, with the suggested-node hint; the
 * UIs only hand the draft out — they never write.
 */

const projectionOf = (over = {}) => ({
  rootPinId: 'task000000000000000000000000000000000000000000000000000001i0',
  title: 'witness extraction',
  policy: { mode: 'tree' },
  nodeStates: {
    r1: { id: 'r1', status: 'open', deps: [], submissions: [] },
    t1: { id: 't1', status: 'open', deps: [], submissions: [] },
  },
  ...over,
});

test('drafts: tree template names the task, root and CLI verbs (en + zh)', () => {
  const draft = buildParticipateDraft(projectionOf(), { lang: 'en' });
  assert.equal(draft.mode, 'tree');
  assert.equal(draft.node, 'r1', 'first open node suggested');
  assert.match(draft.text, /"witness extraction"/);
  assert.match(draft.text, /task000000000000000000000000000000000000000000000000000001i0/);
  assert.match(draft.text, /node r1 is a good candidate/);
  assert.match(draft.text, /metabot metatask claim --root <root> --node <id> --from <bot>/);
  assert.match(draft.text, /metabot metatask submit --request-file <json>/);
  assert.match(draft.text, /#8\/#9 gates/);

  const zh = buildParticipateDraft(projectionOf(), { lang: 'zh' });
  assert.match(zh.text, /「witness extraction」/);
  assert.match(zh.text, /建议从节点 r1 开始评估/);
  assert.match(zh.text, /metabot metatask claim/);
  assert.match(zh.text, /#8\/#9 门禁/);
});

test('drafts: competitive template explains fork racing and parentRefs', () => {
  const competitive = projectionOf({
    policy: { mode: 'competitive' },
    nodeStates: {
      r1: { id: 'r1', status: 'open', deps: ['t1'], submissions: [] },
      t1: { id: 't1', status: 'open', deps: [], submissions: [] },
    },
  });
  const draft = buildParticipateDraft(competitive, { lang: 'en' });
  assert.equal(draft.mode, 'competitive');
  assert.match(draft.text, /COMPETITIVE task/);
  assert.match(draft.text, /intent signal/);
  assert.match(draft.text, /parentRefs \(one submission pinId per dep; entry nodes omit it\)/);
  assert.equal(draft.node, 't1', 'entry node preferred over the join node');

  const zh = buildParticipateDraft(competitive, { lang: 'zh' });
  assert.match(zh.text, /竞赛任务/);
  assert.match(zh.text, /乐观抢跑、自担风险/);
});

test('drafts: node suggestion prefers open entry nodes with the fewest candidates', () => {
  // t2 has fewer competing candidates than t1 → suggested.
  const ranked = suggestParticipateNode(projectionOf({
    nodeStates: {
      t1: { id: 't1', status: 'open', deps: [], submissions: [{}, {}] },
      t2: { id: 't2', status: 'open', deps: [], submissions: [{}] },
    },
  }));
  assert.equal(ranked, 't2');

  // No entry nodes → falls back to dep-carrying open nodes.
  const fallback = suggestParticipateNode(projectionOf({
    nodeStates: {
      r1: { id: 'r1', status: 'open', deps: ['a'], submissions: [] },
      a: { id: 'a', status: 'verified', deps: [], submissions: [] },
    },
  }));
  assert.equal(fallback, 'r1');

  // Everything verified → no hint.
  const settled = suggestParticipateNode(projectionOf({
    nodeStates: { a: { id: 'a', status: 'verified', deps: [], submissions: [] } },
  }));
  assert.equal(settled, null);
});
