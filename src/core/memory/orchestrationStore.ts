// Twin orchestration bookkeeping, ported from IDBots
// src/main/orchestrationStore.ts onto `.runtime/memory/orchestration.json`.
// Durable tasks → steps → attempts with idempotency keys; the delegation
// execution itself lives in the dsh-plugin host (DSH sub-sessions), this
// store is the shared source of truth both sides read and write.
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { MetabotPaths } from '../state/paths';

export type OrchestrationTaskStatus =
  'planning' | 'running' | 'review' | 'completed' | 'failed' | 'cancelled';
export type OrchestrationStepStatus =
  'blocked' | 'ready' | 'queued' | 'running' | 'waiting_input' | 'completed' | 'failed' | 'cancelled';
export type OrchestrationAttemptStatus =
  'queued' | 'running' | 'completed' | 'failed' | 'timed_out' | 'cancelled';

export interface OrchestrationAttempt {
  id: string;
  status: OrchestrationAttemptStatus;
  dshSessionId: string | null;
  handoff: string | null;
  error: string | null;
  /** Set once the terminal notification has been delivered to the twin. */
  notifiedAt: number | null;
  startedAt: number;
  endedAt: number | null;
}

export interface OrchestrationStep {
  id: string;
  workerSlug: string;
  objective: string;
  acceptanceCriteria: string[];
  permissionScope: Record<string, unknown> | null;
  /** Step ids that must reach completed before this step becomes ready. */
  dependsOn: string[];
  idempotencyKey: string;
  status: OrchestrationStepStatus;
  attempts: OrchestrationAttempt[];
  createdAt: number;
  updatedAt: number;
}

export interface OrchestrationTask {
  id: string;
  title: string;
  goal: string;
  intent: string | null;
  ownerGlobalMetaId: string | null;
  status: OrchestrationTaskStatus;
  steps: OrchestrationStep[];
  createdAt: number;
  updatedAt: number;
}

interface OrchestrationFile {
  version: number;
  tasks: OrchestrationTask[];
}

const TASK_STATUSES: readonly string[] = ['planning', 'running', 'review', 'completed', 'failed', 'cancelled'];
const STEP_STATUSES: readonly string[] = ['blocked', 'ready', 'queued', 'running', 'waiting_input', 'completed', 'failed', 'cancelled'];
const ATTEMPT_STATUSES: readonly string[] = ['queued', 'running', 'completed', 'failed', 'timed_out', 'cancelled'];
const TERMINAL_ATTEMPT_STATUSES: readonly string[] = ['completed', 'failed', 'timed_out', 'cancelled'];

let atomicWriteSequence = 0;

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeAttempt(value: unknown): OrchestrationAttempt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = text(record.id);
  if (!id) return null;
  const status = ATTEMPT_STATUSES.includes(String(record.status)) ? record.status as OrchestrationAttemptStatus : 'queued';
  return {
    id,
    status,
    dshSessionId: text(record.dshSessionId) || null,
    handoff: typeof record.handoff === 'string' ? record.handoff : null,
    error: text(record.error) || null,
    notifiedAt: record.notifiedAt === null ? null : num(record.notifiedAt) || null,
    startedAt: num(record.startedAt),
    endedAt: record.endedAt === null ? null : num(record.endedAt) || null,
  };
}

function normalizeStep(value: unknown): OrchestrationStep | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = text(record.id);
  const workerSlug = text(record.workerSlug);
  if (!id || !workerSlug) return null;
  const status = STEP_STATUSES.includes(String(record.status)) ? record.status as OrchestrationStepStatus : 'ready';
  return {
    id,
    workerSlug,
    objective: typeof record.objective === 'string' ? record.objective : '',
    acceptanceCriteria: Array.isArray(record.acceptanceCriteria)
      ? record.acceptanceCriteria.map(text).filter(Boolean)
      : [],
    permissionScope: record.permissionScope && typeof record.permissionScope === 'object' && !Array.isArray(record.permissionScope)
      ? record.permissionScope as Record<string, unknown>
      : null,
    dependsOn: Array.isArray(record.dependsOn) ? record.dependsOn.map(text).filter(Boolean) : [],
    idempotencyKey: text(record.idempotencyKey),
    status,
    attempts: Array.isArray(record.attempts)
      ? record.attempts.map(normalizeAttempt).filter((attempt): attempt is OrchestrationAttempt => attempt !== null)
      : [],
    createdAt: num(record.createdAt),
    updatedAt: num(record.updatedAt),
  };
}

function normalizeTask(value: unknown): OrchestrationTask | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = text(record.id);
  if (!id) return null;
  const status = TASK_STATUSES.includes(String(record.status)) ? record.status as OrchestrationTaskStatus : 'planning';
  return {
    id,
    title: typeof record.title === 'string' ? record.title : '',
    goal: typeof record.goal === 'string' ? record.goal : '',
    intent: text(record.intent) || null,
    ownerGlobalMetaId: text(record.ownerGlobalMetaId) || null,
    status,
    steps: Array.isArray(record.steps)
      ? record.steps.map(normalizeStep).filter((step): step is OrchestrationStep => step !== null)
      : [],
    createdAt: num(record.createdAt),
    updatedAt: num(record.updatedAt),
  };
}

export interface CreateOrchestrationStepInput {
  workerSlug: string;
  objective: string;
  acceptanceCriteria?: string[];
  permissionScope?: Record<string, unknown> | null;
  dependsOn?: string[];
  idempotencyKey?: string;
}

export interface OrchestrationStore {
  createTask(input: {
    title: string;
    goal: string;
    intent?: string;
    ownerGlobalMetaId?: string | null;
    steps?: CreateOrchestrationStepInput[];
  }): Promise<OrchestrationTask>;
  getTask(id: string): Promise<OrchestrationTask | null>;
  listTasks(options?: { status?: OrchestrationTaskStatus; limit?: number }): Promise<OrchestrationTask[]>;
  updateTaskStatus(id: string, status: OrchestrationTaskStatus): Promise<OrchestrationTask | null>;
  updateStep(taskId: string, stepId: string, patch: {
    status?: OrchestrationStepStatus;
    workerSlug?: string;
  }): Promise<OrchestrationStep | null>;
  addAttempt(taskId: string, stepId: string, input?: { dshSessionId?: string | null }): Promise<OrchestrationAttempt | null>;
  updateAttempt(taskId: string, stepId: string, attemptId: string, patch: {
    status?: OrchestrationAttemptStatus;
    dshSessionId?: string | null;
    handoff?: string | null;
    error?: string | null;
  }): Promise<OrchestrationAttempt | null>;
  markAttemptNotified(taskId: string, stepId: string, attemptId: string): Promise<void>;
  /** Terminal attempts whose twin notification has not been delivered yet. */
  listUnnotifiedTerminalAttempts(): Promise<Array<{ task: OrchestrationTask; step: OrchestrationStep; attempt: OrchestrationAttempt }>>;
  /** Running/queued workload of one worker (for roster availability). */
  activeStepCountForWorker(workerSlug: string): Promise<number>;
  findStepByIdempotencyKey(key: string): Promise<{ task: OrchestrationTask; step: OrchestrationStep } | null>;
}

export function createOrchestrationStore(paths: MetabotPaths): OrchestrationStore {
  const filePath = paths.memoryOrchestrationPath;
  let writeQueue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = writeQueue.then(task, task);
    writeQueue = run.catch(() => undefined);
    return run;
  }

  async function readFile(): Promise<OrchestrationFile> {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { version: 1, tasks: [] };
      const tasks = Array.isArray((parsed as Record<string, unknown>).tasks)
        ? ((parsed as Record<string, unknown>).tasks as unknown[])
          .map(normalizeTask)
          .filter((task): task is OrchestrationTask => task !== null)
        : [];
      return { version: 1, tasks };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, tasks: [] };
      throw error;
    }
  }

  async function writeFile(next: OrchestrationFile): Promise<void> {
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

  function findStep(file: OrchestrationFile, taskId: string, stepId: string) {
    const task = file.tasks.find((entry) => entry.id === taskId) ?? null;
    const step = task?.steps.find((entry) => entry.id === stepId) ?? null;
    return { task, step };
  }

  return {
    async createTask(input) {
      return enqueue(async () => {
        const title = text(input.title);
        if (!title) throw new Error('title is required');
        const file = await readFile();
        const now = Date.now();
        const usedKeys = new Set(
          file.tasks.flatMap((task) => task.steps.map((step) => step.idempotencyKey)).filter(Boolean),
        );
        const steps: OrchestrationStep[] = (input.steps ?? []).map((stepInput, index) => {
          const workerSlug = text(stepInput.workerSlug);
          if (!workerSlug) throw new Error('steps[].workerSlug is required');
          const idempotencyKey = text(stepInput.idempotencyKey)
            || `step:${crypto.createHash('sha1').update(`${title}|${workerSlug}|${index}|${now}`).digest('hex').slice(0, 16)}`;
          if (usedKeys.has(idempotencyKey)) {
            throw new Error(`idempotencyKey already in use: ${idempotencyKey}`);
          }
          usedKeys.add(idempotencyKey);
          const dependsOn = (stepInput.dependsOn ?? []).map(text).filter(Boolean);
          return {
            id: `step_${crypto.randomUUID()}`,
            workerSlug,
            objective: typeof stepInput.objective === 'string' ? stepInput.objective : '',
            acceptanceCriteria: (stepInput.acceptanceCriteria ?? []).map(text).filter(Boolean),
            permissionScope: stepInput.permissionScope ?? null,
            dependsOn,
            idempotencyKey,
            status: dependsOn.length > 0 ? 'blocked' as const : 'ready' as const,
            attempts: [],
            createdAt: now,
            updatedAt: now,
          };
        });
        const task: OrchestrationTask = {
          id: `task_${crypto.randomUUID()}`,
          title,
          goal: typeof input.goal === 'string' ? input.goal : '',
          intent: text(input.intent) || null,
          ownerGlobalMetaId: text(input.ownerGlobalMetaId) || null,
          status: 'planning',
          steps,
          createdAt: now,
          updatedAt: now,
        };
        file.tasks.push(task);
        await writeFile(file);
        return task;
      });
    },

    async getTask(id) {
      const file = await readFile();
      return file.tasks.find((task) => task.id === text(id)) ?? null;
    },

    async listTasks(options = {}) {
      const file = await readFile();
      const limit = Math.min(200, Math.max(1, Math.floor(options.limit ?? 50)));
      return file.tasks
        .filter((task) => !options.status || task.status === options.status)
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, limit);
    },

    async updateTaskStatus(id, status) {
      return enqueue(async () => {
        const file = await readFile();
        const task = file.tasks.find((entry) => entry.id === text(id));
        if (!task) return null;
        task.status = status;
        task.updatedAt = Date.now();
        await writeFile(file);
        return task;
      });
    },

    async updateStep(taskId, stepId, patch) {
      return enqueue(async () => {
        const file = await readFile();
        const { task, step } = findStep(file, taskId, stepId);
        if (!task || !step) return null;
        if (patch.status !== undefined) step.status = patch.status;
        if (patch.workerSlug !== undefined && text(patch.workerSlug)) step.workerSlug = text(patch.workerSlug);
        step.updatedAt = Date.now();
        task.updatedAt = step.updatedAt;
        await writeFile(file);
        return step;
      });
    },

    async addAttempt(taskId, stepId, input = {}) {
      return enqueue(async () => {
        const file = await readFile();
        const { task, step } = findStep(file, taskId, stepId);
        if (!task || !step) return null;
        const now = Date.now();
        const attempt: OrchestrationAttempt = {
          id: `att_${crypto.randomUUID()}`,
          status: 'queued',
          dshSessionId: text(input.dshSessionId) || null,
          handoff: null,
          error: null,
          notifiedAt: null,
          startedAt: now,
          endedAt: null,
        };
        step.attempts.push(attempt);
        step.updatedAt = now;
        task.updatedAt = now;
        await writeFile(file);
        return attempt;
      });
    },

    async updateAttempt(taskId, stepId, attemptId, patch) {
      return enqueue(async () => {
        const file = await readFile();
        const { task, step } = findStep(file, taskId, stepId);
        const attempt = step?.attempts.find((entry) => entry.id === attemptId) ?? null;
        if (!task || !step || !attempt) return null;
        if (patch.status !== undefined) {
          attempt.status = patch.status;
          if (TERMINAL_ATTEMPT_STATUSES.includes(patch.status) && !attempt.endedAt) {
            attempt.endedAt = Date.now();
          }
        }
        if (patch.dshSessionId !== undefined) attempt.dshSessionId = text(patch.dshSessionId) || null;
        if (patch.handoff !== undefined) attempt.handoff = patch.handoff;
        if (patch.error !== undefined) attempt.error = text(patch.error) || null;
        step.updatedAt = Date.now();
        task.updatedAt = step.updatedAt;
        await writeFile(file);
        return attempt;
      });
    },

    async markAttemptNotified(taskId, stepId, attemptId) {
      await enqueue(async () => {
        const file = await readFile();
        const { task, step } = findStep(file, taskId, stepId);
        const attempt = step?.attempts.find((entry) => entry.id === attemptId) ?? null;
        if (!task || !step || !attempt) return;
        attempt.notifiedAt = Date.now();
        await writeFile(file);
      });
    },

    async listUnnotifiedTerminalAttempts() {
      const file = await readFile();
      const result: Array<{ task: OrchestrationTask; step: OrchestrationStep; attempt: OrchestrationAttempt }> = [];
      for (const task of file.tasks) {
        if (task.status === 'cancelled') continue;
        for (const step of task.steps) {
          for (const attempt of step.attempts) {
            if (TERMINAL_ATTEMPT_STATUSES.includes(attempt.status) && attempt.notifiedAt === null) {
              result.push({ task, step, attempt });
            }
          }
        }
      }
      return result;
    },

    async activeStepCountForWorker(workerSlug) {
      const file = await readFile();
      const slug = text(workerSlug);
      let count = 0;
      for (const task of file.tasks) {
        if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') continue;
        for (const step of task.steps) {
          if (step.workerSlug !== slug) continue;
          if (step.status === 'queued' || step.status === 'running' || step.status === 'waiting_input') count += 1;
        }
      }
      return count;
    },

    async findStepByIdempotencyKey(key) {
      const file = await readFile();
      const normalized = text(key);
      if (!normalized) return null;
      for (const task of file.tasks) {
        for (const step of task.steps) {
          if (step.idempotencyKey === normalized) return { task, step };
        }
      }
      return null;
    },
  };
}
