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

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  extractDocxText,
  extractEpubText,
  extractHtmlText,
  extractPdfText,
  extractPptxText,
  extractSpreadsheetText,
} from './converters';

export const SUPPORTED_KB_EXTENSIONS: ReadonlySet<string> = new Set([
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
const PLAIN_TEXT_KB_EXTENSIONS: ReadonlySet<string> = new Set([
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

export const KB_DEFAULT_CHUNK_SIZE = 1200;
export const KB_DEFAULT_CHUNK_OVERLAP = 180;
export const KB_SNIPPET_MAX_CHARS = 320;

/**
 * Function words dropped from QUERY tokens (never from index tokens, so the
 * stored v2 token lists stay valid). With bigram-only CJK query tokens the
 * dominant noise is multi-char function words (什么/可以/应该…) and Latin
 * function words (the/a/of…), which appear in virtually every chunk and
 * matched the whole corpus at high scores; the unigram entries only fire for
 * chars isolated by punctuation. Kept deliberately small and safe: membership
 * must never exclude a content-bearing term.
 */
export const KB_QUERY_STOPWORDS: ReadonlySet<string> = new Set([
  // isolated CJK function chars
  '的', '了', '吗', '呢', '吧', '啊', '嘛', '么', '与', '及', '或',
  '但', '是', '还', '而', '且', '于', '因', '此', '其', '中', '上', '下',
  '不', '一', '个', '这', '那', '怎', '如', '何', '为', '对', '很', '真',
  '全', '定', '可', '以', '应', '该', '能', '已', '经', '会', '没', '我',
  '你', '他', '它',
  // common CJK function bigrams
  '什么', '怎么', '如何', '为何', '以及', '对于', '关于', '根据', '由于',
  '虽然', '此外', '其中', '以上', '以下', '非常', '真的', '十分', '全部',
  '一起', '一样', '一下', '一直', '不一', '可以', '应该', '可能', '已经',
  '正在', '将会', '没有', '我们', '你们', '他们', '还是', '就是', '但是',
  '因为', '所以', '如果', '而且', '于是', '然后', '因此', '并且', '或者',
  '这个', '那个', '这些', '那些', '这里', '那里', '哪些', '哪个', '怎样',
  '一些', '一定',
  // top Latin function words
  'the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'with',
  'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this', 'that',
  'as', 'at', 'by', 'from', 'not', 'no', 'yes', 'do', 'does', 'did',
  'will', 'would', 'can', 'could', 'should', 'have', 'has', 'had', 'you',
  'we', 'they', 'i', 'me', 'my',
]);

export class KnowledgeBaseTextError extends Error {
  readonly code: 'dependency_missing' | 'unsupported_format' | 'extract_failed';

  constructor(code: KnowledgeBaseTextError['code'], detail: string) {
    super(detail);
    this.name = 'KnowledgeBaseTextError';
    this.code = code;
  }
}

export function cleanKnowledgeBaseText(value: string): string {
  return String(value || '')
    .replace(/\u0000/g, ' ')
    .replace(/\r/g, '')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function sha256Text(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Async sha256 of raw file bytes — the incremental-learn change detector. */
export async function sha256FileAsync(filePath: string): Promise<string> {
  return crypto.createHash('sha256').update(await fs.promises.readFile(filePath)).digest('hex');
}

/**
 * Detects a SimpleNote-protocol-style JSON payload (the canonical knowledge
 * carrier on MetaWeb and the format knowledge_base_add_document writes) and
 * returns only its human-meaningful body so JSON syntax never pollutes chunks.
 */
function tryExtractNoteJson(raw: string): { text: string; title?: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.content !== 'string' || !record.content.trim()) return null;
  const looksLikeNote =
    typeof record.title === 'string'
    || typeof record.contentType === 'string'
    || typeof record.createTime === 'string';
  if (!looksLikeNote) return null;
  const title = typeof record.title === 'string' ? record.title.trim() : '';
  return {
    text: title ? `${title}\n\n${record.content}` : record.content,
    title: title || undefined,
  };
}

export interface KnowledgeBaseExtraction {
  text: string;
  title?: string;
}

/** Async extractor — identical semantics to the pre-converter pipeline, non-blocking I/O. */
export async function extractKnowledgeBaseTextAsync(filePath: string): Promise<KnowledgeBaseExtraction> {
  const ext = path.extname(filePath).toLowerCase();

  if (PLAIN_TEXT_KB_EXTENSIONS.has(ext)) {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    if (ext === '.json') {
      const note = tryExtractNoteJson(raw);
      if (note) return note;
    }
    return { text: raw };
  }

  if (ext === '.pdf') return extractPdfText(filePath);
  if (ext === '.docx') return extractDocxText(filePath);
  if (ext === '.pptx') return extractPptxText(filePath);
  if (ext === '.xlsx' || ext === '.xls') return extractSpreadsheetText(filePath);
  if (ext === '.html' || ext === '.htm') return extractHtmlText(filePath);
  if (ext === '.epub') return extractEpubText(filePath);

  throw new KnowledgeBaseTextError('unsupported_format', `Unsupported file extension: ${ext}`);
}

export function extractKbDocTitle(filePath: string, text: string): string {
  const fileBase = path.basename(filePath, path.extname(filePath));
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
export function tokenizeKnowledgeBaseText(text: string): string[] {
  const source = String(text || '').toLowerCase();
  const tokens: string[] = [];
  const latin = source.match(/[a-z0-9_]+/g);
  if (latin) tokens.push(...latin);
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
 * 法 in 做法 would match a 民法 query). Function words (KB_QUERY_STOPWORDS)
 * are dropped: they appear in virtually every chunk and used to push noise
 * hits above real matches. Shared by the index query path (indexStore) and
 * the legacy FTS query builder.
 */
export function buildKbQueryTokens(query: string, maxTokens = 32): string[] {
  const source = String(query || '').toLowerCase();
  const tokens: string[] = [];
  const latin = source.match(/[a-z0-9_]+/g);
  if (latin) tokens.push(...latin);
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
  return [...new Set(tokens)].filter((token) => !KB_QUERY_STOPWORDS.has(token)).slice(0, maxTokens);
}

/** Double-quoted OR expression of the query tokens (the legacy FTS5 shape). */
export function buildKbFtsQuery(query: string, maxTokens = 32): string {
  const unique = buildKbQueryTokens(query, maxTokens);
  if (!unique.length) return '';
  return unique.map((token) => `"${token}"`).join(' OR ');
}

/**
 * Exact-phrase boost, ported from the wiki runtime's phraseScore:
 * full substring hit + shared CJK bigram ratio + latin token coverage.
 */
export function phraseScore(question: string, text: string): number {
  const q = cleanKnowledgeBaseText(question);
  const body = cleanKnowledgeBaseText(text);
  if (!q || !body) return 0;

  let score = body.includes(q) ? 1 : 0;
  const queryBigrams = new Set(cjkBigramsOf(q));
  if (queryBigrams.size > 0) {
    const bodyBigrams = new Set(cjkBigramsOf(body));
    let shared = 0;
    for (const item of queryBigrams) {
      if (bodyBigrams.has(item)) shared += 1;
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

function cjkBigramsOf(text: string): string[] {
  const out: string[] = [];
  const runs = String(text || '').match(/[一-鿿]+/g) || [];
  for (const run of runs) {
    const chars = Array.from(run);
    for (let idx = 0; idx < chars.length - 1; idx += 1) {
      out.push(`${chars[idx]}${chars[idx + 1]}`);
    }
  }
  return out;
}

export interface KnowledgeBaseChunk {
  text: string;
  startOffset: number;
  endOffset: number;
}

/** Sliding-window chunker that prefers breaking on paragraph/line boundaries. */
export function chunkKnowledgeBaseText(
  text: string,
  chunkSize: number = KB_DEFAULT_CHUNK_SIZE,
  chunkOverlap: number = KB_DEFAULT_CHUNK_OVERLAP,
): KnowledgeBaseChunk[] {
  const normalized = cleanKnowledgeBaseText(text);
  if (!normalized) return [];
  if (normalized.length <= chunkSize) {
    return [{ text: normalized, startOffset: 0, endOffset: normalized.length }];
  }

  const chunks: KnowledgeBaseChunk[] = [];
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
      } else if (lineIdx > 0) {
        end = cursor + minBreakOffset + lineIdx;
      }
    }
    const slice = normalized.slice(cursor, end).trim();
    if (slice) {
      chunks.push({ text: slice, startOffset: cursor, endOffset: end });
    }
    if (end >= normalized.length) break;
    const next = end - Math.max(0, chunkOverlap);
    cursor = next > cursor ? next : cursor + 1;
  }
  return chunks;
}

export function buildKbCitationSnippet(text: string, maxChars: number = KB_SNIPPET_MAX_CHARS): string {
  const normalized = cleanKnowledgeBaseText(text);
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1)}…`;
}
