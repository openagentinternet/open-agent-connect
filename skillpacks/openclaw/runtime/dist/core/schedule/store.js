"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.STALE_RUNNING_RESET_ERROR = exports.CRASH_RECOVERY_ERROR = exports.MAX_RUNS_LIST_LIMIT = exports.MIN_INTERVAL_MS = exports.MAX_RUNS_PER_TASK = exports.SCHEDULE_HOST_LEASE_MS = exports.STALE_RUNNING_MS = void 0;
exports.validateScheduleSpec = validateScheduleSpec;
exports.computeNextRunAtMs = computeNextRunAtMs;
exports.enableWarnings = enableWarnings;
exports.createScheduleStore = createScheduleStore;
// MetaBot scheduled-task storage layer, ported from IDBots
// src/main/scheduledTaskStore.ts onto the file layout (storage v2 amendment
// 2026-09-05): `.runtime/schedule/schedule.json` holds `{version: 1, tasks,
// runs}`. Writes go through the same atomic write-then-rename plus per-store
// serialized write queue as the dream store, so in-process claim/complete
// traffic (daemon tick + daemon HTTP handlers sharing one store instance per
// profile) can never interleave read-modify-write cycles.
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const cron_1 = require("./cron");
const SCHEDULE_FILE_VERSION = 1;
/** Runs left `running` longer than this are treated as crashed and reset. */
exports.STALE_RUNNING_MS = 30 * 60 * 1000;
/** Host heartbeat lease duration: while fresh, the daemon hands `auto`/`host`
 *  tasks for that profile to the host. */
exports.SCHEDULE_HOST_LEASE_MS = 3 * 60 * 1000;
/** Run history kept per task (IDBots parity). */
exports.MAX_RUNS_PER_TASK = 100;
/** Minimum interval between fires for interval tasks. */
exports.MIN_INTERVAL_MS = 60_000;
/** Maximum run-history page a caller may request. */
exports.MAX_RUNS_LIST_LIMIT = 1000;
exports.CRASH_RECOVERY_ERROR = 'Process stopped during execution';
exports.STALE_RUNNING_RESET_ERROR = 'stale running run reset';
const CHANNELS = new Set(['auto', 'host', 'daemon']);
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
let atomicWriteSequence = 0;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeFiniteNumber(value, fallback = null) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function isoNow(nowMs) {
    return new Date(nowMs).toISOString();
}
function parseIsoMs(value) {
    if (!value)
        return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
}
function validateScheduleSpec(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { spec: null, error: 'schedule must be an object.' };
    }
    const record = value;
    if (record.type === 'at') {
        const datetime = normalizeText(record.datetime);
        if (!datetime || !Number.isFinite(Date.parse(datetime))) {
            return { spec: null, error: 'schedule.at datetime must be a parseable local wall-clock ISO datetime.' };
        }
        return { spec: { type: 'at', datetime }, error: null };
    }
    if (record.type === 'interval') {
        const intervalMs = normalizeFiniteNumber(record.intervalMs);
        if (intervalMs === null || !Number.isInteger(intervalMs) || intervalMs < exports.MIN_INTERVAL_MS) {
            return { spec: null, error: `schedule.interval intervalMs must be an integer >= ${exports.MIN_INTERVAL_MS}.` };
        }
        return { spec: { type: 'interval', intervalMs }, error: null };
    }
    if (record.type === 'cron') {
        const expression = normalizeText(record.expression);
        try {
            (0, cron_1.parseCronExpression)(expression);
        }
        catch {
            return { spec: null, error: 'schedule.cron expression must be a valid 5-field cron expression.' };
        }
        return { spec: { type: 'cron', expression }, error: null };
    }
    return { spec: null, error: 'schedule.type must be at, interval, or cron.' };
}
function normalizeScheduleSpec(value) {
    return validateScheduleSpec(value).spec;
}
function normalizeChannel(value) {
    return CHANNELS.has(value) ? value : 'auto';
}
function normalizeExpiresAt(value) {
    if (value === null)
        return null;
    const text = normalizeText(value);
    return text && DATE_ONLY_RE.test(text) ? text : null;
}
function normalizeTaskState(value) {
    const record = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
    const lastStatus = record.lastStatus;
    return {
        nextRunAtMs: normalizeFiniteNumber(record.nextRunAtMs),
        lastRunAtMs: normalizeFiniteNumber(record.lastRunAtMs),
        lastStatus: lastStatus === 'success' || lastStatus === 'error' || lastStatus === 'running'
            ? lastStatus
            : null,
        lastError: normalizeText(record.lastError) || null,
        lastDurationMs: normalizeFiniteNumber(record.lastDurationMs),
        runningAtMs: normalizeFiniteNumber(record.runningAtMs),
        consecutiveErrors: Math.max(0, Math.floor(normalizeFiniteNumber(record.consecutiveErrors, 0) ?? 0)),
    };
}
function normalizeTask(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const record = value;
    const id = normalizeText(record.id);
    const name = normalizeText(record.name);
    const prompt = normalizeText(record.prompt);
    const schedule = normalizeScheduleSpec(record.schedule);
    if (!id || !name || !prompt || !schedule)
        return null;
    const createdAt = normalizeText(record.createdAt);
    return {
        id,
        name,
        description: normalizeText(record.description),
        enabled: record.enabled !== false,
        schedule,
        prompt,
        workingDirectory: normalizeText(record.workingDirectory),
        channel: normalizeChannel(record.channel),
        expiresAt: normalizeExpiresAt(record.expiresAt),
        state: normalizeTaskState(record.state),
        createdAt: createdAt || new Date(0).toISOString(),
        updatedAt: normalizeText(record.updatedAt) || createdAt || new Date(0).toISOString(),
    };
}
function normalizeRun(value, nowMs) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const record = value;
    const id = normalizeText(record.id);
    const taskId = normalizeText(record.taskId);
    if (!id || !taskId)
        return null;
    const status = record.status;
    let runStatus = status === 'success' || status === 'error' ? status : 'running';
    let error = normalizeText(record.error) || null;
    let finishedAt = normalizeText(record.finishedAt) || null;
    // Crash recovery: a run left `running` by a process that stopped is flipped
    // to error on load, without touching the task's consecutiveErrors counter.
    if (runStatus === 'running') {
        runStatus = 'error';
        error = exports.CRASH_RECOVERY_ERROR;
        finishedAt = finishedAt || isoNow(nowMs);
    }
    const executor = record.executor;
    return {
        id,
        taskId,
        status: runStatus,
        trigger: record.trigger === 'manual' ? 'manual' : 'scheduled',
        executor: executor === 'daemon' || executor === 'host' || executor === 'cli' ? executor : null,
        startedAt: normalizeText(record.startedAt) || isoNow(nowMs),
        finishedAt,
        durationMs: normalizeFiniteNumber(record.durationMs),
        error,
    };
}
function utcToday(nowMs) {
    return new Date(nowMs).toISOString().slice(0, 10);
}
/** An expired task (`expiresAt <=` UTC today) never fires. */
function isExpired(task, nowMs) {
    return task.expiresAt !== null && task.expiresAt <= utcToday(nowMs);
}
/** Local wall-clock epoch of an `at` datetime (no timezone suffix). */
function atDatetimeMs(task) {
    if (task.schedule.type !== 'at')
        return NaN;
    return Date.parse(task.schedule.datetime);
}
function computeNextRunAtMs(task, nowMs) {
    if (!task.enabled)
        return null;
    const schedule = task.schedule;
    if (schedule.type === 'at') {
        const ms = Date.parse(schedule.datetime);
        return Number.isFinite(ms) ? ms : null;
    }
    if (schedule.type === 'interval') {
        return nowMs + Math.max(exports.MIN_INTERVAL_MS, Math.floor(schedule.intervalMs));
    }
    return (0, cron_1.nextCronOccurrence)(schedule.expression, nowMs);
}
/** Warnings for enabling a task: expired, or a one-shot `at` in the past. */
function enableWarnings(task, nowMs) {
    const warnings = [];
    if (isExpired(task, nowMs))
        warnings.push('TASK_EXPIRED');
    if (task.schedule.type === 'at' && Number.isFinite(atDatetimeMs(task)) && atDatetimeMs(task) <= nowMs) {
        warnings.push('TASK_AT_PAST');
    }
    return warnings;
}
function pruneRuns(runs) {
    const counts = new Map();
    const kept = [];
    // Newest first so the per-task cap keeps the most recent runs.
    const sorted = [...runs].sort((left, right) => (parseIsoMs(right.startedAt) ?? 0) - (parseIsoMs(left.startedAt) ?? 0));
    for (const run of sorted) {
        const count = (counts.get(run.taskId) ?? 0) + 1;
        if (count > exports.MAX_RUNS_PER_TASK)
            continue;
        counts.set(run.taskId, count);
        kept.push(run);
    }
    return kept.sort((left, right) => (parseIsoMs(left.startedAt) ?? 0) - (parseIsoMs(right.startedAt) ?? 0));
}
function createScheduleStore(paths) {
    const storePath = paths.schedulePath;
    let writeQueue = Promise.resolve();
    function enqueue(task) {
        const run = writeQueue.then(task, task);
        writeQueue = run.catch(() => undefined);
        return run;
    }
    async function writeJsonAtomic(file) {
        await node_fs_1.promises.mkdir(node_path_1.default.dirname(storePath), { recursive: true });
        atomicWriteSequence += 1;
        const tempPath = `${storePath}.${process.pid}.${Date.now()}.${atomicWriteSequence}.tmp`;
        try {
            await node_fs_1.promises.writeFile(tempPath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
            await node_fs_1.promises.rename(tempPath, storePath);
        }
        catch (error) {
            await node_fs_1.promises.rm(tempPath, { force: true }).catch(() => undefined);
            throw error;
        }
    }
    async function readScheduleFile(nowMs) {
        try {
            const raw = await node_fs_1.promises.readFile(storePath, 'utf8');
            const value = JSON.parse(raw);
            if (!value || typeof value !== 'object' || Array.isArray(value)) {
                return { version: SCHEDULE_FILE_VERSION, tasks: [], runs: [] };
            }
            const record = value;
            return {
                version: SCHEDULE_FILE_VERSION,
                tasks: Array.isArray(record.tasks)
                    ? record.tasks.map(normalizeTask).filter((task) => task !== null)
                    : [],
                runs: Array.isArray(record.runs)
                    ? record.runs.map((run) => normalizeRun(run, nowMs)).filter((run) => run !== null)
                    : [],
            };
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                return { version: SCHEDULE_FILE_VERSION, tasks: [], runs: [] };
            }
            // Corrupt files behave like an empty store; writes recreate the file.
            if (error instanceof SyntaxError) {
                return { version: SCHEDULE_FILE_VERSION, tasks: [], runs: [] };
            }
            throw error;
        }
    }
    /**
     * Settle a task left `running` longer than the stale threshold (a crashed
     * host never wedges the task). The run row itself was already flipped to
     * error by the load-time crash recovery; this clears the in-flight marker
     * and recomputes the next occurrence from now so the fire-once catch-up
     * rule applies without an interval storm.
     */
    async function sweepStaleClaims(file, nowMs) {
        let changed = false;
        for (const task of file.tasks) {
            if (task.state.runningAtMs === null)
                continue;
            if (task.state.runningAtMs > nowMs - exports.STALE_RUNNING_MS)
                continue;
            task.state.runningAtMs = null;
            task.state.nextRunAtMs = computeNextRunAtMs(task, nowMs);
            task.updatedAt = isoNow(nowMs);
            changed = true;
        }
        return changed;
    }
    return {
        async listTasks() {
            const file = await readScheduleFile(Date.now());
            return file.tasks;
        },
        async getTask(id) {
            const file = await readScheduleFile(Date.now());
            return file.tasks.find((task) => task.id === id) ?? null;
        },
        async createTask(input, options = {}) {
            const nowMs = options.now ?? Date.now();
            const { spec, error } = validateScheduleSpec(input.schedule);
            if (!spec)
                throw new Error(error ?? 'invalid schedule');
            const name = normalizeText(input.name);
            const prompt = normalizeText(input.prompt);
            if (!name)
                throw new Error('name is required.');
            if (!prompt)
                throw new Error('prompt is required.');
            if (input.expiresAt !== undefined && input.expiresAt !== null && !DATE_ONLY_RE.test(normalizeText(input.expiresAt))) {
                throw new Error('expiresAt must be a date-only YYYY-MM-DD string or null.');
            }
            const channel = input.channel !== undefined
                ? normalizeChannel(input.channel)
                : 'auto';
            if (input.channel !== undefined && !CHANNELS.has(input.channel)) {
                throw new Error('channel must be auto, host, or daemon.');
            }
            return enqueue(async () => {
                const nowIso = isoNow(nowMs);
                const task = {
                    id: node_crypto_1.default.randomUUID(),
                    name,
                    description: normalizeText(input.description),
                    enabled: input.enabled !== false,
                    schedule: spec,
                    prompt,
                    workingDirectory: normalizeText(input.workingDirectory),
                    channel,
                    expiresAt: input.expiresAt === undefined ? null : normalizeExpiresAt(input.expiresAt),
                    state: {
                        nextRunAtMs: null,
                        lastRunAtMs: null,
                        lastStatus: null,
                        lastError: null,
                        lastDurationMs: null,
                        runningAtMs: null,
                        consecutiveErrors: 0,
                    },
                    createdAt: nowIso,
                    updatedAt: nowIso,
                };
                task.state.nextRunAtMs = computeNextRunAtMs(task, nowMs);
                const file = await readScheduleFile(nowMs);
                file.tasks.push(task);
                await writeJsonAtomic(file);
                return task;
            });
        },
        async updateTask(id, partial, options = {}) {
            const nowMs = options.now ?? Date.now();
            return enqueue(async () => {
                const file = await readScheduleFile(nowMs);
                const task = file.tasks.find((entry) => entry.id === id);
                if (!task)
                    return { notFound: true };
                if (partial.name !== undefined) {
                    const name = normalizeText(partial.name);
                    if (!name)
                        throw new Error('name must not be empty.');
                    task.name = name;
                }
                if (partial.description !== undefined)
                    task.description = normalizeText(partial.description);
                if (partial.prompt !== undefined) {
                    const prompt = normalizeText(partial.prompt);
                    if (!prompt)
                        throw new Error('prompt must not be empty.');
                    task.prompt = prompt;
                }
                if (partial.workingDirectory !== undefined)
                    task.workingDirectory = normalizeText(partial.workingDirectory);
                if (partial.channel !== undefined) {
                    if (!CHANNELS.has(partial.channel))
                        throw new Error('channel must be auto, host, or daemon.');
                    task.channel = partial.channel;
                }
                if (partial.expiresAt !== undefined) {
                    if (partial.expiresAt !== null && !DATE_ONLY_RE.test(normalizeText(partial.expiresAt))) {
                        throw new Error('expiresAt must be a date-only YYYY-MM-DD string or null.');
                    }
                    task.expiresAt = partial.expiresAt === null ? null : normalizeText(partial.expiresAt);
                }
                let scheduleChanged = false;
                if (partial.schedule !== undefined) {
                    const { spec, error } = validateScheduleSpec(partial.schedule);
                    if (!spec)
                        throw new Error(error ?? 'invalid schedule');
                    task.schedule = spec;
                    scheduleChanged = true;
                }
                let enabledChanged = false;
                if (partial.enabled !== undefined && partial.enabled !== task.enabled) {
                    task.enabled = partial.enabled;
                    enabledChanged = true;
                }
                if (scheduleChanged || enabledChanged) {
                    if (!task.enabled) {
                        task.state.nextRunAtMs = null;
                    }
                    else {
                        task.state.nextRunAtMs = computeNextRunAtMs(task, nowMs);
                    }
                }
                task.updatedAt = isoNow(nowMs);
                const warnings = partial.enabled === true ? enableWarnings(task, nowMs) : [];
                await writeJsonAtomic(file);
                return { task, warnings };
            });
        },
        async deleteTask(id) {
            return enqueue(async () => {
                const file = await readScheduleFile(Date.now());
                const before = file.tasks.length;
                file.tasks = file.tasks.filter((task) => task.id !== id);
                if (file.tasks.length === before)
                    return { deleted: false };
                file.runs = file.runs.filter((run) => run.taskId !== id);
                await writeJsonAtomic(file);
                return { deleted: true };
            });
        },
        async setEnabled(id, enabled, options = {}) {
            const nowMs = options.now ?? Date.now();
            return enqueue(async () => {
                const file = await readScheduleFile(nowMs);
                const task = file.tasks.find((entry) => entry.id === id);
                if (!task)
                    return { notFound: true };
                task.enabled = enabled;
                task.state.nextRunAtMs = enabled ? computeNextRunAtMs(task, nowMs) : null;
                task.updatedAt = isoNow(nowMs);
                const warnings = enabled ? enableWarnings(task, nowMs) : [];
                await writeJsonAtomic(file);
                return { task, warnings };
            });
        },
        async listDue(options = {}) {
            const nowMs = options.now ?? Date.now();
            return enqueue(async () => {
                const file = await readScheduleFile(nowMs);
                const swept = await sweepStaleClaims(file, nowMs);
                if (swept)
                    await writeJsonAtomic(file);
                return file.tasks
                    .filter((task) => (task.enabled
                    && !isExpired(task, nowMs)
                    && task.state.runningAtMs === null
                    && task.state.nextRunAtMs !== null
                    && task.state.nextRunAtMs <= nowMs))
                    .sort((left, right) => (left.state.nextRunAtMs ?? 0) - (right.state.nextRunAtMs ?? 0));
            });
        },
        async claim(id, input, options = {}) {
            const nowMs = options.now ?? Date.now();
            return enqueue(async () => {
                const file = await readScheduleFile(nowMs);
                const swept = await sweepStaleClaims(file, nowMs);
                if (swept)
                    await writeJsonAtomic(file);
                const task = file.tasks.find((entry) => entry.id === id);
                if (!task)
                    return { ok: false, code: 'task_not_found' };
                if (isExpired(task, nowMs))
                    return { ok: false, code: 'task_expired' };
                if (task.state.runningAtMs !== null) {
                    return { ok: false, code: 'already_running' };
                }
                const run = {
                    id: node_crypto_1.default.randomUUID(),
                    taskId: task.id,
                    status: 'running',
                    trigger: input.trigger,
                    executor: input.executor,
                    startedAt: isoNow(nowMs),
                    finishedAt: null,
                    durationMs: null,
                    error: null,
                };
                task.state.runningAtMs = nowMs;
                task.updatedAt = isoNow(nowMs);
                file.runs.push(run);
                file.runs = pruneRuns(file.runs);
                await writeJsonAtomic(file);
                return { ok: true, run, task };
            });
        },
        async complete(runId, input, options = {}) {
            const nowMs = options.now ?? Date.now();
            return enqueue(async () => {
                const file = await readScheduleFile(nowMs);
                const run = file.runs.find((entry) => entry.id === runId);
                if (!run)
                    return { notFound: true };
                const task = file.tasks.find((entry) => entry.id === run.taskId) ?? null;
                // The claim-holder check makes settling run-aware: bookkeeping only
                // applies when THIS run holds the task's in-flight marker. A dead
                // host's late completion (its run already flipped to error by the
                // load recovery) must never clear the daemon's fresh claim — that
                // would reopen the no-overlap guard.
                const isClaimHolder = task !== null
                    && task.state.runningAtMs !== null
                    && parseIsoMs(run.startedAt) === task.state.runningAtMs;
                if (!isClaimHolder)
                    return { settled: false, run, task };
                const error = input.error !== undefined && input.error !== null ? String(input.error) : null;
                run.status = error ? 'error' : 'success';
                run.error = error;
                run.finishedAt = isoNow(nowMs);
                const startedAtMs = parseIsoMs(run.startedAt) ?? nowMs;
                run.durationMs = input.durationMs !== undefined && input.durationMs !== null
                    ? Math.max(0, Math.floor(input.durationMs))
                    : Math.max(0, nowMs - startedAtMs);
                task.state.runningAtMs = null;
                task.state.lastRunAtMs = startedAtMs;
                task.state.lastStatus = run.status;
                task.state.lastError = run.error;
                task.state.lastDurationMs = run.durationMs;
                if (run.status === 'success') {
                    task.state.consecutiveErrors = 0;
                }
                else {
                    task.state.consecutiveErrors += 1;
                }
                // Auto-disable: one-shot `at` tasks after any execution, and any
                // task after 5 consecutive errors.
                if (task.schedule.type === 'at' || task.state.consecutiveErrors >= 5) {
                    task.enabled = false;
                }
                task.state.nextRunAtMs = computeNextRunAtMs(task, nowMs);
                task.updatedAt = isoNow(nowMs);
                file.runs = pruneRuns(file.runs);
                await writeJsonAtomic(file);
                return { settled: true, run, task };
            });
        },
        async listRuns(options = {}) {
            const file = await readScheduleFile(Date.now());
            const limit = options.limit === undefined
                ? exports.MAX_RUNS_LIST_LIMIT
                : Math.max(1, Math.min(exports.MAX_RUNS_LIST_LIMIT, Math.floor(options.limit)));
            const runs = file.runs
                .filter((run) => !options.taskId || run.taskId === options.taskId)
                .sort((left, right) => (parseIsoMs(right.startedAt) ?? 0) - (parseIsoMs(left.startedAt) ?? 0));
            return runs.slice(0, limit);
        },
    };
}
