// Per-bot chain history store: one JSON record per chain pin under
// `.runtime/chain-history/`, month-sharded by occurrence month
// (storage layout v2 amendment 2026-09-03). `writes/` mirrors the pins this
// bot published; `reads/` mirrors the pins this bot read. The dream pipeline
// and pending-summary workers scan these shards; there are no index files,
// only time-windowed directory scans. All writes are atomic
// (write-then-rename), all reads tolerate corrupt files by skipping them.
import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { MetabotPaths } from '../state/paths';
import { listMonthDirs, monthShardForMs, monthsInWindow, recentMonthShards } from './monthShard';
import type {
  ChainHistoryKind,
  ChainHistorySearchOptions,
  ChainReadRecord,
  ChainSummaryOutcome,
  ChainSummaryStatus,
  ChainWriteRecord,
  PendingSummaryEntry,
  RecordChainReadInput,
  RecordChainWriteInput,
} from './types';
import {
  DAY_LIST_MAX_PER_KIND,
  DEFAULT_SEARCH_WINDOW_MS,
  MAX_READ_EXCERPT_CHARS,
  MAX_SUMMARY_ATTEMPTS,
  MAX_WRITE_CONTENT_CHARS,
  PENDING_DEFAULT_LIMIT,
  PENDING_MAX_LIMIT,
  PENDING_SCAN_MONTHS,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_LIMIT,
  SUMMARY_MAX_CHARS,
  SUMMARY_MIN_CONTENT_CHARS,
} from './types';

export * from './types';
export { listMonthDirs, monthShardForMs, monthsInWindow, recentMonthShards } from './monthShard';

const PIN_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

let atomicWriteSequence = 0;

/** pinId is the only file-name component; keep it strictly path-safe. */
function assertSafePinId(pinId: string): string {
  const trimmed = typeof pinId === 'string' ? pinId.trim() : '';
  if (!trimmed || trimmed === '.' || trimmed === '..' || !PIN_ID_PATTERN.test(trimmed)) {
    throw new Error(`Invalid chain pinId: ${JSON.stringify(pinId)}`);
  }
  return trimmed;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function textOrNull(value: unknown): string | null {
  return text(value) || null;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function msOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : num(value) || null;
}

function finiteMs(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
}

function clampLimit(value: number | undefined, fallback: number, min: number, max: number): number {
  const raw = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, raw));
}

function normalizeSummaryStatus(value: unknown): ChainSummaryStatus {
  return value === 'pending' || value === 'done' || value === 'failed' ? value : 'skipped';
}

function normalizeWriteRecord(value: unknown): ChainWriteRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1) return null;
  const pinId = text(record.pinId);
  if (!pinId) return null;
  return {
    version: 1,
    pinId,
    txId: textOrNull(record.txId),
    path: textOrNull(record.path),
    operation: textOrNull(record.operation),
    network: textOrNull(record.network),
    contentText: typeof record.contentText === 'string' ? record.contentText : null,
    contentTruncated: record.contentTruncated === true,
    contentBytes: num(record.contentBytes),
    contentType: textOrNull(record.contentType),
    summary: typeof record.summary === 'string' ? record.summary : null,
    summaryStatus: normalizeSummaryStatus(record.summaryStatus),
    summaryAttempts: num(record.summaryAttempts),
    summarizedAtMs: msOrNull(record.summarizedAtMs),
    occurredAtMs: num(record.occurredAtMs),
    createdAtMs: num(record.createdAtMs),
  };
}

function normalizeReadRecord(value: unknown): ChainReadRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1) return null;
  const pinId = text(record.pinId);
  if (!pinId) return null;
  return {
    version: 1,
    pinId,
    path: textOrNull(record.path),
    protocol: textOrNull(record.protocol),
    title: textOrNull(record.title),
    authorGlobalMetaId: textOrNull(record.authorGlobalMetaId),
    contentExcerpt: typeof record.contentExcerpt === 'string' ? record.contentExcerpt : null,
    contentBytes: num(record.contentBytes),
    summary: typeof record.summary === 'string' ? record.summary : null,
    summaryStatus: normalizeSummaryStatus(record.summaryStatus),
    summaryAttempts: num(record.summaryAttempts),
    summarizedAtMs: msOrNull(record.summarizedAtMs),
    savedToKb: record.savedToKb === true,
    kbId: textOrNull(record.kbId),
    source: textOrNull(record.source),
    firstReadAtMs: num(record.firstReadAtMs),
    lastReadAtMs: num(record.lastReadAtMs),
    readCount: num(record.readCount),
  };
}

function kindDirName(kind: ChainHistoryKind): 'writes' | 'reads' {
  return kind === 'write' ? 'writes' : 'reads';
}

function writeTimeMs(record: ChainWriteRecord | ChainReadRecord): number {
  return 'occurredAtMs' in record ? record.occurredAtMs : record.firstReadAtMs;
}

export interface ChainHistoryStore {
  /** Idempotent per pinId: an existing record is never overwritten. */
  recordWrite(input: RecordChainWriteInput): Promise<{ created: boolean }>;
  /** Upsert per pinId: re-reads bump readCount/lastReadAtMs and refresh only
   * the metadata the new input actually provides; summary/KB fields are never
   * clobbered. */
  recordRead(input: RecordChainReadInput): Promise<void>;
  getWrite(pinId: string): Promise<ChainWriteRecord | null>;
  getRead(pinId: string): Promise<ChainReadRecord | null>;
  markReadSavedToKb(pinId: string, kbId: string): Promise<boolean>;
  listWritesForDay(options: { startMs: number; endMs: number; limit?: number }): Promise<ChainWriteRecord[]>;
  listReadsForDay(options: { startMs: number; endMs: number; limit?: number }): Promise<ChainReadRecord[]>;
  /** Pending-summary candidates from the current + previous month shards only,
   * oldest first. */
  listPendingSummaries(kind: 'write', limit?: number): Promise<Array<PendingSummaryEntry<ChainWriteRecord>>>;
  listPendingSummaries(kind: 'read', limit?: number): Promise<Array<PendingSummaryEntry<ChainReadRecord>>>;
  applySummaryOutcome(kind: ChainHistoryKind, pinId: string, outcome: ChainSummaryOutcome): Promise<boolean>;
  /** Records with summarizedAtMs >= sinceMs; kind null counts both kinds. */
  countSummariesSince(kind: ChainHistoryKind | null, sinceMs: number): Promise<number>;
  searchWrites(options?: ChainHistorySearchOptions): Promise<ChainWriteRecord[]>;
  searchReads(options?: ChainHistorySearchOptions): Promise<ChainReadRecord[]>;
}

export function createChainHistoryStore(paths: MetabotPaths): ChainHistoryStore {
  const writesRoot = path.join(paths.chainHistoryRoot, 'writes');
  const readsRoot = path.join(paths.chainHistoryRoot, 'reads');

  async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    atomicWriteSequence += 1;
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${atomicWriteSequence}.tmp`;
    try {
      await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
      await fs.rename(tempPath, filePath);
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async function fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.stat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async function readRecordFile<T>(
    filePath: string,
    normalize: (value: unknown) => T | null,
  ): Promise<T | null> {
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
      return normalize(parsed);
    } catch {
      return null;
    }
  }

  /** All parseable records in the given shards of one kind root. */
  async function scanShards<T>(
    kindRoot: string,
    shards: string[],
    normalize: (value: unknown) => T | null,
  ): Promise<Array<{ shard: string; record: T }>> {
    const found: Array<{ shard: string; record: T }> = [];
    for (const shard of shards) {
      const dir = path.join(kindRoot, shard);
      let entries: string[];
      try {
        entries = await fs.readdir(dir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.endsWith('.json')) continue;
        const record = await readRecordFile(path.join(dir, entry), normalize);
        if (record !== null) {
          found.push({ shard, record });
        }
      }
    }
    return found;
  }

  /** Locate one record file by pinId across month shards. A record lives in at
   * most one shard (its occurrence month is stable). */
  async function locateRecord<T>(
    kindRoot: string,
    pinId: string,
    normalize: (value: unknown) => T | null,
    options: { recentFirst?: boolean } = {},
  ): Promise<{ shard: string; filePath: string; record: T } | null> {
    let shards = await listMonthDirs(kindRoot);
    if (options.recentFirst) {
      shards = shards.reverse();
    }
    for (const shard of shards) {
      const filePath = path.join(kindRoot, shard, `${pinId}.json`);
      if (!(await fileExists(filePath))) continue;
      const record = await readRecordFile(filePath, normalize);
      if (record !== null) {
        return { shard, filePath, record };
      }
    }
    return null;
  }

  function initialSummaryStatus(contentText: string | null): ChainSummaryStatus {
    return contentText !== null && contentText.length >= SUMMARY_MIN_CONTENT_CHARS ? 'pending' : 'skipped';
  }

  async function recordWrite(input: RecordChainWriteInput): Promise<{ created: boolean }> {
    const pinId = assertSafePinId(input.pinId);
    const now = Date.now();
    const occurredAtMs = finiteMs(input.occurredAtMs, now);
    const filePath = path.join(writesRoot, monthShardForMs(occurredAtMs), `${pinId}.json`);
    if (await fileExists(filePath)) {
      return { created: false };
    }
    const fullText = typeof input.contentText === 'string' ? input.contentText : null;
    const contentBytes = typeof input.contentBytes === 'number' && Number.isFinite(input.contentBytes)
      ? Math.max(0, Math.floor(input.contentBytes))
      : fullText !== null
        ? Buffer.byteLength(fullText, 'utf8')
        : 0;
    const contentTruncated = fullText !== null && fullText.length > MAX_WRITE_CONTENT_CHARS;
    const record: ChainWriteRecord = {
      version: 1,
      pinId,
      txId: textOrNull(input.txId),
      path: textOrNull(input.path),
      operation: textOrNull(input.operation),
      network: textOrNull(input.network),
      contentText: contentTruncated ? fullText.slice(0, MAX_WRITE_CONTENT_CHARS) : fullText,
      contentTruncated,
      contentBytes,
      contentType: textOrNull(input.contentType),
      summary: null,
      summaryStatus: initialSummaryStatus(fullText),
      summaryAttempts: 0,
      summarizedAtMs: null,
      occurredAtMs,
      createdAtMs: now,
    };
    await writeJsonAtomic(filePath, record);
    return { created: true };
  }

  async function recordRead(input: RecordChainReadInput): Promise<void> {
    const pinId = assertSafePinId(input.pinId);
    const now = Date.now();
    const readAtMs = finiteMs(input.readAtMs, now);
    const fullText = typeof input.contentText === 'string' && input.contentText.length > 0
      ? input.contentText
      : null;
    const existing = await locateRecord(readsRoot, pinId, normalizeReadRecord);
    if (existing) {
      const { record } = existing;
      // Metadata refresh: overwrite only when the new input provides values.
      const nextPath = textOrNull(input.path);
      const nextProtocol = textOrNull(input.protocol);
      const nextTitle = textOrNull(input.title);
      const nextAuthor = textOrNull(input.authorGlobalMetaId);
      const nextSource = textOrNull(input.source);
      if (nextPath !== null) record.path = nextPath;
      if (nextProtocol !== null) record.protocol = nextProtocol;
      if (nextTitle !== null) record.title = nextTitle;
      if (nextAuthor !== null) record.authorGlobalMetaId = nextAuthor;
      if (nextSource !== null) record.source = nextSource;
      if (fullText !== null) {
        record.contentExcerpt = fullText.length > MAX_READ_EXCERPT_CHARS
          ? fullText.slice(0, MAX_READ_EXCERPT_CHARS)
          : fullText;
        record.contentBytes = Buffer.byteLength(fullText, 'utf8');
      }
      record.readCount += 1;
      record.lastReadAtMs = readAtMs;
      // summary/summaryStatus/summaryAttempts/summarizedAtMs/savedToKb/kbId are
      // deliberately untouched: re-reads never clobber summary or KB state.
      await writeJsonAtomic(existing.filePath, record);
      return;
    }
    const record: ChainReadRecord = {
      version: 1,
      pinId,
      path: textOrNull(input.path),
      protocol: textOrNull(input.protocol),
      title: textOrNull(input.title),
      authorGlobalMetaId: textOrNull(input.authorGlobalMetaId),
      contentExcerpt: fullText !== null && fullText.length > MAX_READ_EXCERPT_CHARS
        ? fullText.slice(0, MAX_READ_EXCERPT_CHARS)
        : fullText,
      contentBytes: fullText !== null ? Buffer.byteLength(fullText, 'utf8') : 0,
      summary: null,
      summaryStatus: initialSummaryStatus(fullText),
      summaryAttempts: 0,
      summarizedAtMs: null,
      savedToKb: false,
      kbId: null,
      source: textOrNull(input.source),
      firstReadAtMs: readAtMs,
      lastReadAtMs: readAtMs,
      readCount: 1,
    };
    const filePath = path.join(readsRoot, monthShardForMs(readAtMs), `${pinId}.json`);
    await writeJsonAtomic(filePath, record);
  }

  async function applyOutcome(
    kind: ChainHistoryKind,
    pinId: string,
    outcome: ChainSummaryOutcome,
  ): Promise<boolean> {
    const kindRoot = kind === 'write' ? writesRoot : readsRoot;
    const located = await locateRecord(
      kindRoot,
      pinId,
      (value: unknown) => (kind === 'write' ? normalizeWriteRecord(value) : normalizeReadRecord(value)),
      { recentFirst: true },
    );
    if (!located) {
      return false;
    }
    const { record } = located;
    if (outcome.status === 'done') {
      record.summary = outcome.summary.trim().slice(0, SUMMARY_MAX_CHARS);
      record.summaryStatus = 'done';
      record.summarizedAtMs = Date.now();
    } else {
      record.summaryAttempts += 1;
      if (record.summaryAttempts >= MAX_SUMMARY_ATTEMPTS) {
        record.summaryStatus = 'failed';
      }
    }
    await writeJsonAtomic(located.filePath, record);
    return true;
  }

  function searchWindow(options: ChainHistorySearchOptions): { fromMs: number; toMs: number; limit: number; query: string } {
    const now = Date.now();
    return {
      fromMs: finiteMs(options.fromMs, now - DEFAULT_SEARCH_WINDOW_MS),
      toMs: finiteMs(options.toMs, now),
      limit: clampLimit(options.limit, SEARCH_DEFAULT_LIMIT, 1, SEARCH_MAX_LIMIT),
      query: text(options.query).toLowerCase(),
    };
  }

  async function listPendingSummariesImpl(
    kind: ChainHistoryKind,
    limit?: number,
  ): Promise<Array<PendingSummaryEntry<ChainWriteRecord | ChainReadRecord>>> {
    const kindRoot = kind === 'write' ? writesRoot : readsRoot;
    const scanned = await scanShards(
      kindRoot,
      recentMonthShards(PENDING_SCAN_MONTHS),
      (value: unknown) => (kind === 'write' ? normalizeWriteRecord(value) : normalizeReadRecord(value)),
    );
    const pending = scanned.filter(({ record }) => (
      record.summaryStatus === 'pending' && record.summaryAttempts < MAX_SUMMARY_ATTEMPTS
    ));
    pending.sort((left, right) => (
      writeTimeMs(left.record) - writeTimeMs(right.record)
      || left.record.pinId.localeCompare(right.record.pinId)
    ));
    return pending.slice(0, clampLimit(limit, PENDING_DEFAULT_LIMIT, 1, PENDING_MAX_LIMIT));
  }

  async function listPendingSummaries(kind: 'write', limit?: number): Promise<Array<PendingSummaryEntry<ChainWriteRecord>>>;
  async function listPendingSummaries(kind: 'read', limit?: number): Promise<Array<PendingSummaryEntry<ChainReadRecord>>>;
  async function listPendingSummaries(
    kind: ChainHistoryKind,
    limit?: number,
  ): Promise<Array<PendingSummaryEntry<ChainWriteRecord | ChainReadRecord>>> {
    return listPendingSummariesImpl(kind, limit);
  }

  return {
    recordWrite,
    recordRead,

    async getWrite(pinId) {
      const safePinId = assertSafePinId(pinId);
      const located = await locateRecord(writesRoot, safePinId, normalizeWriteRecord);
      return located ? located.record : null;
    },

    async getRead(pinId) {
      const safePinId = assertSafePinId(pinId);
      const located = await locateRecord(readsRoot, safePinId, normalizeReadRecord);
      return located ? located.record : null;
    },

    async markReadSavedToKb(pinId, kbId) {
      const safePinId = assertSafePinId(pinId);
      const located = await locateRecord(readsRoot, safePinId, normalizeReadRecord);
      if (!located) {
        return false;
      }
      located.record.savedToKb = true;
      located.record.kbId = text(kbId) || located.record.kbId;
      await writeJsonAtomic(located.filePath, located.record);
      return true;
    },

    async listWritesForDay(options) {
      const limit = clampLimit(options.limit, DAY_LIST_MAX_PER_KIND, 1, DAY_LIST_MAX_PER_KIND);
      const scanned = await scanShards(writesRoot, monthsInWindow(options.startMs, options.endMs), normalizeWriteRecord);
      const matches = scanned
        .map((entry) => entry.record)
        .filter((record) => record.occurredAtMs >= options.startMs && record.occurredAtMs < options.endMs);
      matches.sort((left, right) => left.occurredAtMs - right.occurredAtMs || left.pinId.localeCompare(right.pinId));
      return matches.slice(0, limit);
    },

    async listReadsForDay(options) {
      const limit = clampLimit(options.limit, DAY_LIST_MAX_PER_KIND, 1, DAY_LIST_MAX_PER_KIND);
      const scanned = await scanShards(readsRoot, monthsInWindow(options.startMs, options.endMs), normalizeReadRecord);
      const matches = scanned
        .map((entry) => entry.record)
        .filter((record) => record.lastReadAtMs >= options.startMs && record.lastReadAtMs < options.endMs);
      matches.sort((left, right) => left.lastReadAtMs - right.lastReadAtMs || left.pinId.localeCompare(right.pinId));
      return matches.slice(0, limit);
    },

    listPendingSummaries,

    applySummaryOutcome: applyOutcome,

    async countSummariesSince(kind, sinceMs) {
      const now = Date.now();
      const shards = monthsInWindow(finiteMs(sinceMs, now), now + 1);
      const kinds: ChainHistoryKind[] = kind === null ? ['write', 'read'] : [kind];
      let count = 0;
      for (const currentKind of kinds) {
        const kindRoot = currentKind === 'write' ? writesRoot : readsRoot;
        const scanned = await scanShards(
          kindRoot,
          shards,
          (value: unknown) => (currentKind === 'write' ? normalizeWriteRecord(value) : normalizeReadRecord(value)),
        );
        count += scanned.filter(({ record }) => (
          record.summarizedAtMs !== null && record.summarizedAtMs >= sinceMs
        )).length;
      }
      return count;
    },

    async searchWrites(options = {}) {
      const { fromMs, toMs, limit, query } = searchWindow(options);
      const scanned = await scanShards(writesRoot, monthsInWindow(fromMs, toMs), normalizeWriteRecord);
      const matches = scanned
        .map((entry) => entry.record)
        .filter((record) => {
          if (record.occurredAtMs < fromMs || record.occurredAtMs >= toMs) return false;
          if (!query) return true;
          return [record.contentText, record.summary, record.path, record.pinId]
            .some((field) => typeof field === 'string' && field.toLowerCase().includes(query));
        });
      matches.sort((left, right) => right.occurredAtMs - left.occurredAtMs || left.pinId.localeCompare(right.pinId));
      return matches.slice(0, limit);
    },

    async searchReads(options = {}) {
      const { fromMs, toMs, limit, query } = searchWindow(options);
      const scanned = await scanShards(readsRoot, monthsInWindow(fromMs, toMs), normalizeReadRecord);
      const matches = scanned
        .map((entry) => entry.record)
        .filter((record) => {
          if (record.lastReadAtMs < fromMs || record.lastReadAtMs >= toMs) return false;
          if (!query) return true;
          return [
            record.title,
            record.contentExcerpt,
            record.summary,
            record.authorGlobalMetaId,
            record.path,
            record.protocol,
            record.pinId,
          ].some((field) => typeof field === 'string' && field.toLowerCase().includes(query));
        });
      matches.sort((left, right) => right.lastReadAtMs - left.lastReadAtMs || left.pinId.localeCompare(right.pinId));
      return matches.slice(0, limit);
    },
  };
}
