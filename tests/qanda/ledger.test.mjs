import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRootSync } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const ledger = require('../../dist/core/qanda/ledger.js');
const { QaRecallNotFoundError } = require('../../dist/core/qanda/recall.js');

function makeProfile(prefix) {
  const systemHome = mkdtempTempRootSync(prefix);
  const homeDir = path.join(systemHome, '.metabot', 'profiles', 'bot-1');
  mkdirSync(homeDir, { recursive: true });
  return resolveMetabotPaths(homeDir);
}

test('ledger records and lists per slug+question, junk-tolerant reads', async () => {
  const paths = makeProfile('metabot-qa-ledger-');
  const book = ledger.createQaAnswerLedger(paths);
  const q1 = 'a'.repeat(64) + 'i0';
  await book.recordAnswer('bot-1', q1, {
    answerPinId: 'b'.repeat(64) + 'i0',
    content: 'first',
    postedAt: 1,
    network: 'mvc',
  });
  await book.recordAnswer('bot-1', q1, {
    answerPinId: 'c'.repeat(64) + 'i0',
    content: 'second',
    postedAt: 2,
    network: 'mvc',
  });
  await book.recordAnswer('bot-2', q1, {
    answerPinId: 'd'.repeat(64) + 'i0',
    content: 'other bot',
    postedAt: 3,
    network: 'mvc',
  });
  const mine = await book.listAnswers('bot-1', q1);
  assert.deepEqual(mine.map((entry) => entry.content), ['first', 'second'], 'newest last');
  assert.equal((await book.listAnswers('bot-2', q1)).length, 1);
  assert.equal((await book.listAnswers('bot-1', 'unknown')).length, 0);

  // Corrupt file reads as "no prior answers", never throws.
  writeFileSync(
    path.join(paths.workspaceRoot, 'memory', 'qanda-answer-ledger.json'),
    '{not json',
    'utf8',
  );
  assert.deepEqual(await book.listAnswers('bot-1', q1), []);
});

test('ledger caps entries per question and content length', async () => {
  const paths = makeProfile('metabot-qa-ledger-caps-');
  const book = ledger.createQaAnswerLedger(paths);
  const q = 'e'.repeat(64) + 'i0';
  for (let index = 0; index < 55; index += 1) {
    await book.recordAnswer('bot-1', q, {
      answerPinId: `${index.toString(16).padStart(64, '0')}i0`,
      content: 'x'.repeat(9000),
      postedAt: index,
      network: 'mvc',
    });
  }
  const rows = await book.listAnswers('bot-1', q);
  assert.equal(rows.length, 50, 'newest 50 kept');
  assert.equal(rows[0].postedAt, 5, 'oldest survivor is entry #5');
  assert.equal(rows[0].content.length, 8000, 'content truncated to 8000');
});

test('collectPriorAnswers: index wins when reachable, merges with local, dedup by answerPinId', async () => {
  const local = [
    { answerPinId: 'local-1', content: 'l1', postedAt: 5, network: 'mvc' },
    { answerPinId: 'shared', content: 'l2', postedAt: 6, network: 'mvc' },
  ];
  const merged = await ledger.collectPriorAnswers({
    local,
    fetchRemote: async () => [
      { pinId: 'shared', summary: 'from index', createdAt: 100, chainName: 'mvc' },
      { pinId: 'remote-1', summary: 'r1', createdAt: 200, chainName: 'btc' },
    ],
  });
  assert.equal(merged.source, 'index');
  assert.deepEqual(
    merged.answers.map((entry) => entry.answerPinId),
    ['shared', 'remote-1', 'local-1'],
  );
  assert.equal(merged.answers[0].content, 'from index');
  assert.equal(merged.answers[0].postedAt, 100_000);
});

test('collectPriorAnswers: 40400 keeps local as index-source; outage falls back to local; not-wired stays local', async () => {
  const local = [{ answerPinId: 'l', content: 'l', postedAt: 1, network: 'mvc' }];
  const notFound = await ledger.collectPriorAnswers({
    local,
    fetchRemote: async () => {
      throw new QaRecallNotFoundError('no such question');
    },
  });
  assert.equal(notFound.source, 'index');
  assert.deepEqual(notFound.answers, local);

  const outage = await ledger.collectPriorAnswers({
    local,
    fetchRemote: async () => {
      throw new Error('Q&A API error 50000: down');
    },
  });
  assert.equal(outage.source, 'local');
  assert.deepEqual(outage.answers, local);

  const unwired = await ledger.collectPriorAnswers({ local, fetchRemote: null });
  assert.deepEqual(unwired, { answers: local, source: 'local' });
});
