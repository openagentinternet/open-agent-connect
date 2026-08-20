// Knowledge-point anchored memory ("经验/知识点"), ported from IDBots
// src/main/metaidKnowledgeStore.ts onto `.runtime/memory/knowledge.json`.
// Entries are upserted by topic fingerprint: rewriting an existing topic
// bumps its version and records the prior text as a revision. Writes come
// from the nightly dream consolidation (origin='dream') and from the bot at
// runtime via the knowledge_upsert tool (origin='agent').
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { MetabotPaths } from '../state/paths';

export const KNOWLEDGE_KINDS = ['know_how', 'pitfall', 'principle'] as const;
export type KnowledgeKind = typeof KNOWLEDGE_KINDS[number];

export const KNOWLEDGE_ORIGINS = ['agent', 'dream', 'user'] as const;
export type KnowledgeOrigin = typeof KNOWLEDGE_ORIGINS[number];

export type KnowledgeStatus = 'active' | 'superseded' | 'archived';

export interface KnowledgeSource {
  id: string;
  episodeId: string | null;
  evidenceId: string | null;
  sessionId: string | null;
  sourceChannel: string | null;
  relevance: string | null;
  createdAt: number;
}

export interface KnowledgeRevision {
  id: string;
  version: number;
  summary: string;
  kind: KnowledgeKind;
  origin: KnowledgeOrigin;
  sourceDreamDate: string | null;
  createdAt: number;
}

export interface KnowledgeEntry {
  id: string;
  topic: string;
  topicFingerprint: string;
  summary: string;
  kind: KnowledgeKind;
  category: string | null;
  tags: string[];
  confidence: number;
  status: KnowledgeStatus;
  origin: KnowledgeOrigin;
  sourceDreamDate: string | null;
  version: number;
  sources: KnowledgeSource[];
  revisions: KnowledgeRevision[];
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
}

export interface KnowledgeSourceInput {
  episodeId?: string | null;
  evidenceId?: string | null;
  sessionId?: string | null;
  sourceChannel?: string | null;
  relevance?: string | null;
}

export interface UpsertKnowledgeInput {
  id?: string;
  topic: string;
  summary: string;
  kind?: KnowledgeKind;
  category?: string | null;
  tags?: string[];
  confidence?: number;
  origin?: KnowledgeOrigin;
  sourceDreamDate?: string | null;
  /** Matching key override; derived from the topic when omitted. */
  topicFingerprint?: string;
  /** Pointers back into the shared fact source (no raw text duplicated). */
  sources?: KnowledgeSourceInput[];
}

export interface UpsertKnowledgeResult {
  entry: KnowledgeEntry;
  /** True when a brand-new entry was inserted. */
  created: boolean;
  /** True when an existing topic was revised (version bumped). */
  revised: boolean;
}

export interface ListKnowledgeOptions {
  kind?: KnowledgeKind;
  category?: string;
  status?: KnowledgeStatus | 'all';
  query?: string;
  limit?: number;
  offset?: number;
  /** Bump lastUsedAt on returned entries (recall reuse signal). */
  touchLastUsed?: boolean;
}

/** Compact active-set view handed to the dream prompt for create-vs-revise. */
export interface DreamKnowledgeView {
  id: string;
  topic: string;
  summary: string;
  kind: KnowledgeKind;
  category: string | null;
  version: number;
}

interface KnowledgeFile {
  version: number;
  entries: KnowledgeEntry[];
}

const MAX_TOPIC = 300;
const MAX_SUMMARY = 4_000;
const MAX_CATEGORY = 120;
const MAX_RELEVANCE = 500;
const MAX_TAGS = 12;
const MAX_TAG_LEN = 80;
const MAX_SOURCES = 50;

let atomicWriteSequence = 0;

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function boundedRequiredText(value: unknown, label: string, maxLength: number): string {
  const result = asText(value);
  if (!result) throw new Error(`${label} is required`);
  if (result.length > maxLength) throw new Error(`${label} exceeds ${maxLength} characters`);
  return result;
}

function boundedOptionalText(value: unknown, label: string, maxLength: number): string | null {
  const result = asText(value);
  if (!result) return null;
  if (result.length > maxLength) throw new Error(`${label} exceeds ${maxLength} characters`);
  return result;
}

function normalizeKind(value: unknown): KnowledgeKind {
  return (KNOWLEDGE_KINDS as readonly string[]).includes(String(value)) ? value as KnowledgeKind : 'know_how';
}

function normalizeOrigin(value: unknown): KnowledgeOrigin {
  return (KNOWLEDGE_ORIGINS as readonly string[]).includes(String(value)) ? value as KnowledgeOrigin : 'agent';
}

function normalizeStatus(value: unknown): KnowledgeStatus {
  return value === 'superseded' || value === 'archived' ? value : 'active';
}

function normalizeConfidence(value: unknown): number {
  const parsed = Number(value);
  return Math.min(1, Math.max(0, Number.isFinite(parsed) ? parsed : 0.75));
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of value) {
    const tag = asText(raw).slice(0, MAX_TAG_LEN);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    result.push(tag);
    if (result.length >= MAX_TAGS) break;
  }
  return result;
}

function normalizeTopicKey(topic: string): string {
  return topic.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function topicFingerprintOf(topic: string): string {
  return crypto.createHash('sha256').update(normalizeTopicKey(topic), 'utf8').digest('hex');
}

function normalizeDreamDate(value: unknown): string | null {
  const date = asText(value);
  if (!date) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('sourceDreamDate must be a valid YYYY-MM-DD date');
  }
  return date;
}

function normalizeSources(value: unknown): KnowledgeSourceInput[] {
  if (!Array.isArray(value)) return [];
  const result: KnowledgeSourceInput[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const source = raw as KnowledgeSourceInput;
    const episodeId = asText(source.episodeId) || null;
    const evidenceId = asText(source.evidenceId) || null;
    const sessionId = asText(source.sessionId) || null;
    if (!episodeId && !evidenceId && !sessionId) continue;
    result.push({
      episodeId,
      evidenceId,
      sessionId,
      sourceChannel: boundedOptionalText(source.sourceChannel, 'sourceChannel', 120),
      relevance: boundedOptionalText(source.relevance, 'relevance', MAX_RELEVANCE),
    });
    if (result.length >= MAX_SOURCES) break;
  }
  return result;
}

function normalizeSourceRecord(value: unknown): KnowledgeSource | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = asText(record.id);
  if (!id) return null;
  return {
    id,
    episodeId: asText(record.episodeId) || null,
    evidenceId: asText(record.evidenceId) || null,
    sessionId: asText(record.sessionId) || null,
    sourceChannel: asText(record.sourceChannel) || null,
    relevance: asText(record.relevance) || null,
    createdAt: typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) ? record.createdAt : 0,
  };
}

function normalizeRevisionRecord(value: unknown): KnowledgeRevision | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = asText(record.id);
  if (!id) return null;
  return {
    id,
    version: Math.max(1, Math.floor(Number(record.version) || 1)),
    summary: typeof record.summary === 'string' ? record.summary : '',
    kind: normalizeKind(record.kind),
    origin: normalizeOrigin(record.origin),
    sourceDreamDate: asText(record.sourceDreamDate) || null,
    createdAt: typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) ? record.createdAt : 0,
  };
}

function normalizeEntry(value: unknown): KnowledgeEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = asText(record.id);
  const topic = typeof record.topic === 'string' ? record.topic : '';
  if (!id || !topic.trim()) return null;
  return {
    id,
    topic,
    topicFingerprint: asText(record.topicFingerprint) || topicFingerprintOf(topic),
    summary: typeof record.summary === 'string' ? record.summary : '',
    kind: normalizeKind(record.kind),
    category: asText(record.category) || null,
    tags: normalizeTags(record.tags),
    confidence: normalizeConfidence(record.confidence),
    status: normalizeStatus(record.status),
    origin: normalizeOrigin(record.origin),
    sourceDreamDate: asText(record.sourceDreamDate) || null,
    version: Math.max(1, Math.floor(Number(record.version) || 1)),
    sources: Array.isArray(record.sources)
      ? record.sources.map(normalizeSourceRecord).filter((source): source is KnowledgeSource => source !== null)
      : [],
    revisions: Array.isArray(record.revisions)
      ? record.revisions.map(normalizeRevisionRecord).filter((revision): revision is KnowledgeRevision => revision !== null)
      : [],
    createdAt: typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) ? record.createdAt : 0,
    updatedAt: typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt) ? record.updatedAt : 0,
    lastUsedAt: typeof record.lastUsedAt === 'number' && Number.isFinite(record.lastUsedAt) ? record.lastUsedAt : null,
  };
}

export interface KnowledgeStore {
  getKnowledge(id: string): Promise<KnowledgeEntry | null>;
  upsertKnowledge(input: UpsertKnowledgeInput): Promise<UpsertKnowledgeResult>;
  /** Human edit by id: rewrites in place, archiving the prior text. */
  updateKnowledge(input: { id: string; topic?: string; summary?: string; kind?: KnowledgeKind }): Promise<KnowledgeEntry | null>;
  archiveKnowledge(id: string): Promise<KnowledgeEntry | null>;
  deleteKnowledge(id: string): Promise<boolean>;
  listKnowledge(options?: ListKnowledgeOptions): Promise<KnowledgeEntry[]>;
  searchKnowledge(input: {
    query?: string;
    kind?: KnowledgeKind;
    limit?: number;
    touchLastUsed?: boolean;
  }): Promise<KnowledgeEntry[]>;
  /** Compact active set handed to the dream prompt for create-vs-revise. */
  listKnowledgeForDream(limit?: number): Promise<DreamKnowledgeView[]>;
  countActive(): Promise<number>;
}

export function createKnowledgeStore(paths: MetabotPaths): KnowledgeStore {
  const filePath = paths.memoryKnowledgePath;
  let writeQueue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = writeQueue.then(task, task);
    writeQueue = run.catch(() => undefined);
    return run;
  }

  async function readFile(): Promise<KnowledgeFile> {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { version: 1, entries: [] };
      const entries = Array.isArray((parsed as Record<string, unknown>).entries)
        ? ((parsed as Record<string, unknown>).entries as unknown[])
          .map(normalizeEntry)
          .filter((entry): entry is KnowledgeEntry => entry !== null)
        : [];
      return { version: 1, entries };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, entries: [] };
      throw error;
    }
  }

  async function writeFile(next: KnowledgeFile): Promise<void> {
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

  function toSources(inputs: KnowledgeSourceInput[], now: number): KnowledgeSource[] {
    return inputs.map((input) => ({
      id: `ks_${crypto.randomUUID()}`,
      episodeId: input.episodeId ?? null,
      evidenceId: input.evidenceId ?? null,
      sessionId: input.sessionId ?? null,
      sourceChannel: input.sourceChannel ?? null,
      relevance: input.relevance ?? null,
      createdAt: now,
    }));
  }

  function archiveRevision(entry: KnowledgeEntry, now: number): void {
    entry.revisions.push({
      id: `kr_${crypto.randomUUID()}`,
      version: entry.version,
      summary: entry.summary,
      kind: entry.kind,
      origin: entry.origin,
      sourceDreamDate: entry.sourceDreamDate,
      createdAt: entry.updatedAt || now,
    });
  }

  return {
    async getKnowledge(id) {
      const file = await readFile();
      return file.entries.find((entry) => entry.id === asText(id)) ?? null;
    },

    async upsertKnowledge(input) {
      return enqueue(async () => {
        const topic = boundedRequiredText(input.topic, 'topic', MAX_TOPIC);
        const summary = boundedRequiredText(input.summary, 'summary', MAX_SUMMARY);
        const kind = normalizeKind(input.kind);
        const category = boundedOptionalText(input.category, 'category', MAX_CATEGORY);
        const tags = normalizeTags(input.tags);
        const confidence = normalizeConfidence(input.confidence);
        const origin = normalizeOrigin(input.origin);
        const sourceDreamDate = normalizeDreamDate(input.sourceDreamDate);
        const sources = normalizeSources(input.sources);
        const topicFingerprint = asText(input.topicFingerprint) || topicFingerprintOf(topic);
        const now = Date.now();

        const file = await readFile();
        const existing = file.entries.find((entry) => entry.topicFingerprint === topicFingerprint);

        if (!existing) {
          const entry: KnowledgeEntry = {
            id: asText(input.id) || `kn_${crypto.randomUUID()}`,
            topic,
            topicFingerprint,
            summary,
            kind,
            category,
            tags,
            confidence,
            status: 'active',
            origin,
            sourceDreamDate,
            version: 1,
            sources: toSources(sources, now),
            revisions: [],
            createdAt: now,
            updatedAt: now,
            lastUsedAt: null,
          };
          file.entries.push(entry);
          await writeFile(file);
          return { entry, created: true, revised: false };
        }

        // No-op rewrite (same topic, same summary, same kind) avoids fake revisions.
        const sameContent = existing.summary === summary
          && existing.kind === kind
          && (existing.category ?? null) === (category ?? null);
        if (sameContent) {
          return { entry: existing, created: false, revised: false };
        }

        archiveRevision(existing, now);
        existing.topic = topic;
        existing.summary = summary;
        existing.kind = kind;
        existing.category = category;
        existing.tags = tags;
        existing.confidence = confidence;
        existing.status = 'active';
        existing.origin = origin;
        existing.sourceDreamDate = sourceDreamDate;
        existing.version += 1;
        existing.updatedAt = now;
        // Dream and agent rewrites restate the point's sources from their own
        // evidence view; replace the prior pointer set rather than stacking.
        existing.sources = toSources(sources, now);
        await writeFile(file);
        return { entry: existing, created: false, revised: true };
      });
    },

    async updateKnowledge(input) {
      return enqueue(async () => {
        const file = await readFile();
        const existing = file.entries.find((entry) => entry.id === asText(input.id));
        if (!existing) return null;
        const nextTopic = input.topic !== undefined ? boundedRequiredText(input.topic, 'topic', MAX_TOPIC) : existing.topic;
        const nextSummary = input.summary !== undefined ? boundedRequiredText(input.summary, 'summary', MAX_SUMMARY) : existing.summary;
        const nextKind = input.kind !== undefined ? normalizeKind(input.kind) : existing.kind;
        if (nextTopic === existing.topic && nextSummary === existing.summary && nextKind === existing.kind) {
          return existing;
        }
        const now = Date.now();
        archiveRevision(existing, now);
        existing.topic = nextTopic;
        existing.topicFingerprint = topicFingerprintOf(nextTopic);
        existing.summary = nextSummary;
        existing.kind = nextKind;
        existing.status = 'active';
        existing.version += 1;
        existing.updatedAt = now;
        await writeFile(file);
        return existing;
      });
    },

    async archiveKnowledge(id) {
      return enqueue(async () => {
        const file = await readFile();
        const existing = file.entries.find((entry) => entry.id === asText(id));
        if (!existing) return null;
        existing.status = 'archived';
        existing.updatedAt = Date.now();
        await writeFile(file);
        return existing;
      });
    },

    async deleteKnowledge(id) {
      return enqueue(async () => {
        const file = await readFile();
        const index = file.entries.findIndex((entry) => entry.id === asText(id));
        if (index < 0) return false;
        file.entries.splice(index, 1);
        await writeFile(file);
        return true;
      });
    },

    async listKnowledge(options = {}) {
      const touch = options.touchLastUsed === true;
      const query = asText(options.query).toLowerCase();
      const statusFilter = options.status === 'all' ? null : normalizeStatus(options.status ?? 'active');
      const limit = Math.min(500, Math.max(1, Math.floor(options.limit ?? 100)));
      const offset = Math.max(0, Math.floor(options.offset ?? 0));

      const select = (file: KnowledgeFile): KnowledgeEntry[] => file.entries
        .filter((entry) => {
          if (statusFilter && entry.status !== statusFilter) return false;
          if (options.kind && entry.kind !== normalizeKind(options.kind)) return false;
          if (options.category && entry.category !== boundedOptionalText(options.category, 'category', MAX_CATEGORY)) return false;
          if (query && !entry.topic.toLowerCase().includes(query) && !entry.summary.toLowerCase().includes(query)) return false;
          return true;
        })
        .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
        .slice(offset, offset + limit);

      if (!touch) {
        return select(await readFile());
      }
      return enqueue(async () => {
        const file = await readFile();
        const rows = select(file);
        const now = Date.now();
        const ids = new Set(rows.map((row) => row.id));
        for (const entry of file.entries) {
          if (ids.has(entry.id)) entry.lastUsedAt = now;
        }
        if (rows.length > 0) await writeFile(file);
        return rows.map((row) => ({ ...row, lastUsedAt: now }));
      });
    },

    async searchKnowledge(input) {
      return this.listKnowledge({
        query: input.query,
        kind: input.kind,
        status: 'active',
        limit: input.limit,
        touchLastUsed: input.touchLastUsed,
      });
    },

    async listKnowledgeForDream(limit = 60) {
      const rows = await this.listKnowledge({
        status: 'active',
        limit: Math.min(200, Math.max(1, Math.floor(limit))),
      });
      return rows.map((row) => ({
        id: row.id,
        topic: row.topic,
        summary: row.summary,
        kind: row.kind,
        category: row.category,
        version: row.version,
      }));
    },

    async countActive() {
      const file = await readFile();
      return file.entries.filter((entry) => entry.status === 'active').length;
    },
  };
}
