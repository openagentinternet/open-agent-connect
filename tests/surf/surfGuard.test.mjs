// Surf interaction guard — OAC port of the IDBots surfInteractionGuard
// tests: self-interaction block, duplicate guard, budget ceiling, receipts.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createMetawebSurfStore } = require('../../dist/core/surf/store.js');
const {
  createSurfChainWriteGuard,
  foldSurfReceiptsIntoSeenActions,
  recordSurfDeepRead,
  surfReceiptSeenActions,
  surfSessionPartialStats,
  surfReceiptsFromChainWriteRecord,
} = require('../../dist/core/surf/guard.js');

async function createTempProfileHome() {
  const base = await mkdtempTempRoot('metabot-surf-guard-');
  const profileRoot = path.join(base, '.metabot', 'profiles', 'test-slug');
  await fs.mkdir(profileRoot, { recursive: true });
  return resolveMetabotPaths(profileRoot);
}

function makeWrite() {
  const calls = [];
  const write = async ({ path, payload }) => {
    calls.push({ path, payload });
    return { pinId: `new-pin-${calls.length}`, txids: [], totalCost: 1, network: 'mvc' };
  };
  return { write, calls };
}

test('budget ceiling: attempts beyond the cap are refused with guidance', async () => {
  const { write } = makeWrite();
  const state = { interactionBudget: 2, kbBudget: 40 };
  const guarded = createSurfChainWriteGuard({ write, state });
  await guarded({ path: '/protocols/simplebuzz', payload: { content: 'a' } });
  await guarded({ path: '/protocols/simplebuzz', payload: { content: 'b' } });
  await assert.rejects(
    () => guarded({ path: '/protocols/simplebuzz', payload: { content: 'c' } }),
    /budget exhausted/,
  );
  assert.equal(state.writesUsed, 2);
});

test('duplicate guard: equal-or-stronger prior interaction is refused free of budget', async () => {
  const paths = await createTempProfileHome();
  const store = createMetawebSurfStore(paths);
  await store.markSeen('target-1', 'liked', '2026-09-14T00:00:00Z');
  const { write } = makeWrite();
  const state = { interactionBudget: 5, kbBudget: 40 };
  const guarded = createSurfChainWriteGuard({
    write,
    state,
    getSeenAction: (pinId) => store.getSeenAction(pinId),
  });
  // Same action on a ledger-seen pin: refused, budget NOT spent.
  await assert.rejects(
    () => guarded({ path: '/protocols/paylike', payload: { isLike: 1, likeTo: 'target-1' } }),
    /Already interacted/,
  );
  assert.equal(state.writesUsed ?? 0, 0);
  // A STRONGER follow-up is allowed and recorded in-run.
  await guarded({ path: '/protocols/paycomment', payload: { commentTo: 'target-1', content: 'real addition' } });
  assert.equal(state.writesUsed, 1);
  // The in-run record now blocks a repeat comment this run.
  await assert.rejects(
    () => guarded({ path: '/protocols/paycomment', payload: { commentTo: 'target-1', content: 'again' } }),
    /Already interacted/,
  );
  assert.equal(state.writesUsed, 1);
  // Read-level ledger entries never block interactions.
  await store.markSeen('target-2', 'read', '2026-09-14T00:00:00Z');
  await guarded({ path: '/protocols/paylike', payload: { isLike: 1, likeTo: 'target-2' } });
  assert.equal(state.writesUsed, 2);
});

test('self-interaction block: own pins rejected free of budget; own-thread comments allowed', async () => {
  const paths = await createTempProfileHome();
  const store = createMetawebSurfStore(paths);
  const ownPins = new Set(['own-pin-1']);
  const { write } = makeWrite();
  const state = { interactionBudget: 5, kbBudget: 40 };
  const guarded = createSurfChainWriteGuard({
    write,
    state,
    isOwnPin: async (pinId) => ownPins.has(pinId),
  });
  await assert.rejects(
    () => guarded({ path: '/protocols/paylike', payload: { isLike: 1, likeTo: 'own-pin-1' } }),
    /YOUR OWN pin/,
  );
  await assert.rejects(
    () => guarded({ path: '/protocols/simpleanswer', payload: { answerTo: 'own-pin-1', content: 'me' } }),
    /YOUR OWN pin/,
  );
  assert.equal(state.writesUsed ?? 0, 0);
  // Commenting in your own thread is the inbox path — allowed.
  await guarded({ path: '/protocols/paycomment', payload: { commentTo: 'own-pin-1', content: 'thanks' } });
  assert.equal(state.writesUsed, 1);
});

test('receipts: posts and interactions become ground truth; fold replaces self-report', () => {
  const state = { interactionBudget: 5, kbBudget: 40 };
  state.writesUsed = 3;
  state.interactions = { 't-1': 4 }; // liked
  state.postedPinIds = ['new-pin-1'];
  state.readPinIds = ['r-1'];
  state.kbAddsUsed = 2;
  state.tasksScheduled = 1;

  const receipts = surfReceiptSeenActions(state);
  assert.ok(receipts.some((entry) => entry.pinId === 't-1' && entry.action === 'liked'));
  assert.ok(receipts.some((entry) => entry.pinId === 'new-pin-1' && entry.action === 'posted'));

  const folded = foldSurfReceiptsIntoSeenActions(
    [
      { pinId: 't-1', action: 'liked' }, // self-report (kept only via receipt)
      { pinId: 'hallucinated', action: 'liked' }, // claimed but never published → dropped
      { pinId: 's-1', action: 'saved' }, // read/save class stays self-reported
    ],
    state,
  );
  assert.ok(folded.some((entry) => entry.pinId === 't-1' && entry.action === 'liked'));
  assert.ok(!folded.some((entry) => entry.pinId === 'hallucinated'));
  assert.ok(folded.some((entry) => entry.pinId === 's-1' && entry.action === 'saved'));
  assert.ok(folded.some((entry) => entry.pinId === 'r-1' && entry.action === 'read'));

  const partial = surfSessionPartialStats(state);
  assert.equal(partial.liked, 1);
  assert.equal(partial.posted, 1);
  assert.equal(partial.savedToKb, 2);
  assert.equal(partial.deepRead, 1);
  assert.equal(partial.tasksScheduled, 1);
});

test('deep-read recording is deduped', () => {
  const state = { interactionBudget: 0, kbBudget: 0 };
  recordSurfDeepRead(state, 'p1');
  recordSurfDeepRead(state, 'p1');
  recordSurfDeepRead(state, 'p2');
  assert.deepEqual(state.readPinIds, ['p1', 'p2']);
});

test('chain-write reconciliation: own pin → posted receipt; interaction payload → target receipt', () => {
  const likeReceipts = surfReceiptsFromChainWriteRecord({
    pinId: 'my-pin',
    path: '/protocols/paylike',
    contentText: JSON.stringify({ isLike: 1, likeTo: 'their-pin' }),
  });
  assert.deepEqual(likeReceipts, [
    { pinId: 'my-pin', action: 'posted' },
    { pinId: 'their-pin', action: 'liked' },
  ]);
  const original = surfReceiptsFromChainWriteRecord({
    pinId: 'my-buzz',
    path: '/protocols/simplebuzz',
    contentText: JSON.stringify({ content: 'hi' }),
  });
  assert.deepEqual(original, [{ pinId: 'my-buzz', action: 'posted' }]);
  const unparsable = surfReceiptsFromChainWriteRecord({
    pinId: 'x',
    path: '/protocols/paycomment',
    contentText: '{truncat',
  });
  assert.deepEqual(unparsable, [{ pinId: 'x', action: 'posted' }]);
});

test('duplicate interactions refuse WITHOUT spending budget even when the write target extraction has a stronger rank', async () => {
  const { write } = makeWrite();
  const state = { interactionBudget: 1, kbBudget: 40 };
  const guarded = createSurfChainWriteGuard({ write, state });
  // Answer then like the same question: answered (6) is stronger than liked (4)
  // → the like is refused.
  await guarded({ path: '/protocols/simpleanswer', payload: { answerTo: 'q-1', content: 'a' } });
  await assert.rejects(
    () => guarded({ path: '/protocols/paylike', payload: { isLike: 1, likeTo: 'q-1' } }),
    /Already interacted/,
  );
  assert.equal(state.writesUsed, 1);
});
