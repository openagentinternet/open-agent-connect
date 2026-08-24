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

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawnSync } from 'node:child_process';

export const SUPPORTED_KB_EXTENSIONS: ReadonlySet<string> = new Set([
  '.md',
  '.txt',
  '.json',
  '.csv',
  '.pdf',
  '.docx',
]);

export const KB_DEFAULT_CHUNK_SIZE = 1200;
export const KB_DEFAULT_CHUNK_OVERLAP = 180;
export const KB_SNIPPET_MAX_CHARS = 220;

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

export function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export function commandExists(command: string): boolean {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(checker, [command], { stdio: 'ignore' });
  return result.status === 0;
}

export function getPdftotextInstallHint(): string {
  if (process.platform === 'darwin') return 'Install with: brew install poppler';
  if (process.platform === 'win32') {
    return 'Install Poppler and ensure pdftotext is in PATH. Example: choco install poppler or scoop install poppler';
  }
  if (process.platform === 'linux') {
    return 'Install poppler-utils. Examples: sudo apt install poppler-utils | sudo dnf install poppler-utils | sudo pacman -S poppler';
  }
  return 'Install Poppler and ensure pdftotext command is available in PATH.';
}

export function getDocxDependencyHint(): string {
  if (process.platform === 'darwin') return 'DOCX parsing uses textutil (built-in on macOS).';
  return 'DOCX parsing currently uses textutil (macOS). On non-macOS, convert DOCX to .md/.txt first.';
}

function runTextCommand(command: string, args: string[]): { status: number | null; stdout: string } {
  const result = spawnSync(command, args, {
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

export function extractKnowledgeBaseText(filePath: string): KnowledgeBaseExtraction {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.md' || ext === '.txt' || ext === '.json' || ext === '.csv') {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (ext === '.json') {
      const note = tryExtractNoteJson(raw);
      if (note) return note;
    }
    return { text: raw };
  }

  if (ext === '.pdf') {
    if (!commandExists('pdftotext')) {
      throw new KnowledgeBaseTextError(
        'dependency_missing',
        `Missing dependency "pdftotext" for PDF parsing. ${getPdftotextInstallHint()}`,
      );
    }
    const result = runTextCommand('pdftotext', ['-layout', '-enc', 'UTF-8', filePath, '-']);
    if (result.status === 0 && result.stdout.trim()) {
      return { text: result.stdout };
    }
    throw new KnowledgeBaseTextError(
      'extract_failed',
      `Failed to parse PDF "${filePath}". ${getPdftotextInstallHint()}`,
    );
  }

  if (ext === '.docx') {
    if (!commandExists('textutil')) {
      throw new KnowledgeBaseTextError('dependency_missing', getDocxDependencyHint());
    }
    const result = runTextCommand('textutil', ['-convert', 'txt', '-stdout', filePath]);
    if (result.status === 0 && result.stdout.trim()) {
      return { text: result.stdout };
    }
    throw new KnowledgeBaseTextError(
      'extract_failed',
      `Failed to parse DOCX "${filePath}". ${getDocxDependencyHint()}`,
    );
  }

  throw new KnowledgeBaseTextError('unsupported_format', `Unsupported file extension: ${ext}`);
}

/**
 * Async command runner: spawnSync freezes the whole process for the
 * duration of pdftotext/textutil (seconds on big documents, and learn also
 * runs in the nightly window while the user may be active). Exit code maps
 * to status; a spawn failure (ENOENT & co.) maps to null.
 */
function runTextCommandAsync(command: string, args: string[]): Promise<{ status: number | null; stdout: string }> {
  return new Promise((resolve) => {
    execFile(command, args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }, (error, stdout) => {
      const out = typeof stdout === 'string' ? stdout : '';
      if (!error) {
        resolve({ status: 0, stdout: out });
        return;
      }
      const code = (error as { code?: unknown }).code;
      resolve({ status: typeof code === 'number' ? code : null, stdout: out });
    });
  });
}

/** Async sha256File: hashing a large file no longer blocks the event loop on a synchronous read. */
export async function sha256FileAsync(filePath: string): Promise<string> {
  return crypto.createHash('sha256').update(await fs.promises.readFile(filePath)).digest('hex');
}

/** Async extractKnowledgeBaseText — identical semantics, non-blocking I/O. */
export async function extractKnowledgeBaseTextAsync(filePath: string): Promise<KnowledgeBaseExtraction> {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.md' || ext === '.txt' || ext === '.json' || ext === '.csv') {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    if (ext === '.json') {
      const note = tryExtractNoteJson(raw);
      if (note) return note;
    }
    return { text: raw };
  }

  if (ext === '.pdf') {
    if (!commandExists('pdftotext')) {
      throw new KnowledgeBaseTextError(
        'dependency_missing',
        `Missing dependency "pdftotext" for PDF parsing. ${getPdftotextInstallHint()}`,
      );
    }
    const result = await runTextCommandAsync('pdftotext', ['-layout', '-enc', 'UTF-8', filePath, '-']);
    if (result.status === 0 && result.stdout.trim()) {
      return { text: result.stdout };
    }
    throw new KnowledgeBaseTextError(
      'extract_failed',
      `Failed to parse PDF "${filePath}". ${getPdftotextInstallHint()}`,
    );
  }

  if (ext === '.docx') {
    if (!commandExists('textutil')) {
      throw new KnowledgeBaseTextError('dependency_missing', getDocxDependencyHint());
    }
    const result = await runTextCommandAsync('textutil', ['-convert', 'txt', '-stdout', filePath]);
    if (result.status === 0 && result.stdout.trim()) {
      return { text: result.stdout };
    }
    throw new KnowledgeBaseTextError(
      'extract_failed',
      `Failed to parse DOCX "${filePath}". ${getDocxDependencyHint()}`,
    );
  }

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

/** Pre-tokenized document text stored into the FTS5 index. */
export function toKnowledgeBaseFtsText(text: string): string {
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
export function buildKbFtsQuery(query: string, maxTokens = 32): string {
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
  const unique = [...new Set(tokens)].slice(0, maxTokens);
  if (!unique.length) return '';
  return unique.map((token) => `"${token}"`).join(' OR ');
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
