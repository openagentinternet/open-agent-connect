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
const commandResult_1 = require("../core/contracts/commandResult");
const metabotProfileManager_1 = require("../core/bot/metabotProfileManager");
const paths_1 = require("../core/state/paths");
const store_1 = require("../core/schedule/store");
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
    };
}
