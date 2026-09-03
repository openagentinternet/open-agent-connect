import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createChainHistoryStore } = require('../../dist/core/chainhistory/store.js');
const { monthShardForMs } = require('../../dist/core/chainhistory/monthShard.js');

const DAY_MS = 24 * 60 * 60 * 1000;

async function createTempProfilePaths() {
  const base = await mkdtempTempRoot('metabot-chainhistory-test-');
  const profileRoot = path.join(base, '.metabot', 'profiles', 'test-slug');
  await fs.mkdir(profileRoot, { recursive: true });
  await fs.mkdir(path.join(base, '.metabot', 'manager'), { recursive: true });
  return resolveMetabotPaths(profileRoot);
}

// Local-timezone timestamp: month shards are named by local calendar month,
// so tests build times through the local Date constructor to match.
function localMs(year, monthIndex, day, hour = 12, minute = 0) {
  return new Date(year, monthIndex, day, hour, minute).getTime();
}

function monthsAgoMs(count, now = Date.now()) {
  const date = new Date(now);
  date.setDate(15);
  date.setMonth(date.getMonth() - count);
  return date.getTime();
}

function localDayStart(ms) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

async function fileExists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

test('recordWrite persists a full record and is idempotent per pinId', async () => {
  const paths = await createTempProfilePaths();
  const store = createChainHistoryStore(paths);
  const occurredAtMs = localMs(2026, 8, 2, 10);
  const input = {
    pinId: 'pin-write-roundtrip',
    txId: 'tx-1',
    path: '/protocols/simplebuzz',
    operation: 'create',
    network: 'mainnet',
    contentText: 'hello chain',
    contentType: 'text/plain',
    occurredAtMs,
  };
  assert.deepEqual(await store.recordWrite(input), { created: true });

  const record = await store.getWrite('pin-write-roundtrip');
  assert.equal(record.pinId, 'pin-write-roundtrip');
  assert.equal(record.txId, 'tx-1');
  assert.equal(record.path, '/protocols/simplebuzz');
  assert.equal(record.operation, 'create');
  assert.equal(record.network, 'mainnet');
  assert.equal(record.contentText, 'hello chain');
  assert.equal(record.contentTruncated, false);
  assert.equal(record.contentBytes, Buffer.byteLength('hello chain', 'utf8'));
  assert.equal(record.contentType, 'text/plain');
  assert.equal(record.summary, null);
  assert.equal(record.summaryStatus, 'skipped');
  assert.equal(record.summaryAttempts, 0);
  assert.equal(record.summarizedAtMs, null);
  assert.equal(record.occurredAtMs, occurredAtMs);
  assert.ok(record.createdAtMs > 0);

  const shard = monthShardForMs(occurredAtMs);
  const filePath = path.join(paths.chainHistoryRoot, 'writes', shard, 'pin-write-roundtrip.json');
  const onDisk = JSON.parse(await fs.readFile(filePath, 'utf8'));
  assert.equal(onDisk.pinId, 'pin-write-roundtrip');

  // Re-recording the same pinId never overwrites the stored record.
  assert.deepEqual(await store.recordWrite({ ...input, contentText: 'different content' }), { created: false });
  assert.equal((await store.getWrite('pin-write-roundtrip')).contentText, 'hello chain');
});

test('recordWrite caps contentText at 16000 chars and records original byte size', async () => {
  const paths = await createTempProfilePaths();
  const store = createChainHistoryStore(paths);
  const contentText = 'x'.repeat(16_500);
  await store.recordWrite({ pinId: 'pin-write-truncate', contentText });
  const record = await store.getWrite('pin-write-truncate');
  assert.equal(record.contentText.length, 16_000);
  assert.equal(record.contentTruncated, true);
  assert.equal(record.contentBytes, Buffer.byteLength(contentText, 'utf8'));
  assert.equal(record.summaryStatus, 'pending');
});

test('recordWrite with null contentText (binary payload) is summary-skipped', async () => {
  const paths = await createTempProfilePaths();
  const store = createChainHistoryStore(paths);
  await store.recordWrite({
    pinId: 'pin-write-binary',
    contentText: null,
    contentBytes: 2048,
    contentType: 'image/png',
  });
  const record = await store.getWrite('pin-write-binary');
  assert.equal(record.contentText, null);
  assert.equal(record.contentTruncated, false);
  assert.equal(record.contentBytes, 2048);
  assert.equal(record.summaryStatus, 'skipped');
});

test('summaryStatus threshold: 799 chars skipped, 800 chars pending', async () => {
  const paths = await createTempProfilePaths();
  const store = createChainHistoryStore(paths);
  await store.recordWrite({ pinId: 'pin-threshold-799', contentText: 'a'.repeat(799) });
  await store.recordWrite({ pinId: 'pin-threshold-800', contentText: 'a'.repeat(800) });
  assert.equal((await store.getWrite('pin-threshold-799')).summaryStatus, 'skipped');
  assert.equal((await store.getWrite('pin-threshold-800')).summaryStatus, 'pending');
});

test('recordRead upserts across months and never clobbers summary or KB state', async () => {
  const paths = await createTempProfilePaths();
  const store = createChainHistoryStore(paths);
  const july = localMs(2026, 6, 31, 23);
  const august = localMs(2026, 7, 1, 1);
  assert.notEqual(monthShardForMs(july), monthShardForMs(august));

  await store.recordRead({
    pinId: 'pin-read-upsert',
    path: '/protocols/metaprotocol',
    protocol: 'metaprotocol',
    title: 'First title',
    authorGlobalMetaId: 'metaid-author',
    contentText: 'short excerpt',
    source: 'read_metaweb_pin',
    readAtMs: july,
  });
  let record = await store.getRead('pin-read-upsert');
  assert.equal(record.readCount, 1);
  assert.equal(record.firstReadAtMs, july);
  assert.equal(record.lastReadAtMs, july);
  assert.equal(record.contentExcerpt, 'short excerpt');
  assert.equal(record.summaryStatus, 'skipped');
  assert.equal(record.savedToKb, false);
  assert.equal(record.kbId, null);

  await store.applySummaryOutcome('read', 'pin-read-upsert', { status: 'done', summary: 'A summary.' });
  await store.markReadSavedToKb('pin-read-upsert', 'kb-1');

  // Re-read in a later month with fresh metadata but no content.
  await store.recordRead({ pinId: 'pin-read-upsert', title: 'Second title', readAtMs: august });
  record = await store.getRead('pin-read-upsert');
  assert.equal(record.readCount, 2);
  assert.equal(record.firstReadAtMs, july);
  assert.equal(record.lastReadAtMs, august);
  assert.equal(record.title, 'Second title');
  // Fields not provided by the re-read keep their stored values.
  assert.equal(record.path, '/protocols/metaprotocol');
  assert.equal(record.contentExcerpt, 'short excerpt');
  // Summary and KB state survive re-reads.
  assert.equal(record.summary, 'A summary.');
  assert.equal(record.summaryStatus, 'done');
  assert.equal(record.savedToKb, true);
  assert.equal(record.kbId, 'kb-1');

  // The record stays in its first-read month shard.
  assert.ok(await fileExists(path.join(
    paths.chainHistoryRoot, 'reads', monthShardForMs(july), 'pin-read-upsert.json',
  )));
  assert.equal(await fileExists(path.join(
    paths.chainHistoryRoot, 'reads', monthShardForMs(august), 'pin-read-upsert.json',
  )), false);
});

test('recordRead caps the excerpt at 8000 chars and derives summaryStatus from full text', async () => {
  const paths = await createTempProfilePaths();
  const store = createChainHistoryStore(paths);
  const fullText = 'y'.repeat(9_000);
  await store.recordRead({ pinId: 'pin-read-excerpt', contentText: fullText });
  const record = await store.getRead('pin-read-excerpt');
  assert.equal(record.contentExcerpt.length, 8_000);
  assert.equal(record.contentBytes, Buffer.byteLength(fullText, 'utf8'));
  assert.equal(record.summaryStatus, 'pending');
});

test('markReadSavedToKb returns false for unknown pins and true for known reads', async () => {
  const paths = await createTempProfilePaths();
  const store = createChainHistoryStore(paths);
  assert.equal(await store.markReadSavedToKb('pin-kb-missing', 'kb-1'), false);
  await store.recordRead({ pinId: 'pin-kb-known', title: 'doc' });
  assert.equal(await store.markReadSavedToKb('pin-kb-known', 'kb-42'), true);
  const record = await store.getRead('pin-kb-known');
  assert.equal(record.savedToKb, true);
  assert.equal(record.kbId, 'kb-42');
});

test('day-window queries filter by day and cross month boundaries', async () => {
  const paths = await createTempProfilePaths();
  const store = createChainHistoryStore(paths);
  const jan31 = localMs(2026, 0, 31, 12);
  const feb1 = localMs(2026, 1, 1, 8);
  const jan31Start = localMs(2026, 0, 31, 0);
  const feb1Start = localMs(2026, 1, 1, 0);
  const feb2Start = localMs(2026, 1, 2, 0);

  await store.recordWrite({ pinId: 'pin-day-jan', contentText: 'jan write', occurredAtMs: jan31 });
  await store.recordWrite({ pinId: 'pin-day-feb', contentText: 'feb write', occurredAtMs: feb1 });
  await store.recordRead({ pinId: 'pin-read-jan', readAtMs: jan31 });
  await store.recordRead({ pinId: 'pin-read-feb', readAtMs: feb1 });

  const janWrites = await store.listWritesForDay({ startMs: jan31Start, endMs: feb1Start });
  assert.deepEqual(janWrites.map((record) => record.pinId), ['pin-day-jan']);

  // A window spanning both days crosses the Jan/Feb shard boundary.
  const bothWrites = await store.listWritesForDay({ startMs: jan31Start, endMs: feb2Start });
  assert.deepEqual(bothWrites.map((record) => record.pinId), ['pin-day-jan', 'pin-day-feb']);

  const limited = await store.listWritesForDay({ startMs: jan31Start, endMs: feb2Start, limit: 1 });
  assert.deepEqual(limited.map((record) => record.pinId), ['pin-day-jan']);

  // Reads are filtered by lastReadAtMs.
  const janReads = await store.listReadsForDay({ startMs: jan31Start, endMs: feb1Start });
  assert.deepEqual(janReads.map((record) => record.pinId), ['pin-read-jan']);

  // A re-read bumps lastReadAtMs, but the record stays in its first-read
  // shard, so a single-day scan in the later month does not see it; a window
  // covering both months does.
  await store.recordRead({ pinId: 'pin-read-jan', readAtMs: feb1 });
  const janReadsAfter = await store.listReadsForDay({ startMs: jan31Start, endMs: feb1Start });
  assert.deepEqual(janReadsAfter.map((record) => record.pinId), []);
  const febReads = await store.listReadsForDay({ startMs: feb1Start, endMs: feb2Start });
  assert.deepEqual(febReads.map((record) => record.pinId), ['pin-read-feb']);
  const bothReads = await store.listReadsForDay({ startMs: jan31Start, endMs: feb2Start });
  assert.deepEqual(bothReads.map((record) => record.pinId).sort(), ['pin-read-feb', 'pin-read-jan']);
});

test('listPendingSummaries scans only the current and previous month shards', async () => {
  const paths = await createTempProfilePaths();
  const store = createChainHistoryStore(paths);
  const now = Date.now();
  const longText = 'x'.repeat(900);
  await store.recordWrite({ pinId: 'pin-pending-old', contentText: longText, occurredAtMs: monthsAgoMs(3, now) });
  await store.recordWrite({ pinId: 'pin-pending-prev', contentText: longText, occurredAtMs: monthsAgoMs(1, now) });
  await store.recordWrite({ pinId: 'pin-pending-cur', contentText: longText, occurredAtMs: now });
  await store.recordWrite({ pinId: 'pin-pending-skipped', contentText: 'tiny', occurredAtMs: now });

  const pending = await store.listPendingSummaries('write');
  const pinIds = pending.map((entry) => entry.record.pinId);
  // A pending record from 3 months ago is outside the 2-month scan scope.
  assert.ok(!pinIds.includes('pin-pending-old'));
  assert.ok(!pinIds.includes('pin-pending-skipped'));
  assert.deepEqual(pinIds, ['pin-pending-prev', 'pin-pending-cur']); // oldest first
  for (const entry of pending) {
    assert.match(entry.shard, /^\d{4}-\d{2}$/);
    assert.equal(entry.record.summaryStatus, 'pending');
  }
});

test('applySummaryOutcome handles done (trim + cap 500) and failed (flips at 3 attempts)', async () => {
  const paths = await createTempProfilePaths();
  const store = createChainHistoryStore(paths);
  const longText = 'x'.repeat(900);

  await store.recordWrite({ pinId: 'pin-outcome-done', contentText: longText });
  const longSummary = `  ${'s'.repeat(600)}  `;
  assert.equal(await store.applySummaryOutcome('write', 'pin-outcome-done', { status: 'done', summary: longSummary }), true);
  let record = await store.getWrite('pin-outcome-done');
  assert.equal(record.summaryStatus, 'done');
  assert.equal(record.summary.length, 500);
  assert.equal(record.summary, 's'.repeat(500));
  assert.ok(record.summarizedAtMs > 0);

  await store.recordWrite({ pinId: 'pin-outcome-fail', contentText: longText });
  assert.equal(await store.applySummaryOutcome('write', 'pin-outcome-fail', { status: 'failed' }), true);
  assert.equal(await store.applySummaryOutcome('write', 'pin-outcome-fail', { status: 'failed' }), true);
  record = await store.getWrite('pin-outcome-fail');
  assert.equal(record.summaryAttempts, 2);
  assert.equal(record.summaryStatus, 'pending');
  assert.equal(await store.applySummaryOutcome('write', 'pin-outcome-fail', { status: 'failed' }), true);
  record = await store.getWrite('pin-outcome-fail');
  assert.equal(record.summaryAttempts, 3);
  assert.equal(record.summaryStatus, 'failed');

  // Unknown pins report false and leave nothing behind.
  assert.equal(await store.applySummaryOutcome('write', 'pin-outcome-missing', { status: 'failed' }), false);

  // Neither a done nor a failed record is pending anymore.
  assert.deepEqual(await store.listPendingSummaries('write'), []);
});

test('countSummariesSince counts summarized records per kind or across both', async () => {
  const paths = await createTempProfilePaths();
  const store = createChainHistoryStore(paths);
  const longText = 'x'.repeat(900);
  await store.recordWrite({ pinId: 'pin-count-w', contentText: longText });
  await store.recordRead({ pinId: 'pin-count-r', contentText: longText });
  const before = Date.now();
  assert.equal(await store.countSummariesSince(null, before), 0);

  await store.applySummaryOutcome('write', 'pin-count-w', { status: 'done', summary: 'w' });
  await store.applySummaryOutcome('read', 'pin-count-r', { status: 'done', summary: 'r' });
  assert.equal(await store.countSummariesSince('write', before), 1);
  assert.equal(await store.countSummariesSince('read', before), 1);
  assert.equal(await store.countSummariesSince(null, before), 2);
  // Summaries older than the window start do not count.
  assert.equal(await store.countSummariesSince(null, Date.now() + 1_000), 0);
});

test('searchWrites matches keywords case-insensitively and returns newest first', async () => {
  const paths = await createTempProfilePaths();
  const store = createChainHistoryStore(paths);
  const now = Date.now();
  const older = now - 10 * DAY_MS;
  const newer = now - 1 * DAY_MS;
  await store.recordWrite({ pinId: 'pin-search-old', contentText: 'Release the Kraken report', occurredAtMs: older });
  await store.recordWrite({ pinId: 'pin-search-new', contentText: 'kraken follow-up notes', occurredAtMs: newer });
  await store.recordWrite({ pinId: 'pin-search-other', contentText: 'unrelated buzz post', occurredAtMs: newer });

  const hits = await store.searchWrites({ query: 'KRAKEN' });
  assert.deepEqual(hits.map((record) => record.pinId), ['pin-search-new', 'pin-search-old']);

  // No query returns every record in the window, newest first.
  const all = await store.searchWrites({ fromMs: now - 30 * DAY_MS });
  assert.deepEqual(all.map((record) => record.pinId), ['pin-search-new', 'pin-search-other', 'pin-search-old']);
});

test('searchWrites defaults to a 90-day window and clamps the limit', async () => {
  const paths = await createTempProfilePaths();
  const store = createChainHistoryStore(paths);
  const now = Date.now();
  await store.recordWrite({ pinId: 'pin-window-100d', contentText: 'ancient history record', occurredAtMs: now - 100 * DAY_MS });
  await store.recordWrite({ pinId: 'pin-window-10d', contentText: 'recent history record', occurredAtMs: now - 10 * DAY_MS });

  // 100 days old is outside the default 90-day window.
  const defaultHits = await store.searchWrites({ query: 'history' });
  assert.deepEqual(defaultHits.map((record) => record.pinId), ['pin-window-10d']);

  const wideHits = await store.searchWrites({ query: 'history', fromMs: now - 120 * DAY_MS });
  assert.deepEqual(wideHits.map((record) => record.pinId), ['pin-window-10d', 'pin-window-100d']);

  const limited = await store.searchWrites({ fromMs: now - 120 * DAY_MS, limit: 1 });
  assert.deepEqual(limited.map((record) => record.pinId), ['pin-window-10d']);
});

test('searchReads matches title/excerpt/author and respects the window', async () => {
  const paths = await createTempProfilePaths();
  const store = createChainHistoryStore(paths);
  const now = Date.now();
  await store.recordRead({ pinId: 'pin-rsearch-1', title: 'MetaID Whitepaper', contentText: 'about identity', readAtMs: now - 5 * DAY_MS });
  await store.recordRead({ pinId: 'pin-rsearch-2', title: 'Other doc', authorGlobalMetaId: 'metaid-kraken-author', readAtMs: now - 2 * DAY_MS });

  const byTitle = await store.searchReads({ query: 'whitepaper' });
  assert.deepEqual(byTitle.map((record) => record.pinId), ['pin-rsearch-1']);
  const byAuthor = await store.searchReads({ query: 'KRAKEN' });
  assert.deepEqual(byAuthor.map((record) => record.pinId), ['pin-rsearch-2']);
  // Read happened 5 days ago; a window ending 30 days ago excludes it.
  const outOfWindow = await store.searchReads({ query: 'whitepaper', toMs: now - 30 * DAY_MS });
  assert.equal(outOfWindow.length, 0);
});

test('corrupt record files are skipped, never fatal', async () => {
  const paths = await createTempProfilePaths();
  const store = createChainHistoryStore(paths);
  const now = Date.now();
  await store.recordWrite({ pinId: 'pin-corrupt-ok', contentText: 'fine content', occurredAtMs: now });
  const shard = monthShardForMs(now);
  await fs.writeFile(
    path.join(paths.chainHistoryRoot, 'writes', shard, 'pin-corrupt-bad.json'),
    '{ not valid json',
    'utf8',
  );

  assert.equal(await store.getWrite('pin-corrupt-bad'), null);
  const hits = await store.searchWrites({ query: 'fine' });
  assert.deepEqual(hits.map((record) => record.pinId), ['pin-corrupt-ok']);
  const dayStart = localDayStart(now);
  const listed = await store.listWritesForDay({ startMs: dayStart, endMs: dayStart + DAY_MS });
  assert.deepEqual(listed.map((record) => record.pinId), ['pin-corrupt-ok']);
  assert.equal(await store.getWrite('pin-corrupt-missing'), null);
});

test('pinId must be a safe file name component', async () => {
  const paths = await createTempProfilePaths();
  const store = createChainHistoryStore(paths);
  await assert.rejects(() => store.recordWrite({ pinId: '../escape' }), /Invalid chain pinId/);
  await assert.rejects(() => store.recordWrite({ pinId: 'bad/pin' }), /Invalid chain pinId/);
  await assert.rejects(() => store.recordRead({ pinId: '' }), /Invalid chain pinId/);
  await assert.rejects(() => store.getWrite('..'), /Invalid chain pinId/);
  await assert.rejects(() => store.markReadSavedToKb('a b', 'kb-1'), /Invalid chain pinId/);
});
