// L3b capability drafts (`.runtime/memory/capability-drafts.json`) — the
// file-port counterpart of IDBots' `capability_drafts` table (SDD §4.1).
// Every dream may distill up to MAX_CAPABILITY_LEARNINGS reusable
// skill/workflow/tool-pattern candidates; each lands here as an append-only
// status 'draft' row. Promotion into real skills is a later phase and nothing
// in this store ever touches the skill tables. Re-dreams append rather than
// replace (IDBots semantics — drafts carry no per-date batch contract).
// Writes follow the store conventions: atomic write-then-rename, serialized
// through the per-store write queue.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import type { MetabotPaths } from '../state/paths';

export interface CapabilityDraft {
  id: string;
  /** YYYY-MM-DD of the dream that distilled this candidate. */
  dreamDate: string;
  title: string;
  description: string;
  capabilityType: 'skill' | 'workflow' | 'tool_pattern';
  sourceSessionIds: string[];
  status: 'draft';
  createdAt: number;
}

interface CapabilityDraftsFile {
  version: 1;
  drafts: CapabilityDraft[];
}

let atomicWriteSequence = 0;

function normalizeDraft(value: unknown): CapabilityDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.title !== 'string' || !record.title.trim()) return null;
  if (typeof record.description !== 'string' || !record.description.trim()) return null;
  const rawType = typeof record.capabilityType === 'string' ? record.capabilityType.trim() : '';
  const capabilityType: CapabilityDraft['capabilityType'] = rawType === 'workflow'
    ? 'workflow'
    : rawType === 'tool_pattern'
      ? 'tool_pattern'
      : 'skill';
  return {
    id: typeof record.id === 'string' && record.id ? record.id : `cap_${randomUUID()}`,
    dreamDate: typeof record.dreamDate === 'string' && record.dreamDate ? record.dreamDate : '',
    title: record.title.trim(),
    description: record.description.trim(),
    capabilityType,
    sourceSessionIds: Array.isArray(record.sourceSessionIds)
      ? [...new Set(record.sourceSessionIds
        .filter((id): id is string => typeof id === 'string')
        .map((id) => id.trim())
        .filter(Boolean))]
      : [],
    status: 'draft',
    createdAt: typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
      ? record.createdAt
      : 0,
  };
}

function normalizeFile(value: unknown): CapabilityDraftsFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { version: 1, drafts: [] };
  }
  const record = value as Record<string, unknown>;
  const drafts = Array.isArray(record.drafts)
    ? record.drafts
      .map((entry) => normalizeDraft(entry))
      .filter((entry): entry is CapabilityDraft => entry !== null)
    : [];
  return { version: 1, drafts };
}

export interface CapabilityStore {
  /** Append dream-distilled candidates for one date; returns rows inserted. */
  insertDrafts(date: string, learnings: Array<{
    title?: string | null;
    description?: string | null;
    capabilityType?: string | null;
    sourceSessionIds?: string[];
  }>): Promise<number>;
  /** Read drafts, newest first. */
  listDrafts(options?: { limit?: number }): Promise<CapabilityDraft[]>;
}

export function createCapabilityStore(paths: MetabotPaths): CapabilityStore {
  const filePath = paths.memoryCapabilityDraftsPath;
  let writeQueue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = writeQueue.then(task, task);
    writeQueue = run.catch(() => undefined);
    return run;
  }

  async function readFile(): Promise<CapabilityDraftsFile> {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return normalizeFile(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { version: 1, drafts: [] };
      }
      throw error;
    }
  }

  async function writeFile(next: CapabilityDraftsFile): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    atomicWriteSequence += 1;
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${atomicWriteSequence}.tmp`;
    try {
      await fs.writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
      await fs.rename(tempPath, filePath);
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  return {
    async insertDrafts(date, learnings) {
      const now = Date.now();
      const additions: CapabilityDraft[] = [];
      for (const learning of Array.isArray(learnings) ? learnings : []) {
        const draft = normalizeDraft({
          title: learning?.title,
          description: learning?.description,
          capabilityType: learning?.capabilityType,
          sourceSessionIds: learning?.sourceSessionIds,
        });
        if (!draft) continue;
        additions.push({ ...draft, dreamDate: date, status: 'draft', createdAt: now });
      }
      if (additions.length > 0) {
        await enqueue(async () => {
          const file = await readFile();
          file.drafts.push(...additions);
          await writeFile(file);
        });
      }
      return additions.length;
    },

    async listDrafts(options = {}) {
      const limit = typeof options.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0
        ? Math.floor(options.limit)
        : null;
      const drafts = (await readFile()).drafts
        .sort((left, right) => right.createdAt - left.createdAt);
      return limit !== null ? drafts.slice(0, limit) : drafts;
    },
  };
}
