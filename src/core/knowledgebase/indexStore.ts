/**
 * Derived per-KB search index — OAC port of the IDBots knowledgeBaseIndexStore,
 * on a portable pure-JS inverted index instead of FTS5 (OAC targets Node >=20
 * where node:sqlite is unavailable). Everything here is derived state: delete
 * the file + run learn to rebuild. Ranking mirrors the IDBots blend:
 * normalized bm25-style tf/idf + phraseScore (0.85 / 0.15), minScore 0.18.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  chunkKnowledgeBaseText,
  cleanKnowledgeBaseText,
  phraseScore,
  sha256Text,
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
}

export interface KbQueryHit {
  docRelPath: string;
  ord: number;
  snippet: string;
  score: number;
  title: string;
}

interface IndexFileV1 {
  version: 1;
  docs: KbIndexDocRow[];
  chunks: KbIndexChunkRow[];
  /** token -> chunk indexes (positional into chunks). */
  inverted: Record<string, number[]>;
}

export interface KbIndexStore {
  filePath: string;
  load(): Promise<IndexFileV1 | null>;
  rebuild(rawDir: string, now: () => number): Promise<{ docCount: number; chunkCount: number }>;
  query(
    query: string,
    options: { topK?: number; minScore?: number },
  ): Promise<KbQueryHit[]>;
  clear(): Promise<void>;
}

export const KB_QUERY_DEFAULT_TOP_K = 8;
export const KB_QUERY_DEFAULT_MIN_SCORE = 0.18;
const BM25_K1 = 1.2;
const BM25_B = 0.75;

function emptyIndex(): IndexFileV1 {
  return { version: 1, docs: [], chunks: [], inverted: {} };
}

function indexTokens(text: string): string[] {
  return [...new Set(tokenizeKnowledgeBaseText(text))];
}

/** Build the full index from every file under rawDir (recursive). */
async function buildIndexFromRawDir(
  rawDir: string,
  now: () => number,
): Promise<IndexFileV1> {
  const index = emptyIndex();
  const { extractKnowledgeBaseTextAsync, extractKbDocTitle, SUPPORTED_KB_EXTENSIONS } = await import('./text.js');

  async function walk(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await walk(full));
      } else if (entry.isFile() && SUPPORTED_KB_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(full);
      }
    }
    return files;
  }

  const files = await walk(rawDir).catch(() => [] as string[]);
  files.sort();
  for (const filePath of files) {
    const stat = await fs.stat(filePath);
    let extraction: { text: string; title?: string };
    try {
      extraction = await extractKnowledgeBaseTextAsync(filePath);
    } catch {
      continue; // unsupported/failed files are skipped, learn never dies on one doc
    }
    const relpath = path.relative(rawDir, filePath);
    const title = extraction.title?.trim() || extractKbDocTitle(filePath, extraction.text);
    const chunks = chunkKnowledgeBaseText(extraction.text);
    const docRow: KbIndexDocRow = {
      relpath,
      sha256: sha256Text(extraction.text),
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
  // Query-path cache: tokenize each chunk once per index-file generation
  // (mtime+size) instead of on every query — the corpus grows nightly and
  // per-query retokenization becomes a multi-second event-loop block.
  let cache: { key: string; index: IndexFileV1; chunkTokens: string[][] } | null = null;

  function indexGenerationKey(): Promise<string> {
    return fs.stat(filePath).then(
      (stat) => `${Math.floor(stat.mtimeMs)}:${stat.size}`,
      () => 'missing',
    );
  }

  function chunkTokensOf(index: IndexFileV1): string[][] {
    return index.chunks.map((chunk) => tokenizeKnowledgeBaseText(chunk.text));
  }

  async function readIndexCached(): Promise<{ index: IndexFileV1; chunkTokens: string[][] }> {
    const key = await indexGenerationKey();
    if (cache && cache.key === key) return cache;
    const index = await readIndex();
    cache = { key, index, chunkTokens: chunkTokensOf(index) };
    return cache;
  }

  async function readIndex(): Promise<IndexFileV1> {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<IndexFileV1>;
      if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) return emptyIndex();
      return {
        version: 1,
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

  async function writeIndex(index: IndexFileV1): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmpPath, JSON.stringify(index), 'utf8');
    await fs.rename(tmpPath, filePath);
  }

  return {
    filePath,

    load: readIndex,

    rebuild: async (rawDir, now) => {
      const index = await buildIndexFromRawDir(rawDir, now);
      await writeIndex(index);
      cache = null;
      return { docCount: index.docs.length, chunkCount: index.chunks.length };
    },

    query: async (query, options: { topK?: number; minScore?: number } = {}) => {
      const { index, chunkTokens } = await readIndexCached();
      if (index.chunks.length === 0 || !query.trim()) return [];
      const tokens = indexTokens(query);
      if (!tokens.length) return [];

      const avgLen = chunkTokens.reduce((sum, tokens2) => sum + tokens2.length, 0)
        / Math.max(1, chunkTokens.length);
      const scores = new Map<number, number>();
      const hits: Array<{ token: string; chunkIndexes: number[] }> = [];

      for (const token of tokens) {
        const postings = index.inverted[token];
        if (!postings?.length) continue;
        hits.push({ token, chunkIndexes: postings });
        const df = new Set(postings).size;
        for (const chunkIndex of postings) {
          const chunk = index.chunks[chunkIndex];
          const chunkTokenList = chunkTokens[chunkIndex];
          if (!chunk || !chunkTokenList) continue;
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
