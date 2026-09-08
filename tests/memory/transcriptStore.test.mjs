import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const {
  appendTranscriptTurn,
  normalizeSessionReference,
  readSessionMessages,
  readTranscript,
} = require('../../dist/core/memory/transcriptStore.js');

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

test('normalizeSessionReference strips the printed schemes and rejects invalid ids', () => {
  assert.equal(normalizeSessionReference('  session-abc_1.def  '), 'session-abc_1.def');
  assert.equal(normalizeSessionReference('session:session-abc'), 'session-abc');
  assert.equal(normalizeSessionReference('session://session-abc'), 'session-abc');
  assert.equal(normalizeSessionReference(''), null);
  assert.equal(normalizeSessionReference('session:'), null);
  assert.equal(normalizeSessionReference('bad id with spaces'), null);
  assert.equal(normalizeSessionReference('bad/id'), null);
});

test('readSessionMessages summarizes a mirrored DSH transcript by id', async () => {
  const paths = await createTempProfilePaths();
  await appendTranscriptTurn(paths, makeTurn(1));
  await appendTranscriptTurn(paths, makeTurn(2));
  const summary = await readSessionMessages(paths, 'session:s1');
  assert.ok(summary);
  assert.equal(summary.sessionId, 's1');
  assert.equal(summary.channel, 'dsh');
  assert.equal(summary.messageCount, 2);
  assert.equal(summary.firstMessageAt, 1_700_000_000_000 + 1000);
  assert.equal(summary.lastMessageAt, 1_700_000_000_000 + 2000);
  assert.deepEqual(summary.turns.map((t) => t.role), ['user', 'assistant']);
});

test('readSessionMessages falls back to the A2A private-chat store', async () => {
  const paths = await createTempProfilePaths();
  await fs.mkdir(paths.a2aRoot, { recursive: true });
  await fs.writeFile(
    path.join(paths.a2aRoot, 'chat-peer1.json'),
    JSON.stringify({
      peer: { globalMetaId: 'gmid-peer1', name: 'Peer One' },
      messages: [
        { direction: 'incoming', content: '你好', timestamp: 1_700_000_100_000 },
        { direction: 'outgoing', content: '你好！', timestamp: 1_700_000_200_000 },
        { direction: 'incoming', content: '   ', timestamp: 1_700_000_300_000 },
      ],
    }),
    'utf8',
  );
  const byStoredId = await readSessionMessages(paths, 'chat-peer1');
  assert.ok(byStoredId);
  assert.equal(byStoredId.channel, 'metaweb_private');
  assert.equal(byStoredId.peerGlobalMetaId, 'gmid-peer1');
  assert.equal(byStoredId.peerName, 'Peer One');
  // Blank messages never surface as turns.
  assert.equal(byStoredId.messageCount, 2);
  assert.deepEqual(byStoredId.turns.map((t) => t.role), ['user', 'assistant']);

  const withoutPrefix = await readSessionMessages(paths, 'peer1');
  assert.ok(withoutPrefix);
  assert.equal(withoutPrefix.sessionId, 'chat-peer1');
});

test('readSessionMessages returns null for an unknown session', async () => {
  const paths = await createTempProfilePaths();
  assert.equal(await readSessionMessages(paths, 'missing'), null);
  assert.equal(await readSessionMessages(paths, 'bad id'), null);
});
