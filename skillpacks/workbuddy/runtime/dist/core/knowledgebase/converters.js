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
exports.extractPdfText = extractPdfText;
exports.extractDocxText = extractDocxText;
exports.extractPptxText = extractPptxText;
exports.extractSpreadsheetText = extractSpreadsheetText;
exports.extractHtmlText = extractHtmlText;
exports.extractEpubText = extractEpubText;
const node_path_1 = __importDefault(require("node:path"));
/**
 * Pure-JS document-to-text converters for the knowledge base — port of the
 * IDBots knowledgeBaseConverters lib. Markitdown-style format coverage
 * (PDF/DOCX/PPTX/XLSX/HTML/EPUB) via lazy-loaded npm packages: no external
 * binaries (the previous OAC pipeline required a user-installed `pdftotext`
 * and macOS-only `textutil`), and app startup is unaffected because every
 * heavy dependency loads inside its own branch, so a broken package only
 * breaks its own format.
 *
 * Each extractor throws KnowledgeBaseTextError('extract_failed', …) when the
 * file cannot be parsed or yields no text; the learn loop records per-file
 * failures instead of aborting the run, so throwing is safe.
 */
const text_1 = require("./text");
function errorDetail(error) {
    return error instanceof Error ? error.message : String(error);
}
/** Shared HTML → Markdown conversion (DOCX, HTML pages, EPUB chapters). */
async function htmlToMarkdown(html) {
    const mod = await Promise.resolve().then(() => __importStar(require('turndown')));
    const TurndownService = mod.default;
    const service = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
    return service.turndown(html);
}
async function extractPdfText(filePath) {
    try {
        const pdfjs = await Promise.resolve().then(() => __importStar(require('pdfjs-dist/legacy/build/pdf.mjs')));
        // Ship-side standard fonts give correct glyph metrics for non-embedded
        // (base-14) fonts; without them pdfjs still extracts but warns and guesses
        // glyph widths. Resolve via require so both the tsc test build and the
        // published dist bundle find node_modules at runtime.
        const pdfjsRoot = node_path_1.default.resolve(node_path_1.default.dirname(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')), '../..');
        const standardFontDataUrl = node_path_1.default.join(pdfjsRoot, 'standard_fonts') + node_path_1.default.sep;
        const data = new Uint8Array(await (await Promise.resolve().then(() => __importStar(require('node:fs/promises')))).readFile(filePath));
        const loadingTask = pdfjs.getDocument({ data, disableFontFace: true, standardFontDataUrl, verbosity: 0 });
        const doc = await loadingTask.promise;
        try {
            const pages = [];
            for (let pageNo = 1; pageNo <= doc.numPages; pageNo += 1) {
                const page = await doc.getPage(pageNo);
                const content = await page.getTextContent();
                let pageText = '';
                for (const item of content.items) {
                    if (!('str' in item))
                        continue;
                    pageText += item.str;
                    if ('hasEOL' in item && item.hasEOL)
                        pageText += '\n';
                }
                if (pageText.trim())
                    pages.push(pageText.trim());
            }
            const text = pages.join('\n\n').trim();
            if (!text)
                throw new Error('no extractable text (scanned or image-only PDF)');
            return { text };
        }
        finally {
            await loadingTask.destroy();
        }
    }
    catch (error) {
        if (error instanceof text_1.KnowledgeBaseTextError)
            throw error;
        throw new text_1.KnowledgeBaseTextError('extract_failed', `Failed to parse PDF "${filePath}": ${errorDetail(error)}`);
    }
}
async function extractDocxText(filePath) {
    try {
        const mammoth = await Promise.resolve().then(() => __importStar(require('mammoth')));
        const result = await mammoth.convertToHtml({ path: filePath });
        const text = (await htmlToMarkdown(result.value)).trim();
        if (!text)
            throw new Error('no extractable text');
        return { text };
    }
    catch (error) {
        if (error instanceof text_1.KnowledgeBaseTextError)
            throw error;
        throw new text_1.KnowledgeBaseTextError('extract_failed', `Failed to parse DOCX "${filePath}": ${errorDetail(error)}`);
    }
}
function decodeXmlEntities(value) {
    return value
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(parseInt(num, 10)))
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}
/**
 * Text runs of one OOXML slide/notes XML, paragraph by paragraph. Regex-based
 * on purpose: `<a:t>` content never contains a raw '<', and document order is
 * exactly the reading order we want for indexing.
 */
function extractOoxmlParagraphs(xml) {
    const paragraphs = [];
    for (const para of xml.split('</a:p>')) {
        const runs = Array.from(para.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g), (match) => match[1]);
        const text = decodeXmlEntities(runs.join('')).trim();
        if (text)
            paragraphs.push(text);
    }
    return paragraphs;
}
async function extractPptxText(filePath) {
    try {
        const AdmZip = (await Promise.resolve().then(() => __importStar(require('adm-zip')))).default;
        const zip = new AdmZip(await (await Promise.resolve().then(() => __importStar(require('node:fs/promises')))).readFile(filePath));
        const entryText = new Map();
        for (const entry of zip.getEntries()) {
            if (!entry.isDirectory)
                entryText.set(entry.entryName, entry.getData().toString('utf8'));
        }
        const slideNumbers = [...entryText.keys()]
            .map((name) => /^ppt\/slides\/slide(\d+)\.xml$/.exec(name)?.[1])
            .filter((num) => Boolean(num))
            .map(Number)
            .sort((a, b) => a - b);
        const sections = [];
        for (const num of slideNumbers) {
            const paragraphs = extractOoxmlParagraphs(entryText.get(`ppt/slides/slide${num}.xml`) || '');
            const notes = extractOoxmlParagraphs(entryText.get(`ppt/notesSlides/notesSlide${num}.xml`) || '');
            const body = paragraphs.join('\n');
            const notesText = notes.length ? `\n\nNotes: ${notes.join('\n')}` : '';
            if (body || notesText)
                sections.push(`## Slide ${num}\n\n${body}${notesText}`.trim());
        }
        const text = sections.join('\n\n').trim();
        if (!text)
            throw new Error('no extractable text in any slide');
        return { text };
    }
    catch (error) {
        if (error instanceof text_1.KnowledgeBaseTextError)
            throw error;
        throw new text_1.KnowledgeBaseTextError('extract_failed', `Failed to parse PPTX "${filePath}": ${errorDetail(error)}`);
    }
}
async function extractSpreadsheetText(filePath) {
    try {
        const XLSX = await Promise.resolve().then(() => __importStar(require('xlsx')));
        const workbook = XLSX.read(await (await Promise.resolve().then(() => __importStar(require('node:fs/promises')))).readFile(filePath), { type: 'buffer' });
        const sections = [];
        for (const name of workbook.SheetNames) {
            const sheet = workbook.Sheets[name];
            if (!sheet)
                continue;
            const csv = XLSX.utils.sheet_to_csv(sheet).trim();
            if (csv)
                sections.push(`## Sheet: ${name}\n\n${csv}`);
        }
        const text = sections.join('\n\n').trim();
        if (!text)
            throw new Error('no extractable cells in any sheet');
        return { text };
    }
    catch (error) {
        if (error instanceof text_1.KnowledgeBaseTextError)
            throw error;
        throw new text_1.KnowledgeBaseTextError('extract_failed', `Failed to parse spreadsheet "${filePath}": ${errorDetail(error)}`);
    }
}
async function extractHtmlText(filePath) {
    try {
        const html = await (await Promise.resolve().then(() => __importStar(require('node:fs/promises')))).readFile(filePath, 'utf8');
        const text = (await htmlToMarkdown(html)).trim();
        if (!text)
            throw new Error('no extractable text');
        return { text };
    }
    catch (error) {
        if (error instanceof text_1.KnowledgeBaseTextError)
            throw error;
        throw new text_1.KnowledgeBaseTextError('extract_failed', `Failed to parse HTML "${filePath}": ${errorDetail(error)}`);
    }
}
/** Reads one zip entry as utf8, tolerating './'-prefixed container paths. */
function readZipTextEntry(entryText, name) {
    const normalized = name.replace(/^\.\//, '');
    for (const key of [name, normalized, `./${normalized}`]) {
        const value = entryText.get(key);
        if (value !== undefined)
            return value;
    }
    return undefined;
}
async function extractEpubText(filePath) {
    try {
        const AdmZip = (await Promise.resolve().then(() => __importStar(require('adm-zip')))).default;
        const { XMLParser } = await Promise.resolve().then(() => __importStar(require('fast-xml-parser')));
        const zip = new AdmZip(await (await Promise.resolve().then(() => __importStar(require('node:fs/promises')))).readFile(filePath));
        const entryText = new Map();
        for (const entry of zip.getEntries()) {
            if (!entry.isDirectory)
                entryText.set(entry.entryName, entry.getData().toString('utf8'));
        }
        const container = readZipTextEntry(entryText, 'META-INF/container.xml');
        const opfPath = container && /<rootfile[^>]*\bfull-path="([^"]+)"/.exec(container)?.[1];
        if (!opfPath)
            throw new Error('META-INF/container.xml rootfile not found');
        const opf = readZipTextEntry(entryText, opfPath);
        if (!opf)
            throw new Error(`OPF package document "${opfPath}" not found in archive`);
        const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
        const packageDoc = (parser.parse(opf).package || {});
        const asArray = (value) => value === undefined ? [] : Array.isArray(value) ? value : [value];
        const manifest = new Map();
        for (const item of asArray(packageDoc.manifest?.item)) {
            const id = item['@_id'];
            const href = item['@_href'];
            if (id && href)
                manifest.set(id, { href, mediaType: item['@_media-type'] || '' });
        }
        const opfDir = node_path_1.default.posix.dirname(opfPath);
        const spineHrefs = asArray(packageDoc.spine?.itemref)
            .map((ref) => manifest.get(ref['@_idref']))
            .filter((item) => Boolean(item))
            .map((item) => node_path_1.default.posix.normalize(node_path_1.default.posix.join(opfDir === '.' ? '' : opfDir, decodeURIComponent(item.href))));
        const chapters = [];
        for (const href of spineHrefs) {
            const chapter = readZipTextEntry(entryText, href);
            if (!chapter)
                continue;
            const markdown = (await htmlToMarkdown(chapter)).trim();
            if (markdown)
                chapters.push(markdown);
        }
        const text = chapters.join('\n\n').trim();
        if (!text)
            throw new Error('no extractable text in spine chapters');
        const dcTitle = packageDoc.metadata?.['dc:title'];
        const title = typeof dcTitle === 'string'
            ? dcTitle.trim()
            : typeof dcTitle?.['#text'] === 'string'
                ? String(dcTitle['#text']).trim()
                : '';
        return title ? { text, title } : { text };
    }
    catch (error) {
        if (error instanceof text_1.KnowledgeBaseTextError)
            throw error;
        throw new text_1.KnowledgeBaseTextError('extract_failed', `Failed to parse EPUB "${filePath}": ${errorDetail(error)}`);
    }
}
