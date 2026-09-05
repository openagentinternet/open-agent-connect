/**
 * Knowledge base service — learn (full/incremental rebuild), query (one KB or
 * merged across a bot's KBs), addDocument (SimpleNote-JSON wrapper with
 * provenance), importFiles. OAC port of the IDBots knowledgeBaseService on
 * the portable index store. Every learn is serialized per-KB and yields the
 * event loop between documents so the daemon never blocks.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { MetabotPaths } from '../state/paths';
import { createChainHistoryStore } from '../chainhistory/store';
import {
  createKnowledgeBaseStore,
  knowledgeBaseIndexPath,
  type KnowledgeBaseRecord,
  type KnowledgeBaseStore,
} from './store';
import { createKnowledgeBaseIndexStore, type KbQueryHit } from './indexStore';
import {
  SUPPORTED_KB_EXTENSIONS,
  cleanKnowledgeBaseText,
  extractKbDocTitle,
  sha256Text,
} from './text';

export interface KbQueryResult {
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  hits: KbQueryHit[];
}

export interface AddDocumentInput {
  title: string;
  content: string;
  knowledgeBaseId?: string;
  sourceType?: 'web' | 'metaweb' | 'manual';
  url?: string;
  pinId?: string;
  tags?: string[];
}

export class KnowledgeBaseServiceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'KnowledgeBaseServiceError';
  }
}

export function slugifyKbFileName(title: string, content: string): string {
  const base = title.trim().toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'document';
  return `${base}-${sha256Text(content).slice(0, 8)}.json`;
}

export function buildKbDocumentJson(input: AddDocumentInput): string {
  const record: Record<string, unknown> = {
    title: input.title.trim(),
    contentType: 'text/markdown',
    content: input.content,
    // Machine provenance block; bounded and string-typed by construction.
    'x-kb-source': {
      type: input.sourceType ?? 'manual',
      ...(input.url ? { url: input.url.slice(0, 500) } : {}),
      ...(input.pinId ? { pinId: input.pinId.slice(0, 100) } : {}),
      ...(Array.isArray(input.tags) && input.tags.length
        ? { tags: input.tags.slice(0, 10).map((tag) => String(tag).slice(0, 40)) }
        : {}),
    },
  };
  return JSON.stringify(record, null, 2);
}

export interface KnowledgeBaseService {
  store: KnowledgeBaseStore;
  ensureDefaultKnowledgeBase(metabotSlug: string): Promise<KnowledgeBaseRecord>;
  learnKnowledgeBase(metabotSlug: string, knowledgeBaseId?: string, full?: boolean): Promise<KnowledgeBaseRecord>;
  queryKnowledgeBase(metabotSlug: string, query: string, options?: {
    knowledgeBaseId?: string;
    topK?: number;
    minScore?: number;
  }): Promise<KbQueryResult[]>;
  addDocument(metabotSlug: string, input: AddDocumentInput): Promise<{ knowledgeBase: KnowledgeBaseRecord; relPath: string }>;
  importFiles(metabotSlug: string, knowledgeBaseId: string | undefined, filePaths: string[]): Promise<number>;
}

export function createKnowledgeBaseService(paths: MetabotPaths): KnowledgeBaseService {
  const store = createKnowledgeBaseStore(paths);
  const learnQueues = new Map<string, Promise<unknown>>();
  // Index stores memoized per KB: the per-instance query cache (keyed by the
  // index file's mtime:size generation) then survives across calls and
  // self-invalidates when the file is rebuilt or deleted.
  const indexStores = new Map<string, ReturnType<typeof createKnowledgeBaseIndexStore>>();
  const indexFor = (kbId: string): ReturnType<typeof createKnowledgeBaseIndexStore> => {
    let index = indexStores.get(kbId);
    if (!index) {
      index = createKnowledgeBaseIndexStore(knowledgeBaseIndexPath(paths, kbId));
      indexStores.set(kbId, index);
    }
    return index;
  };

  function enqueueLearn(kbId: string, work: () => Promise<void>): Promise<void> {
    const next = (learnQueues.get(kbId) ?? Promise.resolve()).then(work, work);
    learnQueues.set(kbId, next.catch(() => undefined));
    return next;
  }

  async function requireKb(metabotSlug: string, id?: string): Promise<KnowledgeBaseRecord> {
    if (id) {
      const kb = await store.getKnowledgeBase(id);
      if (!kb || kb.metabotSlug !== metabotSlug) {
        throw new KnowledgeBaseServiceError('kb_not_found', `Knowledge base ${id} not found for ${metabotSlug}.`);
      }
      return kb;
    }
    return ensureDefaultKnowledgeBase(metabotSlug);
  }

  async function ensureDefaultKnowledgeBase(metabotSlug: string): Promise<KnowledgeBaseRecord> {
    const existing = await store.getDefaultKnowledgeBase(metabotSlug);
    if (existing) return existing;
    return store.createKnowledgeBase({ metabotSlug, name: 'Default' });
  }

  return {
    store,
    ensureDefaultKnowledgeBase,

    learnKnowledgeBase: async (metabotSlug, knowledgeBaseId, full) => {
      const kb = await requireKb(metabotSlug, knowledgeBaseId);
      let learnSummary: KnowledgeBaseRecord['learnSummary'];
      await enqueueLearn(kb.id, async () => {
        const index = indexFor(kb.id);
        // Incremental by default (unchanged docs reuse their stored chunks +
        // tokens); learn(full) forces a from-scratch rebuild — stale docs
        // always drop either way, since the walk is the source of truth.
        await fs.mkdir(kb.rawDir, { recursive: true });
        const stats = await index.rebuild(kb.rawDir, () => Date.now(), { full: full === true });
        await store.setCounts(kb.id, stats.docCount, stats.chunkCount, Date.now());
        learnSummary = { added: stats.added, updated: stats.updated, removed: stats.removed };
      });
      const updated = await store.getKnowledgeBase(kb.id);
      if (!updated) throw new KnowledgeBaseServiceError('kb_not_found', `Knowledge base ${kb.id} disappeared mid-learn.`);
      return learnSummary ? { ...updated, learnSummary } : updated;
    },

    queryKnowledgeBase: async (metabotSlug, query, options) => {
      const all = await store.listKnowledgeBases();
      const mine = all.filter((row) => row.metabotSlug === metabotSlug);
      const targets = options?.knowledgeBaseId
        ? mine.filter((row) => row.id === options.knowledgeBaseId)
        : mine;
      const results: KbQueryResult[] = [];
      for (const kb of targets) {
        const index = indexFor(kb.id);
        const hits = await index.query(query, {
          ...(options?.topK != null ? { topK: options.topK } : {}),
          ...(options?.minScore != null ? { minScore: options.minScore } : {}),
        });
        if (hits.length > 0) {
          results.push({ knowledgeBaseId: kb.id, knowledgeBaseName: kb.name, hits });
        }
      }
      return results;
    },

    addDocument: async (metabotSlug, input) => {
      const title = input.title.trim().slice(0, 200);
      const content = cleanKnowledgeBaseText(input.content).slice(0, 2_000_000);
      if (!title || !content) {
        throw new KnowledgeBaseServiceError('fields_required', 'title and content are required.');
      }
      const kb = await requireKb(metabotSlug, input.knowledgeBaseId);
      const fileName = slugifyKbFileName(title, content);
      const relPath = path.join('metabot-inbox', fileName);
      await fs.mkdir(path.join(kb.rawDir, 'metabot-inbox'), { recursive: true });
      await fs.writeFile(path.join(kb.rawDir, relPath), buildKbDocumentJson({ ...input, title, content }), 'utf8');
      // Best-effort chain-history cross-mark: a metaweb-sourced save marks the
      // pin's read record savedToKb. A marking failure must never fail the save.
      if (input.sourceType === 'metaweb' && typeof input.pinId === 'string' && input.pinId) {
        try {
          await createChainHistoryStore(paths).markReadSavedToKb(input.pinId, kb.id);
        } catch {
          // Marking is advisory; the document is already saved.
        }
      }
      return { knowledgeBase: kb, relPath };
    },

    importFiles: async (metabotSlug, knowledgeBaseId, filePaths) => {
      const kb = await requireKb(metabotSlug, knowledgeBaseId);
      let imported = 0;
      for (const filePath of filePaths) {
        const ext = path.extname(filePath).toLowerCase();
        if (!SUPPORTED_KB_EXTENSIONS.has(ext)) continue;
        const target = path.join(kb.rawDir, path.basename(filePath));
        try {
          await fs.copyFile(filePath, target);
          imported += 1;
        } catch {
          // Individual import failures never abort the batch.
        }
      }
      return imported;
    },
  };
}

export { extractKbDocTitle };
