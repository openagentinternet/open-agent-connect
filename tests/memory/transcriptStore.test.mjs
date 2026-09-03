import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { appendTranscriptTurn, readTranscript } = require('../../dist/core/memory/transcriptStore.js');

async function createTempProfilePaths() {
  const base = await mkdtempTempRoot('metabot-transcript-store-test-');
  const profileRoot = path.join(base, '.metabot', 'profiles', 'test-slug');
  await fs.mkdir(profileRoot, { recursive: true });
  await fs.mkdir(path.join(base, '.metabot', 'manager'), { recursive: true });
  return resolveMetabotPaths(profileRoot);
}

function makeTurn(turn, overrides = {}) {
  return {
    sessionId: 's1',
    turn,
    role: turn % 2 === 1 ? 'user' : 'assistant',
    text: `turn ${turn}`,
    ts: 1_700_000_000_000 + turn * 1000,
    channel: 'dsh',
    peerGlobalMetaId: null,
    ...overrides,
  };
}

test('readTranscript returns every turn by default (no implicit limit of 1)', async () => {
  const paths = await createTempProfilePaths();
  for (const turn of [1, 2, 3]) {
    await appendTranscriptTurn(paths, makeTurn(turn));
  }
  const turns = await readTranscript(paths, 's1');
  assert.equal(turns.length, 3);
  assert.deepEqual(turns.map((t) => t.turn), [1, 2, 3]);
});

test('readTranscript honors an explicit limit by returning the capped tail', async () => {
  const paths = await createTempProfilePaths();
  for (const turn of [1, 2, 3]) {
    await appendTranscriptTurn(paths, makeTurn(turn));
  }
  const turns = await readTranscript(paths, 's1', { limit: 2 });
  assert.equal(turns.length, 2);
  assert.deepEqual(turns.map((t) => t.turn), [2, 3]);
});

test('readTranscript returns [] for an unknown session', async () => {
  const paths = await createTempProfilePaths();
  assert.deepEqual(await readTranscript(paths, 'missing'), []);
});
