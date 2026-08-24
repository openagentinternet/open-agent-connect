"use strict";
/**
 * Derived per-KB search index — OAC port of the IDBots knowledgeBaseIndexStore,
 * on a portable pure-JS inverted index instead of FTS5 (OAC targets Node >=20
 * where node:sqlite is unavailable). Everything here is derived state: delete
 * the file + run learn to rebuild. Ranking mirrors the IDBots blend:
 * normalized bm25-style tf/idf + phraseScore (0.85 / 0.15), minScore 0.18.
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
    return { version: 1, docs: [], chunks: [], inverted: {} };
}
function indexTokens(text) {
    return [...new Set((0, text_1.tokenizeKnowledgeBaseText)(text))];
}
/** Build the full index from every file under rawDir (recursive). */
async function buildIndexFromRawDir(rawDir, now) {
    const index = emptyIndex();
    const { extractKnowledgeBaseTextAsync, extractKbDocTitle, SUPPORTED_KB_EXTENSIONS } = await Promise.resolve().then(() => __importStar(require('./text.js')));
    async function walk(dir) {
        const entries = await node_fs_1.promises.readdir(dir, { withFileTypes: true });
        const files = [];
        for (const entry of entries) {
            const full = node_path_1.default.join(dir, entry.name);
            if (entry.isDirectory()) {
                files.push(...await walk(full));
            }
            else if (entry.isFile() && SUPPORTED_KB_EXTENSIONS.has(node_path_1.default.extname(entry.name).toLowerCase())) {
                files.push(full);
            }
        }
        return files;
    }
    const files = await walk(rawDir).catch(() => []);
    files.sort();
    for (const filePath of files) {
        const stat = await node_fs_1.promises.stat(filePath);
        let extraction;
        try {
            extraction = await extractKnowledgeBaseTextAsync(filePath);
        }
        catch {
            continue; // unsupported/failed files are skipped, learn never dies on one doc
        }
        const relpath = node_path_1.default.relative(rawDir, filePath);
        const title = extraction.title?.trim() || extractKbDocTitle(filePath, extraction.text);
        const chunks = (0, text_1.chunkKnowledgeBaseText)(extraction.text);
        const docRow = {
            relpath,
            sha256: (0, text_1.sha256Text)(extraction.text),
            size: stat.size,
            mtimeMs: Math.floor(stat.mtimeMs),
            title,
            chunkCount: chunks.length,
            ingestedAt: now(),
        };
        index.docs.push(docRow);
        chunks.forEach((chunk, ord) => {
            const chunkIndex = index.chunks.length;
            index.chunks.push({ docRelPath: relpath, ord, text: chunk.text });
            for (const token of indexTokens(chunk.text)) {
                (index.inverted[token] ??= []).push(chunkIndex);
            }
        });
    }
    return index;
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
    async function readIndex() {
        try {
            const raw = await node_fs_1.promises.readFile(filePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || parsed.version !== 1)
                return emptyIndex();
            return {
                version: 1,
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
        rebuild: async (rawDir, now) => {
            const index = await buildIndexFromRawDir(rawDir, now);
            await writeIndex(index);
            return { docCount: index.docs.length, chunkCount: index.chunks.length };
        },
        query: async (query, options = {}) => {
            const index = await readIndex();
            if (index.chunks.length === 0 || !query.trim())
                return [];
            const tokens = indexTokens(query);
            if (!tokens.length)
                return [];
            const avgLen = index.chunks.reduce((sum, chunk) => sum + (0, text_1.tokenizeKnowledgeBaseText)(chunk.text).length, 0)
                / Math.max(1, index.chunks.length);
            const scores = new Map();
            const hits = [];
            for (const token of tokens) {
                const postings = index.inverted[token];
                if (!postings?.length)
                    continue;
                hits.push({ token, chunkIndexes: postings });
                const df = new Set(postings).size;
                for (const chunkIndex of postings) {
                    const chunk = index.chunks[chunkIndex];
                    if (!chunk)
                        continue;
                    const chunkTokens = (0, text_1.tokenizeKnowledgeBaseText)(chunk.text);
                    const tf = chunkTokens.filter((item) => item === token).length;
                    const raw = bm25Score(tf, chunkTokens.length, avgLen, df, index.chunks.length);
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
        },
    };
}
