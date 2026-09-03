// Dream consolidation storage layer, ported from IDBots src/main/dreamStore.ts
// onto the file layout (storage v2 amendment 2026-08-20):
// - `.runtime/memory/dream-runs.json`: run records (the idempotency anchor,
//   unique per dream date) + the resumable fragment cache.
// - `.runtime/memory/dream-summaries.json`: structured daily summaries.
// - `memory/YYYY-MM-DD.md`: the human-readable diary mirror.
// Also owns the "what did this bot do on date D" activity query, gathered from
// mirrored DSH transcripts, the on-chain A2A conversation stores, the group-task
// state/message caches, the seller-order list in the runtime state, and the
// per-bot chain history store.
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { createChainHistoryStore } from '../chainhistory/store';
import {
  GROUP_TASK_TERMINAL_STATUSES,
  type GroupTaskMember,
  type GroupTaskRecord,
} from '../grouptask/types';
import type { OpenTeamMembershipRecord } from '../grouptask/openteamStore';
import type { SellerOrderRecord } from '../orders/sellerOrderState';
import type { MetabotPaths } from '../state/paths';
import { readTranscript } from './transcriptStore';

export type DreamRunStatus = 'running' | 'completed' | 'failed';
export type DreamFragmentStatus = 'running' | 'completed' | 'failed';

export interface DreamRun {
  dreamDate: string;
  status: DreamRunStatus;
  attemptCount: number;
  llm: string | null;
  /** Algorithm version the run was made with; 0 = legacy, pre-versioning. */
  dreamVersion: number;
  error: string | null;
  startedAt: number;
  completedAt: number | null;
}

export interface DreamFragment {
  dreamDate: string;
  fragmentKey: string;
  sessionId: string;
  chunkIndex: number;
  contentHash: string;
  sourceMessageCount: number;
  sourceCharCount: number;
  estimatedInputTokens: number;
  status: DreamFragmentStatus;
  summaryJson: string | null;
  llm: string | null;
  dreamVersion: number;
  error: string | null;
  attemptCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface DailySummarySessionRef {
  sessionId: string;
  title: string;
  sessionType: string;
  isOrder: boolean;
}

export interface DailySummary {
  summaryDate: string;
  summaryText: string;
  sections: Record<string, string>;
  stats: Record<string, number>;
  /** Sessions that fed this summary — the index from a recalled day back to
   * the full conversations. */
  sessionRefs: DailySummarySessionRef[];
  llm: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface DreamActivityMessage {
  type: 'user' | 'assistant';
  content: string;
  createdAt: number;
  /** Human's per-message rating (thumbs up/down), when the message was rated. */
  feedbackRating?: 'up' | 'down';
  /** Human's free-text comment attached to the rating, when present. */
  feedbackComment?: string | null;
}

export interface DreamSessionActivity {
  sessionId: string;
  title: string;
  sessionType: string;
  peerName: string | null;
  isOrder: boolean;
  messages: DreamActivityMessage[];
}

export interface DreamTaskRunActivity {
  taskName: string;
  status: string;
  startedAt: number;
  sessionId: string | null;
}

/** accepted = closed/rated that day; active = still open with same-day activity. */
export type DreamGroupTaskPhase = 'accepted' | 'active';

export interface DreamGroupTaskEvaluation {
  taskId: number;
  title: string;
  goal: string;
  memberRole: string;
  rating: number | null;
  ratingComment: string | null;
  status?: string;
  phase?: DreamGroupTaskPhase;
  dayMessageCount?: number;
}

export interface DreamGroupChatMessage {
  senderName: string;
  content: string;
  occurredAt: number;
}

export interface DreamGroupChatActivity {
  taskId: number;
  title: string;
  taskStatus: string;
  memberRole: string;
  messages: DreamGroupChatMessage[];
}

/** A pin the bot itself broadcast to the chain that day (writes ledger). */
export interface DreamChainWriteActivity {
  pinId: string;
  path: string | null;
  operation: string | null;
  occurredAtMs: number;
  /** Async LLM gist when available; the prompt falls back to stored text. */
  summary: string | null;
  contentText: string | null;
  contentType: string | null;
}

/** A chain pin the bot fully read that day (reads ledger). */
export interface DreamChainReadActivity {
  pinId: string;
  path: string | null;
  protocol: string | null;
  title: string | null;
  authorGlobalMetaId: string | null;
  summary: string | null;
  contentExcerpt: string | null;
  savedToKb: boolean;
  readCount: number;
  lastReadAtMs: number;
}

export interface DreamDayActivity {
  sessions: DreamSessionActivity[];
  taskRuns: DreamTaskRunActivity[];
  orderCount: number;
  groupTasks: DreamGroupTaskEvaluation[];
  groupChats?: DreamGroupChatActivity[];
  /** Pins this bot published to the chain that day (chain content history). */
  chainWrites?: DreamChainWriteActivity[];
  /** Chain pins this bot fully read that day (chain content history). */
  chainReads?: DreamChainReadActivity[];
}

interface DreamRunsFile {
  version: number;
  runs: DreamRun[];
  fragments: DreamFragment[];
}

interface DreamSummariesFile {
  version: number;
  summaries: DailySummary[];
}

let atomicWriteSequence = 0;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeRun(value: unknown): DreamRun | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const dreamDate = normalizeText(record.dreamDate);
  if (!dreamDate) return null;
  const status = record.status;
  return {
    dreamDate,
    status: status === 'running' || status === 'failed' ? status : 'completed',
    attemptCount: Math.max(0, Math.floor(normalizeFiniteNumber(record.attemptCount, 1))),
    llm: normalizeText(record.llm) || null,
    dreamVersion: Math.max(0, Math.floor(normalizeFiniteNumber(record.dreamVersion, 0))),
    error: normalizeText(record.error) || null,
    startedAt: normalizeFiniteNumber(record.startedAt),
    completedAt: record.completedAt === null ? null : normalizeFiniteNumber(record.completedAt),
  };
}

function normalizeFragment(value: unknown): DreamFragment | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const dreamDate = normalizeText(record.dreamDate);
  const fragmentKey = normalizeText(record.fragmentKey);
  if (!dreamDate || !fragmentKey) return null;
  const status = record.status;
  return {
    dreamDate,
    fragmentKey,
    sessionId: normalizeText(record.sessionId),
    chunkIndex: Math.max(0, Math.floor(normalizeFiniteNumber(record.chunkIndex))),
    contentHash: normalizeText(record.contentHash),
    sourceMessageCount: Math.max(0, Math.floor(normalizeFiniteNumber(record.sourceMessageCount))),
    sourceCharCount: Math.max(0, Math.floor(normalizeFiniteNumber(record.sourceCharCount))),
    estimatedInputTokens: Math.max(0, Math.floor(normalizeFiniteNumber(record.estimatedInputTokens))),
    status: status === 'running' || status === 'failed' ? status : 'completed',
    summaryJson: typeof record.summaryJson === 'string' ? record.summaryJson : null,
    llm: normalizeText(record.llm) || null,
    dreamVersion: Math.max(0, Math.floor(normalizeFiniteNumber(record.dreamVersion, 0))),
    error: normalizeText(record.error) || null,
    attemptCount: Math.max(0, Math.floor(normalizeFiniteNumber(record.attemptCount, 1))),
    createdAt: normalizeFiniteNumber(record.createdAt),
    updatedAt: normalizeFiniteNumber(record.updatedAt),
  };
}

function normalizeSummary(value: unknown): DailySummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const summaryDate = normalizeText(record.summaryDate);
  const summaryText = typeof record.summaryText === 'string' ? record.summaryText : '';
  if (!summaryDate || !summaryText.trim()) return null;
  const sections = record.sections && typeof record.sections === 'object' && !Array.isArray(record.sections)
    ? Object.fromEntries(
      Object.entries(record.sections as Record<string, unknown>)
        .filter(([, sectionValue]) => typeof sectionValue === 'string' && sectionValue.trim())
        .map(([key, sectionValue]) => [key, (sectionValue as string).trim()]),
    )
    : {};
  const stats = record.stats && typeof record.stats === 'object' && !Array.isArray(record.stats)
    ? Object.fromEntries(
      Object.entries(record.stats as Record<string, unknown>)
        .filter(([, statValue]) => typeof statValue === 'number' && Number.isFinite(statValue)),
    ) as Record<string, number>
    : {};
  const sessionRefs = Array.isArray(record.sessionRefs)
    ? record.sessionRefs.flatMap((ref): DailySummarySessionRef[] => {
      if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return [];
      const refRecord = ref as Record<string, unknown>;
      const sessionId = normalizeText(refRecord.sessionId);
      if (!sessionId) return [];
      return [{
        sessionId,
        title: normalizeText(refRecord.title),
        sessionType: normalizeText(refRecord.sessionType),
        isOrder: refRecord.isOrder === true,
      }];
    })
    : [];
  return {
    summaryDate,
    summaryText,
    sections,
    stats,
    sessionRefs,
    llm: normalizeText(record.llm) || null,
    createdAt: normalizeFiniteNumber(record.createdAt),
    updatedAt: normalizeFiniteNumber(record.updatedAt),
  };
}

async function readJsonFile<T>(filePath: string, normalize: (value: unknown) => T, empty: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return normalize(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty;
    throw error;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  atomicWriteSequence += 1;
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${atomicWriteSequence}.tmp`;
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

const DREAM_SECTION_LABELS: Record<string, string> = {
  human: '与人类用户的对话',
  a2a: '与其他 Bot 的对话',
  orders: '服务订单',
  tasks: '定时任务',
  group_tasks: '群任务',
};

/** Render the human-readable diary mirror at `memory/YYYY-MM-DD.md`. */
export function renderDreamDiaryMarkdown(summary: DailySummary): string {
  const parts: string[] = [
    `# ${summary.summaryDate} 梦境日记`,
    '',
    summary.summaryText.trim(),
  ];
  for (const [key, label] of Object.entries(DREAM_SECTION_LABELS)) {
    const section = summary.sections[key];
    if (section?.trim()) {
      parts.push('', `## ${label}`, '', section.trim());
    }
  }
  const statLines: string[] = [];
  if (summary.stats.sessionCount !== undefined) statLines.push(`- 会话数:${summary.stats.sessionCount}`);
  if (summary.stats.messageCount !== undefined) statLines.push(`- 消息数:${summary.stats.messageCount}`);
  if (summary.sessionRefs.length > 0) {
    statLines.push(`- 关联会话:${summary.sessionRefs.map((ref) => ref.sessionId).join(', ')}`);
  }
  if (statLines.length > 0) {
    parts.push('', '## 统计', '', ...statLines);
  }
  return `${parts.join('\n')}\n`;
}

/** Per-chat cap on in-day messages handed to the dream pipeline (IDBots caps
 * the same excerpt at 400; the file port stays tighter). */
export const DREAM_GROUP_CHAT_MAX_MESSAGES = 200;

/** One in-day group-chat message at full fidelity — the prompt activity shape
 * drops pin/sender ids, but the dream-time experience harvest needs them. */
export interface DreamDayGroupChatSourceMessage {
  index: number;
  pinId: string | null;
  txId: string | null;
  senderName: string | null;
  senderGlobalMetaId: string | null;
  content: string;
  /** Epoch ms (on-disk `chainTimestamp` is epoch seconds, indexer convention). */
  occurredAt: number;
}

/** One group's in-day chat stream joined with its local task or guest membership. */
export interface DreamDayGroupChatSource {
  groupId: string;
  /** Chair-side task row when the group lives in this profile's state.json. */
  task: GroupTaskRecord | null;
  /** OpenTeam membership when this profile joined the group as a guest worker. */
  membership: OpenTeamMembershipRecord | null;
  /** In-day, non-suspect, non-empty messages, chronological. */
  messages: DreamDayGroupChatSourceMessage[];
}

/** Raw day-windowed group-task source rows shared by gatherActivity and the
 * dream-time experience harvest (single implementation of the file reads). */
export interface DreamDayGroupTaskSource {
  tasks: GroupTaskRecord[];
  members: GroupTaskMember[];
  chats: DreamDayGroupChatSource[];
}

/** Epoch-ms field or null; grouptask timestamps are ms, junk/missing → null. */
function timestampMs(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function inDayMs(value: unknown, startMs: number, endMs: number): boolean {
  const ms = timestampMs(value);
  return ms !== null && ms >= startMs && ms < endMs;
}

/** Best-effort JSON read: missing or corrupt files yield null, never throw. */
async function readJsonOrNull(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => (
      Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry)
    ))
    : [];
}

/** Match the grouptask store's message-file name sanitization. */
function sanitizeGroupIdForMessagesFile(groupId: string): string {
  return groupId.replace(/[^0-9a-zA-Z_-]/gu, '_');
}

/** Owner acceptance ratings are 1-5 stars; anything else is junk data. */
function normalizeDreamRating(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rating = Math.trunc(value);
  return rating >= 1 && rating <= 5 ? rating : null;
}

/** This profile's role in one task: the chair row wins, else the member row. */
function dreamGroupTaskMemberRole(
  task: GroupTaskRecord,
  members: GroupTaskMember[],
  slug: string,
): string {
  if (task.chairSlug === slug) return 'chair';
  const member = members.find((entry) => (
    entry.taskId === task.id && entry.slug === slug && entry.removedAt == null
  ));
  return member?.role === 'chair' ? 'chair' : 'worker';
}

/**
 * Best-effort read of the group-task day source: the chair-side state.json,
 * guest OpenTeam memberships, and the decrypted per-group message caches.
 * Read-only and never throws — missing/corrupt files yield empty collections.
 */
export async function readDreamDayGroupTaskSource(
  paths: MetabotPaths,
  input: { startMs: number; endMs: number },
): Promise<DreamDayGroupTaskSource> {
  const root = path.join(paths.runtimeRoot, 'grouptask');
  const { startMs, endMs } = input;

  const state = await readJsonOrNull(path.join(root, 'state.json'));
  const stateRecord = state && typeof state === 'object' && !Array.isArray(state)
    ? state as Record<string, unknown>
    : null;
  const tasks = asRecordArray(stateRecord?.tasks)
    .filter((entry) => typeof entry.id === 'number' && typeof entry.title === 'string') as unknown as GroupTaskRecord[];
  const members = asRecordArray(stateRecord?.members)
    .filter((entry) => typeof entry.taskId === 'number') as unknown as GroupTaskMember[];

  const openteam = await readJsonOrNull(path.join(root, 'openteam.json'));
  const openteamRecord = openteam && typeof openteam === 'object' && !Array.isArray(openteam)
    ? openteam as Record<string, unknown>
    : null;
  const memberships = asRecordArray(openteamRecord?.memberships)
    .filter((entry) => typeof entry.groupId === 'string' && entry.groupId.trim()) as unknown as OpenTeamMembershipRecord[];

  // Message files are named by the sanitized groupId; map back through every
  // locally known group (chair-side tasks first, then guest memberships).
  const groupsByFileKey = new Map<string, { groupId: string; task: GroupTaskRecord | null; membership: OpenTeamMembershipRecord | null }>();
  for (const task of tasks) {
    const groupId = typeof task.groupId === 'string' ? task.groupId.trim() : '';
    if (!groupId) continue;
    const key = sanitizeGroupIdForMessagesFile(groupId);
    if (!groupsByFileKey.has(key)) groupsByFileKey.set(key, { groupId, task, membership: null });
  }
  for (const membership of memberships) {
    const groupId = membership.groupId.trim();
    const key = sanitizeGroupIdForMessagesFile(groupId);
    if (!groupsByFileKey.has(key)) groupsByFileKey.set(key, { groupId, task: null, membership });
  }

  let messageFiles: string[] = [];
  try {
    messageFiles = (await fs.readdir(path.join(root, 'messages')))
      .filter((entry) => entry.endsWith('.json'));
  } catch {
    messageFiles = [];
  }

  const chats: DreamDayGroupChatSource[] = [];
  for (const fileName of messageFiles) {
    const group = groupsByFileKey.get(fileName.slice(0, -'.json'.length));
    if (!group) continue; // Orphan cache: the group is unknown locally.
    const value = await readJsonOrNull(path.join(root, 'messages', fileName));
    const record = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
    const messages = asRecordArray(record?.messages).flatMap((entry): DreamDayGroupChatSourceMessage[] => {
      const occurredSec = timestampMs(entry.chainTimestamp);
      if (occurredSec === null) return [];
      const occurredAt = occurredSec * 1000;
      if (occurredAt < startMs || occurredAt >= endMs) return [];
      // Suspect rows failed attribution checks upstream; never attribute them.
      if (entry.senderSuspect === true) return [];
      const content = typeof entry.content === 'string' ? entry.content : '';
      if (!content.trim()) return [];
      return [{
        index: timestampMs(entry.index) ?? 0,
        pinId: normalizeText(entry.pinId) || null,
        txId: normalizeText(entry.txId) || null,
        senderName: normalizeText(entry.senderName) || null,
        senderGlobalMetaId: normalizeText(entry.senderGlobalMetaId) || null,
        content,
        occurredAt,
      }];
    });
    if (messages.length === 0) continue;
    messages.sort((left, right) => left.occurredAt - right.occurredAt || left.index - right.index);
    chats.push({ groupId: group.groupId, task: group.task, membership: group.membership, messages });
  }
  chats.sort((left, right) => (
    (left.messages[0]?.occurredAt ?? 0) - (right.messages[0]?.occurredAt ?? 0)
  ));
  return { tasks, members, chats };
}

/**
 * Best-effort read of the seller orders active inside the day (created or
 * updated in [startMs, endMs)), straight from runtime-state.json. Read-only.
 */
export async function readDreamDaySellerOrders(
  paths: MetabotPaths,
  input: { startMs: number; endMs: number },
): Promise<SellerOrderRecord[]> {
  const value = await readJsonOrNull(paths.runtimeStatePath);
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  return asRecordArray(record?.sellerOrders)
    .filter((entry) => typeof entry.id === 'string' && entry.id.trim())
    .filter((entry) => (
      inDayMs(entry.createdAt, input.startMs, input.endMs)
      || inDayMs(entry.updatedAt, input.startMs, input.endMs)
    )) as unknown as SellerOrderRecord[];
}

export interface DreamStore {
  getRun(dreamDate: string): Promise<DreamRun | null>;
  /** Run states keyed by date, the input the due-date algorithm expects. */
  getRunStates(): Promise<Map<string, DreamRun>>;
  /** Upsert a run as running; resets stale `running` records left by a crash. */
  beginRun(dreamDate: string, llm: string | null, dreamVersion: number): Promise<DreamRun>;
  finishRun(dreamDate: string, status: 'completed' | 'failed', error?: string | null): Promise<void>;
  /**
   * Mark every run left `running` longer than `staleMs` as failed — the
   * crash/restart recovery sweep (IDBots `resetStaleRunningRuns` parity). The
   * due-date algorithm skips `running` dates, so without this sweep a run
   * orphaned by a process restart would stay `running` forever. Returns the
   * number of runs reset.
   */
  resetStaleRunningRuns(options: { staleMs: number; now?: number }): Promise<number>;
  getFragment(dreamDate: string, fragmentKey: string): Promise<DreamFragment | null>;
  upsertFragment(fragment: DreamFragment): Promise<void>;
  upsertDailySummary(input: {
    summaryDate: string;
    summaryText: string;
    sections: Record<string, string>;
    stats: Record<string, number>;
    sessionRefs: DailySummarySessionRef[];
    llm: string | null;
  }): Promise<DailySummary>;
  listDailySummaries(options?: { limit?: number; before?: string }): Promise<DailySummary[]>;
  searchDailySummaries(options: {
    query?: string;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
  }): Promise<DailySummary[]>;
  /** Latest dream date that sourced the current self-identity, if any. */
  getDreamIdentityLatestDate(): Promise<string | null>;
  writeDiaryMarkdown(summary: DailySummary): Promise<void>;
  writeSelfIdentityMarkdown(text: string): Promise<void>;
  /** Gather one local calendar day's activity from transcripts + A2A stores. */
  gatherActivity(input: { startMs: number; endMs: number }): Promise<DreamDayActivity>;
}

export function createDreamStore(paths: MetabotPaths, deps: {
  getDreamIdentityLatestDate?: () => Promise<string | null>;
} = {}): DreamStore {
  const runsPath = paths.memoryDreamRunsPath;
  const summariesPath = paths.memoryDreamSummariesPath;
  let writeQueue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = writeQueue.then(task, task);
    writeQueue = run.catch(() => undefined);
    return run;
  }

  async function readRuns(): Promise<DreamRunsFile> {
    const file = await readJsonFile(
      runsPath,
      (value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return { version: 1, runs: [], fragments: [] };
        const record = value as Record<string, unknown>;
        return {
          version: 1,
          runs: Array.isArray(record.runs)
            ? record.runs.map(normalizeRun).filter((run): run is DreamRun => run !== null)
            : [],
          fragments: Array.isArray(record.fragments)
            ? record.fragments.map(normalizeFragment).filter((fragment): fragment is DreamFragment => fragment !== null)
            : [],
        };
      },
      { version: 1, runs: [], fragments: [] },
    );
    return file;
  }

  async function readSummaries(): Promise<DreamSummariesFile> {
    return readJsonFile(
      summariesPath,
      (value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return { version: 1, summaries: [] };
        const record = value as Record<string, unknown>;
        return {
          version: 1,
          summaries: Array.isArray(record.summaries)
            ? record.summaries.map(normalizeSummary).filter((summary): summary is DailySummary => summary !== null)
            : [],
        };
      },
      { version: 1, summaries: [] },
    );
  }

  return {
    async getRun(dreamDate) {
      const file = await readRuns();
      return file.runs.find((run) => run.dreamDate === dreamDate) ?? null;
    },

    async getRunStates() {
      const file = await readRuns();
      return new Map(file.runs.map((run) => [run.dreamDate, run]));
    },

    async beginRun(dreamDate, llm, dreamVersion) {
      return enqueue(async () => {
        const file = await readRuns();
        const now = Date.now();
        const existing = file.runs.find((run) => run.dreamDate === dreamDate);
        if (existing) {
          existing.status = 'running';
          existing.attemptCount += 1;
          existing.llm = llm;
          existing.dreamVersion = dreamVersion;
          existing.error = null;
          existing.startedAt = now;
          existing.completedAt = null;
          await writeJsonAtomic(runsPath, file);
          return existing;
        }
        const run: DreamRun = {
          dreamDate,
          status: 'running',
          attemptCount: 1,
          llm,
          dreamVersion,
          error: null,
          startedAt: now,
          completedAt: null,
        };
        file.runs.push(run);
        await writeJsonAtomic(runsPath, file);
        return run;
      });
    },

    async finishRun(dreamDate, status, error = null) {
      await enqueue(async () => {
        const file = await readRuns();
        const run = file.runs.find((entry) => entry.dreamDate === dreamDate);
        if (!run) return;
        run.status = status;
        run.error = status === 'failed' ? (error ?? 'unknown error') : null;
        run.completedAt = Date.now();
        await writeJsonAtomic(runsPath, file);
      });
    },

    async resetStaleRunningRuns({ staleMs, now }) {
      return enqueue(async () => {
        const file = await readRuns();
        const effectiveNow = now ?? Date.now();
        const cutoff = effectiveNow - Math.max(0, staleMs);
        let reset = 0;
        for (const run of file.runs) {
          if (run.status !== 'running' || run.startedAt > cutoff) continue;
          run.status = 'failed';
          run.error = 'stale running run reset';
          run.completedAt = effectiveNow;
          reset += 1;
        }
        if (reset > 0) await writeJsonAtomic(runsPath, file);
        return reset;
      });
    },

    async getFragment(dreamDate, fragmentKey) {
      const file = await readRuns();
      return file.fragments.find((fragment) => (
        fragment.dreamDate === dreamDate && fragment.fragmentKey === fragmentKey
      )) ?? null;
    },

    async upsertFragment(fragment) {
      await enqueue(async () => {
        const file = await readRuns();
        const index = file.fragments.findIndex((entry) => (
          entry.dreamDate === fragment.dreamDate && entry.fragmentKey === fragment.fragmentKey
        ));
        if (index >= 0) {
          file.fragments[index] = { ...fragment, updatedAt: Date.now() };
        } else {
          file.fragments.push({ ...fragment, createdAt: fragment.createdAt || Date.now(), updatedAt: Date.now() });
        }
        await writeJsonAtomic(runsPath, file);
      });
    },

    async upsertDailySummary(input) {
      return enqueue(async () => {
        const file = await readSummaries();
        const now = Date.now();
        const existing = file.summaries.find((summary) => summary.summaryDate === input.summaryDate);
        if (existing) {
          existing.summaryText = input.summaryText;
          existing.sections = input.sections;
          existing.stats = input.stats;
          existing.sessionRefs = input.sessionRefs;
          existing.llm = input.llm;
          existing.updatedAt = now;
          await writeJsonAtomic(summariesPath, file);
          await this.writeDiaryMarkdown(existing);
          return existing;
        }
        const summary: DailySummary = {
          ...input,
          createdAt: now,
          updatedAt: now,
        };
        file.summaries.push(summary);
        file.summaries.sort((left, right) => right.summaryDate.localeCompare(left.summaryDate));
        await writeJsonAtomic(summariesPath, file);
        await this.writeDiaryMarkdown(summary);
        return summary;
      });
    },

    async listDailySummaries(options = {}) {
      const file = await readSummaries();
      const limit = Math.max(1, Math.min(90, Math.floor(options.limit ?? 30)));
      return file.summaries
        .filter((summary) => !options.before || summary.summaryDate < options.before)
        .sort((left, right) => right.summaryDate.localeCompare(left.summaryDate))
        .slice(0, limit);
    },

    async searchDailySummaries(options) {
      const file = await readSummaries();
      const query = normalizeText(options.query).toLowerCase();
      const limit = Math.max(1, Math.min(30, Math.floor(options.limit ?? 10)));
      return file.summaries
        .filter((summary) => {
          if (options.dateFrom && summary.summaryDate < options.dateFrom) return false;
          if (options.dateTo && summary.summaryDate > options.dateTo) return false;
          if (!query) return true;
          return summary.summaryText.toLowerCase().includes(query)
            || Object.values(summary.sections).some((section) => section.toLowerCase().includes(query));
        })
        .sort((left, right) => right.summaryDate.localeCompare(left.summaryDate))
        .slice(0, limit);
    },

    async getDreamIdentityLatestDate() {
      return deps.getDreamIdentityLatestDate ? deps.getDreamIdentityLatestDate() : null;
    },

    async writeDiaryMarkdown(summary) {
      await fs.mkdir(paths.workspaceMemoryRoot, { recursive: true });
      const diaryPath = path.join(paths.workspaceMemoryRoot, `${summary.summaryDate}.md`);
      await fs.writeFile(diaryPath, renderDreamDiaryMarkdown(summary), 'utf8');
    },

    async writeSelfIdentityMarkdown(text) {
      await fs.mkdir(paths.workspaceMemoryRoot, { recursive: true });
      await fs.writeFile(paths.memorySelfIdentityPath, `${text.trim()}\n`, 'utf8');
    },

    async gatherActivity({ startMs, endMs }) {
      const sessions: DreamSessionActivity[] = [];

      // Mirrored DSH transcripts: one session per file.
      let transcriptIds: string[] = [];
      try {
        transcriptIds = (await fs.readdir(paths.memoryTranscriptsRoot))
          .filter((entry) => entry.endsWith('.jsonl'))
          .map((entry) => entry.slice(0, -'.jsonl'.length));
      } catch {
        transcriptIds = [];
      }
      for (const sessionId of transcriptIds) {
        const turns = await readTranscript(paths, sessionId);
        const dayTurns = turns.filter((turn) => turn.ts >= startMs && turn.ts < endMs);
        if (dayTurns.length === 0) continue;
        const channel = dayTurns[0].channel || 'dsh';
        const peer = dayTurns.find((turn) => turn.peerGlobalMetaId)?.peerGlobalMetaId ?? null;
        sessions.push({
          sessionId,
          title: peer ? `${channel} 会话(${peer})` : `${channel} 会话 ${sessionId}`,
          sessionType: channel === 'dsh' ? 'human' : channel,
          peerName: peer,
          isOrder: false,
          messages: dayTurns.map((turn) => ({
            type: turn.role,
            content: turn.text,
            createdAt: turn.ts,
          })),
        });
      }

      // On-chain A2A conversations: one session per peer file.
      let a2aFiles: string[] = [];
      try {
        a2aFiles = (await fs.readdir(paths.a2aRoot))
          .filter((entry) => entry.startsWith('chat-') && entry.endsWith('.json'));
      } catch {
        a2aFiles = [];
      }
      for (const fileName of a2aFiles) {
        let conversation: {
          peer?: { globalMetaId?: string | null; name?: string | null } | null;
          messages?: Array<{ direction?: string; content?: string; timestamp?: number }>;
        } | null = null;
        try {
          conversation = JSON.parse(await fs.readFile(path.join(paths.a2aRoot, fileName), 'utf8'));
        } catch {
          continue;
        }
        if (!conversation || !Array.isArray(conversation.messages)) continue;
        const dayMessages = conversation.messages.filter((message) => (
          typeof message?.content === 'string'
          && message.content.trim()
          && typeof message.timestamp === 'number'
          && message.timestamp >= startMs
          && message.timestamp < endMs
        ));
        if (dayMessages.length === 0) continue;
        const peerName = normalizeText(conversation.peer?.name) || null;
        const peerId = normalizeText(conversation.peer?.globalMetaId) || fileName;
        sessions.push({
          sessionId: fileName.slice(0, -'.json'.length),
          title: peerName ? `A2A 私聊(${peerName})` : `A2A 私聊(${peerId})`,
          sessionType: 'a2a',
          peerName,
          isOrder: false,
          messages: dayMessages.map((message) => ({
            type: message.direction === 'outgoing' ? 'assistant' as const : 'user' as const,
            content: (message.content ?? '').replace(/\s+/g, ' ').trim(),
            createdAt: message.timestamp ?? 0,
          })),
        });
      }

      sessions.sort((left, right) => (
        (left.messages[0]?.createdAt ?? 0) - (right.messages[0]?.createdAt ?? 0)
      ));

      // Group tasks + on-chain group chats + seller orders (IDBots
      // getActivityForDate parity), all best-effort reads of local mirrors.
      const slug = path.basename(paths.profileRoot);
      const groupTaskSource = await readDreamDayGroupTaskSource(paths, { startMs, endMs });
      const dayOrders = await readDreamDaySellerOrders(paths, { startMs, endMs });

      // Same-day message counts per group feed both the chat excerpts and the
      // "still active" task phase (IDBots derives them from the capped chat).
      const dayMessageCountByGroupId = new Map(
        groupTaskSource.chats.map((chat) => [
          chat.groupId,
          Math.min(chat.messages.length, DREAM_GROUP_CHAT_MAX_MESSAGES),
        ]),
      );

      const groupChats: DreamGroupChatActivity[] = groupTaskSource.chats.map((chat) => ({
        // Guest groups have no local task row: taskId 0, the membership's
        // title/status, and the guest/worker role.
        taskId: chat.task?.id ?? 0,
        title: chat.task?.title ?? chat.membership?.taskTitle ?? chat.groupId,
        taskStatus: chat.task?.status ?? chat.membership?.status ?? 'executing',
        memberRole: chat.task
          ? dreamGroupTaskMemberRole(chat.task, groupTaskSource.members, slug)
          : 'worker',
        messages: chat.messages.slice(0, DREAM_GROUP_CHAT_MAX_MESSAGES).map((message) => ({
          senderName: message.senderName ?? 'unknown',
          content: message.content,
          occurredAt: message.occurredAt,
        })),
      }));

      // Accepted phase: rated or closed inside the day. Active phase: still
      // non-terminal with same-day activity (chat messages or an engine drive).
      const acceptedGroupTasks: DreamGroupTaskEvaluation[] = [];
      const activeGroupTasks: DreamGroupTaskEvaluation[] = [];
      for (const task of groupTaskSource.tasks) {
        const groupId = typeof task.groupId === 'string' ? task.groupId.trim() : '';
        const dayMessageCount = groupId ? dayMessageCountByGroupId.get(groupId) : undefined;
        const base = {
          taskId: task.id,
          title: task.title,
          goal: typeof task.goal === 'string' ? task.goal : '',
          memberRole: dreamGroupTaskMemberRole(task, groupTaskSource.members, slug),
          status: typeof task.status === 'string' ? task.status : undefined,
          ...(dayMessageCount !== undefined ? { dayMessageCount } : {}),
        };
        if (inDayMs(task.ratedAt, startMs, endMs) || inDayMs(task.closedAt, startMs, endMs)) {
          acceptedGroupTasks.push({
            ...base,
            rating: normalizeDreamRating(task.rating),
            ratingComment: normalizeText(task.ratingComment) || null,
            phase: 'accepted',
          });
          continue;
        }
        if (GROUP_TASK_TERMINAL_STATUSES.has(task.status)) continue;
        if ((dayMessageCount ?? 0) === 0 && !inDayMs(task.lastDrivenAt, startMs, endMs)) continue;
        activeGroupTasks.push({
          ...base,
          rating: null,
          ratingComment: null,
          phase: 'active',
        });
      }

      // Chain content history (own writes / full reads): timestamps are epoch
      // milliseconds, so the day window applies directly. The store caps each
      // kind at 50 entries and returns them chronological-ascending. Best
      // effort: a history-store failure must never break a dream run.
      let chainWrites: DreamChainWriteActivity[] = [];
      let chainReads: DreamChainReadActivity[] = [];
      try {
        const chainHistory = createChainHistoryStore(paths);
        chainWrites = (await chainHistory.listWritesForDay({ startMs, endMs })).map((record) => ({
          pinId: record.pinId,
          path: record.path,
          operation: record.operation,
          occurredAtMs: record.occurredAtMs,
          summary: record.summary,
          contentText: record.contentText,
          contentType: record.contentType,
        }));
        chainReads = (await chainHistory.listReadsForDay({ startMs, endMs })).map((record) => ({
          pinId: record.pinId,
          path: record.path,
          protocol: record.protocol,
          title: record.title,
          authorGlobalMetaId: record.authorGlobalMetaId,
          summary: record.summary,
          contentExcerpt: record.contentExcerpt,
          savedToKb: record.savedToKb,
          readCount: record.readCount,
          lastReadAtMs: record.lastReadAtMs,
        }));
      } catch {
        chainWrites = [];
        chainReads = [];
      }

      return {
        sessions,
        // OAC has no scheduled-task feature; the prompt section stays empty.
        taskRuns: [],
        orderCount: dayOrders.length,
        groupTasks: [...acceptedGroupTasks, ...activeGroupTasks],
        groupChats,
        chainWrites,
        chainReads,
      };
    },
  };
}

/** sha256 fingerprint of one fragment's source content (resumability anchor). */
export function hashDreamFragmentContent(chunk: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(chunk)).digest('hex');
}
