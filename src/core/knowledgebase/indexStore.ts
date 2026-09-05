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

import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  chunkKnowledgeBaseText,
  cleanKnowledgeBaseText,
  phraseScore,
  sha256FileAsync,
  tokenizeKnowledgeBaseText,
  buildKbCitationSnippet,
} from './text';

export interface KbIndexDocRow {
  relpath: string;
  sha256: string;
  size: number;
  mtimeMs: number;
  title: string;
  chunkCount: number;
  ingestedAt: number;
}

export interface KbIndexChunkRow {
  docRelPath: string;
  ord: number;
  text: string;
  /** Precomputed query tokens (v2); absent rows fall back to on-the-fly tokenization. */
  tokens?: string[];
}

export interface KbQueryHit {
  docRelPath: string;
  ord: number;
  snippet: string;
  score: number;
  title: string;
}

interface IndexFile {
  version: 1 | 2;
  docs: KbIndexDocRow[];
  chunks: KbIndexChunkRow[];
  /** token -> chunk indexes (positional into chunks). */
  inverted: Record<string, number[]>;
}

export interface KbIndexStore {
  filePath: string;
  load(): Promise<IndexFile | null>;
  rebuild(
    rawDir: string,
    now: () => number,
    options?: { full?: boolean },
  ): Promise<KbLearnStats & { docCount: number; chunkCount: number }>;
  query(
    query: string,
    options: { topK?: number; minScore?: number },
  ): Promise<KbQueryHit[]>;
  clear(): Promise<void>;
}

/** What one learn pass did relative to the previous index (IDBots parity). */
export interface KbLearnStats {
  /** Documents that were not in the previous index. */
  added: number;
  /** Documents whose raw bytes changed since the previous index. */
  updated: number;
  /** Documents that vanished from the raw dir. */
  removed: number;
}

export const KB_QUERY_DEFAULT_TOP_K = 8;
export const KB_QUERY_DEFAULT_MIN_SCORE = 0.18;
const BM25_K1 = 1.2;
const BM25_B = 0.75;

function emptyIndex(): IndexFile {
  return { version: 2, docs: [], chunks: [], inverted: {} };
}

function indexTokens(text: string): string[] {
  return [...new Set(tokenizeKnowledgeBaseText(text))];
}

/** Chunk tokens from the stored list, falling back to tokenization for v1 rows. */
function tokensOfChunk(chunk: KbIndexChunkRow): string[] {
  if (Array.isArray(chunk.tokens)) return chunk.tokens;
  return tokenizeKnowledgeBaseText(chunk.text);
}

async function walkRawFiles(dir: string): Promise<string[]> {
  const { SUPPORTED_KB_EXTENSIONS } = await import('./text.js');
  async function walk(current: string): Promise<string[]> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        files.push(...await walk(full));
      } else if (entry.isFile() && SUPPORTED_KB_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(full);
      }
    }
    return files;
  }
  return walk(dir).catch(() => [] as string[]);
}

interface LearnedDoc {
  row: KbIndexDocRow;
  chunks: Required<Pick<KbIndexChunkRow, 'docRelPath' | 'ord' | 'text' | 'tokens'>>[];
}

/** Extract + chunk + tokenize one raw file into an indexable doc. */
async function learnDoc(
  rawDir: string,
  filePath: string,
  stat: { size: number; mtimeMs: number },
  rawSha256: string,
  now: () => number,
): Promise<LearnedDoc | null> {
  const { extractKnowledgeBaseTextAsync, extractKbDocTitle } = await import('./text.js');
  let extraction: { text: string; title?: string };
  try {
    extraction = await extractKnowledgeBaseTextAsync(filePath);
  } catch {
    return null; // unsupported/failed files are skipped, learn never dies on one doc
  }
  const relpath = path.relative(rawDir, filePath);
  const title = extraction.title?.trim() || extractKbDocTitle(filePath, extraction.text);
  const chunks = chunkKnowledgeBaseText(extraction.text);
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

function buildInverted(chunks: Array<KbIndexChunkRow>): Record<string, number[]> {
  const inverted: Record<string, number[]> = {};
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
async function buildFullIndex(rawDir: string, now: () => number): Promise<IndexFile> {
  const files = (await walkRawFiles(rawDir)).sort();
  const docs: KbIndexDocRow[] = [];
  const chunks: KbIndexChunkRow[] = [];
  for (const filePath of files) {
    const stat = await fs.stat(filePath);
    const learned = await learnDoc(rawDir, filePath, stat, await sha256FileAsync(filePath), now);
    if (!learned) continue;
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
async function buildIncrementalIndex(
  rawDir: string,
  previous: IndexFile,
  now: () => number,
): Promise<IndexFile> {
  const oldDocByPath = new Map(previous.docs.map((doc) => [doc.relpath, doc]));
  const oldChunksByPath = new Map<string, KbIndexChunkRow[]>();
  for (const chunk of previous.chunks) {
    const list = oldChunksByPath.get(chunk.docRelPath) ?? [];
    list.push(chunk);
    oldChunksByPath.set(chunk.docRelPath, list);
  }

  const files = (await walkRawFiles(rawDir)).sort();
  const docs: KbIndexDocRow[] = [];
  const chunks: KbIndexChunkRow[] = [];

  const reuseDoc = (row: KbIndexDocRow, oldChunks: KbIndexChunkRow[]): boolean => {
    if (oldChunks.length === 0) return false;
    if (oldChunks.some((chunk) => !Array.isArray(chunk.tokens))) return false; // v1 rows
    docs.push(row);
    for (const chunk of oldChunks) {
      chunks.push({ docRelPath: chunk.docRelPath, ord: chunk.ord, text: chunk.text, tokens: chunk.tokens });
    }
    return true;
  };

  for (const filePath of files) {
    const relpath = path.relative(rawDir, filePath);
    const stat = await fs.stat(filePath);
    const oldRow = oldDocByPath.get(relpath);
    const oldChunks = oldChunksByPath.get(relpath) ?? [];

    if (oldRow
      && oldRow.size === stat.size
      && oldRow.mtimeMs === Math.floor(stat.mtimeMs)
      && reuseDoc(oldRow, oldChunks)) {
      continue;
    }

    const rawSha256 = await sha256FileAsync(filePath);
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
    } else if (oldRow && oldChunks.length > 0) {
      // Previously-indexed doc became unreadable — keep the stale copy.
      reuseDoc(oldRow, oldChunks);
    }
  }
  return { version: 2, docs, chunks, inverted: buildInverted(chunks) };
}

function bm25Score(
  tf: number,
  docLen: number,
  avgLen: number,
  df: number,
  totalDocs: number,
): number {
  if (tf <= 0 || df <= 0 || totalDocs <= 0) return 0;
  const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));
  const norm = BM25_K1 + 1;
  const lenPart = 1 - BM25_B + BM25_B * (docLen / Math.max(1, avgLen));
  return idf * ((tf * norm) / (tf + BM25_K1 * lenPart));
}

export function createKnowledgeBaseIndexStore(filePath: string): KbIndexStore {
  // Query-path cache: parse the index JSON once per index-file generation
  // (mtime+size) instead of on every query.
  let cache: { key: string; index: IndexFile } | null = null;

  function indexGenerationKey(): Promise<string> {
    return fs.stat(filePath).then(
      (stat) => `${Math.floor(stat.mtimeMs)}:${stat.size}`,
      () => 'missing',
    );
  }

  async function readIndexCached(): Promise<IndexFile> {
    const key = await indexGenerationKey();
    if (cache && cache.key === key) return cache.index;
    const index = await readIndex();
    cache = { key, index };
    return index;
  }

  async function readIndex(): Promise<IndexFile> {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<IndexFile>;
      if (!parsed || typeof parsed !== 'object' || (parsed.version !== 1 && parsed.version !== 2)) {
        return emptyIndex();
      }
      return {
        version: parsed.version,
        docs: Array.isArray(parsed.docs) ? parsed.docs : [],
        chunks: Array.isArray(parsed.chunks) ? parsed.chunks : [],
        inverted: parsed.inverted && typeof parsed.inverted === 'object' && !Array.isArray(parsed.inverted)
          ? parsed.inverted as Record<string, number[]>
          : {},
      };
    } catch {
      return emptyIndex();
    }
  }

  async function writeIndex(index: IndexFile): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmpPath, JSON.stringify(index), 'utf8');
    await fs.rename(tmpPath, filePath);
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
      // Learn summary vs the previous index, by raw-content sha256 per relpath
      // (IDBots' learn {added, updated, removed}). A full rebuild diffs against
      // the previous index the same way when one exists.
      const prevByPath = new Map((previous?.docs ?? []).map((doc) => [doc.relpath, doc.sha256]));
      const added = index.docs.filter((doc) => !prevByPath.has(doc.relpath)).length;
      const removed = [...prevByPath.keys()].filter(
        (relpath) => !index.docs.some((doc) => doc.relpath === relpath),
      ).length;
      const updated = index.docs.filter(
        (doc) => prevByPath.get(doc.relpath) !== undefined && prevByPath.get(doc.relpath) !== doc.sha256,
      ).length;
      return { docCount: index.docs.length, chunkCount: index.chunks.length, added, updated, removed };
    },

    query: async (query, options: { topK?: number; minScore?: number } = {}) => {
      const index = await readIndexCached();
      if (index.chunks.length === 0 || !query.trim()) return [];
      const tokens = indexTokens(query);
      if (!tokens.length) return [];

      const chunkTokenLists = index.chunks.map(tokensOfChunk);
      const avgLen = chunkTokenLists.reduce((sum, list) => sum + list.length, 0)
        / Math.max(1, chunkTokenLists.length);
      const scores = new Map<number, number>();

      for (const token of tokens) {
        const postings = index.inverted[token];
        if (!postings?.length) continue;
        const df = new Set(postings).size;
        for (const chunkIndex of postings) {
          const chunkTokenList = chunkTokenLists[chunkIndex];
          if (!chunkTokenList) continue;
          const tf = chunkTokenList.filter((item) => item === token).length;
          const raw = bm25Score(tf, chunkTokenList.length, avgLen, df, index.chunks.length);
          scores.set(chunkIndex, (scores.get(chunkIndex) ?? 0) + raw);
        }
      }

      const topK = options.topK ?? KB_QUERY_DEFAULT_TOP_K;
      const minScore = options.minScore ?? KB_QUERY_DEFAULT_MIN_SCORE;
      const maxScore = Math.max(...[...scores.values()], 1e-9);
      const titleByDoc = new Map(index.docs.map((doc) => [doc.relpath, doc.title]));

      const ranked = [...scores.entries()]
        .map(([chunkIndex, bm25]) => {
          const chunk = index.chunks[chunkIndex];
          const normalizedBm25 = 0.85 * (bm25 / maxScore);
          const phrase = 0.15 * Math.min(1, phraseScore(query, chunk.text));
          return {
            docRelPath: chunk.docRelPath,
            ord: chunk.ord,
            snippet: buildKbCitationSnippet(chunk.text),
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
      await fs.rm(filePath, { force: true }).catch(() => undefined);
      cache = null;
    },
  };
}

export { cleanKnowledgeBaseText };
