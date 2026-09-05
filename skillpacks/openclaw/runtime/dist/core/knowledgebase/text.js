"use strict";
/**
 * Pure text processing for the MetaBot knowledge base. OAC port of the
 * IDBots knowledgeBaseText lib (itself ported from the metabot-create-wiki
 * runtime), keeping the three deliberate changes:
 *  1. The tokenizer additionally emits CJK bigrams (per CJK run, never
 *     across punctuation) so two-character Chinese words match reliably in
 *     the inverted index — the FTS5 trigram tokenizer cannot match queries
 *     shorter than 3 chars.
 *  2. Chunking prefers paragraph/line boundaries inside the sliding window.
 *  3. `.json` files that look like a SimpleNote-protocol payload
 *     ({ title, contentType, content }) index only title + content as the
 *     document body; other JSON (e.g. raw MetaWeb pins) is indexed verbatim.
 *
 * Binary formats (PDF/DOCX/PPTX/XLSX/HTML/EPUB) go through the pure-JS
 * converters (./converters, ported from IDBots) — no pdftotext/textutil
 * binaries, so extraction is cross-platform.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KnowledgeBaseTextError = exports.KB_SNIPPET_MAX_CHARS = exports.KB_DEFAULT_CHUNK_OVERLAP = exports.KB_DEFAULT_CHUNK_SIZE = exports.SUPPORTED_KB_EXTENSIONS = void 0;
exports.cleanKnowledgeBaseText = cleanKnowledgeBaseText;
exports.sha256Text = sha256Text;
exports.sha256FileAsync = sha256FileAsync;
exports.extractKnowledgeBaseTextAsync = extractKnowledgeBaseTextAsync;
exports.extractKbDocTitle = extractKbDocTitle;
exports.tokenizeKnowledgeBaseText = tokenizeKnowledgeBaseText;
exports.buildKbQueryTokens = buildKbQueryTokens;
exports.buildKbFtsQuery = buildKbFtsQuery;
exports.phraseScore = phraseScore;
exports.chunkKnowledgeBaseText = chunkKnowledgeBaseText;
exports.buildKbCitationSnippet = buildKbCitationSnippet;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const converters_1 = require("./converters");
exports.SUPPORTED_KB_EXTENSIONS = new Set([
    '.md',
    '.markdown',
    '.txt',
    '.json',
    '.csv',
    '.tsv',
    '.yaml',
    '.yml',
    '.xml',
    '.log',
    '.rst',
    '.pdf',
    '.docx',
    '.pptx',
    '.xlsx',
    '.xls',
    '.html',
    '.htm',
    '.epub',
]);
/** Plain-text formats read verbatim (after SimpleNote-JSON unwrap for .json). */
const PLAIN_TEXT_KB_EXTENSIONS = new Set([
    '.md',
    '.markdown',
    '.txt',
    '.json',
    '.csv',
    '.tsv',
    '.yaml',
    '.yml',
    '.xml',
    '.log',
    '.rst',
]);
exports.KB_DEFAULT_CHUNK_SIZE = 1200;
exports.KB_DEFAULT_CHUNK_OVERLAP = 180;
exports.KB_SNIPPET_MAX_CHARS = 220;
class KnowledgeBaseTextError extends Error {
    code;
    constructor(code, detail) {
        super(detail);
        this.name = 'KnowledgeBaseTextError';
        this.code = code;
    }
}
exports.KnowledgeBaseTextError = KnowledgeBaseTextError;
function cleanKnowledgeBaseText(value) {
    return String(value || '')
        .replace(/\u0000/g, ' ')
        .replace(/\r/g, '')
        .replace(/\t/g, ' ')
        .replace(/[ ]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
function sha256Text(value) {
    return node_crypto_1.default.createHash('sha256').update(value, 'utf8').digest('hex');
}
/** Async sha256 of raw file bytes — the incremental-learn change detector. */
async function sha256FileAsync(filePath) {
    return node_crypto_1.default.createHash('sha256').update(await node_fs_1.default.promises.readFile(filePath)).digest('hex');
}
/**
 * Detects a SimpleNote-protocol-style JSON payload (the canonical knowledge
 * carrier on MetaWeb and the format knowledge_base_add_document writes) and
 * returns only its human-meaningful body so JSON syntax never pollutes chunks.
 */
function tryExtractNoteJson(raw) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        return null;
    const record = parsed;
    if (typeof record.content !== 'string' || !record.content.trim())
        return null;
    const looksLikeNote = typeof record.title === 'string'
        || typeof record.contentType === 'string'
        || typeof record.createTime === 'string';
    if (!looksLikeNote)
        return null;
    const title = typeof record.title === 'string' ? record.title.trim() : '';
    return {
        text: title ? `${title}\n\n${record.content}` : record.content,
        title: title || undefined,
    };
}
/** Async extractor — identical semantics to the pre-converter pipeline, non-blocking I/O. */
async function extractKnowledgeBaseTextAsync(filePath) {
    const ext = node_path_1.default.extname(filePath).toLowerCase();
    if (PLAIN_TEXT_KB_EXTENSIONS.has(ext)) {
        const raw = await node_fs_1.default.promises.readFile(filePath, 'utf8');
        if (ext === '.json') {
            const note = tryExtractNoteJson(raw);
            if (note)
                return note;
        }
        return { text: raw };
    }
    if (ext === '.pdf')
        return (0, converters_1.extractPdfText)(filePath);
    if (ext === '.docx')
        return (0, converters_1.extractDocxText)(filePath);
    if (ext === '.pptx')
        return (0, converters_1.extractPptxText)(filePath);
    if (ext === '.xlsx' || ext === '.xls')
        return (0, converters_1.extractSpreadsheetText)(filePath);
    if (ext === '.html' || ext === '.htm')
        return (0, converters_1.extractHtmlText)(filePath);
    if (ext === '.epub')
        return (0, converters_1.extractEpubText)(filePath);
    throw new KnowledgeBaseTextError('unsupported_format', `Unsupported file extension: ${ext}`);
}
function extractKbDocTitle(filePath, text) {
    const fileBase = node_path_1.default.basename(filePath, node_path_1.default.extname(filePath));
    const firstLine = String(text || '')
        .split(/\r?\n/)
        .map((line) => line.trim().replace(/^#+\s*/, ''))
        .find(Boolean);
    return firstLine || fileBase || 'Untitled';
}
/**
 * Latin words + CJK unigrams + CJK bigrams within each CJK run.
 * Bigrams make two-character Chinese words (民法, 合同, …) directly matchable.
 */
function tokenizeKnowledgeBaseText(text) {
    const source = String(text || '').toLowerCase();
    const tokens = [];
    const latin = source.match(/[a-z0-9_]+/g);
    if (latin)
        tokens.push(...latin);
    const cjkRuns = source.match(/[一-鿿]+/g) || [];
    for (const run of cjkRuns) {
        const chars = Array.from(run);
        tokens.push(...chars);
        for (let idx = 0; idx < chars.length - 1; idx += 1) {
            tokens.push(`${chars[idx]}${chars[idx + 1]}`);
        }
    }
    return tokens;
}
/**
 * Token selection for free-form queries, favoring precision: latin words and
 * CJK *bigrams* (a CJK unigram is only emitted for an isolated single char,
 * never for chars inside a longer run — otherwise every doc containing e.g.
 * 法 in 做法 would match a 民法 query). Shared by the index query path and
 * the retention-tested query-builder contract.
 */
function buildKbQueryTokens(query, maxTokens = 32) {
    const source = String(query || '').toLowerCase();
    const tokens = [];
    const latin = source.match(/[a-z0-9_]+/g);
    if (latin)
        tokens.push(...latin);
    const cjkRuns = source.match(/[一-鿿]+/g) || [];
    for (const run of cjkRuns) {
        const chars = Array.from(run);
        if (chars.length === 1) {
            tokens.push(chars[0]);
            continue;
        }
        for (let idx = 0; idx < chars.length - 1; idx += 1) {
            tokens.push(`${chars[idx]}${chars[idx + 1]}`);
        }
    }
    return [...new Set(tokens)].slice(0, maxTokens);
}
/** Double-quoted OR expression of the query tokens (the legacy FTS5 shape). */
function buildKbFtsQuery(query, maxTokens = 32) {
    const unique = buildKbQueryTokens(query, maxTokens);
    if (!unique.length)
        return '';
    return unique.map((token) => `"${token}"`).join(' OR ');
}
/**
 * Exact-phrase boost, ported from the wiki runtime's phraseScore:
 * full substring hit + shared CJK bigram ratio + latin token coverage.
 */
function phraseScore(question, text) {
    const q = cleanKnowledgeBaseText(question);
    const body = cleanKnowledgeBaseText(text);
    if (!q || !body)
        return 0;
    let score = body.includes(q) ? 1 : 0;
    const queryBigrams = new Set(cjkBigramsOf(q));
    if (queryBigrams.size > 0) {
        const bodyBigrams = new Set(cjkBigramsOf(body));
        let shared = 0;
        for (const item of queryBigrams) {
            if (bodyBigrams.has(item))
                shared += 1;
        }
        score += shared / queryBigrams.size;
    }
    const latinTokens = tokenizeKnowledgeBaseText(q).filter((token) => /[a-z0-9_]/i.test(token));
    if (latinTokens.length > 0) {
        const lowerBody = body.toLowerCase();
        const matched = latinTokens.filter((token) => lowerBody.includes(token.toLowerCase())).length;
        score += matched / latinTokens.length;
    }
    return score;
}
function cjkBigramsOf(text) {
    const out = [];
    const runs = String(text || '').match(/[一-鿿]+/g) || [];
    for (const run of runs) {
        const chars = Array.from(run);
        for (let idx = 0; idx < chars.length - 1; idx += 1) {
            out.push(`${chars[idx]}${chars[idx + 1]}`);
        }
    }
    return out;
}
/** Sliding-window chunker that prefers breaking on paragraph/line boundaries. */
function chunkKnowledgeBaseText(text, chunkSize = exports.KB_DEFAULT_CHUNK_SIZE, chunkOverlap = exports.KB_DEFAULT_CHUNK_OVERLAP) {
    const normalized = cleanKnowledgeBaseText(text);
    if (!normalized)
        return [];
    if (normalized.length <= chunkSize) {
        return [{ text: normalized, startOffset: 0, endOffset: normalized.length }];
    }
    const chunks = [];
    const minBreakOffset = Math.max(1, Math.floor(chunkSize * 0.6));
    let cursor = 0;
    while (cursor < normalized.length) {
        let end = Math.min(normalized.length, cursor + chunkSize);
        if (end < normalized.length) {
            const tail = normalized.slice(cursor + minBreakOffset, end);
            const paragraphIdx = tail.lastIndexOf('\n\n');
            const lineIdx = paragraphIdx < 0 ? tail.lastIndexOf('\n') : -1;
            if (paragraphIdx > 0) {
                end = cursor + minBreakOffset + paragraphIdx;
            }
            else if (lineIdx > 0) {
                end = cursor + minBreakOffset + lineIdx;
            }
        }
        const slice = normalized.slice(cursor, end).trim();
        if (slice) {
            chunks.push({ text: slice, startOffset: cursor, endOffset: end });
        }
        if (end >= normalized.length)
            break;
        const next = end - Math.max(0, chunkOverlap);
        cursor = next > cursor ? next : cursor + 1;
    }
    return chunks;
}
function buildKbCitationSnippet(text, maxChars = exports.KB_SNIPPET_MAX_CHARS) {
    const normalized = cleanKnowledgeBaseText(text);
    if (normalized.length <= maxChars)
        return normalized;
    return `${normalized.slice(0, maxChars - 1)}…`;
}
