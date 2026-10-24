/**
 * Long-term task persistence, on the file layout (storage layout v2): one
 * directory per module holding one JSON file per dataset — `tasks.json`,
 * `subtasks.json`, `events.json`. Writes go through atomic write-then-rename
 * plus a per-store serialized queue, the same pattern as the surf and schedule
 * stores, so a daemon tick and an HTTP handler sharing one instance can never
 * interleave a read-modify-write cycle.
 *
 * The reference implementation keeps this in SQLite with CHECK constraints and
 * a UNIQUE(task_id, ordinal). There is no SQLite anywhere in this repository,
 * so those constraints live here as write-time validation instead — a bad
 * stage, a bad sub-task status or a duplicate ordinal is refused before the
 * file is written, not after it is read.
 *
 * Deliberately NOT stored: the board column and the progress. Both are derived
 * read-time (see derive.ts); a stored copy could disagree with the sub-tasks it
 * summarises.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { deriveColumn, deriveCurrentSubtask, deriveProgress } from './derive.js';
import type {
  LongTermColumn,
  LongTermEvent,
  LongTermSubtask,
  LongTermSubtaskStatus,
  LongTermTask,
  LongTermTaskProgress,
  LongTermTaskStage,
} from './types.js';

const FILE_VERSION = 1;

/**
 * The five central-registry keys this store needs. Taking them as a structural
 * shape keeps the store free of a paths-module import while staying wired to
 * the one place paths are resolved.
 */
export interface LongTermStoreRoots {
  longtermRoot: string;
  longtermTasksPath: string;
  longtermSubtasksPath: string;
  longtermEventsPath: string;
  longtermNudgeStatePath: string;
}

export interface LongTermStorePaths {
  /** Directory holding the three JSON files. */
  root: string;
  tasksPath: string;
  subtasksPath: string;
  eventsPath: string;
  nudgeStatePath: string;
}

/** A stored sub-task carries its owning task id. */
export interface LongTermStoredSubtask extends LongTermSubtask {
  taskId: string;
}

/** One board card: the task plus its read-time derivations. */
export interface LongTermBoardCard {
  task: LongTermTask;
  column: LongTermColumn | null;
  progress: LongTermTaskProgress;
  currentSubtask: LongTermSubtask | null;
}

interface TasksFile { version: number; tasks: LongTermTask[] }
interface SubtasksFile { version: number; subtasks: LongTermStoredSubtask[] }
interface EventsFile { version: number; events: LongTermEvent[] }

/** Planner bookkeeping per task: what we already nudged, and when the owner was last seen. */
export interface LongTermNudgeState {
  taskId: string;
  lastNudgeAtMs: number;
  /** The newest journal event already seen when we nudged. */
  lastNudgedEventAtMs: number;
  lastOwnerActivityAtMs: number | null;
}
interface NudgeStateFile { version: number; states: LongTermNudgeState[] }

const TASK_STAGES: readonly LongTermTaskStage[] = ['defining', 'active', 'paused', 'done', 'cancelled'];
const SUBTASK_STATUSES: readonly LongTermSubtaskStatus[] = [
  'pending', 'in_progress', 'waiting_owner', 'waiting_external',
  'accepted', 'rejected', 'skipped',
];

const isStage = (value: unknown): value is LongTermTaskStage =>
  typeof value === 'string' && (TASK_STAGES as readonly string[]).includes(value);
const isSubtaskStatus = (value: unknown): value is LongTermSubtaskStatus =>
  typeof value === 'string' && (SUBTASK_STATUSES as readonly string[]).includes(value);
const asText = (value: unknown): string => (typeof value === 'string' ? value : '');
/** Journal-friendly clip for echoed field values (titles). */
const clip = (text: string): string => (text.length > 60 ? `${text.slice(0, 60)}…` : text);

export interface CreateTaskInput {
  id: string;
  title: string;
  goal?: string;
  stage?: LongTermTaskStage;
  nowIso: string;
}

export interface AddSubtaskInput {
  taskId: string;
  id: string;
  ordinal: number;
  title: string;
  status?: LongTermSubtaskStatus;
  dependsOn?: string[];
  expectedMinutes?: number | null;
}

export interface LongTermStore {
  createTask(input: CreateTaskInput): Promise<LongTermTask>;
  getTask(taskId: string): Promise<LongTermTask | null>;
  listTasks(): Promise<LongTermTask[]>;
  setTaskStage(taskId: string, stage: LongTermTaskStage, nowIso: string): Promise<LongTermTask | null>;
  updateTask(input: { taskId: string; title?: string; goal?: string; nowIso: string }): Promise<LongTermTask | null>;
  addSubtask(input: AddSubtaskInput): Promise<LongTermStoredSubtask>;
  listSubtasks(taskId: string): Promise<LongTermStoredSubtask[]>;
  updateSubtaskStatus(
    taskId: string, subtaskId: string, status: LongTermSubtaskStatus, nowIso: string,
  ): Promise<LongTermStoredSubtask | null>;
  addEvent(input: {
    taskId: string; subtaskId?: string | null; kind: string; actor: string;
    detail?: string | null; at: string;
  }): Promise<LongTermEvent>;
  listEvents(taskId: string): Promise<LongTermEvent[]>;
  getNudgeState(taskId: string): Promise<LongTermNudgeState | null>;
  setNudgeState(taskId: string, state: Omit<LongTermNudgeState, 'taskId'>): Promise<LongTermNudgeState>;
  /** The board: every task with its column, progress and current sub-task. */
  getBoard(): Promise<LongTermBoardCard[]>;
}

/** Build the store straight from `resolveMetabotPaths(...)`. */
export function longTermStorePaths(roots: LongTermStoreRoots): LongTermStorePaths {
  return {
    root: roots.longtermRoot,
    tasksPath: roots.longtermTasksPath,
    subtasksPath: roots.longtermSubtasksPath,
    eventsPath: roots.longtermEventsPath,
    nudgeStatePath: roots.longtermNudgeStatePath,
  };
}

export function createLongTermStore(paths: LongTermStorePaths): LongTermStore {
  // Every read-modify-write cycle runs through this chain, so two concurrent
  // callers can never drop each other's row.
  let chain: Promise<unknown> = Promise.resolve();
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = chain.then(task, task);
    chain = run.then(() => undefined, () => undefined);
    return run;
  }

  async function writeJsonAtomic(filePath: string, file: unknown): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
    await fs.rename(tmp, filePath);
  }

  async function readJsonFile<T>(filePath: string, empty: () => T, pick: (raw: Record<string, unknown>) => T): Promise<T> {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty();
      return pick(parsed as Record<string, unknown>);
    } catch {
      return empty();
    }
  }

  const emptyTasks = (): TasksFile => ({ version: FILE_VERSION, tasks: [] });
  const emptySubtasks = (): SubtasksFile => ({ version: FILE_VERSION, subtasks: [] });
  const emptyEvents = (): EventsFile => ({ version: FILE_VERSION, events: [] });
  const emptyNudgeState = (): NudgeStateFile => ({ version: FILE_VERSION, states: [] });

  const readTasks = (): Promise<TasksFile> => readJsonFile(paths.tasksPath, emptyTasks, (raw) => ({
    version: FILE_VERSION,
    tasks: Array.isArray(raw.tasks)
      ? (raw.tasks as unknown[]).filter((entry): entry is LongTermTask => {
        const row = entry as Partial<LongTermTask> | null;
        return !!row && typeof row.id === 'string' && isStage(row.stage);
      })
      : [],
  }));

  const readSubtasks = (): Promise<SubtasksFile> => readJsonFile(paths.subtasksPath, emptySubtasks, (raw) => ({
    version: FILE_VERSION,
    subtasks: Array.isArray(raw.subtasks)
      ? (raw.subtasks as unknown[]).filter((entry): entry is LongTermStoredSubtask => {
        const row = entry as Partial<LongTermStoredSubtask> | null;
        return !!row && typeof row.id === 'string' && typeof row.taskId === 'string'
          && typeof row.ordinal === 'number' && isSubtaskStatus(row.status);
      }).map((row) => ({ ...row, dependsOn: Array.isArray(row.dependsOn) ? row.dependsOn : [] }))
      : [],
  }));

  const readNudgeStates = (): Promise<NudgeStateFile> => readJsonFile(
    paths.nudgeStatePath, emptyNudgeState, (raw) => ({
      version: FILE_VERSION,
      states: Array.isArray(raw.states)
        ? (raw.states as unknown[]).filter((entry): entry is LongTermNudgeState => {
          const row = entry as Partial<LongTermNudgeState> | null;
          return !!row && typeof row.taskId === 'string' && typeof row.lastNudgeAtMs === 'number';
        })
        : [],
    }),
  );

  const readEvents = (): Promise<EventsFile> => readJsonFile(paths.eventsPath, emptyEvents, (raw) => ({
    version: FILE_VERSION,
    events: Array.isArray(raw.events)
      ? (raw.events as unknown[]).filter((entry): entry is LongTermEvent => {
        const row = entry as Partial<LongTermEvent> | null;
        return !!row && typeof row.id === 'string' && typeof row.taskId === 'string';
      })
      : [],
  }));

  async function appendEvent(event: LongTermEvent): Promise<LongTermEvent> {
    const file = await readEvents();
    file.events.push(event);
    await writeJsonAtomic(paths.eventsPath, file);
    return event;
  }

  const listTasksSorted = async (): Promise<LongTermTask[]> => {
    const file = await readTasks();
    return [...file.tasks].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  };

  return {
    async createTask(input) {
      return enqueue(async () => {
        const stage = input.stage ?? 'defining';
        if (!isStage(stage)) throw new Error(`long-term task: unknown stage "${String(input.stage)}"`);
        const id = asText(input.id);
        if (!id) throw new Error('long-term task: id is required.');
        const file = await readTasks();
        if (file.tasks.some((task) => task.id === id)) {
          throw new Error(`long-term task ${id} already exists.`);
        }
        const task: LongTermTask = {
          id,
          title: asText(input.title),
          goal: asText(input.goal),
          stage,
          currentSubtaskId: null,
          createdAt: input.nowIso,
          updatedAt: input.nowIso,
        };
        file.tasks.push(task);
        await writeJsonAtomic(paths.tasksPath, file);
        return task;
      });
    },

    async getTask(taskId) {
      const file = await readTasks();
      return file.tasks.find((task) => task.id === taskId) ?? null;
    },

    async listTasks() {
      return listTasksSorted();
    },

    async setTaskStage(taskId, stage, nowIso) {
      return enqueue(async () => {
        if (!isStage(stage)) throw new Error(`long-term task: unknown stage "${String(stage)}"`);
        const file = await readTasks();
        const task = file.tasks.find((entry) => entry.id === taskId);
        if (!task) return null;
        const previous = task.stage;
        task.stage = stage;
        task.updatedAt = nowIso;
        await writeJsonAtomic(paths.tasksPath, file);
        // A stage move is journal-worthy in the same shape as a status move:
        // the advance planner reads the journal, so a silent stage change would
        // read as silence to every later pass.
        if (previous !== stage) {
          await appendEvent({
            id: `${taskId}:task_stage:${nowIso}`,
            taskId,
            subtaskId: null,
            kind: 'task_stage',
            actor: 'local',
            detail: `${previous} -> ${stage}`,
            at: nowIso,
          });
        }
        return task;
      });
    },

    async updateTask(input) {
      return enqueue(async () => {
        if (input.title !== undefined && input.title.trim() === '') {
          throw new Error('long-term task: title must be a non-empty string when provided.');
        }
        const file = await readTasks();
        const task = file.tasks.find((entry) => entry.id === input.taskId);
        if (!task) return null;
        // The goal text is this store's interim carrier for acceptance
        // criteria, so rewriting either field is a replan-class change: journal
        // it. Titles are echoed old->new (clipped); the goal is only marked,
        // because its full text lives in the task row.
        const changes: string[] = [];
        if (input.title !== undefined && input.title !== task.title) {
          changes.push(`title: "${clip(task.title)}" -> "${clip(input.title)}"`);
          task.title = input.title;
        }
        if (input.goal !== undefined && input.goal !== task.goal) {
          changes.push('goal updated');
          task.goal = input.goal;
        }
        task.updatedAt = input.nowIso;
        await writeJsonAtomic(paths.tasksPath, file);
        if (changes.length > 0) {
          await appendEvent({
            id: `${input.taskId}:task_update:${input.nowIso}`,
            taskId: input.taskId,
            subtaskId: null,
            kind: 'task_update',
            actor: 'local',
            detail: changes.join('; '),
            at: input.nowIso,
          });
        }
        return task;
      });
    },

    async addSubtask(input) {
      return enqueue(async () => {
        const status = input.status ?? 'pending';
        if (!isSubtaskStatus(status)) {
          throw new Error(`long-term subtask: unknown status "${String(input.status)}"`);
        }
        if (!Number.isInteger(input.ordinal) || input.ordinal < 0) {
          throw new Error('long-term subtask: ordinal must be a non-negative integer.');
        }
        const tasks = await readTasks();
        if (!tasks.tasks.some((task) => task.id === input.taskId)) {
          throw new Error(`long-term subtask: no such task "${input.taskId}".`);
        }
        const file = await readSubtasks();
        // UNIQUE(task_id, ordinal) — the reference keeps this in SQL.
        const clash = file.subtasks.find(
          (row) => row.taskId === input.taskId && row.ordinal === input.ordinal,
        );
        if (clash) {
          throw new Error(
            `long-term subtask: ordinal ${input.ordinal} is already used by "${clash.id}" in task ${input.taskId}.`,
          );
        }
        if (file.subtasks.some((row) => row.taskId === input.taskId && row.id === input.id)) {
          throw new Error(`long-term subtask ${input.id} already exists in task ${input.taskId}.`);
        }
        const subtask: LongTermStoredSubtask = {
          taskId: input.taskId,
          id: input.id,
          ordinal: input.ordinal,
          title: asText(input.title),
          status,
          dependsOn: Array.isArray(input.dependsOn) ? [...input.dependsOn] : [],
          expectedMinutes:
            typeof input.expectedMinutes === 'number' && Number.isInteger(input.expectedMinutes)
              && input.expectedMinutes > 0
              ? input.expectedMinutes
              : null,
        };
        file.subtasks.push(subtask);
        await writeJsonAtomic(paths.subtasksPath, file);
        return subtask;
      });
    },

    async listSubtasks(taskId) {
      const file = await readSubtasks();
      return file.subtasks
        .filter((row) => row.taskId === taskId)
        .sort((left, right) => left.ordinal - right.ordinal);
    },

    async updateSubtaskStatus(taskId, subtaskId, status, nowIso) {
      return enqueue(async () => {
        if (!isSubtaskStatus(status)) {
          throw new Error(`long-term subtask: unknown status "${String(status)}"`);
        }
        const file = await readSubtasks();
        const row = file.subtasks.find((entry) => entry.taskId === taskId && entry.id === subtaskId);
        if (!row) return null;
        const previous = row.status;
        row.status = status;
        await writeJsonAtomic(paths.subtasksPath, file);
        if (previous !== status) {
          await appendEvent({
            id: `${taskId}:${subtaskId}:${nowIso}:${status}`,
            taskId,
            subtaskId,
            kind: 'subtask_status',
            actor: 'local',
            detail: `${previous} -> ${status}`,
            at: nowIso,
          });
        }
        const tasks = await readTasks();
        const task = tasks.tasks.find((entry) => entry.id === taskId);
        if (task) {
          task.updatedAt = nowIso;
          await writeJsonAtomic(paths.tasksPath, tasks);
        }
        return row;
      });
    },

    async addEvent(input) {
      return enqueue(() => appendEvent({
        id: `${input.taskId}:${input.kind}:${input.at}`,
        taskId: input.taskId,
        subtaskId: input.subtaskId ?? null,
        kind: input.kind,
        actor: input.actor,
        detail: input.detail ?? null,
        at: input.at,
      }));
    },

    async getNudgeState(taskId) {
      const file = await readNudgeStates();
      return file.states.find((state) => state.taskId === taskId) ?? null;
    },

    async setNudgeState(taskId, state) {
      return enqueue(async () => {
        const file = await readNudgeStates();
        const existing = file.states.findIndex((entry) => entry.taskId === taskId);
        const next: LongTermNudgeState = { taskId, ...state };
        if (existing >= 0) file.states[existing] = next;
        else file.states.push(next);
        await writeJsonAtomic(paths.nudgeStatePath, file);
        return next;
      });
    },

    async listEvents(taskId) {
      const file = await readEvents();
      return file.events
        .filter((event) => event.taskId === taskId)
        .sort((left, right) => left.at.localeCompare(right.at));
    },

    async getBoard() {
      const tasks = await listTasksSorted();
      const file = await readSubtasks();
      return tasks.map((task) => {
        const subtasks = file.subtasks
          .filter((row) => row.taskId === task.id)
          .sort((left, right) => left.ordinal - right.ordinal);
        const currentSubtask = deriveCurrentSubtask(task.currentSubtaskId, subtasks);
        return {
          task,
          column: deriveColumn(task.stage, currentSubtask?.status ?? null),
          progress: deriveProgress(subtasks),
          currentSubtask,
        };
      });
    },
  };
}
