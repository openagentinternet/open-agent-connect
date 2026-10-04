"use strict";
/**
 * Derived per-KB search index — OAC port of the IDBots knowledgeBaseIndexStore,
 * on a portable pure-JS inverted index instead of FTS5 (OAC targets Node >=20
 * where node:sqlite is unavailable). Everything here is derived state: delete
 * the file + run learn to rebuild. Ranking mirrors the IDBots blend:
 * normalized bm25-style tf/idf + phraseScore (0.85 / 0.15), minScore 0.18.
 *
 * Incremental learn mirrors the IDBots docs-table semantics: a document whose
 * raw bytes are unchanged (size+mtime short-circuit, else sha256 of the file
 * bytes) reuses its stored chunks AND their precomputed token lists — the
 * expensive extraction/chunking/tokenization steps only rerun for changed or
 * new files, and docs that vanished from the raw dir drop out. Tokens live in
 * the chunk rows (the equivalent of IDBots' FTS5 `token_text` column), which
 * also removes the per-generation re-tokenization from the query path.
 */
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
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanKnowledgeBaseText = exports.KB_INDEX_LOCK_STALE_MS = exports.KB_INDEX_LOCK_WAIT_MS = exports.KbIndexLockError = exports.KB_QUERY_DEFAULT_MIN_SCORE = exports.KB_QUERY_DEFAULT_TOP_K = void 0;
exports.withKbIndexLock = withKbIndexLock;
exports.createKnowledgeBaseIndexStore = createKnowledgeBaseIndexStore;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const text_1 = require("./text");
Object.defineProperty(exports, "cleanKnowledgeBaseText", { enumerable: true, get: function () { return text_1.cleanKnowledgeBaseText; } });
/** Bound the per-learn failure list surfaced to tools/UI; the count stays exact. */
const KB_LEARN_FAILED_SAMPLE_CAP = 20;
/** Collect up to the sample cap of `{file, reason}` failures for one learn pass. */
class KbLearnFailureCollector {
    failed = [];
    failedTotal = 0;
    add(file, reason) {
        this.failedTotal += 1;
        if (this.failed.length < KB_LEARN_FAILED_SAMPLE_CAP) {
            this.failed.push({ file, reason: reason.slice(0, 300) });
        }
    }
}
exports.KB_QUERY_DEFAULT_TOP_K = 8;
exports.KB_QUERY_DEFAULT_MIN_SCORE = 0.18;
const BM25_K1 = 1.2;
const BM25_B = 0.75;
function emptyIndex() {
    return { version: 2, docs: [], chunks: [], inverted: {} };
}
function indexTokens(text) {
    return [...new Set((0, text_1.tokenizeKnowledgeBaseText)(text))];
}
/** Chunk tokens from the stored list, falling back to tokenization for v1 rows. */
function tokensOfChunk(chunk) {
    if (Array.isArray(chunk.tokens))
        return chunk.tokens;
    return (0, text_1.tokenizeKnowledgeBaseText)(chunk.text);
}
async function walkRawFiles(dir) {
    const { SUPPORTED_KB_EXTENSIONS } = await Promise.resolve().then(() => __importStar(require('./text.js')));
    async function walk(current) {
        const entries = await node_fs_1.promises.readdir(current, { withFileTypes: true });
        const files = [];
        for (const entry of entries) {
            const full = node_path_1.default.join(current, entry.name);
            if (entry.isDirectory()) {
                files.push(...await walk(full));
            }
            else if (entry.isFile() && SUPPORTED_KB_EXTENSIONS.has(node_path_1.default.extname(entry.name).toLowerCase())) {
                files.push(full);
            }
        }
        return files;
    }
    return walk(dir).catch(() => []);
}
/** Extract + chunk + tokenize one raw file into an indexable doc. */
async function learnDoc(rawDir, filePath, stat, rawSha256, now) {
    const { extractKnowledgeBaseTextAsync, extractKbDocTitle } = await Promise.resolve().then(() => __importStar(require('./text.js')));
    const relpath = node_path_1.default.relative(rawDir, filePath);
    let extraction;
    try {
        extraction = await extractKnowledgeBaseTextAsync(filePath);
    }
    catch (error) {
        // Unsupported/failed files are skipped — the learn never dies on one doc,
        // but the failure is reported (IDBots `summary.failed` parity).
        return {
            learned: null,
            failure: {
                file: relpath,
                reason: error instanceof Error ? error.message : String(error),
            },
        };
    }
    const title = extraction.title?.trim() || extractKbDocTitle(filePath, extraction.text);
    const chunks = (0, text_1.chunkKnowledgeBaseText)(extraction.text);
    return {
        learned: {
            row: {
                relpath,
                sha256: rawSha256,
                size: stat.size,
                mtimeMs: Math.floor(stat.mtimeMs),
                title,
                chunkCount: chunks.length,
                ingestedAt: now(),
            },
            chunks: chunks.map((chunk, ord) => ({
                docRelPath: relpath,
                ord,
                text: chunk.text,
                tokens: indexTokens(chunk.text),
            })),
        },
    };
}
function buildInverted(chunks) {
    const inverted = {};
    chunks.forEach((chunk, chunkIndex) => {
        for (const token of new Set(tokensOfChunk(chunk))) {
            (inverted[token] ??= []).push(chunkIndex);
        }
    });
    return inverted;
}
// ---------------------------------------------------------------------------
// Cross-instance learn lock (#9): daemon, DSH host, and CLI learn the same KB
// from separate service instances, and a per-instance queue cannot serialize
// them. The lock file lives next to the derived index. Creation is atomic via
// link(2) from a fully-written temp file (no empty-file window); a lock left
// by a crashed process is stolen once its content timestamp goes stale. The
// read→steal decision has a theoretical replace-in-between race; its failure
// mode is one benign interleaved rebuild (the pre-lock status quo), never
// corruption — atomic index writes are unchanged.
// ---------------------------------------------------------------------------
class KbIndexLockError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'KbIndexLockError';
    }
}
exports.KbIndexLockError = KbIndexLockError;
exports.KB_INDEX_LOCK_WAIT_MS = 4 * 60_000;
exports.KB_INDEX_LOCK_STALE_MS = 15 * 60_000;
const KB_INDEX_LOCK_POLL_MS = 250;
async function withKbIndexLock(indexPath, fn, options = {}) {
    const lockPath = `${indexPath}.lock`;
    const waitMs = options.waitMs ?? exports.KB_INDEX_LOCK_WAIT_MS;
    const staleMs = options.staleMs ?? exports.KB_INDEX_LOCK_STALE_MS;
    const now = options.now ?? Date.now;
    const deadline = now() + waitMs;
    const acquire = async () => {
        const content = { pid: process.pid, at: now() };
        const tmpPath = `${lockPath}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
        // The index directory may not exist yet (lock taken before any learn).
        await node_fs_1.promises.mkdir(node_path_1.default.dirname(lockPath), { recursive: true });
        await node_fs_1.promises.writeFile(tmpPath, JSON.stringify(content), 'utf8');
        try {
            await node_fs_1.promises.link(tmpPath, lockPath);
            return true;
        }
        catch (error) {
            return false; // EEXIST — someone else holds it
        }
        finally {
            await node_fs_1.promises.unlink(tmpPath).catch(() => undefined);
        }
    };
    const stealIfStale = async () => {
        let raw;
        try {
            raw = await node_fs_1.promises.readFile(lockPath, 'utf8');
        }
        catch {
            return true; // gone — retry the acquire directly
        }
        let content = null;
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed.at === 'number')
                content = { pid: Number(parsed.pid) || 0, at: parsed.at };
        }
        catch {
            content = null;
        }
        // Unparseable (crash mid-write via an older writer) or stale → steal by
        // rename (atomic; only one contender wins the rename).
        if (content && now() - content.at < staleMs)
            return false;
        const stealPath = `${lockPath}.steal-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
        try {
            await node_fs_1.promises.rename(lockPath, stealPath);
        }
        catch {
            return true; // someone else stole or released it — retry the acquire
        }
        await node_fs_1.promises.unlink(stealPath).catch(() => undefined);
        options.log?.(`[KB] stole a stale learn lock (${lockPath}) held since ${content ? new Date(content.at).toISOString() : 'an unreadable timestamp'}`);
        return true;
    };
    let acquired = false;
    try {
        while (true) {
            if (await acquire()) {
                acquired = true;
                break;
            }
            if (now() >= deadline) {
                throw new KbIndexLockError('learn_busy', `Another learn is holding the lock for this knowledge base (waited ${Math.round(waitMs / 1000)}s). Retry later.`);
            }
            if (await stealIfStale())
                continue;
            await new Promise((resolve) => setTimeout(resolve, KB_INDEX_LOCK_POLL_MS));
        }
        return await fn();
    }
    finally {
        if (acquired)
            await node_fs_1.promises.unlink(lockPath).catch(() => undefined);
    }
}
/**
 * Full rebuild: re-extract every file. Used by learn(full) and as the
 * v1→v2 migration path (v1 chunk rows carry no token lists to reuse).
 */
async function buildFullIndex(rawDir, now) {
    const files = (await walkRawFiles(rawDir)).sort();
    const docs = [];
    const chunks = [];
    const failures = new KbLearnFailureCollector();
    for (const filePath of files) {
        const stat = await node_fs_1.promises.stat(filePath);
        const { learned, failure } = await learnDoc(rawDir, filePath, stat, await (0, text_1.sha256FileAsync)(filePath), now);
        if (failure)
            failures.add(failure.file, failure.reason);
        if (!learned)
            continue;
        docs.push(learned.row);
        for (const chunk of learned.chunks) {
            chunks.push({ docRelPath: chunk.docRelPath, ord: chunk.ord, text: chunk.text, tokens: chunk.tokens });
        }
    }
    return { index: { version: 2, docs, chunks, inverted: buildInverted(chunks) }, failures };
}
/**
 * Incremental rebuild: reuse stored chunks+tokens for unchanged docs, re-learn
 * only new/changed files, drop docs that vanished. A doc whose (changed) file
 * now fails extraction keeps its previous chunks rather than losing coverage.
 */
async function buildIncrementalIndex(rawDir, previous, now) {
    const oldDocByPath = new Map(previous.docs.map((doc) => [doc.relpath, doc]));
    const oldChunksByPath = new Map();
    for (const chunk of previous.chunks) {
        const list = oldChunksByPath.get(chunk.docRelPath) ?? [];
        list.push(chunk);
        oldChunksByPath.set(chunk.docRelPath, list);
    }
    const files = (await walkRawFiles(rawDir)).sort();
    const docs = [];
    const chunks = [];
    const failures = new KbLearnFailureCollector();
    const reuseDoc = (row, oldChunks) => {
        if (oldChunks.length === 0)
            return false;
        if (oldChunks.some((chunk) => !Array.isArray(chunk.tokens)))
            return false; // v1 rows
        docs.push(row);
        for (const chunk of oldChunks) {
            chunks.push({ docRelPath: chunk.docRelPath, ord: chunk.ord, text: chunk.text, tokens: chunk.tokens });
        }
        return true;
    };
    for (const filePath of files) {
        const relpath = node_path_1.default.relative(rawDir, filePath);
        const stat = await node_fs_1.promises.stat(filePath);
        const oldRow = oldDocByPath.get(relpath);
        const oldChunks = oldChunksByPath.get(relpath) ?? [];
        if (oldRow
            && oldRow.size === stat.size
            && oldRow.mtimeMs === Math.floor(stat.mtimeMs)
            && reuseDoc(oldRow, oldChunks)) {
            continue;
        }
        const rawSha256 = await (0, text_1.sha256FileAsync)(filePath);
        if (oldRow
            && oldRow.sha256 === rawSha256
            && reuseDoc({ ...oldRow, size: stat.size, mtimeMs: Math.floor(stat.mtimeMs) }, oldChunks)) {
            continue;
        }
        const { learned, failure } = await learnDoc(rawDir, filePath, stat, rawSha256, now);
        if (learned) {
            docs.push(learned.row);
            for (const chunk of learned.chunks) {
                chunks.push({ docRelPath: chunk.docRelPath, ord: chunk.ord, text: chunk.text, tokens: chunk.tokens });
            }
        }
        else if (oldRow && oldChunks.length > 0) {
            // Previously-indexed doc became unreadable — keep the stale copy (no
            // coverage loss) and report the failure so the surface knows why the
            // doc's content no longer matches the file.
            failures.add(relpath, `${failure ? failure.reason : 'extraction failed'} (kept the previously indexed copy)`);
        }
        else if (failure) {
            failures.add(failure.file, failure.reason);
        }
    }
    return { index: { version: 2, docs, chunks, inverted: buildInverted(chunks) }, failures };
}
function bm25Score(tf, docLen, avgLen, df, totalDocs) {
    if (tf <= 0 || df <= 0 || totalDocs <= 0)
        return 0;
    const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));
    const norm = BM25_K1 + 1;
    const lenPart = 1 - BM25_B + BM25_B * (docLen / Math.max(1, avgLen));
    return idf * ((tf * norm) / (tf + BM25_K1 * lenPart));
}
function createKnowledgeBaseIndexStore(filePath) {
    // Query-path cache: parse the index JSON once per index-file generation
    // (mtime+size) instead of on every query.
    let cache = null;
    function indexGenerationKey() {
        return node_fs_1.promises.stat(filePath).then((stat) => `${Math.floor(stat.mtimeMs)}:${stat.size}`, () => 'missing');
    }
    async function readIndexCached() {
        const key = await indexGenerationKey();
        if (cache && cache.key === key)
            return cache.index;
        const index = await readIndex();
        cache = { key, index };
        return index;
    }
    async function readIndex() {
        try {
            const raw = await node_fs_1.promises.readFile(filePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || (parsed.version !== 1 && parsed.version !== 2)) {
                return emptyIndex();
            }
            return {
                version: parsed.version,
                docs: Array.isArray(parsed.docs) ? parsed.docs : [],
                chunks: Array.isArray(parsed.chunks) ? parsed.chunks : [],
                inverted: parsed.inverted && typeof parsed.inverted === 'object' && !Array.isArray(parsed.inverted)
                    ? parsed.inverted
                    : {},
            };
        }
        catch {
            return emptyIndex();
        }
    }
    async function writeIndex(index) {
        await node_fs_1.promises.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
        const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
        await node_fs_1.promises.writeFile(tmpPath, JSON.stringify(index), 'utf8');
        await node_fs_1.promises.rename(tmpPath, filePath);
    }
    return {
        filePath,
        load: readIndex,
        rebuild: async (rawDir, now, options) => {
            const previous = options?.full ? null : await readIndex();
            const built = previous && previous.version === 2 && previous.docs.length >= 0
                ? await buildIncrementalIndex(rawDir, previous, now)
                : await buildFullIndex(rawDir, now);
            const index = built.index;
            await writeIndex(index);
            cache = null;
            // Learn summary vs the previous index, by raw-content sha256 per relpath
            // (IDBots' learn {added, updated, removed}). A full rebuild diffs against
            // the previous index the same way when one exists.
            const prevByPath = new Map((previous?.docs ?? []).map((doc) => [doc.relpath, doc.sha256]));
            const added = index.docs.filter((doc) => !prevByPath.has(doc.relpath)).length;
            const removed = [...prevByPath.keys()].filter((relpath) => !index.docs.some((doc) => doc.relpath === relpath)).length;
            const updated = index.docs.filter((doc) => prevByPath.get(doc.relpath) !== undefined && prevByPath.get(doc.relpath) !== doc.sha256).length;
            return {
                docCount: index.docs.length,
                chunkCount: index.chunks.length,
                added,
                updated,
                removed,
                failed: built.failures.failed,
                failedTotal: built.failures.failedTotal,
            };
        },
        // Single-doc learn for the addDocument hot path: the saved inbox file is
        // the only change, so extract/chunk/tokenize just it and splice it into
        // the stored index — no corpus walk, no per-file re-hash. The inverted
        // map is rebuilt from the stored chunk token lists (CPU-only, bounded by
        // index size, no file I/O). v1 indexes (no token lists) return null and
        // the caller falls back to a full rebuild (the v1→v2 migration).
        upsertDoc: async (rawDir, filePath, now) => {
            const index = await readIndex();
            if (index.version !== 2)
                return null;
            const relpath = node_path_1.default.relative(rawDir, filePath);
            const stat = await node_fs_1.promises.stat(filePath);
            const rawSha256 = await (0, text_1.sha256FileAsync)(filePath);
            const prevDocs = index.docs.filter((doc) => doc.relpath !== relpath);
            const oldRow = index.docs.find((doc) => doc.relpath === relpath);
            const oldChunks = index.chunks.filter((chunk) => chunk.docRelPath === relpath);
            if (oldRow
                && oldRow.size === stat.size
                && oldRow.mtimeMs === Math.floor(stat.mtimeMs)
                && oldChunks.length > 0
                && oldChunks.every((chunk) => Array.isArray(chunk.tokens))) {
                return { changed: false, docCount: index.docs.length, chunkCount: index.chunks.length };
            }
            if (oldRow && oldRow.sha256 === rawSha256
                && oldChunks.length > 0
                && oldChunks.every((chunk) => Array.isArray(chunk.tokens))) {
                return { changed: false, docCount: index.docs.length, chunkCount: index.chunks.length };
            }
            const { learned } = await learnDoc(rawDir, filePath, stat, rawSha256, now);
            if (!learned) {
                // Extraction failed: keep any previously indexed copy (same policy as
                // the incremental rebuild) and report no change — the failure shows up
                // in the next full learn's learnSummary.
                return { changed: false, docCount: index.docs.length, chunkCount: index.chunks.length };
            }
            const docs = [...prevDocs, learned.row];
            const chunks = [
                ...index.chunks.filter((chunk) => chunk.docRelPath !== relpath),
                ...learned.chunks.map((chunk) => ({
                    docRelPath: chunk.docRelPath,
                    ord: chunk.ord,
                    text: chunk.text,
                    tokens: chunk.tokens,
                })),
            ];
            const next = { version: 2, docs, chunks, inverted: buildInverted(chunks) };
            await writeIndex(next);
            cache = null;
            return { changed: true, docCount: docs.length, chunkCount: chunks.length };
        },
        query: async (query, options = {}) => {
            const index = await readIndexCached();
            if (index.chunks.length === 0 || !query.trim())
                return [];
            // Precision tokens (CJK bigrams only, stopwords dropped) — NOT the index
            // tokenizer: function-word unigrams sit in virtually every chunk and used
            // to push completely unrelated queries to the top of the ranking.
            const tokens = (0, text_1.buildKbQueryTokens)(query);
            if (!tokens.length)
                return [];
            const chunkTokenLists = index.chunks.map(tokensOfChunk);
            const avgLen = chunkTokenLists.reduce((sum, list) => sum + list.length, 0)
                / Math.max(1, chunkTokenLists.length);
            const scores = new Map();
            const matchedTokens = new Map();
            let ideal = 0;
            for (const token of tokens) {
                const postings = index.inverted[token];
                if (!postings?.length)
                    continue;
                const df = new Set(postings).size;
                let tokenBest = 0;
                for (const chunkIndex of postings) {
                    const chunkTokenList = chunkTokenLists[chunkIndex];
                    if (!chunkTokenList)
                        continue;
                    const tf = chunkTokenList.filter((item) => item === token).length;
                    const raw = bm25Score(tf, chunkTokenList.length, avgLen, df, index.chunks.length);
                    if (raw <= 0)
                        continue;
                    scores.set(chunkIndex, (scores.get(chunkIndex) ?? 0) + raw);
                    let tokenSet = matchedTokens.get(chunkIndex);
                    if (!tokenSet) {
                        tokenSet = new Set();
                        matchedTokens.set(chunkIndex, tokenSet);
                    }
                    tokenSet.add(token);
                    if (raw > tokenBest)
                        tokenBest = raw;
                }
                ideal += tokenBest;
            }
            if (ideal <= 0)
                return [];
            const topK = options.topK ?? exports.KB_QUERY_DEFAULT_TOP_K;
            const minScore = options.minScore ?? exports.KB_QUERY_DEFAULT_MIN_SCORE;
            const titleByDoc = new Map(index.docs.map((doc) => [doc.relpath, doc.title]));
            // Absolute scoring, not relative: the old bm25/maxScore normalization
            // handed the top candidate ~0.85 for ANY query with one token overlap,
            // so unrelated queries outranked real matches and minScore never
            // filtered. Now the bm25 part is the share of this query's achievable
            // best score (ideal) times the coverage of matched distinct tokens — a
            // chunk matching one noise bigram out of a dozen query tokens stays far
            // below the default 0.18 floor and the result comes back honestly empty.
            const ranked = [...scores.entries()]
                .map(([chunkIndex, bm25]) => {
                const chunk = index.chunks[chunkIndex];
                const coverage = (matchedTokens.get(chunkIndex)?.size ?? 0) / tokens.length;
                const normalizedBm25 = 0.85 * coverage * (bm25 / ideal);
                const phrase = 0.15 * Math.min(1, (0, text_1.phraseScore)(query, chunk.text));
                return {
                    docRelPath: chunk.docRelPath,
                    ord: chunk.ord,
                    snippet: (0, text_1.buildKbCitationSnippet)(chunk.text),
                    score: Number((normalizedBm25 + phrase).toFixed(4)),
                    title: titleByDoc.get(chunk.docRelPath) ?? chunk.docRelPath,
                };
            })
                .filter((hit) => hit.score >= minScore)
                .sort((left, right) => right.score - left.score)
                .slice(0, topK);
            return ranked;
        },
        clear: async () => {
            await node_fs_1.promises.rm(filePath, { force: true }).catch(() => undefined);
            cache = null;
        },
    };
}
