// File-backed scoped memory store, ported from the IDBots user_memories /
// user_memory_sources SQL logic in src/main/coworkStore.ts. One JSON file per
// MetaBot profile (`.runtime/memory/memories.json`); all writes are atomic
// (write-then-rename) and serialized within the process.
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { MetabotPaths } from '../state/paths';
import {
  createOwnerMemoryScope,
  normalizeMemoryScopeSelector,
  parseContactScopeKey,
  type MemoryOrigin,
  type MemoryScope,
  type MemoryScopeKind,
  type MemoryUsageClass,
  type MemoryVisibility,
} from './memoryScope';
import {
  buildMemoryFingerprint,
  choosePreferredMemoryText,
  maxMemoryTextChars,
  MEMORY_NEAR_DUPLICATE_MIN_SCORE,
  normalizeMemoryMatchKey,
  normalizeMemoryOrigin,
  normalizeMemorySemanticKey,
  normalizeMemoryText,
  normalizeMemoryUsageClass,
  normalizeMemoryVisibility,
  resolveMemoryClassification,
  scoreMemorySimilarity,
  truncateMemoryText,
} from './memoryText';
import type {
  MemoryCreateInput,
  MemoryDeleteInput,
  MemoryEntry,
  MemoryEntrySource,
  MemoryEntrySourceInput,
  MemoryEntryStats,
  MemoryEntryStatus,
  MemoryListOptions,
  MemoryScopesOverview,
  MemoryScopeSelectorInput,
  MemoryScopeSummary,
  MemoryUpdateInput,
} from './memoryTypes';

const TRANSIENT_JSON_READ_RETRIES = 5;
const TRANSIENT_JSON_READ_DELAY_MS = 10;
const NEAR_DUPLICATE_SCAN_LIMIT = 200;
const LIST_MAX_LIMIT = 200;

let atomicWriteSequence = 0;

interface MemoriesFile {
  version: number;
  entries: MemoryEntry[];
}

function cloneEmptyFile(): MemoriesFile {
  return { version: 1, entries: [] };
}

function normalizeFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeOptionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeScopeKind(value: unknown): MemoryScopeKind {
  return value === 'contact' || value === 'conversation' ? value : 'owner';
}

function normalizeStatus(value: unknown): MemoryEntryStatus {
  return value === 'stale' || value === 'deleted' ? value : 'created';
}

function normalizeSource(value: unknown): MemoryEntrySource | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = normalizeOptionalText(record.id);
  if (!id) return null;
  const role = record.role;
  return {
    id,
    sessionId: normalizeOptionalText(record.sessionId),
    messageId: normalizeOptionalText(record.messageId),
    role: role === 'user' || role === 'assistant' || role === 'tool' ? role : 'system',
    sourceChannel: normalizeOptionalText(record.sourceChannel),
    sourceType: normalizeOptionalText(record.sourceType),
    externalConversationId: normalizeOptionalText(record.externalConversationId),
    sourceId: normalizeOptionalText(record.sourceId),
    dreamDate: normalizeOptionalText(record.dreamDate),
    isActive: record.isActive !== false,
    createdAt: normalizeFiniteNumber(record.createdAt, 0),
  };
}

function normalizeEntry(value: unknown): MemoryEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = normalizeOptionalText(record.id);
  const text = typeof record.text === 'string' ? record.text : '';
  if (!id || !normalizeMemoryText(text)) return null;
  const createdAt = normalizeFiniteNumber(record.createdAt, 0);
  return {
    id,
    text,
    fingerprint: normalizeOptionalText(record.fingerprint) ?? buildMemoryFingerprint(text),
    confidence: Math.max(0, Math.min(1, normalizeFiniteNumber(record.confidence, 0.75))),
    isExplicit: record.isExplicit === true,
    status: normalizeStatus(record.status),
    scopeKind: normalizeScopeKind(record.scopeKind),
    scopeKey: normalizeOptionalText(record.scopeKey) ?? createOwnerMemoryScope().key,
    usageClass: normalizeMemoryUsageClass(record.usageClass as string | undefined),
    visibility: normalizeMemoryVisibility(record.visibility as string | undefined),
    origin: normalizeMemoryOrigin(record.origin as string | undefined),
    sources: Array.isArray(record.sources)
      ? record.sources.map(normalizeSource).filter((source): source is MemoryEntrySource => source !== null)
      : [],
    createdAt,
    updatedAt: normalizeFiniteNumber(record.updatedAt, createdAt),
    lastUsedAt: normalizeFiniteNumber(record.lastUsedAt, Number.NaN) || null,
    archivedAt: normalizeOptionalText(record.archivedAt),
  };
}

function normalizeFile(value: unknown): MemoriesFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return cloneEmptyFile();
  const record = value as Record<string, unknown>;
  const entries = Array.isArray(record.entries)
    ? record.entries.map(normalizeEntry).filter((entry): entry is MemoryEntry => entry !== null)
    : [];
  return { version: 1, entries };
}

function resolveSelector(input: MemoryScopeSelectorInput): MemoryScope {
  return normalizeMemoryScopeSelector(input) ?? createOwnerMemoryScope();
}

function buildSource(input: MemoryEntrySourceInput | undefined, now: number): MemoryEntrySource | null {
  if (!input) return null;
  return {
    id: `src_${crypto.randomUUID()}`,
    sessionId: input.sessionId?.trim() || null,
    messageId: input.messageId?.trim() || null,
    role: input.role ?? 'system',
    sourceChannel: input.sourceChannel?.trim() || null,
    sourceType: input.sourceType?.trim() || null,
    externalConversationId: input.externalConversationId?.trim() || null,
    sourceId: (input.sourceId?.trim() || input.messageId?.trim()) || null,
    dreamDate: input.dreamDate?.trim() || null,
    isActive: true,
    createdAt: now,
  };
}

export interface MemoryWriteResult {
  memory: MemoryEntry;
  created: boolean;
  updated: boolean;
}

export interface MemoryStore {
  list(options?: MemoryListOptions): Promise<MemoryEntry[]>;
  create(input: MemoryCreateInput): Promise<MemoryEntry>;
  createOrRevive(input: MemoryCreateInput): Promise<MemoryWriteResult>;
  update(input: MemoryUpdateInput): Promise<MemoryEntry | null>;
  remove(input: MemoryDeleteInput): Promise<boolean>;
  /** Dream pipeline: replace one day's dream batch (self_identity excluded). */
  softDeleteDreamMemoriesForDate(dreamDate: string): Promise<number>;
  /** Hygiene: soft-archive specific memories by id (deep-consolidation retire).
   * self_identity is always refused; `notUsedSince` guards against the LLM
   * await window — rows touched after that snapshot survive. */
  archiveMemories(input: { ids: string[]; archivedAt: string; notUsedSince?: number }): Promise<number>;
  /** Hygiene reverse: clear the soft-archive mark on specific memories. */
  unarchiveMemories(ids: string[]): Promise<number>;
  /** Hygiene decay: dream-origin rows untouched past the cutoff get the mark
   * (self_identity and conversation-origin rows are never auto-archived). */
  archiveDecayedDreamMemories(input: { cutoffMs: number; archivedAt: string }): Promise<number>;
  /** Hygiene purge: physically remove `status='deleted'` tombstones past the
   * grace period — the one low-risk delete in the memory layer. */
  purgeDeletedMemoryTombstones(cutoffMs: number): Promise<number>;
  /** Append one provenance source to an existing entry (no field changes). */
  addSource(id: string, scope: MemoryScope, source: MemoryEntrySourceInput): Promise<boolean>;
  /** Startup repair: revive the newest deleted self_identity when none is live. */
  restoreMissingSelfIdentity(): Promise<boolean>;
  markMemorySourcesInactiveBySession(sessionId: string): Promise<void>;
  markOrphanImplicitMemoriesStale(selector?: MemoryScopeSelectorInput): Promise<void>;
  stats(selector?: MemoryScopeSelectorInput): Promise<MemoryEntryStats>;
  listScopes(): Promise<MemoryScopesOverview>;
}

export function createMemoryStore(paths: MetabotPaths): MemoryStore {
  const filePath = paths.memoryMemoriesPath;
  let writeQueue: Promise<unknown> = Promise.resolve();

  async function readFile(): Promise<MemoriesFile> {
    for (let attempt = 0; attempt <= TRANSIENT_JSON_READ_RETRIES; attempt += 1) {
      try {
        const raw = await fs.readFile(filePath, 'utf8');
        return normalizeFile(JSON.parse(raw));
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          return cloneEmptyFile();
        }
        if (error instanceof SyntaxError && attempt < TRANSIENT_JSON_READ_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, TRANSIENT_JSON_READ_DELAY_MS));
          continue;
        }
        throw error;
      }
    }
    return cloneEmptyFile();
  }

  async function writeFile(next: MemoriesFile): Promise<void> {
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

  /** Serialize read-modify-write cycles inside this process. */
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = writeQueue.then(task, task);
    writeQueue = run.catch(() => undefined);
    return run;
  }

  function addSource(entry: MemoryEntry, input: MemoryEntrySourceInput | undefined, now: number): void {
    const source = buildSource(input, now);
    if (source) {
      entry.sources.push(source);
    }
  }

  function findMergeCandidate(
    file: MemoriesFile,
    scope: MemoryScope,
    fingerprint: string,
    normalizedText: string,
  ): MemoryEntry | null {
    const inScope = file.entries.filter((entry) => (
      entry.status !== 'deleted' && entry.scopeKind === scope.kind && entry.scopeKey === scope.key
    ));
    const exact = inScope
      .filter((entry) => entry.fingerprint === fingerprint)
      .sort((left, right) => right.updatedAt - left.updatedAt)[0];
    if (exact) return exact;

    const incomingSemanticKey = normalizeMemorySemanticKey(normalizedText);
    if (!incomingSemanticKey) return null;
    let bestCandidate: MemoryEntry | null = null;
    let bestScore = 0;
    const candidates = [...inScope]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, NEAR_DUPLICATE_SCAN_LIMIT);
    for (const candidate of candidates) {
      const candidateSemanticKey = normalizeMemorySemanticKey(candidate.text);
      if (!candidateSemanticKey) continue;
      const score = scoreMemorySimilarity(candidateSemanticKey, incomingSemanticKey);
      if (score <= bestScore) continue;
      bestScore = score;
      bestCandidate = candidate;
    }
    return bestCandidate && bestScore >= MEMORY_NEAR_DUPLICATE_MIN_SCORE ? bestCandidate : null;
  }

  function createOrReviveInFile(file: MemoriesFile, input: MemoryCreateInput): MemoryWriteResult {
    const normalizedText = truncateMemoryText(
      normalizeMemoryText(input.text),
      maxMemoryTextChars(input.usageClass),
    );
    if (!normalizedText) {
      throw new Error('Memory text is required');
    }

    const now = Date.now();
    const fingerprint = buildMemoryFingerprint(normalizedText);
    const confidence = Math.max(0, Math.min(1, Number.isFinite(input.confidence) ? Number(input.confidence) : 0.75));
    const explicitFlag = Boolean(input.isExplicit);
    const scope = resolveSelector(input);
    const classification = resolveMemoryClassification(normalizedText, scope, {
      usageClass: input.usageClass ?? null,
      visibility: input.visibility ?? null,
    });

    const existing = input.forceNew
      ? null
      : findMergeCandidate(file, scope, fingerprint, normalizedText);

    if (existing) {
      const mergedText = choosePreferredMemoryText(existing.text, normalizedText);
      existing.text = mergedText;
      existing.fingerprint = buildMemoryFingerprint(mergedText);
      existing.confidence = Math.max(existing.confidence || 0, confidence);
      existing.isExplicit = existing.isExplicit || explicitFlag;
      existing.status = 'created';
      const mergedClassification = resolveMemoryClassification(mergedText, scope, {
        usageClass: input.usageClass ?? existing.usageClass,
        visibility: input.visibility ?? existing.visibility,
      });
      existing.usageClass = mergedClassification.usageClass;
      existing.visibility = mergedClassification.visibility;
      existing.updatedAt = now;
      addSource(existing, input.source, now);
      return { memory: existing, created: false, updated: true };
    }

    const entry: MemoryEntry = {
      id: `mem_${crypto.randomUUID()}`,
      text: normalizedText,
      fingerprint,
      confidence,
      isExplicit: explicitFlag,
      status: 'created',
      scopeKind: scope.kind,
      scopeKey: scope.key,
      usageClass: classification.usageClass,
      visibility: classification.visibility,
      origin: normalizeMemoryOrigin(input.origin),
      sources: [],
      createdAt: now,
      updatedAt: now,
      lastUsedAt: null,
      archivedAt: null,
    };
    addSource(entry, input.source, now);
    file.entries.push(entry);
    return { memory: entry, created: true, updated: false };
  }

  function findScopedEntry(file: MemoriesFile, id: string, scope: MemoryScope): MemoryEntry | null {
    return file.entries.find((entry) => (
      entry.id === id && entry.scopeKind === scope.kind && entry.scopeKey === scope.key
    )) ?? null;
  }

  return {
    async list(options = {}) {
      const scope = resolveSelector(options);
      const query = normalizeMemoryText(options.query || '').toLowerCase();
      const includeDeleted = Boolean(options.includeDeleted);
      const status = options.status || 'all';
      const limit = Math.max(1, Math.min(LIST_MAX_LIMIT, Math.floor(options.limit ?? LIST_MAX_LIMIT)));
      const offset = Math.max(0, Math.floor(options.offset ?? 0));

      const file = await readFile();
      const filtered = file.entries.filter((entry) => {
        if (entry.scopeKind !== scope.kind || entry.scopeKey !== scope.key) return false;
        if (!includeDeleted && status === 'all' && entry.status === 'deleted') return false;
        if (status !== 'all' && entry.status !== status) return false;
        // Hygiene-archived rows leave injection and default listings; admin/UI
        // surfaces opt back in with includeArchived.
        if (!options.includeArchived && entry.archivedAt != null) return false;
        if (query && !entry.text.toLowerCase().includes(query)) return false;
        if (options.usageClass && entry.usageClass !== normalizeMemoryUsageClass(options.usageClass)) return false;
        if (options.origin && entry.origin !== normalizeMemoryOrigin(options.origin)) return false;
        return true;
      });
      filtered.sort((left, right) => right.updatedAt - left.updatedAt);
      const page = filtered.slice(offset, offset + limit);

      if (options.touchLastUsed && page.length > 0) {
        const ids = new Set(page.map((entry) => entry.id));
        const now = Date.now();
        await enqueue(async () => {
          const current = await readFile();
          let touched = false;
          for (const entry of current.entries) {
            if (ids.has(entry.id)) {
              entry.lastUsedAt = now;
              touched = true;
            }
          }
          if (touched) await writeFile(current);
        });
      }
      return page;
    },

    async createOrRevive(input) {
      return enqueue(async () => {
        const file = await readFile();
        const result = createOrReviveInFile(file, input);
        await writeFile(file);
        return result;
      });
    },

    async create(input) {
      const result = await this.createOrRevive(input);
      return result.memory;
    },

    async update(input) {
      return enqueue(async () => {
        const file = await readFile();
        const scope = resolveSelector(input);
        const current = findScopedEntry(file, input.id, scope);
        if (!current) return null;
        // self_identity entries belong to the dream service; refuse edits from
        // tools, IPC and implicit pipelines unless explicitly allowed internally.
        if (current.usageClass === 'self_identity' && !input.allowProtected) {
          return null;
        }

        const now = Date.now();
        const nextText = input.text !== undefined
          ? truncateMemoryText(normalizeMemoryText(input.text), maxMemoryTextChars(input.usageClass ?? current.usageClass))
          : current.text;
        if (!nextText) {
          throw new Error('Memory text is required');
        }
        current.text = nextText;
        current.fingerprint = buildMemoryFingerprint(nextText);
        current.confidence = input.confidence !== undefined
          ? Math.max(0, Math.min(1, Number(input.confidence)))
          : current.confidence;
        current.status = input.status && (input.status === 'created' || input.status === 'stale' || input.status === 'deleted')
          ? input.status
          : current.status;
        current.isExplicit = input.isExplicit !== undefined ? Boolean(input.isExplicit) : current.isExplicit;
        const nextClassification = resolveMemoryClassification(nextText, scope, {
          usageClass: input.usageClass ?? current.usageClass,
          visibility: input.visibility ?? current.visibility,
        });
        current.usageClass = nextClassification.usageClass;
        current.visibility = nextClassification.visibility;
        current.updatedAt = now;
        addSource(current, input.source, now);
        await writeFile(file);
        return current;
      });
    },

    async remove(input) {
      return enqueue(async () => {
        const file = await readFile();
        const scope = resolveSelector(input);
        const target = findScopedEntry(file, input.id, scope);
        if (!target) return false;
        // self_identity entries belong to the dream service; refuse deletion
        // from tools, IPC and implicit pipelines unless explicitly allowed.
        if (target.usageClass === 'self_identity' && !input.allowProtected) {
          return false;
        }
        const now = Date.now();
        target.status = 'deleted';
        target.updatedAt = now;
        for (const source of target.sources) {
          source.isActive = false;
        }
        await writeFile(file);
        return true;
      });
    },

    async softDeleteDreamMemoriesForDate(dreamDate) {
      const date = dreamDate.trim();
      if (!date) return 0;
      return enqueue(async () => {
        const file = await readFile();
        const now = Date.now();
        let count = 0;
        for (const entry of file.entries) {
          if (entry.origin !== 'dream' || entry.status === 'deleted') continue;
          if (entry.usageClass !== 'profile_fact'
            && entry.usageClass !== 'value_boundary'
            && entry.usageClass !== 'work_review') continue;
          if (!entry.sources.some((source) => source.dreamDate === date)) continue;
          entry.status = 'deleted';
          entry.updatedAt = now;
          for (const source of entry.sources) {
            source.isActive = false;
          }
          count += 1;
        }
        if (count > 0) await writeFile(file);
        return count;
      });
    },

    async restoreMissingSelfIdentity() {
      return enqueue(async () => {
        const file = await readFile();
        const hasLive = file.entries.some((entry) => (
          entry.usageClass === 'self_identity' && entry.status !== 'deleted'
        ));
        if (hasLive) return false;
        const deleted = file.entries
          .filter((entry) => entry.usageClass === 'self_identity' && entry.status === 'deleted')
          .sort((left, right) => right.createdAt - left.createdAt)[0];
        if (!deleted) return false;
        deleted.status = 'created';
        deleted.updatedAt = Date.now();
        const newestSource = [...deleted.sources].sort((left, right) => right.createdAt - left.createdAt)[0];
        if (newestSource) newestSource.isActive = true;
        await writeFile(file);
        return true;
      });
    },

    async archiveMemories(input) {
      const ids = new Set(input.ids.map((id) => id.trim()).filter(Boolean));
      if (ids.size === 0) return 0;
      return enqueue(async () => {
        const file = await readFile();
        const now = Date.now();
        let archived = 0;
        for (const entry of file.entries) {
          if (!ids.has(entry.id)) continue;
          if (entry.archivedAt != null) continue;
          if (entry.usageClass === 'self_identity' || entry.status !== 'created') continue;
          // The LLM call had an await window: anything edited or injection-
          // touched (lastUsedAt/updatedAt bumped) since the inventory snapshot
          // must survive the proposal.
          if (input.notUsedSince != null && (entry.lastUsedAt ?? entry.updatedAt) > input.notUsedSince) continue;
          entry.archivedAt = input.archivedAt;
          entry.updatedAt = now;
          archived += 1;
        }
        if (archived > 0) await writeFile(file);
        return archived;
      });
    },

    async unarchiveMemories(ids) {
      const idSet = new Set(ids.map((id) => id.trim()).filter(Boolean));
      if (idSet.size === 0) return 0;
      return enqueue(async () => {
        const file = await readFile();
        let restored = 0;
        for (const entry of file.entries) {
          if (!idSet.has(entry.id) || entry.archivedAt == null) continue;
          entry.archivedAt = null;
          entry.updatedAt = Date.now();
          restored += 1;
        }
        if (restored > 0) await writeFile(file);
        return restored;
      });
    },

    async archiveDecayedDreamMemories(input) {
      const cutoff = Math.floor(input.cutoffMs);
      return enqueue(async () => {
        const file = await readFile();
        let archived = 0;
        for (const entry of file.entries) {
          if (entry.archivedAt != null) continue;
          if (entry.status !== 'created' || entry.origin !== 'dream') continue;
          if (entry.usageClass === 'self_identity') continue;
          if ((entry.lastUsedAt ?? entry.updatedAt) >= cutoff) continue;
          entry.archivedAt = input.archivedAt;
          entry.updatedAt = Date.now();
          archived += 1;
        }
        if (archived > 0) await writeFile(file);
        return archived;
      });
    },

    async purgeDeletedMemoryTombstones(cutoffMs) {
      const cutoff = Math.floor(cutoffMs);
      return enqueue(async () => {
        const file = await readFile();
        const before = file.entries.length;
        file.entries = file.entries.filter((entry) => (
          entry.status !== 'deleted' || entry.updatedAt >= cutoff
        ));
        const purged = before - file.entries.length;
        if (purged > 0) await writeFile(file);
        return purged;
      });
    },

    async addSource(id, scope, sourceInput) {
      return enqueue(async () => {
        const file = await readFile();
        const target = findScopedEntry(file, id, scope);
        if (!target) return false;
        addSource(target, sourceInput, Date.now());
        await writeFile(file);
        return true;
      });
    },

    async markMemorySourcesInactiveBySession(sessionId) {
      const session = sessionId.trim();
      if (!session) return;
      await enqueue(async () => {
        const file = await readFile();
        let changed = false;
        for (const entry of file.entries) {
          for (const source of entry.sources) {
            if (source.sessionId === session && source.isActive) {
              source.isActive = false;
              changed = true;
            }
          }
        }
        if (changed) await writeFile(file);
      });
    },

    async markOrphanImplicitMemoriesStale(selector) {
      const scope = resolveSelector(selector ?? {});
      await enqueue(async () => {
        const file = await readFile();
        const now = Date.now();
        let changed = false;
        for (const entry of file.entries) {
          if (entry.scopeKind !== scope.kind || entry.scopeKey !== scope.key) continue;
          if (entry.isExplicit || entry.status !== 'created') continue;
          if (entry.sources.some((source) => source.isActive)) continue;
          entry.status = 'stale';
          entry.updatedAt = now;
          changed = true;
        }
        if (changed) await writeFile(file);
      });
    },

    async stats(selector) {
      const scope = resolveSelector(selector ?? {});
      const file = await readFile();
      const stats: MemoryEntryStats = {
        total: 0,
        created: 0,
        stale: 0,
        deleted: 0,
        explicit: 0,
        implicit: 0,
      };
      for (const entry of file.entries) {
        if (entry.scopeKind !== scope.kind || entry.scopeKey !== scope.key) continue;
        stats.total += 1;
        stats[entry.status] += 1;
        if (entry.isExplicit) stats.explicit += 1;
        else stats.implicit += 1;
      }
      return stats;
    },

    async listScopes() {
      const file = await readFile();
      const summaries = new Map<string, MemoryScopeSummary>();
      for (const entry of file.entries) {
        if (entry.status === 'deleted') continue;
        const mapKey = `${entry.scopeKind}|${entry.scopeKey}`;
        const existing = summaries.get(mapKey);
        if (existing) {
          existing.count += 1;
          continue;
        }
        const summary: MemoryScopeSummary = {
          kind: entry.scopeKind,
          key: entry.scopeKey,
          count: 1,
        };
        if (entry.scopeKind === 'contact') {
          summary.peerGlobalMetaId = parseContactScopeKey(entry.scopeKey)?.peerGlobalMetaId ?? null;
        }
        summaries.set(mapKey, summary);
      }
      const overview: MemoryScopesOverview = {
        owner: null,
        contacts: [],
        conversations: [],
      };
      for (const summary of summaries.values()) {
        if (summary.kind === 'owner') {
          overview.owner = overview.owner && overview.owner.count >= summary.count ? overview.owner : summary;
        } else if (summary.kind === 'contact') {
          overview.contacts.push(summary);
        } else {
          overview.conversations.push(summary);
        }
      }
      overview.contacts.sort((left, right) => right.count - left.count);
      overview.conversations.sort((left, right) => right.count - left.count);
      return overview;
    },
  };
}
