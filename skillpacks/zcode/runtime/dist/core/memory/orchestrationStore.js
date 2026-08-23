"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOrchestrationStore = createOrchestrationStore;
// Twin orchestration bookkeeping, ported from IDBots
// src/main/orchestrationStore.ts onto `.runtime/memory/orchestration.json`.
// Durable tasks → steps → attempts with idempotency keys; the delegation
// execution itself lives in the dsh-plugin host (DSH sub-sessions), this
// store is the shared source of truth both sides read and write.
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const TASK_STATUSES = ['planning', 'running', 'review', 'completed', 'failed', 'cancelled'];
const STEP_STATUSES = ['blocked', 'ready', 'queued', 'running', 'waiting_input', 'completed', 'failed', 'cancelled'];
const ATTEMPT_STATUSES = ['queued', 'running', 'completed', 'failed', 'timed_out', 'cancelled'];
const TERMINAL_ATTEMPT_STATUSES = ['completed', 'failed', 'timed_out', 'cancelled'];
let atomicWriteSequence = 0;
const text = (value) => (typeof value === 'string' ? value.trim() : '');
function num(value, fallback = 0) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function normalizeAttempt(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const record = value;
    const id = text(record.id);
    if (!id)
        return null;
    const status = ATTEMPT_STATUSES.includes(String(record.status)) ? record.status : 'queued';
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
function normalizeStep(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const record = value;
    const id = text(record.id);
    const workerSlug = text(record.workerSlug);
    if (!id || !workerSlug)
        return null;
    const status = STEP_STATUSES.includes(String(record.status)) ? record.status : 'ready';
    return {
        id,
        workerSlug,
        objective: typeof record.objective === 'string' ? record.objective : '',
        acceptanceCriteria: Array.isArray(record.acceptanceCriteria)
            ? record.acceptanceCriteria.map(text).filter(Boolean)
            : [],
        permissionScope: record.permissionScope && typeof record.permissionScope === 'object' && !Array.isArray(record.permissionScope)
            ? record.permissionScope
            : null,
        dependsOn: Array.isArray(record.dependsOn) ? record.dependsOn.map(text).filter(Boolean) : [],
        idempotencyKey: text(record.idempotencyKey),
        status,
        attempts: Array.isArray(record.attempts)
            ? record.attempts.map(normalizeAttempt).filter((attempt) => attempt !== null)
            : [],
        createdAt: num(record.createdAt),
        updatedAt: num(record.updatedAt),
    };
}
function normalizeTask(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const record = value;
    const id = text(record.id);
    if (!id)
        return null;
    const status = TASK_STATUSES.includes(String(record.status)) ? record.status : 'planning';
    return {
        id,
        title: typeof record.title === 'string' ? record.title : '',
        goal: typeof record.goal === 'string' ? record.goal : '',
        intent: text(record.intent) || null,
        ownerGlobalMetaId: text(record.ownerGlobalMetaId) || null,
        status,
        steps: Array.isArray(record.steps)
            ? record.steps.map(normalizeStep).filter((step) => step !== null)
            : [],
        createdAt: num(record.createdAt),
        updatedAt: num(record.updatedAt),
    };
}
function createOrchestrationStore(paths) {
    const filePath = paths.memoryOrchestrationPath;
    let writeQueue = Promise.resolve();
    function enqueue(task) {
        const run = writeQueue.then(task, task);
        writeQueue = run.catch(() => undefined);
        return run;
    }
    async function readFile() {
        try {
            const raw = await node_fs_1.promises.readFile(filePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
                return { version: 1, tasks: [] };
            const tasks = Array.isArray(parsed.tasks)
                ? parsed.tasks
                    .map(normalizeTask)
                    .filter((task) => task !== null)
                : [];
            return { version: 1, tasks };
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return { version: 1, tasks: [] };
            throw error;
        }
    }
    async function writeFile(next) {
        await node_fs_1.promises.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
        atomicWriteSequence += 1;
        const tempPath = `${filePath}.${process.pid}.${Date.now()}.${atomicWriteSequence}.tmp`;
        try {
            await node_fs_1.promises.writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
            await node_fs_1.promises.rename(tempPath, filePath);
        }
        catch (error) {
            await node_fs_1.promises.rm(tempPath, { force: true }).catch(() => undefined);
            throw error;
        }
    }
    function findStep(file, taskId, stepId) {
        const task = file.tasks.find((entry) => entry.id === taskId) ?? null;
        const step = task?.steps.find((entry) => entry.id === stepId) ?? null;
        return { task, step };
    }
    return {
        async createTask(input) {
            return enqueue(async () => {
                const title = text(input.title);
                if (!title)
                    throw new Error('title is required');
                const file = await readFile();
                const now = Date.now();
                const usedKeys = new Set(file.tasks.flatMap((task) => task.steps.map((step) => step.idempotencyKey)).filter(Boolean));
                const steps = (input.steps ?? []).map((stepInput, index) => {
                    const workerSlug = text(stepInput.workerSlug);
                    if (!workerSlug)
                        throw new Error('steps[].workerSlug is required');
                    const idempotencyKey = text(stepInput.idempotencyKey)
                        || `step:${node_crypto_1.default.createHash('sha1').update(`${title}|${workerSlug}|${index}|${now}`).digest('hex').slice(0, 16)}`;
                    if (usedKeys.has(idempotencyKey)) {
                        throw new Error(`idempotencyKey already in use: ${idempotencyKey}`);
                    }
                    usedKeys.add(idempotencyKey);
                    const dependsOn = (stepInput.dependsOn ?? []).map(text).filter(Boolean);
                    return {
                        id: `step_${node_crypto_1.default.randomUUID()}`,
                        workerSlug,
                        objective: typeof stepInput.objective === 'string' ? stepInput.objective : '',
                        acceptanceCriteria: (stepInput.acceptanceCriteria ?? []).map(text).filter(Boolean),
                        permissionScope: stepInput.permissionScope ?? null,
                        dependsOn,
                        idempotencyKey,
                        status: dependsOn.length > 0 ? 'blocked' : 'ready',
                        attempts: [],
                        createdAt: now,
                        updatedAt: now,
                    };
                });
                const task = {
                    id: `task_${node_crypto_1.default.randomUUID()}`,
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
                if (!task)
                    return null;
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
                if (!task || !step)
                    return null;
                if (patch.status !== undefined)
                    step.status = patch.status;
                if (patch.workerSlug !== undefined && text(patch.workerSlug))
                    step.workerSlug = text(patch.workerSlug);
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
                if (!task || !step)
                    return null;
                const now = Date.now();
                const attempt = {
                    id: `att_${node_crypto_1.default.randomUUID()}`,
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
                if (!task || !step || !attempt)
                    return null;
                if (patch.status !== undefined) {
                    attempt.status = patch.status;
                    if (TERMINAL_ATTEMPT_STATUSES.includes(patch.status) && !attempt.endedAt) {
                        attempt.endedAt = Date.now();
                    }
                }
                if (patch.dshSessionId !== undefined)
                    attempt.dshSessionId = text(patch.dshSessionId) || null;
                if (patch.handoff !== undefined)
                    attempt.handoff = patch.handoff;
                if (patch.error !== undefined)
                    attempt.error = text(patch.error) || null;
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
                if (!task || !step || !attempt)
                    return;
                attempt.notifiedAt = Date.now();
                await writeFile(file);
            });
        },
        async listUnnotifiedTerminalAttempts() {
            const file = await readFile();
            const result = [];
            for (const task of file.tasks) {
                if (task.status === 'cancelled')
                    continue;
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
                if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled')
                    continue;
                for (const step of task.steps) {
                    if (step.workerSlug !== slug)
                        continue;
                    if (step.status === 'queued' || step.status === 'running' || step.status === 'waiting_input')
                        count += 1;
                }
            }
            return count;
        },
        async findStepByIdempotencyKey(key) {
            const file = await readFile();
            const normalized = text(key);
            if (!normalized)
                return null;
            for (const task of file.tasks) {
                for (const step of task.steps) {
                    if (step.idempotencyKey === normalized)
                        return { task, step };
                }
            }
            return null;
        },
    };
}
