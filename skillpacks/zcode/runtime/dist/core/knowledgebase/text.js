"use strict";
/**
 * Pure text processing for the MetaBot knowledge base. OAC port of the
 * IDBots knowledgeBaseText lib (itself ported from the metabot-create-wiki
 * runtime), keeping the three deliberate changes:
 *  1. The tokenizer additionally emits CJK bigrams (per CJK run, never
 *     across punctuation) so two-character Chinese words match reliably in
 *     FTS5 — the FTS5 trigram tokenizer cannot match queries shorter than
 *     3 chars.
 *  2. Chunking prefers paragraph/line boundaries inside the sliding window.
 *  3. `.json` files that look like a SimpleNote-protocol payload
 *     ({ title, contentType, content }) index only title + content as the
 *     document body; other JSON (e.g. raw MetaWeb pins) is indexed verbatim.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KnowledgeBaseTextError = exports.KB_SNIPPET_MAX_CHARS = exports.KB_DEFAULT_CHUNK_OVERLAP = exports.KB_DEFAULT_CHUNK_SIZE = exports.SUPPORTED_KB_EXTENSIONS = void 0;
exports.cleanKnowledgeBaseText = cleanKnowledgeBaseText;
exports.sha256Text = sha256Text;
exports.sha256File = sha256File;
exports.commandExists = commandExists;
exports.getPdftotextInstallHint = getPdftotextInstallHint;
exports.getDocxDependencyHint = getDocxDependencyHint;
exports.extractKnowledgeBaseText = extractKnowledgeBaseText;
exports.sha256FileAsync = sha256FileAsync;
exports.extractKnowledgeBaseTextAsync = extractKnowledgeBaseTextAsync;
exports.extractKbDocTitle = extractKbDocTitle;
exports.tokenizeKnowledgeBaseText = tokenizeKnowledgeBaseText;
exports.toKnowledgeBaseFtsText = toKnowledgeBaseFtsText;
exports.buildKbFtsQuery = buildKbFtsQuery;
exports.chunkKnowledgeBaseText = chunkKnowledgeBaseText;
exports.buildKbCitationSnippet = buildKbCitationSnippet;
exports.phraseScore = phraseScore;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
exports.SUPPORTED_KB_EXTENSIONS = new Set([
    '.md',
    '.txt',
    '.json',
    '.csv',
    '.pdf',
    '.docx',
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
function sha256File(filePath) {
    return node_crypto_1.default.createHash('sha256').update(node_fs_1.default.readFileSync(filePath)).digest('hex');
}
function commandExists(command) {
    const checker = process.platform === 'win32' ? 'where' : 'which';
    const result = (0, node_child_process_1.spawnSync)(checker, [command], { stdio: 'ignore' });
    return result.status === 0;
}
function getPdftotextInstallHint() {
    if (process.platform === 'darwin')
        return 'Install with: brew install poppler';
    if (process.platform === 'win32') {
        return 'Install Poppler and ensure pdftotext is in PATH. Example: choco install poppler or scoop install poppler';
    }
    if (process.platform === 'linux') {
        return 'Install poppler-utils. Examples: sudo apt install poppler-utils | sudo dnf install poppler-utils | sudo pacman -S poppler';
    }
    return 'Install Poppler and ensure pdftotext command is available in PATH.';
}
function getDocxDependencyHint() {
    if (process.platform === 'darwin')
        return 'DOCX parsing uses textutil (built-in on macOS).';
    return 'DOCX parsing currently uses textutil (macOS). On non-macOS, convert DOCX to .md/.txt first.';
}
function runTextCommand(command, args) {
    const result = (0, node_child_process_1.spawnSync)(command, args, {
        encoding: 'utf8',
        maxBuffer: 20 * 1024 * 1024,
    });
    return { status: result.status, stdout: result.stdout || '' };
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
function extractKnowledgeBaseText(filePath) {
    const ext = node_path_1.default.extname(filePath).toLowerCase();
    if (ext === '.md' || ext === '.txt' || ext === '.json' || ext === '.csv') {
        const raw = node_fs_1.default.readFileSync(filePath, 'utf8');
        if (ext === '.json') {
            const note = tryExtractNoteJson(raw);
            if (note)
                return note;
        }
        return { text: raw };
    }
    if (ext === '.pdf') {
        if (!commandExists('pdftotext')) {
            throw new KnowledgeBaseTextError('dependency_missing', `Missing dependency "pdftotext" for PDF parsing. ${getPdftotextInstallHint()}`);
        }
        const result = runTextCommand('pdftotext', ['-layout', '-enc', 'UTF-8', filePath, '-']);
        if (result.status === 0 && result.stdout.trim()) {
            return { text: result.stdout };
        }
        throw new KnowledgeBaseTextError('extract_failed', `Failed to parse PDF "${filePath}". ${getPdftotextInstallHint()}`);
    }
    if (ext === '.docx') {
        if (!commandExists('textutil')) {
            throw new KnowledgeBaseTextError('dependency_missing', getDocxDependencyHint());
        }
        const result = runTextCommand('textutil', ['-convert', 'txt', '-stdout', filePath]);
        if (result.status === 0 && result.stdout.trim()) {
            return { text: result.stdout };
        }
        throw new KnowledgeBaseTextError('extract_failed', `Failed to parse DOCX "${filePath}". ${getDocxDependencyHint()}`);
    }
    throw new KnowledgeBaseTextError('unsupported_format', `Unsupported file extension: ${ext}`);
}
/**
 * Async command runner: spawnSync freezes the whole process for the
 * duration of pdftotext/textutil (seconds on big documents, and learn also
 * runs in the nightly window while the user may be active). Exit code maps
 * to status; a spawn failure (ENOENT & co.) maps to null.
 */
function runTextCommandAsync(command, args) {
    return new Promise((resolve) => {
        (0, node_child_process_1.execFile)(command, args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }, (error, stdout) => {
            const out = typeof stdout === 'string' ? stdout : '';
            if (!error) {
                resolve({ status: 0, stdout: out });
                return;
            }
            const code = error.code;
            resolve({ status: typeof code === 'number' ? code : null, stdout: out });
        });
    });
}
/** Async sha256File: hashing a large file no longer blocks the event loop on a synchronous read. */
async function sha256FileAsync(filePath) {
    return node_crypto_1.default.createHash('sha256').update(await node_fs_1.default.promises.readFile(filePath)).digest('hex');
}
/** Async extractKnowledgeBaseText — identical semantics, non-blocking I/O. */
async function extractKnowledgeBaseTextAsync(filePath) {
    const ext = node_path_1.default.extname(filePath).toLowerCase();
    if (ext === '.md' || ext === '.txt' || ext === '.json' || ext === '.csv') {
        const raw = await node_fs_1.default.promises.readFile(filePath, 'utf8');
        if (ext === '.json') {
            const note = tryExtractNoteJson(raw);
            if (note)
                return note;
        }
        return { text: raw };
    }
    if (ext === '.pdf') {
        if (!commandExists('pdftotext')) {
            throw new KnowledgeBaseTextError('dependency_missing', `Missing dependency "pdftotext" for PDF parsing. ${getPdftotextInstallHint()}`);
        }
        const result = await runTextCommandAsync('pdftotext', ['-layout', '-enc', 'UTF-8', filePath, '-']);
        if (result.status === 0 && result.stdout.trim()) {
            return { text: result.stdout };
        }
        throw new KnowledgeBaseTextError('extract_failed', `Failed to parse PDF "${filePath}". ${getPdftotextInstallHint()}`);
    }
    if (ext === '.docx') {
        if (!commandExists('textutil')) {
            throw new KnowledgeBaseTextError('dependency_missing', getDocxDependencyHint());
        }
        const result = await runTextCommandAsync('textutil', ['-convert', 'txt', '-stdout', filePath]);
        if (result.status === 0 && result.stdout.trim()) {
            return { text: result.stdout };
        }
        throw new KnowledgeBaseTextError('extract_failed', `Failed to parse DOCX "${filePath}". ${getDocxDependencyHint()}`);
    }
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
/** Pre-tokenized document text stored into the FTS5 index. */
function toKnowledgeBaseFtsText(text) {
    return tokenizeKnowledgeBaseText(text).join(' ');
}
/**
 * Builds a safe FTS5 MATCH expression from a free-form query.
 *
 * Token selection favors precision: latin words and CJK *bigrams* (a CJK
 * unigram is only emitted for an isolated single char, never for chars inside
 * a longer run — otherwise every doc containing e.g. 法 in 做法 would match a
 * 民法 query). Tokens are double-quoted (they only ever contain [a-z0-9_] or
 * CJK chars) and OR-ed so bm25() ranks chunks covering more of the query
 * higher.
 */
function buildKbFtsQuery(query, maxTokens = 32) {
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
    const unique = [...new Set(tokens)].slice(0, maxTokens);
    if (!unique.length)
        return '';
    return unique.map((token) => `"${token}"`).join(' OR ');
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
