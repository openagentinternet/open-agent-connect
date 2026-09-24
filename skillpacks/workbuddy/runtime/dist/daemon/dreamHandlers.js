"use strict";
/**
 * Daemon-side dream handler group: the /api/dream/* verbs. The read verbs
 * (status/due/summaries/self-identity/capabilities) are pure core-store calls;
 * `run` ports the `metabot dream run` in-process loop (plan → LLM → commit)
 * with the unified passive-LLM chain (DSH pair first, then the local runtime
 * fallback through the injected daemon llmExecutor).
 *
 * Long-running contract mirrors /api/surf/run: `wait: true` holds the request
 * until the run settles; the default starts the run inside the daemon process
 * and returns `{ date, status: 'running' }` immediately. Run state lives in
 * the dream store, so `status`/`due` observe it (their stale-running sweep is
 * the crash-recovery path when the daemon dies mid-run).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDreamDaemonHandlers = createDreamDaemonHandlers;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const commandResult_1 = require("../core/contracts/commandResult");
const capabilityStore_1 = require("../core/memory/capabilityStore");
const dreamStore_1 = require("../core/memory/dreamStore");
const dreamService_1 = require("../core/memory/dreamService");
const experiencePromptBlocks_1 = require("../core/memory/experiencePromptBlocks");
const memoryStore_1 = require("../core/memory/memoryStore");
const hostLlmExecutorBridge_1 = require("../core/llm/hostLlmExecutorBridge");
const llmBindingStore_1 = require("../core/llm/llmBindingStore");
const llmRuntimeResolver_1 = require("../core/llm/llmRuntimeResolver");
const llmRuntimeStore_1 = require("../core/llm/llmRuntimeStore");
const llmRuntimeExecution_1 = require("../core/llm/llmRuntimeExecution");
const paths_1 = require("../core/state/paths");
const DREAM_LLM_TIMEOUT_MS = 180_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
async function readPreferredLlmRuntimeId(paths) {
    try {
        const raw = await node_fs_1.promises.readFile(paths.preferredLlmRuntimePath, 'utf8');
        const data = JSON.parse(raw);
        return typeof data.runtimeId === 'string' ? data.runtimeId : null;
    }
    catch {
        return null;
    }
}
/** Same shape as the CLI `parseDreamLimits` (limits object or bare fields). */
function parseDreamLimits(payload) {
    const source = payload?.limits && typeof payload.limits === 'object' && !Array.isArray(payload.limits)
        ? payload.limits
        : payload;
    if (!source)
        return undefined;
    const contextWindow = typeof source.contextWindow === 'number' && Number.isFinite(source.contextWindow)
        ? source.contextWindow
        : undefined;
    const maxOutputTokens = typeof source.maxOutputTokens === 'number' && Number.isFinite(source.maxOutputTokens)
        ? source.maxOutputTokens
        : undefined;
    if (contextWindow === undefined && maxOutputTokens === undefined)
        return undefined;
    return {
        ...(contextWindow !== undefined ? { contextWindow } : {}),
        ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    };
}
function defaultDreamDate() {
    const now = new Date();
    return (0, experiencePromptBlocks_1.formatLocalDate)(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
}
function createDreamDaemonHandlers(input) {
    const log = input.log ?? (() => undefined);
    // One in-flight background run per profile+date, surf `startSurf` parity.
    const inFlight = new Set();
    function completeFor(paths, slug) {
        const llmExecutor = input.llmExecutor ?? null;
        const runtimeResolver = (0, llmRuntimeResolver_1.createLlmRuntimeResolver)({
            runtimeStore: (0, llmRuntimeStore_1.createLlmRuntimeStore)(paths),
            bindingStore: (0, llmBindingStore_1.createLlmBindingStore)(paths),
            getPreferredRuntimeId: () => readPreferredLlmRuntimeId(paths),
        });
        return async (request) => {
            if (!llmExecutor) {
                throw new Error('No LLM executor is configured on this daemon for dream runs.');
            }
            // Unified passive-LLM priority: the Bot's DSH pair first, then the
            // local runtime chain below.
            const hostText = await (0, hostLlmExecutorBridge_1.createHostFirstCompletion)({
                dshLlmPath: paths.dshLlmPath,
                timeoutMs: DREAM_LLM_TIMEOUT_MS,
            })({
                botSlug: slug,
                system: request.system,
                user: request.user,
                ...(Number.isFinite(request.maxOutputTokens) && request.maxOutputTokens > 0
                    ? { maxTokens: request.maxOutputTokens }
                    : {}),
            });
            if (hostText !== null)
                return hostText;
            const outcome = await (0, llmRuntimeExecution_1.runLlmPromptWithRuntimeFallback)({
                runtimeResolver,
                llmExecutor,
                metaBotSlug: slug,
                prompt: request.user,
                systemPrompt: request.system,
                timeoutMs: DREAM_LLM_TIMEOUT_MS,
                pollIntervalMs: 5_000,
            });
            if (outcome.status !== 'completed') {
                throw new Error(outcome.error || `Dream generation ended with status ${outcome.status}.`);
            }
            return outcome.output;
        };
    }
    return {
        due: async (rawInput) => {
            const bot = await input.resolveBot(rawInput?.from);
            if ('failure' in bot)
                return bot.failure;
            const due = await (0, dreamService_1.dueDreamDates)((0, paths_1.resolveMetabotPaths)(bot.homeDir));
            return (0, commandResult_1.commandSuccess)(due);
        },
        status: async (rawInput) => {
            const bot = await input.resolveBot(rawInput?.from);
            if ('failure' in bot)
                return bot.failure;
            const status = await (0, dreamService_1.dreamStatus)((0, paths_1.resolveMetabotPaths)(bot.homeDir));
            return (0, commandResult_1.commandSuccess)(status);
        },
        summaries: async (rawInput) => {
            const bot = await input.resolveBot(rawInput?.from);
            if ('failure' in bot)
                return bot.failure;
            const rawLimit = rawInput?.limit;
            const limit = typeof rawLimit === 'number' && Number.isFinite(rawLimit)
                ? Math.max(1, Math.floor(rawLimit))
                : typeof rawLimit === 'string' && rawLimit.trim() !== '' && Number.isFinite(Number(rawLimit))
                    ? Math.max(1, Math.floor(Number(rawLimit)))
                    : undefined;
            const dreamStore = (0, dreamStore_1.createDreamStore)((0, paths_1.resolveMetabotPaths)(bot.homeDir));
            const summaries = await dreamStore.listDailySummaries({
                ...(limit !== undefined ? { limit } : {}),
                ...(rawInput?.before ? { before: rawInput.before } : {}),
            });
            return (0, commandResult_1.commandSuccess)({ summaries });
        },
        selfIdentity: async (rawInput) => {
            const bot = await input.resolveBot(rawInput?.from);
            if ('failure' in bot)
                return bot.failure;
            const memoryStore = (0, memoryStore_1.createMemoryStore)((0, paths_1.resolveMetabotPaths)(bot.homeDir));
            const entries = await memoryStore.list({
                usageClass: 'self_identity',
                status: 'created',
                limit: 1,
            });
            return (0, commandResult_1.commandSuccess)({
                text: entries[0]?.text ?? '',
                updatedAt: entries[0]?.updatedAt ?? null,
            });
        },
        capabilities: async (rawInput) => {
            const bot = await input.resolveBot(rawInput?.from);
            if ('failure' in bot)
                return bot.failure;
            const rawLimit = rawInput?.limit;
            const limit = typeof rawLimit === 'number' && Number.isFinite(rawLimit)
                ? Math.max(1, Math.floor(rawLimit))
                : typeof rawLimit === 'string' && rawLimit.trim() !== '' && Number.isFinite(Number(rawLimit))
                    ? Math.max(1, Math.floor(Number(rawLimit)))
                    : undefined;
            const drafts = await (0, capabilityStore_1.createCapabilityStore)((0, paths_1.resolveMetabotPaths)(bot.homeDir)).listDrafts({
                ...(limit !== undefined ? { limit } : {}),
            });
            return (0, commandResult_1.commandSuccess)({ drafts });
        },
        run: async (rawInput) => {
            const bot = await input.resolveBot(rawInput?.from);
            if ('failure' in bot)
                return bot.failure;
            const date = typeof rawInput?.date === 'string' && rawInput.date.trim()
                ? rawInput.date.trim()
                : defaultDreamDate();
            if (!DATE_RE.test(date)) {
                return (0, commandResult_1.commandFailed)('invalid_flag', '--date must be YYYY-MM-DD.');
            }
            const paths = (0, paths_1.resolveMetabotPaths)(bot.homeDir);
            const slug = node_path_1.default.basename(paths.profileRoot);
            const key = `${paths.profileRoot}:${date}`;
            if (inFlight.has(key)) {
                return (0, commandResult_1.commandFailed)('dream_already_running', `Dream run already in progress for ${date}.`);
            }
            const runInput = {
                date,
                llm: typeof rawInput?.llm === 'string' ? rawInput.llm : null,
                limits: parseDreamLimits(rawInput?.limits),
                isRepair: rawInput?.isRepair === true,
            };
            const complete = completeFor(paths, slug);
            if (rawInput?.wait === true) {
                const result = await (0, dreamService_1.runDream)(paths, runInput, complete);
                if (result.kind === 'failed') {
                    return (0, commandResult_1.commandFailed)('dream_run_failed', result.error ?? 'dream run failed');
                }
                return (0, commandResult_1.commandSuccess)(result);
            }
            inFlight.add(key);
            void (async () => {
                try {
                    const result = await (0, dreamService_1.runDream)(paths, runInput, complete);
                    log(`[Dream] ${slug} ${date} → ${result.kind}${result.error ? ` (${result.error})` : ''}`);
                }
                catch (error) {
                    log(`[Dream] ${slug} ${date} failed: ${error instanceof Error ? error.message : String(error)}`);
                }
                finally {
                    inFlight.delete(key);
                }
            })();
            return (0, commandResult_1.commandSuccess)({ date, status: 'running', wait: false });
        },
    };
}
