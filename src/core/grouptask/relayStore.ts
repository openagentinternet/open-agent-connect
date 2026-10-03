/**
 * Source-session relay store: milestone rows the DSH host drains and injects
 * back into the chat that originated the task ("哪里发起哪里结束"). Rows carry
 * the origin DSH session id; rows without one are never emitted. Layout:
 * `.runtime/grouptask/relay.json` under the CHAIR profile's runtime root.
 * The daemon is the only writer; the CLI `grouptask relay drain` verb returns
 * pending rows and marks them drained in one step.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { MetabotPaths } from '../state/paths';
import type { GroupTaskRelayKind, GroupTaskRelayRow } from './types';

export interface GroupTaskRelayStateFile {
  seq: number;
  rows: GroupTaskRelayRow[];
}

export interface AddGroupTaskRelayInput {
  taskId: number;
  groupId: string | null;
  sessionId: string;
  kind: GroupTaskRelayKind;
  title: string;
  text: string;
}

export interface GroupTaskRelayStore {
  readonly root: string;
  add(input: AddGroupTaskRelayInput): Promise<GroupTaskRelayRow>;
  listPending(): Promise<GroupTaskRelayRow[]>;
  /** Drain semantics: return the pending rows and mark them drained. */
  drain(): Promise<GroupTaskRelayRow[]>;
}

/** Drained rows older than this are pruned on the next drain. */
const RELAY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** Upper bound on retained rows; the oldest drained rows go first. */
const RELAY_MAX_ROWS = 200;

function emptyState(): GroupTaskRelayStateFile {
  return { seq: 0, rows: [] };
}

/**
 * Bounded retention for the relay file: drop drained rows past the 30-day
 * window, then cap the total, always evicting the oldest drained rows first
 * and never a pending one.
 */
function pruneRelayRows(rows: GroupTaskRelayRow[], nowMs: number): GroupTaskRelayRow[] {
  const cutoff = nowMs - RELAY_RETENTION_MS;
  const kept = rows.filter((row) => row.drainedAt == null || row.drainedAt >= cutoff);
  if (kept.length <= RELAY_MAX_ROWS) return kept;
  const pending = kept.filter((row) => row.drainedAt == null);
  const drained = kept
    .filter((row) => row.drainedAt != null)
    .sort((left, right) => (left.drainedAt! - right.drainedAt!) || (left.id - right.id));
  const room = Math.max(0, RELAY_MAX_ROWS - pending.length);
  return [...pending, ...drained.slice(drained.length - room)].sort((left, right) => left.id - right.id);
}

export function resolveGroupTaskRelayPath(paths: MetabotPaths): string {
  return path.join(paths.runtimeRoot, 'grouptask', 'relay.json');
}

export function createGroupTaskRelayStore(paths: MetabotPaths): GroupTaskRelayStore {
  const statePath = resolveGroupTaskRelayPath(paths);

  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };

  async function readState(): Promise<GroupTaskRelayStateFile> {
    try {
      const raw = await fs.readFile(statePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<GroupTaskRelayStateFile>;
      return {
        seq: Number.isInteger(parsed.seq) && (parsed.seq as number) >= 0 ? (parsed.seq as number) : 0,
        rows: Array.isArray(parsed.rows) ? parsed.rows : [],
      };
    } catch {
      return emptyState();
    }
  }

  async function writeState(state: GroupTaskRelayStateFile): Promise<void> {
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    const tmpPath = `${statePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await fs.rename(tmpPath, statePath);
  }

  return {
    root: path.dirname(statePath),

    add: (input) => enqueue(async () => {
      const state = await readState();
      state.seq += 1;
      const row: GroupTaskRelayRow = {
        id: state.seq,
        taskId: input.taskId,
        groupId: input.groupId ?? null,
        sessionId: input.sessionId.trim(),
        kind: input.kind,
        title: input.title.trim().slice(0, 200),
        text: input.text.trim().slice(0, 2000),
        createdAt: Date.now(),
        drainedAt: null,
      };
      state.rows.push(row);
      await writeState(state);
      return row;
    }),

    listPending: async () => {
      const state = await readState();
      return state.rows.filter((row) => row.drainedAt == null);
    },

    drain: () => enqueue(async () => {
      const state = await readState();
      const pending = state.rows.filter((row) => row.drainedAt == null);
      const now = Date.now();
      for (const row of pending) row.drainedAt = now;
      const pruned = pruneRelayRows(state.rows, now);
      if (pending.length === 0 && pruned.length === state.rows.length) return [];
      state.rows = pruned;
      await writeState(state);
      return pending;
    }),
  };
}
