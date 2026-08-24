/**
 * Knowledge base registry — per-bot document corpora. OAC port of the IDBots
 * knowledgeBaseStore, adapted to the storage layout v2 file conventions:
 *   registry:  <workspace>/memory/knowledge-bases.json
 *   raw docs:  <workspace>/memory/knowledge-bases/<kbId>/raw/**
 *   derived:   <runtime>/knowledge-bases/<kbId>/index.json
 * Derived data is rebuildable from the raw corpus at any time (learn --full).
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { MetabotPaths } from '../state/paths';

export interface KnowledgeBaseRecord {
  id: string;
  metabotSlug: string;
  name: string;
  description: string;
  rawDir: string;
  isDefault: boolean;
  autoLearn: boolean;
  docCount: number;
  chunkCount: number;
  lastLearnedAt: number | null;
  lastAutoLearnDate: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateKnowledgeBaseInput {
  metabotSlug: string;
  name: string;
  description?: string;
  isDefault?: boolean;
  autoLearn?: boolean;
  rawDir?: string;
}

export class KnowledgeBaseStoreError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'KnowledgeBaseStoreError';
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

async function writeJsonFileAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tmpPath, filePath);
}

export interface KnowledgeBaseStore {
  registryPath: string;
  listKnowledgeBases(): Promise<KnowledgeBaseRecord[]>;
  getKnowledgeBase(id: string): Promise<KnowledgeBaseRecord | null>;
  getDefaultKnowledgeBase(metabotSlug: string): Promise<KnowledgeBaseRecord | null>;
  createKnowledgeBase(input: CreateKnowledgeBaseInput): Promise<KnowledgeBaseRecord>;
  updateKnowledgeBase(id: string, patch: Partial<Pick<KnowledgeBaseRecord, 'name' | 'description' | 'autoLearn'>>): Promise<KnowledgeBaseRecord>;
  removeKnowledgeBase(id: string): Promise<boolean>;
  setCounts(id: string, docCount: number, chunkCount: number, learnedAt: number): Promise<void>;
  markAutoLearned(id: string, dateIso: string): Promise<void>;
  listDueForAutoLearn(now: Date): Promise<KnowledgeBaseRecord[]>;
}

function kbIdFor(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'default';
}

export function createKnowledgeBaseStore(paths: MetabotPaths): KnowledgeBaseStore {
  const registryPath = path.join(paths.workspaceRoot, 'memory', 'knowledge-bases.json');
  const rootDir = path.join(paths.workspaceRoot, 'memory', 'knowledge-bases');

  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };

  interface RegistryFile {
    seq: number;
    bases: KnowledgeBaseRecord[];
  }

  async function readRegistry(): Promise<RegistryFile> {
    const parsed = await readJsonFile<Partial<RegistryFile>>(registryPath);
    if (!parsed || typeof parsed !== 'object') return { seq: 0, bases: [] };
    return {
      seq: Number.isInteger(parsed.seq) && (parsed.seq as number) >= 0 ? (parsed.seq as number) : 0,
      bases: Array.isArray(parsed.bases)
        ? parsed.bases.filter((row) => row && typeof row === 'object' && typeof row.id === 'string')
        : [],
    };
  }

  async function writeRegistry(state: RegistryFile): Promise<void> {
    await writeJsonFileAtomic(registryPath, state);
  }

  function normalizeRecord(row: Partial<KnowledgeBaseRecord>): KnowledgeBaseRecord {
    return {
      id: String(row.id ?? ''),
      metabotSlug: String(row.metabotSlug ?? ''),
      name: String(row.name ?? ''),
      description: String(row.description ?? ''),
      rawDir: String(row.rawDir ?? ''),
      isDefault: row.isDefault === true,
      autoLearn: row.autoLearn !== false,
      docCount: Number(row.docCount) || 0,
      chunkCount: Number(row.chunkCount) || 0,
      lastLearnedAt: typeof row.lastLearnedAt === 'number' ? row.lastLearnedAt : null,
      lastAutoLearnDate: typeof row.lastAutoLearnDate === 'string' ? row.lastAutoLearnDate : null,
      createdAt: Number(row.createdAt) || Date.now(),
      updatedAt: Number(row.updatedAt) || Date.now(),
    };
  }

  return {
    registryPath,

    listKnowledgeBases: async () => {
      const state = await readRegistry();
      return state.bases.map(normalizeRecord).sort((left, right) => right.updatedAt - left.updatedAt);
    },

    getKnowledgeBase: async (id) => {
      const state = await readRegistry();
      const row = state.bases.find((entry) => entry.id === id);
      return row ? normalizeRecord(row) : null;
    },

    getDefaultKnowledgeBase: async (metabotSlug) => {
      const state = await readRegistry();
      const row = state.bases.find((entry) => entry.metabotSlug === metabotSlug && entry.isDefault)
        ?? state.bases.find((entry) => entry.metabotSlug === metabotSlug);
      return row ? normalizeRecord(row) : null;
    },

    createKnowledgeBase: (input) => enqueue(async () => {
      const state = await readRegistry();
      const name = input.name.trim();
      if (!name) throw new KnowledgeBaseStoreError('name_required', 'Knowledge base name is required.');
      let id = kbIdFor(name);
      if (state.bases.some((entry) => entry.id === id && entry.metabotSlug === input.metabotSlug)) {
        id = `${id}-${Date.now().toString(36).slice(-4)}`;
      }
      // First KB of a bot becomes its default automatically.
      const isDefault = input.isDefault
        || !state.bases.some((entry) => entry.metabotSlug === input.metabotSlug);
      const now = Date.now();
      const record: KnowledgeBaseRecord = {
        id,
        metabotSlug: input.metabotSlug,
        name,
        description: (input.description ?? '').trim(),
        rawDir: input.rawDir?.trim() || path.join(rootDir, id, 'raw'),
        isDefault,
        autoLearn: input.autoLearn ?? true,
        docCount: 0,
        chunkCount: 0,
        lastLearnedAt: null,
        lastAutoLearnDate: null,
        createdAt: now,
        updatedAt: now,
      };
      await fs.mkdir(record.rawDir, { recursive: true });
      state.seq += 1;
      state.bases.push(record);
      await writeRegistry(state);
      return record;
    }),

    updateKnowledgeBase: (id, patch) => enqueue(async () => {
      const state = await readRegistry();
      const row = state.bases.find((entry) => entry.id === id);
      if (!row) throw new KnowledgeBaseStoreError('not_found', `Knowledge base ${id} not found.`);
      if (patch.name != null && patch.name.trim()) row.name = patch.name.trim();
      if (patch.description != null) row.description = patch.description.trim();
      if (patch.autoLearn != null) row.autoLearn = patch.autoLearn;
      row.updatedAt = Date.now();
      await writeRegistry(state);
      return normalizeRecord(row);
    }),

    removeKnowledgeBase: (id) => enqueue(async () => {
      const state = await readRegistry();
      const before = state.bases.length;
      const target = state.bases.find((entry) => entry.id === id);
      state.bases = state.bases.filter((entry) => entry.id !== id);
      if (state.bases.length === before) return false;
      await writeRegistry(state);
      // Prune the raw corpus so a same-named KB cannot resurrect old documents.
      if (target?.rawDir) {
        await fs.rm(target.rawDir, { recursive: true, force: true }).catch(() => undefined);
      }
      return true;
    }),

    setCounts: (id, docCount, chunkCount, learnedAt) => enqueue(async () => {
      const state = await readRegistry();
      const row = state.bases.find((entry) => entry.id === id);
      if (!row) return;
      row.docCount = docCount;
      row.chunkCount = chunkCount;
      row.lastLearnedAt = learnedAt;
      row.updatedAt = Date.now();
      await writeRegistry(state);
    }),

    markAutoLearned: (id, dateIso) => enqueue(async () => {
      const state = await readRegistry();
      const row = state.bases.find((entry) => entry.id === id);
      if (!row) return;
      row.lastAutoLearnDate = dateIso;
      row.updatedAt = Date.now();
      await writeRegistry(state);
    }),

    listDueForAutoLearn: async (now) => {
      const state = await readRegistry();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const hour = now.getHours();
      return state.bases
        .map(normalizeRecord)
        .filter((row) => row.autoLearn
          && row.lastAutoLearnDate !== today
          && hour >= 0 && hour < 6);
    },
  };
}

/** Resolve the derived index path for one KB (runtime layer, rebuildable). */
export function knowledgeBaseIndexPath(paths: MetabotPaths, kbId: string): string {
  return path.join(paths.runtimeRoot, 'knowledge-bases', kbId, 'index.json');
}
