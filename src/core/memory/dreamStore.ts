// Dream consolidation storage layer, ported from IDBots src/main/dreamStore.ts
// onto the file layout (storage v2 amendment 2026-08-20):
// - `.runtime/memory/dream-runs.json`: run records (the idempotency anchor,
//   unique per dream date) + the resumable fragment cache.
// - `.runtime/memory/dream-summaries.json`: structured daily summaries.
// - `memory/YYYY-MM-DD.md`: the human-readable diary mirror.
// Also owns the "what did this bot do on date D" activity query, gathered from
// mirrored DSH transcripts and the on-chain A2A conversation stores.
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

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

export interface DreamDayActivity {
  sessions: DreamSessionActivity[];
  taskRuns: DreamTaskRunActivity[];
  orderCount: number;
  groupTasks: DreamGroupTaskEvaluation[];
  groupChats?: DreamGroupChatActivity[];
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

export interface DreamStore {
  getRun(dreamDate: string): Promise<DreamRun | null>;
  /** Run states keyed by date, the input the due-date algorithm expects. */
  getRunStates(): Promise<Map<string, DreamRun>>;
  /** Upsert a run as running; resets stale `running` records left by a crash. */
  beginRun(dreamDate: string, llm: string | null, dreamVersion: number): Promise<DreamRun>;
  finishRun(dreamDate: string, status: 'completed' | 'failed', error?: string | null): Promise<void>;
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

      return {
        sessions,
        taskRuns: [],
        orderCount: 0,
        groupTasks: [],
        groupChats: [],
      };
    },
  };
}

/** sha256 fingerprint of one fragment's source content (resumability anchor). */
export function hashDreamFragmentContent(chunk: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(chunk)).digest('hex');
}
