"use strict";
/**
 * Scheduled-task daemon handler group: the /api/schedule/* verbs. Business
 * rules live in core/schedule/store; this file is wiring + input
 * normalization only (the grouptask handler-group pattern). The host lease
 * lives in the daemon process and is shared with the daemon tick via the
 * injected `hostLeases` map; `createScheduleStore` is shared too so
 * claim/complete go through the same per-profile write queue the tick uses.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeScheduleStoreInput = normalizeScheduleStoreInput;
exports.createScheduleDaemonHandlers = createScheduleDaemonHandlers;
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = require("node:fs");
const commandResult_1 = require("../core/contracts/commandResult");
const metabotProfileManager_1 = require("../core/bot/metabotProfileManager");
const paths_1 = require("../core/state/paths");
const store_1 = require("../core/schedule/store");
const service_1 = require("../core/schedule/service");
const hostLlmExecutorBridge_1 = require("../core/llm/hostLlmExecutorBridge");
const llmBindingStore_1 = require("../core/llm/llmBindingStore");
const llmRuntimeResolver_1 = require("../core/llm/llmRuntimeResolver");
const llmRuntimeStore_1 = require("../core/llm/llmRuntimeStore");
const llmRuntimeExecution_1 = require("../core/llm/llmRuntimeExecution");
const SCHEDULE_RUN_LLM_TIMEOUT_MS = 30 * 60_000;
function normalizeScheduleStoreInput(value) {
    return typeof value === 'string' ? value.trim() : '';
}
/** Resolve one local profile by slug (exact) then globalMetaId. */
async function resolveProfileBySelector(systemHomeDir, selector) {
    if (!selector)
        return null;
    const bySlug = await (0, metabotProfileManager_1.getMetabotProfile)(systemHomeDir, selector).catch(() => null);
    if (bySlug)
        return bySlug;
    const profiles = await (0, metabotProfileManager_1.listMetabotProfiles)(systemHomeDir).catch(() => []);
    return profiles.find((profile) => profile.globalMetaId === selector) ?? null;
}
function createScheduleDaemonHandlers(input) {
    const { systemHomeDir } = input;
    const storeFor = (homeDir) => (input.createScheduleStore
        ? input.createScheduleStore(homeDir)
        : (0, store_1.createScheduleStore)((0, paths_1.resolveMetabotPaths)(homeDir)));
    const hostLeases = input.hostLeases ?? new Map();
    const log = input.log ?? (() => undefined);
    // Run-now in-flight guard: one background run per profile+task, dream
    // `startRun` parity; the store claim underneath is the durable guard.
    const runInFlight = new Set();
    async function readPreferredRuntimeId(paths) {
        try {
            const raw = await node_fs_1.promises.readFile(paths.preferredLlmRuntimePath, 'utf8');
            const data = JSON.parse(raw);
            return typeof data.runtimeId === 'string' ? data.runtimeId : null;
        }
        catch {
            return null;
        }
    }
    /** The daemon-side scheduled-task LLM turn: DSH pair first, local chain fallback. */
    function buildRunLlm(paths, slug) {
        const llmExecutor = input.llmExecutor ?? null;
        const runtimeResolver = (0, llmRuntimeResolver_1.createLlmRuntimeResolver)({
            runtimeStore: (0, llmRuntimeStore_1.createLlmRuntimeStore)(paths),
            bindingStore: (0, llmBindingStore_1.createLlmBindingStore)(paths),
            getPreferredRuntimeId: () => readPreferredRuntimeId(paths),
        });
        return async (turn) => {
            if (!llmExecutor) {
                return {
                    ok: false,
                    error: 'No LLM executor is configured on this daemon for scheduled task runs.',
                };
            }
            const hostText = await (0, hostLlmExecutorBridge_1.createHostFirstCompletion)({
                dshLlmPath: paths.dshLlmPath,
                timeoutMs: SCHEDULE_RUN_LLM_TIMEOUT_MS,
            })({ botSlug: slug, system: turn.systemPrompt, user: turn.prompt });
            if (hostText !== null)
                return { ok: true, output: hostText };
            const outcome = await (0, llmRuntimeExecution_1.runLlmPromptWithRuntimeFallback)({
                runtimeResolver,
                llmExecutor,
                metaBotSlug: slug,
                prompt: turn.prompt,
                systemPrompt: turn.systemPrompt,
                timeoutMs: SCHEDULE_RUN_LLM_TIMEOUT_MS,
                pollIntervalMs: 5_000,
            });
            if (outcome.status !== 'completed') {
                return {
                    ok: false,
                    error: outcome.error || `Scheduled task execution ended with status ${outcome.status}.`,
                };
            }
            return { ok: true, output: outcome.output };
        };
    }
    async function resolveProfileHomeDir(from) {
        const selector = normalizeScheduleStoreInput(from);
        if (!selector) {
            return {
                homeDir: '',
                slug: '',
                failure: (0, commandResult_1.commandFailed)('missing_from', 'A bot selector is required (--from or heartbeat slug).'),
            };
        }
        const profile = await resolveProfileBySelector(systemHomeDir, selector);
        if (!profile || typeof profile.homeDir !== 'string' || !profile.homeDir) {
            return {
                homeDir: '',
                slug: selector,
                failure: (0, commandResult_1.commandFailed)('profile_not_found', `MetaBot profile not found: ${selector}`),
            };
        }
        return { homeDir: node_path_1.default.resolve(profile.homeDir), slug: profile.slug, failure: null };
    }
    return {
        heartbeat: async (rawInput) => {
            const slug = normalizeScheduleStoreInput(rawInput?.slug);
            const host = normalizeScheduleStoreInput(rawInput?.host);
            if (!slug)
                return (0, commandResult_1.commandFailed)('missing_slug', 'heartbeat slug is required.');
            if (!host)
                return (0, commandResult_1.commandFailed)('missing_host', 'heartbeat host is required.');
            const profile = await resolveProfileBySelector(systemHomeDir, slug);
            if (!profile)
                return (0, commandResult_1.commandFailed)('profile_not_found', `MetaBot profile not found: ${slug}`);
            const expiresAtMs = Date.now() + store_1.SCHEDULE_HOST_LEASE_MS;
            hostLeases.set(profile.slug, { host, expiresAtMs });
            return (0, commandResult_1.commandSuccess)({ slug: profile.slug, host, expiresAtMs });
        },
        due: async (rawInput) => {
            const all = rawInput?.all === true || rawInput?.all === 'true';
            if (all) {
                const profiles = await (0, metabotProfileManager_1.listMetabotProfiles)(systemHomeDir).catch(() => []);
                const due = [];
                for (const profile of profiles) {
                    if (typeof profile.homeDir !== 'string' || !profile.homeDir)
                        continue;
                    const tasks = await storeFor(node_path_1.default.resolve(profile.homeDir)).listDue();
                    if (tasks.length > 0)
                        due.push({ slug: profile.slug, tasks });
                }
                return (0, commandResult_1.commandSuccess)({ due });
            }
            const resolved = await resolveProfileHomeDir(rawInput?.from);
            if (resolved.failure)
                return resolved.failure;
            const tasks = await storeFor(resolved.homeDir).listDue();
            return (0, commandResult_1.commandSuccess)({ due: [{ slug: resolved.slug, tasks }] });
        },
        list: async (rawInput) => {
            const resolved = await resolveProfileHomeDir(rawInput?.from);
            if (resolved.failure)
                return resolved.failure;
            const tasks = await storeFor(resolved.homeDir).listTasks();
            return (0, commandResult_1.commandSuccess)({ tasks });
        },
        show: async (rawInput) => {
            const resolved = await resolveProfileHomeDir(rawInput?.from);
            if (resolved.failure)
                return resolved.failure;
            const id = normalizeScheduleStoreInput(rawInput?.id);
            if (!id)
                return (0, commandResult_1.commandFailed)('missing_id', 'task id is required.');
            const task = await storeFor(resolved.homeDir).getTask(id);
            if (!task)
                return (0, commandResult_1.commandFailed)('task_not_found', `Scheduled task not found: ${id}`);
            return (0, commandResult_1.commandSuccess)({ task });
        },
        runs: async (rawInput) => {
            const resolved = await resolveProfileHomeDir(rawInput?.from);
            if (resolved.failure)
                return resolved.failure;
            const id = normalizeScheduleStoreInput(rawInput?.id);
            const rawLimit = rawInput?.limit;
            const numericLimit = typeof rawLimit === 'number' && Number.isFinite(rawLimit)
                ? rawLimit
                : typeof rawLimit === 'string' && rawLimit.trim() !== '' && Number.isFinite(Number(rawLimit))
                    ? Number(rawLimit)
                    : NaN;
            const limit = Number.isFinite(numericLimit) ? Math.floor(numericLimit) : undefined;
            const runs = await storeFor(resolved.homeDir).listRuns({
                ...(id ? { taskId: id } : {}),
                ...(limit !== undefined ? { limit } : {}),
            });
            return (0, commandResult_1.commandSuccess)({ runs });
        },
        claim: async (rawInput) => {
            const resolved = await resolveProfileHomeDir(rawInput?.from);
            if (resolved.failure)
                return resolved.failure;
            const id = normalizeScheduleStoreInput(rawInput?.id);
            if (!id)
                return (0, commandResult_1.commandFailed)('missing_id', 'task id is required.');
            const executorValue = normalizeScheduleStoreInput(rawInput?.executor) || 'host';
            const executor = executorValue === 'daemon' || executorValue === 'cli'
                ? executorValue
                : 'host';
            log(`[Schedule] host claim: task ${id} for ${resolved.slug}`);
            const result = await storeFor(resolved.homeDir).claim(id, { trigger: 'scheduled', executor });
            if (!result.ok) {
                if (result.code === 'task_not_found') {
                    return (0, commandResult_1.commandFailed)('task_not_found', `Scheduled task not found: ${id}`);
                }
                if (result.code === 'task_expired') {
                    return (0, commandResult_1.commandFailed)('task_expired', `Scheduled task has expired: ${id}`);
                }
                return (0, commandResult_1.commandFailed)('already_running', `Scheduled task is already running: ${id}`);
            }
            return (0, commandResult_1.commandSuccess)({ run: result.run, task: result.task });
        },
        complete: async (rawInput) => {
            const resolved = await resolveProfileHomeDir(rawInput?.from);
            if (resolved.failure)
                return resolved.failure;
            const runId = normalizeScheduleStoreInput(rawInput?.runId);
            if (!runId)
                return (0, commandResult_1.commandFailed)('missing_run_id', 'run id is required.');
            const error = rawInput?.error === undefined || rawInput.error === null
                ? undefined
                : String(rawInput.error);
            const rawDuration = rawInput?.durationMs;
            const durationMs = typeof rawDuration === 'number' && Number.isFinite(rawDuration)
                ? Math.max(0, Math.floor(rawDuration))
                : undefined;
            const result = await storeFor(resolved.homeDir).complete(runId, {
                ...(error !== undefined ? { error } : {}),
                ...(durationMs !== undefined ? { durationMs } : {}),
            });
            if ('notFound' in result) {
                return (0, commandResult_1.commandFailed)('task_run_not_found', `Scheduled task run not found: ${runId}`);
            }
            return (0, commandResult_1.commandSuccess)({ settled: result.settled, run: result.run, task: result.task });
        },
        // ---- Management verbs (the /api/schedule UI surface). Same actor rule
        // as the lease protocol above: an explicit `from` bot selector. ---------
        create: async (rawInput) => {
            const resolved = await resolveProfileHomeDir(rawInput?.from);
            if (resolved.failure)
                return resolved.failure;
            const name = normalizeScheduleStoreInput(rawInput?.name);
            if (!name)
                return (0, commandResult_1.commandFailed)('missing_name', 'task name is required.');
            const prompt = normalizeScheduleStoreInput(rawInput?.prompt);
            if (!prompt)
                return (0, commandResult_1.commandFailed)('missing_prompt', 'task prompt is required.');
            const schedule = rawInput?.schedule;
            if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) {
                return (0, commandResult_1.commandFailed)('invalid_argument', 'schedule ({type: at|interval|cron, ...}) is required.');
            }
            try {
                const task = await storeFor(resolved.homeDir).createTask({
                    name,
                    prompt,
                    schedule: schedule,
                    ...(typeof rawInput?.workingDirectory === 'string' && rawInput.workingDirectory.trim()
                        ? { workingDirectory: rawInput.workingDirectory.trim() }
                        : {}),
                    ...(normalizeScheduleStoreInput(rawInput?.channel)
                        ? { channel: normalizeScheduleStoreInput(rawInput.channel) }
                        : {}),
                    ...(typeof rawInput?.expiresAt === 'string' && rawInput.expiresAt.trim()
                        ? { expiresAt: rawInput.expiresAt.trim() }
                        : {}),
                    ...(typeof rawInput?.enabled === 'boolean' ? { enabled: rawInput.enabled } : {}),
                });
                return (0, commandResult_1.commandSuccess)({ task });
            }
            catch (error) {
                return (0, commandResult_1.commandFailed)('invalid_argument', error instanceof Error ? error.message : String(error));
            }
        },
        update: async (rawInput) => {
            const resolved = await resolveProfileHomeDir(rawInput?.from);
            if (resolved.failure)
                return resolved.failure;
            const id = normalizeScheduleStoreInput(rawInput?.id);
            if (!id)
                return (0, commandResult_1.commandFailed)('missing_id', 'task id is required.');
            const payload = rawInput?.payload;
            if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
                return (0, commandResult_1.commandFailed)('invalid_payload', 'payload (partial task fields) is required.');
            }
            try {
                const result = await storeFor(resolved.homeDir).updateTask(id, payload);
                if ('notFound' in result) {
                    return (0, commandResult_1.commandFailed)('task_not_found', `Scheduled task not found: ${id}`);
                }
                return (0, commandResult_1.commandSuccess)({ task: result.task, warnings: result.warnings });
            }
            catch (error) {
                return (0, commandResult_1.commandFailed)('invalid_argument', error instanceof Error ? error.message : String(error));
            }
        },
        delete: async (rawInput) => {
            const resolved = await resolveProfileHomeDir(rawInput?.from);
            if (resolved.failure)
                return resolved.failure;
            const id = normalizeScheduleStoreInput(rawInput?.id);
            if (!id)
                return (0, commandResult_1.commandFailed)('missing_id', 'task id is required.');
            const result = await storeFor(resolved.homeDir).deleteTask(id);
            if (!result.deleted) {
                return (0, commandResult_1.commandFailed)('task_not_found', `Scheduled task not found: ${id}`);
            }
            return (0, commandResult_1.commandSuccess)({ deleted: true });
        },
        enable: async (rawInput) => {
            const resolved = await resolveProfileHomeDir(rawInput?.from);
            if (resolved.failure)
                return resolved.failure;
            const id = normalizeScheduleStoreInput(rawInput?.id);
            if (!id)
                return (0, commandResult_1.commandFailed)('missing_id', 'task id is required.');
            const result = await storeFor(resolved.homeDir).setEnabled(id, true);
            if ('notFound' in result) {
                return (0, commandResult_1.commandFailed)('task_not_found', `Scheduled task not found: ${id}`);
            }
            return (0, commandResult_1.commandSuccess)({ task: result.task, warnings: result.warnings });
        },
        disable: async (rawInput) => {
            const resolved = await resolveProfileHomeDir(rawInput?.from);
            if (resolved.failure)
                return resolved.failure;
            const id = normalizeScheduleStoreInput(rawInput?.id);
            if (!id)
                return (0, commandResult_1.commandFailed)('missing_id', 'task id is required.');
            const result = await storeFor(resolved.homeDir).setEnabled(id, false);
            if ('notFound' in result) {
                return (0, commandResult_1.commandFailed)('task_not_found', `Scheduled task not found: ${id}`);
            }
            return (0, commandResult_1.commandSuccess)({ task: result.task, warnings: result.warnings });
        },
        // ---- Run-now verb (the standalone schedule UI "Run now" action; the CLI
        // `metabot schedule run` twin runs in-process on the caller). Mirrors
        // /api/dream/run: `wait: true` holds the request until the run settles;
        // the default starts the run inside the daemon process and returns
        // { taskId, status: 'running' } immediately — progress is observable via
        // /api/schedule/runs. Same from-required actor rule as the verbs above;
        // the store claim is the durable single-run guard. ----------------------
        run: async (rawInput) => {
            const resolved = await resolveProfileHomeDir(rawInput?.from);
            if (resolved.failure)
                return resolved.failure;
            const id = normalizeScheduleStoreInput(rawInput?.id);
            if (!id)
                return (0, commandResult_1.commandFailed)('missing_id', 'task id is required.');
            const paths = (0, paths_1.resolveMetabotPaths)(resolved.homeDir);
            const key = `${paths.profileRoot}:${id}`;
            if (runInFlight.has(key)) {
                return (0, commandResult_1.commandFailed)('already_running', `Scheduled task is already running: ${id}`);
            }
            const execute = async () => {
                const result = await (0, service_1.runScheduledTask)(paths, {
                    taskId: id,
                    trigger: 'manual',
                    executor: 'daemon',
                }, { runLlm: buildRunLlm(paths, resolved.slug) });
                if (result.kind === 'already_running') {
                    return (0, commandResult_1.commandFailed)('already_running', `Scheduled task is already running: ${id}`);
                }
                if (result.kind === 'failed') {
                    return (0, commandResult_1.commandFailed)('schedule_run_failed', result.error);
                }
                return (0, commandResult_1.commandSuccess)({ taskId: id, output: result.output });
            };
            if (rawInput?.wait === true) {
                const outcome = await execute();
                return outcome.ok ? (0, commandResult_1.commandSuccess)({ ...outcome.data, wait: true }) : outcome;
            }
            runInFlight.add(key);
            void (async () => {
                try {
                    const outcome = await execute();
                    log(`[Schedule] run-now ${resolved.slug} task ${id} → ${outcome.ok
                        ? 'completed'
                        : `failed (${outcome.code ?? 'error'}: ${outcome.message ?? 'unknown'})`}`);
                }
                catch (error) {
                    log(`[Schedule] run-now ${resolved.slug} task ${id} failed: ${error instanceof Error ? error.message : String(error)}`);
                }
                finally {
                    runInFlight.delete(key);
                }
            })();
            return (0, commandResult_1.commandSuccess)({ taskId: id, status: 'running', wait: false });
        },
    };
}
