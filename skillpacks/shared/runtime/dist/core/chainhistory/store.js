"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recentMonthShards = exports.monthsInWindow = exports.monthShardForMs = exports.listMonthDirs = void 0;
exports.createChainHistoryStore = createChainHistoryStore;
// Per-bot chain history store: one JSON record per chain pin under
// `.runtime/chain-history/`, month-sharded by occurrence month
// (storage layout v2 amendment 2026-09-03). `writes/` mirrors the pins this
// bot published; `reads/` mirrors the pins this bot read. The dream pipeline
// and pending-summary workers scan these shards; there are no index files,
// only time-windowed directory scans. All writes are atomic
// (write-then-rename), all reads tolerate corrupt files by skipping them.
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const monthShard_1 = require("./monthShard");
const types_1 = require("./types");
__exportStar(require("./types"), exports);
var monthShard_2 = require("./monthShard");
Object.defineProperty(exports, "listMonthDirs", { enumerable: true, get: function () { return monthShard_2.listMonthDirs; } });
Object.defineProperty(exports, "monthShardForMs", { enumerable: true, get: function () { return monthShard_2.monthShardForMs; } });
Object.defineProperty(exports, "monthsInWindow", { enumerable: true, get: function () { return monthShard_2.monthsInWindow; } });
Object.defineProperty(exports, "recentMonthShards", { enumerable: true, get: function () { return monthShard_2.recentMonthShards; } });
const PIN_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
let atomicWriteSequence = 0;
/** pinId is the only file-name component; keep it strictly path-safe. */
function assertSafePinId(pinId) {
    const trimmed = typeof pinId === 'string' ? pinId.trim() : '';
    if (!trimmed || trimmed === '.' || trimmed === '..' || !PIN_ID_PATTERN.test(trimmed)) {
        throw new Error(`Invalid chain pinId: ${JSON.stringify(pinId)}`);
    }
    return trimmed;
}
function text(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function textOrNull(value) {
    return text(value) || null;
}
function num(value, fallback = 0) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function msOrNull(value) {
    return value === null || value === undefined ? null : num(value) || null;
}
function finiteMs(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
}
function clampLimit(value, fallback, min, max) {
    const raw = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
    return Math.min(max, Math.max(min, raw));
}
function normalizeSummaryStatus(value) {
    return value === 'pending' || value === 'done' || value === 'failed' ? value : 'skipped';
}
function normalizeWriteRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const record = value;
    if (record.version !== 1)
        return null;
    const pinId = text(record.pinId);
    if (!pinId)
        return null;
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
function normalizeReadRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const record = value;
    if (record.version !== 1)
        return null;
    const pinId = text(record.pinId);
    if (!pinId)
        return null;
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
function kindDirName(kind) {
    return kind === 'write' ? 'writes' : 'reads';
}
function writeTimeMs(record) {
    return 'occurredAtMs' in record ? record.occurredAtMs : record.firstReadAtMs;
}
function createChainHistoryStore(paths) {
    const writesRoot = node_path_1.default.join(paths.chainHistoryRoot, 'writes');
    const readsRoot = node_path_1.default.join(paths.chainHistoryRoot, 'reads');
    async function writeJsonAtomic(filePath, value) {
        await node_fs_1.promises.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
        atomicWriteSequence += 1;
        const tempPath = `${filePath}.${process.pid}.${Date.now()}.${atomicWriteSequence}.tmp`;
        try {
            await node_fs_1.promises.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
            await node_fs_1.promises.rename(tempPath, filePath);
        }
        catch (error) {
            await node_fs_1.promises.rm(tempPath, { force: true }).catch(() => undefined);
            throw error;
        }
    }
    async function fileExists(filePath) {
        try {
            await node_fs_1.promises.stat(filePath);
            return true;
        }
        catch {
            return false;
        }
    }
    async function readRecordFile(filePath, normalize) {
        try {
            const parsed = JSON.parse(await node_fs_1.promises.readFile(filePath, 'utf8'));
            return normalize(parsed);
        }
        catch {
            return null;
        }
    }
    /** All parseable records in the given shards of one kind root. */
    async function scanShards(kindRoot, shards, normalize) {
        const found = [];
        for (const shard of shards) {
            const dir = node_path_1.default.join(kindRoot, shard);
            let entries;
            try {
                entries = await node_fs_1.promises.readdir(dir);
            }
            catch {
                continue;
            }
            for (const entry of entries) {
                if (!entry.endsWith('.json'))
                    continue;
                const record = await readRecordFile(node_path_1.default.join(dir, entry), normalize);
                if (record !== null) {
                    found.push({ shard, record });
                }
            }
        }
        return found;
    }
    /** Locate one record file by pinId across month shards. A record lives in at
     * most one shard (its occurrence month is stable). */
    async function locateRecord(kindRoot, pinId, normalize, options = {}) {
        let shards = await (0, monthShard_1.listMonthDirs)(kindRoot);
        if (options.recentFirst) {
            shards = shards.reverse();
        }
        for (const shard of shards) {
            const filePath = node_path_1.default.join(kindRoot, shard, `${pinId}.json`);
            if (!(await fileExists(filePath)))
                continue;
            const record = await readRecordFile(filePath, normalize);
            if (record !== null) {
                return { shard, filePath, record };
            }
        }
        return null;
    }
    function initialSummaryStatus(contentText) {
        return contentText !== null && contentText.length >= types_1.SUMMARY_MIN_CONTENT_CHARS ? 'pending' : 'skipped';
    }
    async function recordWrite(input) {
        const pinId = assertSafePinId(input.pinId);
        const now = Date.now();
        const occurredAtMs = finiteMs(input.occurredAtMs, now);
        const filePath = node_path_1.default.join(writesRoot, (0, monthShard_1.monthShardForMs)(occurredAtMs), `${pinId}.json`);
        if (await fileExists(filePath)) {
            return { created: false };
        }
        const fullText = typeof input.contentText === 'string' ? input.contentText : null;
        const contentBytes = typeof input.contentBytes === 'number' && Number.isFinite(input.contentBytes)
            ? Math.max(0, Math.floor(input.contentBytes))
            : fullText !== null
                ? Buffer.byteLength(fullText, 'utf8')
                : 0;
        const contentTruncated = fullText !== null && fullText.length > types_1.MAX_WRITE_CONTENT_CHARS;
        const record = {
            version: 1,
            pinId,
            txId: textOrNull(input.txId),
            path: textOrNull(input.path),
            operation: textOrNull(input.operation),
            network: textOrNull(input.network),
            contentText: contentTruncated ? fullText.slice(0, types_1.MAX_WRITE_CONTENT_CHARS) : fullText,
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
    async function recordRead(input) {
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
            if (nextPath !== null)
                record.path = nextPath;
            if (nextProtocol !== null)
                record.protocol = nextProtocol;
            if (nextTitle !== null)
                record.title = nextTitle;
            if (nextAuthor !== null)
                record.authorGlobalMetaId = nextAuthor;
            if (nextSource !== null)
                record.source = nextSource;
            if (fullText !== null) {
                record.contentExcerpt = fullText.length > types_1.MAX_READ_EXCERPT_CHARS
                    ? fullText.slice(0, types_1.MAX_READ_EXCERPT_CHARS)
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
        const record = {
            version: 1,
            pinId,
            path: textOrNull(input.path),
            protocol: textOrNull(input.protocol),
            title: textOrNull(input.title),
            authorGlobalMetaId: textOrNull(input.authorGlobalMetaId),
            contentExcerpt: fullText !== null && fullText.length > types_1.MAX_READ_EXCERPT_CHARS
                ? fullText.slice(0, types_1.MAX_READ_EXCERPT_CHARS)
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
        const filePath = node_path_1.default.join(readsRoot, (0, monthShard_1.monthShardForMs)(readAtMs), `${pinId}.json`);
        await writeJsonAtomic(filePath, record);
    }
    async function applyOutcome(kind, pinId, outcome) {
        const kindRoot = kind === 'write' ? writesRoot : readsRoot;
        const located = await locateRecord(kindRoot, pinId, (value) => (kind === 'write' ? normalizeWriteRecord(value) : normalizeReadRecord(value)), { recentFirst: true });
        if (!located) {
            return false;
        }
        const { record } = located;
        if (outcome.status === 'done') {
            record.summary = outcome.summary.trim().slice(0, types_1.SUMMARY_MAX_CHARS);
            record.summaryStatus = 'done';
            record.summarizedAtMs = Date.now();
        }
        else {
            record.summaryAttempts += 1;
            if (record.summaryAttempts >= types_1.MAX_SUMMARY_ATTEMPTS) {
                record.summaryStatus = 'failed';
            }
        }
        await writeJsonAtomic(located.filePath, record);
        return true;
    }
    function searchWindow(options) {
        const now = Date.now();
        return {
            fromMs: finiteMs(options.fromMs, now - types_1.DEFAULT_SEARCH_WINDOW_MS),
            toMs: finiteMs(options.toMs, now),
            limit: clampLimit(options.limit, types_1.SEARCH_DEFAULT_LIMIT, 1, types_1.SEARCH_MAX_LIMIT),
            query: text(options.query).toLowerCase(),
        };
    }
    async function listPendingSummariesImpl(kind, limit) {
        const kindRoot = kind === 'write' ? writesRoot : readsRoot;
        const scanned = await scanShards(kindRoot, (0, monthShard_1.recentMonthShards)(types_1.PENDING_SCAN_MONTHS), (value) => (kind === 'write' ? normalizeWriteRecord(value) : normalizeReadRecord(value)));
        const pending = scanned.filter(({ record }) => (record.summaryStatus === 'pending' && record.summaryAttempts < types_1.MAX_SUMMARY_ATTEMPTS));
        pending.sort((left, right) => (writeTimeMs(left.record) - writeTimeMs(right.record)
            || left.record.pinId.localeCompare(right.record.pinId)));
        return pending.slice(0, clampLimit(limit, types_1.PENDING_DEFAULT_LIMIT, 1, types_1.PENDING_MAX_LIMIT));
    }
    async function listPendingSummaries(kind, limit) {
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
            const limit = clampLimit(options.limit, types_1.DAY_LIST_MAX_PER_KIND, 1, types_1.DAY_LIST_MAX_PER_KIND);
            const scanned = await scanShards(writesRoot, (0, monthShard_1.monthsInWindow)(options.startMs, options.endMs), normalizeWriteRecord);
            const matches = scanned
                .map((entry) => entry.record)
                .filter((record) => record.occurredAtMs >= options.startMs && record.occurredAtMs < options.endMs);
            matches.sort((left, right) => left.occurredAtMs - right.occurredAtMs || left.pinId.localeCompare(right.pinId));
            return matches.slice(0, limit);
        },
        async listReadsForDay(options) {
            const limit = clampLimit(options.limit, types_1.DAY_LIST_MAX_PER_KIND, 1, types_1.DAY_LIST_MAX_PER_KIND);
            const scanned = await scanShards(readsRoot, (0, monthShard_1.monthsInWindow)(options.startMs, options.endMs), normalizeReadRecord);
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
            const shards = (0, monthShard_1.monthsInWindow)(finiteMs(sinceMs, now), now + 1);
            const kinds = kind === null ? ['write', 'read'] : [kind];
            let count = 0;
            for (const currentKind of kinds) {
                const kindRoot = currentKind === 'write' ? writesRoot : readsRoot;
                const scanned = await scanShards(kindRoot, shards, (value) => (currentKind === 'write' ? normalizeWriteRecord(value) : normalizeReadRecord(value)));
                count += scanned.filter(({ record }) => (record.summarizedAtMs !== null && record.summarizedAtMs >= sinceMs)).length;
            }
            return count;
        },
        async searchWrites(options = {}) {
            const { fromMs, toMs, limit, query } = searchWindow(options);
            const scanned = await scanShards(writesRoot, (0, monthShard_1.monthsInWindow)(fromMs, toMs), normalizeWriteRecord);
            const matches = scanned
                .map((entry) => entry.record)
                .filter((record) => {
                if (record.occurredAtMs < fromMs || record.occurredAtMs >= toMs)
                    return false;
                if (!query)
                    return true;
                return [record.contentText, record.summary, record.path, record.pinId]
                    .some((field) => typeof field === 'string' && field.toLowerCase().includes(query));
            });
            matches.sort((left, right) => right.occurredAtMs - left.occurredAtMs || left.pinId.localeCompare(right.pinId));
            return matches.slice(0, limit);
        },
        async searchReads(options = {}) {
            const { fromMs, toMs, limit, query } = searchWindow(options);
            const scanned = await scanShards(readsRoot, (0, monthShard_1.monthsInWindow)(fromMs, toMs), normalizeReadRecord);
            const matches = scanned
                .map((entry) => entry.record)
                .filter((record) => {
                if (record.lastReadAtMs < fromMs || record.lastReadAtMs >= toMs)
                    return false;
                if (!query)
                    return true;
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
