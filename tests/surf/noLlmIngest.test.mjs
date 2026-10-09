import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runSurfNoLlmKbIngest } = require('../../dist/core/surf/noLlmIngest.js');

function pinReader(map) {
  return async (pinId) => {
    const entry = map[pinId];
    if (!entry) throw new Error(`unknown pin ${pinId}`);
    return entry;
  };
}

test('saves briefed pins raw into the KB, skipping unreadable and empty pins', async () => {
  const saved = [];
  const result = await runSurfNoLlmKbIngest({
    items: [{ pinId: 'p1', title: 'Briefing Title 1' }, { pinId: 'p2' }, { pinId: 'p3' }, { pinId: 'p4' }],
    maxSaves: 10,
    readPin: pinReader({
      p1: { pinId: 'p1', meta: { title: 'Real Title' }, text: 'full body one' },
      p2: { pinId: 'p2', meta: { title: '' }, text: '  ' },
      p3: { pinId: 'p3', meta: { title: 'T3' }, text: 'full body three' },
      // p4 missing → read error
    }),
    addDocument: async (doc) => { saved.push(doc); },
  });

  assert.equal(result.savedToKb, 2);
  assert.deepEqual(result.savedPinIds, ['p1', 'p3']);
  assert.deepEqual(result.skippedPinIds.sort(), ['p2', 'p4']);
  assert.equal(saved[0].title, 'Real Title');
  assert.equal(saved[0].content, 'full body one');
  assert.equal(saved[0].sourceType, 'metaweb');
  assert.equal(saved[0].pinId, 'p1');
  // Falls back to the briefing title when the pin has none.
  assert.equal(saved[1].title, 'T3');
});

test('honors the KB add budget', async () => {
  const saved = [];
  const result = await runSurfNoLlmKbIngest({
    items: [{ pinId: 'p1' }, { pinId: 'p2' }, { pinId: 'p3' }],
    maxSaves: 1,
    readPin: pinReader({
      p1: { pinId: 'p1', meta: { title: 'T1' }, text: 'one' },
      p2: { pinId: 'p2', meta: { title: 'T2' }, text: 'two' },
      p3: { pinId: 'p3', meta: { title: 'T3' }, text: 'three' },
    }),
    addDocument: async (doc) => { saved.push(doc); },
  });
  assert.equal(result.savedToKb, 1);
  assert.deepEqual(result.savedPinIds, ['p1']);
});

test('KB write failures skip the pin instead of aborting the run', async () => {
  const warnings = [];
  const savedDocs = [];
  const result = await runSurfNoLlmKbIngest({
    items: [{ pinId: 'p1' }, { pinId: 'p2' }],
    maxSaves: 5,
    readPin: pinReader({
      p1: { pinId: 'p1', meta: { title: 'T1' }, text: 'one' },
      p2: { pinId: 'p2', meta: { title: 'T2' }, text: 'two' },
    }),
    addDocument: async (doc) => {
      if (doc.pinId === 'p1') throw new Error('kb full');
      savedDocs.push(doc);
    },
    logWarning: (message) => warnings.push(message),
  });
  assert.equal(result.savedToKb, 1);
  assert.deepEqual(result.savedPinIds, ['p2']);
  assert.deepEqual(result.skippedPinIds, ['p1']);
  assert.ok(warnings.some((message) => message.includes('kb full')));
});
