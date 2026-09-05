// Time-anchored experience ledger, ported from IDBots
// src/main/metaidExperienceStore.ts onto `.runtime/memory/experience.json`.
// Episodes are the shared fact source: daily summaries, person-anchored
// impressions, and knowledge points all index into this ledger. Evidence
// rows store hashes/references, never raw private text.
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { MetabotPaths } from '../state/paths';

export const EXPERIENCE_EPISODE_TYPES = [
  'direct_interaction',
  'task_participation',
  'service_order',
  'scheduled_task',
  'public_pin_observation',
  'third_party_reference',
] as const;

export type ExperienceEpisodeType = typeof EXPERIENCE_EPISODE_TYPES[number];
export type ExperienceEpisodeStatus = 'open' | 'completed' | 'failed' | 'abandoned';

export interface ExperienceEpisode {
  id: string;
  ownerGlobalMetaId: string;
  episodeType: ExperienceEpisodeType;
  sourceChannel: string;
  sourceKey: string;
  sessionId: string | null;
  externalConversationId: string | null;
  taskId: string | null;
  orderId: string | null;
  status: ExperienceEpisodeStatus;
  startedAt: number;
  endedAt: number | null;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  /** Hygiene soft-archive mark (ISO 8601); archived episodes leave hot paths. */
  archivedAt: string | null;
}

export interface ExperienceParticipant {
  episodeId: string;
  globalMetaId: string | null;
  unresolvedActorKey: string | null;
  identityState: 'known' | 'unknown';
  role: string;
  displayName: string | null;
  source: string;
  createdAt: number;
}

export interface ExperienceEvidence {
  id: string;
  episodeId: string;
  evidenceType: string;
  sourceKey: string;
  pinId: string | null;
  publisherGlobalMetaId: string | null;
  messageId: string | null;
  contentHash: string;
  occurredAt: number;
  retrievedAt: number | null;
  metadata: Record<string, unknown>;
  createdAt: number;
}

export interface CreateExperienceEpisodeInput {
  ownerGlobalMetaId: string;
  episodeType: ExperienceEpisodeType;
  sourceChannel: string;
  sourceKey: string;
  sessionId?: string | null;
  externalConversationId?: string | null;
  taskId?: string | null;
  orderId?: string | null;
  status?: ExperienceEpisodeStatus;
  startedAt?: number;
  endedAt?: number | null;
  metadata?: Record<string, unknown>;
}

export interface AddExperienceParticipantInput {
  episodeId: string;
  globalMetaId?: string | null;
  unresolvedActorKey?: string | null;
  role: string;
  displayName?: string | null;
  source: string;
}

export interface AddExperienceEvidenceInput {
  episodeId: string;
  evidenceType: string;
  sourceKey: string;
  pinId?: string | null;
  publisherGlobalMetaId?: string | null;
  messageId?: string | null;
  contentHash?: string | null;
  occurredAt?: number;
  retrievedAt?: number | null;
  metadata?: Record<string, unknown>;
}

interface ExperienceFile {
  version: number;
  episodes: Array<ExperienceEpisode & { participants: ExperienceParticipant[]; evidence: ExperienceEvidence[] }>;
}

const MAX_METADATA_CHARS = 8_000;

let atomicWriteSequence = 0;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > MAX_METADATA_CHARS) return {};
  } catch {
    return {};
  }
  return value as Record<string, unknown>;
}

function normalizeEpisodeType(value: unknown): ExperienceEpisodeType {
  return (EXPERIENCE_EPISODE_TYPES as readonly string[]).includes(String(value))
    ? value as ExperienceEpisodeType
    : 'direct_interaction';
}

function normalizeEpisodeStatus(value: unknown): ExperienceEpisodeStatus {
  return value === 'open' || value === 'failed' || value === 'abandoned' ? value : 'completed';
}

function normalizeParticipant(value: unknown): ExperienceParticipant | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const globalMetaId = text(record.globalMetaId) || null;
  const unresolvedActorKey = text(record.unresolvedActorKey) || null;
  if (!globalMetaId && !unresolvedActorKey) return null;
  return {
    episodeId: text(record.episodeId),
    globalMetaId,
    unresolvedActorKey,
    identityState: globalMetaId ? 'known' : 'unknown',
    role: text(record.role) || 'peer',
    displayName: text(record.displayName) || null,
    source: text(record.source) || 'observed',
    createdAt: num(record.createdAt),
  };
}

function normalizeEvidence(value: unknown): ExperienceEvidence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = text(record.id);
  const episodeId = text(record.episodeId);
  const evidenceType = text(record.evidenceType);
  const sourceKey = text(record.sourceKey);
  if (!id || !episodeId || !evidenceType || !sourceKey) return null;
  return {
    id,
    episodeId,
    evidenceType,
    sourceKey,
    pinId: text(record.pinId) || null,
    publisherGlobalMetaId: text(record.publisherGlobalMetaId) || null,
    messageId: text(record.messageId) || null,
    contentHash: text(record.contentHash),
    occurredAt: num(record.occurredAt),
    retrievedAt: record.retrievedAt === null ? null : num(record.retrievedAt) || null,
    metadata: normalizeMetadata(record.metadata),
    createdAt: num(record.createdAt),
  };
}

function normalizeEpisode(value: unknown): ExperienceFile['episodes'][number] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = text(record.id);
  const ownerGlobalMetaId = text(record.ownerGlobalMetaId);
  const sourceChannel = text(record.sourceChannel);
  const sourceKey = text(record.sourceKey);
  if (!id || !ownerGlobalMetaId || !sourceChannel || !sourceKey) return null;
  return {
    id,
    ownerGlobalMetaId,
    episodeType: normalizeEpisodeType(record.episodeType),
    sourceChannel,
    sourceKey,
    sessionId: text(record.sessionId) || null,
    externalConversationId: text(record.externalConversationId) || null,
    taskId: text(record.taskId) || null,
    orderId: text(record.orderId) || null,
    status: normalizeEpisodeStatus(record.status),
    startedAt: num(record.startedAt),
    endedAt: record.endedAt === null ? null : num(record.endedAt) || null,
    metadata: normalizeMetadata(record.metadata),
    createdAt: num(record.createdAt),
    updatedAt: num(record.updatedAt),
    archivedAt: text(record.archivedAt) || null,
    participants: Array.isArray(record.participants)
      ? record.participants.map(normalizeParticipant).filter((p): p is ExperienceParticipant => p !== null)
      : [],
    evidence: Array.isArray(record.evidence)
      ? record.evidence.map(normalizeEvidence).filter((e): e is ExperienceEvidence => e !== null)
      : [],
  };
}

/** sha1 content hash for evidence rows — evidence stores hashes, not raw text. */
export function hashExperienceContent(content: string): string {
  return crypto.createHash('sha1').update(content, 'utf8').digest('hex');
}

export interface ExperienceStore {
  /** Idempotent on (ownerGlobalMetaId, sourceChannel, sourceKey): returns the
   * existing episode when the key already exists. */
  createEpisode(input: CreateExperienceEpisodeInput): Promise<ExperienceEpisode>;
  getEpisode(id: string): Promise<ExperienceEpisode | null>;
  updateEpisodeStatus(id: string, status: ExperienceEpisodeStatus, endedAt?: number | null): Promise<void>;
  addParticipant(input: AddExperienceParticipantInput): Promise<ExperienceParticipant | null>;
  /** Idempotent on (episodeId, evidenceType, sourceKey). */
  addEvidence(input: AddExperienceEvidenceInput): Promise<ExperienceEvidence | null>;
  listEpisodes(options: {
    ownerGlobalMetaId?: string;
    subjectGlobalMetaId?: string;
    fromTime?: number;
    toTime?: number;
    /** When set, hygiene-archived episodes join the listing (default excludes them). */
    includeArchived?: boolean;
    limit?: number;
  }): Promise<ExperienceEpisode[]>;
  listParticipants(episodeId: string): Promise<ExperienceParticipant[]>;
  listEvidence(episodeId: string, options?: {
    fromTime?: number;
    toTime?: number;
    limit?: number;
  }): Promise<ExperienceEvidence[]>;
  /** Hygiene: soft-archive terminal episodes past the retention horizon. */
  archiveEpisodes(input: { cutoffMs: number; archivedAt: string }): Promise<number>;
  /** Hygiene: settle open episodes whose source of truth already reached a
   * terminal state — orders completed/refunded/failed, group tasks
   * done/cancelled, direct interactions dormant past the cutoff. Idempotent:
   * terminal rows are never re-touched. */
  reconcileOpenEpisodes(input: { nowMs: number; dormantCutoffMs: number }): Promise<{
    serviceOrdersSettled: number;
    taskEpisodesSettled: number;
    dormantInteractionsClosed: number;
  }>;
}

export function createExperienceStore(paths: MetabotPaths): ExperienceStore {
  const filePath = paths.memoryExperiencePath;
  let writeQueue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = writeQueue.then(task, task);
    writeQueue = run.catch(() => undefined);
    return run;
  }

  async function readFile(): Promise<ExperienceFile> {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { version: 1, episodes: [] };
      }
      const episodes = Array.isArray((parsed as Record<string, unknown>).episodes)
        ? ((parsed as Record<string, unknown>).episodes as unknown[])
          .map(normalizeEpisode)
          .filter((episode): episode is ExperienceFile['episodes'][number] => episode !== null)
        : [];
      return { version: 1, episodes };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, episodes: [] };
      throw error;
    }
  }

  async function writeFile(next: ExperienceFile): Promise<void> {
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

  function strip(episode: ExperienceFile['episodes'][number]): ExperienceEpisode {
    const { participants: _participants, evidence: _evidence, ...rest } = episode;
    return rest;
  }

  /** Terminal seller-order states from runtime-state.json, keyed by the
   * episode sourceKey (`order:<id>`). Best effort: missing/corrupt file
   * yields an empty map and those episodes wait for the next pass. */
  async function readTerminalOrderStates(): Promise<Map<string, 'completed' | 'failed'>> {
    const states = new Map<string, 'completed' | 'failed'>();
    try {
      const parsed = JSON.parse(await fs.readFile(paths.runtimeStatePath, 'utf8')) as Record<string, unknown>;
      const orders = Array.isArray(parsed.sellerOrders) ? parsed.sellerOrders as Record<string, unknown>[] : [];
      for (const order of orders) {
        const id = text(order.id);
        if (!id) continue;
        const state = text(order.state);
        if (state === 'failed') states.set(`order:${id}`, 'failed');
        else if (state === 'completed' || state === 'refunded') states.set(`order:${id}`, 'completed');
      }
    } catch {
      // Best effort: a missing/corrupt runtime state leaves orders unreconciled.
    }
    return states;
  }

  /** Terminal group-task states from `.runtime/grouptask/state.json`, keyed by
   * task id (episodes carry `taskId`). Best effort like readTerminalOrderStates. */
  async function readTerminalTaskStates(): Promise<Map<string, 'completed' | 'abandoned'>> {
    const states = new Map<string, 'completed' | 'abandoned'>();
    try {
      const parsed = JSON.parse(
        await fs.readFile(path.join(paths.runtimeRoot, 'grouptask', 'state.json'), 'utf8'),
      ) as Record<string, unknown>;
      const tasks = Array.isArray(parsed.tasks) ? parsed.tasks as Record<string, unknown>[] : [];
      for (const task of tasks) {
        if (task.id === undefined || task.id === null) continue;
        const status = text(task.status);
        if (status === 'cancelled') states.set(String(task.id), 'abandoned');
        else if (status === 'done') states.set(String(task.id), 'completed');
      }
    } catch {
      // Best effort.
    }
    return states;
  }

  /** Newest evidence timestamp for an episode — the source-of-truth anchor for
   * when an open episode actually went quiet (IDBots `COALESCE(MAX(ev.occurred_at), …)`). */
  function newestEvidenceAt(episode: ExperienceFile['episodes'][number]): number {
    return episode.evidence.reduce((max, evidence) => Math.max(max, evidence.occurredAt || 0), 0);
  }

  return {
    async createEpisode(input) {
      return enqueue(async () => {
        const file = await readFile();
        const owner = text(input.ownerGlobalMetaId);
        const sourceChannel = text(input.sourceChannel);
        const sourceKey = text(input.sourceKey);
        if (!owner) throw new Error('ownerGlobalMetaId is required');
        if (!sourceChannel || !sourceKey) throw new Error('sourceChannel and sourceKey are required');
        const existing = file.episodes.find((episode) => (
          episode.ownerGlobalMetaId === owner
          && episode.sourceChannel === sourceChannel
          && episode.sourceKey === sourceKey
        ));
        if (existing) {
          // Recurring activity on the same source key revives a
          // hygiene-archived episode — new evidence means the episode is hot
          // again, not a ghost row that stays invisible to hot paths.
          if (existing.archivedAt != null) {
            existing.archivedAt = null;
            existing.updatedAt = Date.now();
            await writeFile(file);
          }
          return strip(existing);
        }
        const now = Date.now();
        const episode: ExperienceFile['episodes'][number] = {
          id: `ep_${crypto.randomUUID()}`,
          ownerGlobalMetaId: owner,
          episodeType: normalizeEpisodeType(input.episodeType),
          sourceChannel,
          sourceKey,
          sessionId: text(input.sessionId) || null,
          externalConversationId: text(input.externalConversationId) || null,
          taskId: text(input.taskId) || null,
          orderId: text(input.orderId) || null,
          status: input.status ?? 'open',
          startedAt: num(input.startedAt, now),
          endedAt: input.endedAt === undefined ? null : input.endedAt,
          metadata: normalizeMetadata(input.metadata),
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
          participants: [],
          evidence: [],
        };
        file.episodes.push(episode);
        await writeFile(file);
        return strip(episode);
      });
    },

    async getEpisode(id) {
      const file = await readFile();
      const episode = file.episodes.find((entry) => entry.id === text(id));
      return episode ? strip(episode) : null;
    },

    async updateEpisodeStatus(id, status, endedAt) {
      await enqueue(async () => {
        const file = await readFile();
        const episode = file.episodes.find((entry) => entry.id === text(id));
        if (!episode) return;
        episode.status = status;
        if (endedAt !== undefined) episode.endedAt = endedAt;
        episode.updatedAt = Date.now();
        await writeFile(file);
      });
    },

    async addParticipant(input) {
      return enqueue(async () => {
        const file = await readFile();
        const episode = file.episodes.find((entry) => entry.id === text(input.episodeId));
        if (!episode) return null;
        const globalMetaId = text(input.globalMetaId) || null;
        const unresolvedActorKey = text(input.unresolvedActorKey) || null;
        if (!globalMetaId && !unresolvedActorKey) return null;
        const existing = episode.participants.find((participant) => (
          (globalMetaId && participant.globalMetaId === globalMetaId)
          || (unresolvedActorKey && participant.unresolvedActorKey === unresolvedActorKey)
        ));
        if (existing) return existing;
        const participant: ExperienceParticipant = {
          episodeId: episode.id,
          globalMetaId,
          unresolvedActorKey,
          identityState: globalMetaId ? 'known' : 'unknown',
          role: text(input.role) || 'peer',
          displayName: text(input.displayName) || null,
          source: text(input.source) || 'observed',
          createdAt: Date.now(),
        };
        episode.participants.push(participant);
        episode.updatedAt = Date.now();
        await writeFile(file);
        return participant;
      });
    },

    async addEvidence(input) {
      return enqueue(async () => {
        const file = await readFile();
        const episode = file.episodes.find((entry) => entry.id === text(input.episodeId));
        if (!episode) return null;
        const evidenceType = text(input.evidenceType);
        const sourceKey = text(input.sourceKey);
        if (!evidenceType || !sourceKey) return null;
        const existing = episode.evidence.find((entry) => (
          entry.evidenceType === evidenceType && entry.sourceKey === sourceKey
        ));
        if (existing) return existing;
        const now = Date.now();
        const evidence: ExperienceEvidence = {
          id: `ev_${crypto.randomUUID()}`,
          episodeId: episode.id,
          evidenceType,
          sourceKey,
          pinId: text(input.pinId) || null,
          publisherGlobalMetaId: text(input.publisherGlobalMetaId) || null,
          messageId: text(input.messageId) || null,
          contentHash: text(input.contentHash),
          occurredAt: num(input.occurredAt, now),
          retrievedAt: input.retrievedAt === undefined ? null : input.retrievedAt,
          metadata: normalizeMetadata(input.metadata),
          createdAt: now,
        };
        episode.evidence.push(evidence);
        episode.updatedAt = now;
        await writeFile(file);
        return evidence;
      });
    },

    async listEpisodes(options) {
      const file = await readFile();
      const owner = text(options.ownerGlobalMetaId);
      const subject = text(options.subjectGlobalMetaId);
      const limit = Math.min(500, Math.max(1, Math.floor(options.limit ?? 100)));
      const filtered = file.episodes.filter((episode) => {
        if (owner && episode.ownerGlobalMetaId !== owner) return false;
        if (options.fromTime !== undefined && episode.startedAt < options.fromTime) return false;
        if (options.toTime !== undefined && episode.startedAt >= options.toTime) return false;
        // Hygiene-archived episodes leave hot paths (dream candidates, contact
        // views, cognition context); explicit recall opts back in.
        if (!options.includeArchived && episode.archivedAt != null) return false;
        if (subject && !episode.participants.some((participant) => participant.globalMetaId === subject)) return false;
        return true;
      });
      filtered.sort((left, right) => right.startedAt - left.startedAt || left.id.localeCompare(right.id));
      return filtered.slice(0, limit).map(strip);
    },

    async listParticipants(episodeId) {
      const file = await readFile();
      const episode = file.episodes.find((entry) => entry.id === text(episodeId));
      return episode ? [...episode.participants] : [];
    },

    async listEvidence(episodeId, options = {}) {
      const file = await readFile();
      const episode = file.episodes.find((entry) => entry.id === text(episodeId));
      if (!episode) return [];
      const limit = Math.min(500, Math.max(1, Math.floor(options.limit ?? 100)));
      const filtered = episode.evidence.filter((entry) => {
        if (options.fromTime !== undefined && entry.occurredAt < options.fromTime) return false;
        if (options.toTime !== undefined && entry.occurredAt >= options.toTime) return false;
        return true;
      });
      filtered.sort((left, right) => right.occurredAt - left.occurredAt || left.id.localeCompare(right.id));
      return filtered.slice(0, limit);
    },

    async archiveEpisodes(input) {
      const cutoff = Math.floor(input.cutoffMs);
      return enqueue(async () => {
        const file = await readFile();
        let archived = 0;
        for (const episode of file.episodes) {
          if (episode.archivedAt != null) continue;
          if (episode.status !== 'completed' && episode.status !== 'failed' && episode.status !== 'abandoned') continue;
          const anchor = episode.endedAt ?? episode.startedAt ?? episode.createdAt;
          if (anchor >= cutoff) continue;
          episode.archivedAt = input.archivedAt;
          episode.updatedAt = Date.now();
          archived += 1;
        }
        if (archived > 0) await writeFile(file);
        return archived;
      });
    },

    async reconcileOpenEpisodes(input) {
      const now = Math.floor(input.nowMs);
      const dormantCutoff = Math.floor(input.dormantCutoffMs);
      return enqueue(async () => {
        const file = await readFile();
        const orderStates = await readTerminalOrderStates();
        const taskStates = await readTerminalTaskStates();
        let serviceOrdersSettled = 0;
        let taskEpisodesSettled = 0;
        let dormantInteractionsClosed = 0;
        for (const episode of file.episodes) {
          if (episode.status !== 'open' || episode.archivedAt != null) continue;
          if (episode.episodeType === 'service_order') {
            const terminal = orderStates.get(episode.sourceKey);
            if (!terminal) continue;
            episode.status = terminal;
            episode.endedAt = newestEvidenceAt(episode) || episode.startedAt || episode.createdAt;
            episode.updatedAt = now;
            serviceOrdersSettled += 1;
            continue;
          }
          if (episode.episodeType === 'task_participation') {
            const terminal = episode.taskId ? taskStates.get(episode.taskId) : undefined;
            if (!terminal) continue;
            episode.status = terminal;
            episode.endedAt = newestEvidenceAt(episode) || episode.startedAt || episode.createdAt;
            episode.updatedAt = now;
            taskEpisodesSettled += 1;
            continue;
          }
          if (episode.episodeType === 'direct_interaction') {
            if (episode.startedAt >= dormantCutoff) continue;
            const lastActivity = newestEvidenceAt(episode);
            if (lastActivity >= dormantCutoff) continue;
            episode.status = 'completed';
            episode.endedAt = lastActivity || episode.startedAt || episode.createdAt;
            episode.updatedAt = now;
            dormantInteractionsClosed += 1;
            continue;
          }
        }
        if (serviceOrdersSettled + taskEpisodesSettled + dormantInteractionsClosed > 0) {
          await writeFile(file);
        }
        return { serviceOrdersSettled, taskEpisodesSettled, dormantInteractionsClosed };
      });
    },
  };
}
