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
exports.cleanKnowledgeBaseText = exports.KB_QUERY_DEFAULT_MIN_SCORE = exports.KB_QUERY_DEFAULT_TOP_K = void 0;
exports.createKnowledgeBaseIndexStore = createKnowledgeBaseIndexStore;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const text_1 = require("./text");
Object.defineProperty(exports, "cleanKnowledgeBaseText", { enumerable: true, get: function () { return text_1.cleanKnowledgeBaseText; } });
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
    let extraction;
    try {
        extraction = await extractKnowledgeBaseTextAsync(filePath);
    }
    catch {
        return null; // unsupported/failed files are skipped, learn never dies on one doc
    }
    const relpath = node_path_1.default.relative(rawDir, filePath);
    const title = extraction.title?.trim() || extractKbDocTitle(filePath, extraction.text);
    const chunks = (0, text_1.chunkKnowledgeBaseText)(extraction.text);
    return {
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
/**
 * Full rebuild: re-extract every file. Used by learn(full) and as the
 * v1→v2 migration path (v1 chunk rows carry no token lists to reuse).
 */
async function buildFullIndex(rawDir, now) {
    const files = (await walkRawFiles(rawDir)).sort();
    const docs = [];
    const chunks = [];
    for (const filePath of files) {
        const stat = await node_fs_1.promises.stat(filePath);
        const learned = await learnDoc(rawDir, filePath, stat, await (0, text_1.sha256FileAsync)(filePath), now);
        if (!learned)
            continue;
        docs.push(learned.row);
        for (const chunk of learned.chunks) {
            chunks.push({ docRelPath: chunk.docRelPath, ord: chunk.ord, text: chunk.text, tokens: chunk.tokens });
        }
    }
    return { version: 2, docs, chunks, inverted: buildInverted(chunks) };
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
        const learned = await learnDoc(rawDir, filePath, stat, rawSha256, now);
        if (learned) {
            docs.push(learned.row);
            for (const chunk of learned.chunks) {
                chunks.push({ docRelPath: chunk.docRelPath, ord: chunk.ord, text: chunk.text, tokens: chunk.tokens });
            }
        }
        else if (oldRow && oldChunks.length > 0) {
            // Previously-indexed doc became unreadable — keep the stale copy.
            reuseDoc(oldRow, oldChunks);
        }
    }
    return { version: 2, docs, chunks, inverted: buildInverted(chunks) };
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
            const index = previous && previous.version === 2 && previous.docs.length >= 0
                ? await buildIncrementalIndex(rawDir, previous, now)
                : await buildFullIndex(rawDir, now);
            await writeIndex(index);
            cache = null;
            return { docCount: index.docs.length, chunkCount: index.chunks.length };
        },
        query: async (query, options = {}) => {
            const index = await readIndexCached();
            if (index.chunks.length === 0 || !query.trim())
                return [];
            const tokens = indexTokens(query);
            if (!tokens.length)
                return [];
            const chunkTokenLists = index.chunks.map(tokensOfChunk);
            const avgLen = chunkTokenLists.reduce((sum, list) => sum + list.length, 0)
                / Math.max(1, chunkTokenLists.length);
            const scores = new Map();
            for (const token of tokens) {
                const postings = index.inverted[token];
                if (!postings?.length)
                    continue;
                const df = new Set(postings).size;
                for (const chunkIndex of postings) {
                    const chunkTokenList = chunkTokenLists[chunkIndex];
                    if (!chunkTokenList)
                        continue;
                    const tf = chunkTokenList.filter((item) => item === token).length;
                    const raw = bm25Score(tf, chunkTokenList.length, avgLen, df, index.chunks.length);
                    scores.set(chunkIndex, (scores.get(chunkIndex) ?? 0) + raw);
                }
            }
            const topK = options.topK ?? exports.KB_QUERY_DEFAULT_TOP_K;
            const minScore = options.minScore ?? exports.KB_QUERY_DEFAULT_MIN_SCORE;
            const maxScore = Math.max(...[...scores.values()], 1e-9);
            const titleByDoc = new Map(index.docs.map((doc) => [doc.relpath, doc.title]));
            const ranked = [...scores.entries()]
                .map(([chunkIndex, bm25]) => {
                const chunk = index.chunks[chunkIndex];
                const normalizedBm25 = 0.85 * (bm25 / maxScore);
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
