"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildProviderServiceOrderPrompt = buildProviderServiceOrderPrompt;
exports.createProviderServiceRunner = createProviderServiceRunner;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const platformSkillCatalog_1 = require("../../services/platformSkillCatalog");
const serviceRunnerContracts_1 = require("./serviceRunnerContracts");
const platformRegistry_1 = require("../../platform/platformRegistry");
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function isLeadingProcessNarration(value, providerSkill) {
    const text = normalizeText(value);
    if (!text || text.length > 320) {
        return false;
    }
    const lower = text.toLowerCase();
    const skillName = normalizeText(providerSkill).toLowerCase();
    const startsWithProcessVerb = /^(reading|fetching|checking|searching|loading|using|running|calling|starting|inspecting|looking up)\b/.test(lower);
    const referencesInternalExecution = /\b(skill|metabot|daemon|trace|payment|txid|order|provider|remote service|services call|cli)\b/.test(lower)
        || (Boolean(skillName) && lower.includes(skillName));
    return startsWithProcessVerb && referencesInternalExecution;
}
function sanitizeProviderDeliverableText(value, providerSkill) {
    const normalized = normalizeText(value);
    if (!normalized) {
        return '';
    }
    const paragraphs = normalized.split(/\n{2,}/);
    while (paragraphs.length > 1 && isLeadingProcessNarration(paragraphs[0], providerSkill)) {
        paragraphs.shift();
    }
    return paragraphs.join('\n\n').trim();
}
async function defaultCanStartRuntime(runtime) {
    const binaryPath = normalizeText(runtime.binaryPath);
    if (!binaryPath) {
        return false;
    }
    if (!node_path_1.default.isAbsolute(binaryPath)) {
        return true;
    }
    try {
        await node_fs_1.promises.access(binaryPath, node_fs_1.promises.constants.X_OK);
        return true;
    }
    catch {
        return false;
    }
}
function buildPaidOrderSystemPrompt(input) {
    const providerSkill = normalizeText(input.providerSkill);
    return [
        'You are the provider-side service executor for this paid service order, already paid and inbound.',
        `Service: ${normalizeText(input.serviceName) || normalizeText(input.displayName) || 'Service Order'}.`,
        `Required provider skill: ${providerSkill}.`,
        `You must use only the injected local skill "${providerSkill}" to complete this paid order.`,
        'Treat the selected skill as the local service implementation, even when the runtime and skill source came from different platforms.',
        `Expected output type: ${normalizeText(input.outputType) || 'text'}.`,
        'The buyer has already selected and paid for this service. Do not call any remote service, run metabot services call, act as a buyer, or discover services.',
        'The final answer must contain only the deliverable the buyer requested.',
        'Start directly with the result title or data; never start with status narration such as "Reading the skill" or "Fetching data".',
        'Do not repeat payment metadata or include process narration, greetings, rating boilerplate, service ids, chain txids, trace ids, skill paths, or instructions for the user to run commands.',
        'Do not include daemon diagnostics, CLI startup logs, trace-watch output, or internal troubleshooting notes.',
        `Client request: ${normalizeText(input.userTask)}`,
        input.taskContext ? `Task context: ${normalizeText(input.taskContext)}` : '',
    ].filter(Boolean).join('\n');
}
function isTextOutputType(value) {
    const outputType = normalizeText(value).toLowerCase();
    return !outputType || outputType === 'text';
}
function resolveSkillRootAbsolutePath(deps, root) {
    return root.kind === 'project'
        ? node_path_1.default.resolve(deps.projectRoot, root.path)
        : (0, platformRegistry_1.resolvePlatformSkillRootPath)(root, deps.systemHomeDir, deps.env);
}
function buildPaidOrderUserPrompt(input) {
    const lines = [
        'Provider execution mode: fulfill this inbound order locally with the selected skill. Do not delegate it.',
        `Service order for ${normalizeText(input.serviceName) || normalizeText(input.displayName) || 'Service Order'}.`,
        `User task: ${normalizeText(input.userTask)}`,
    ];
    if (normalizeText(input.taskContext)) {
        lines.push(`Task context: ${normalizeText(input.taskContext)}`);
    }
    return lines.join('\n');
}
function withRuntimeMetadata(result, input) {
    const selection = input.selection ?? null;
    const sessionId = normalizeText(input.sessionId);
    const enriched = {
        ...result,
        metadata: {
            ...(result.metadata ?? {}),
            runtimeId: input.runtime.id,
            runtimeProvider: input.runtime.provider,
            sessionId: sessionId || null,
            providerSkill: input.providerSkill,
            fallbackSelected: selection?.fallbackSelected ?? null,
            selection,
        },
        runtimeId: input.runtime.id,
        ...(sessionId ? { sessionId } : {}),
        selection,
    };
    return enriched;
}
function createRuntimeFailedResult(code, message, input) {
    return withRuntimeMetadata((0, serviceRunnerContracts_1.createServiceRunnerFailedResult)(code, message), input);
}
function isRetryableProviderRuntimeFailure(code) {
    return code === 'provider_execution_failed'
        || code === 'provider_execution_timeout'
        || code === 'provider_execution_cancelled';
}
function buildSessionFailure(run, providerSkill) {
    const { session, sessionId, runtime, selection } = run;
    if (session?.status === 'failed' || session?.status === 'cancelled' || session?.status === 'timeout') {
        const sessionError = session.error;
        const code = session.status === 'timeout'
            ? 'provider_execution_timeout'
            : session.status === 'cancelled'
                ? 'provider_execution_cancelled'
                : 'provider_execution_failed';
        return {
            result: createRuntimeFailedResult(code, normalizeText(sessionError) || 'Provider execution did not complete successfully.', {
                runtime,
                providerSkill,
                sessionId,
                selection,
            }),
            retryable: isRetryableProviderRuntimeFailure(code),
        };
    }
    if (!session?.result) {
        const code = 'provider_execution_timeout';
        return {
            result: createRuntimeFailedResult(code, 'The provider runtime did not produce a terminal session result before timeout.', {
                runtime,
                providerSkill,
                sessionId,
                selection,
            }),
            retryable: true,
        };
    }
    if (session.result.status !== 'completed') {
        const code = session.result.status === 'timeout'
            ? 'provider_execution_timeout'
            : session.result.status === 'cancelled'
                ? 'provider_execution_cancelled'
                : 'provider_execution_failed';
        return {
            result: createRuntimeFailedResult(code, session.result.error || 'Provider execution did not complete successfully.', {
                runtime,
                providerSkill,
                sessionId,
                selection,
            }),
            retryable: isRetryableProviderRuntimeFailure(code),
        };
    }
    return null;
}
async function waitForSession(llmExecutor, sessionId, timeoutMs, pollIntervalMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
        const session = await llmExecutor.getSession(sessionId);
        if (session?.result || session?.status === 'failed' || session?.status === 'timeout' || session?.status === 'cancelled') {
            return session;
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    return llmExecutor.getSession(sessionId);
}
async function readRuntimeSelection(deps, runtime, providerSkill, fallbackSelected) {
    if (!isInjectableSkillRuntime(runtime)) {
        return null;
    }
    const canStartRuntime = deps.canStartRuntime ?? defaultCanStartRuntime;
    if (!await canStartRuntime(runtime)) {
        return null;
    }
    const platform = (0, platformRegistry_1.getPlatformDefinition)(runtime.provider);
    const roots = (0, platformRegistry_1.getPlatformSkillRoots)(platform.id);
    const rootDiagnostics = [];
    for (const root of roots) {
        const absolutePath = resolveSkillRootAbsolutePath(deps, root);
        try {
            const entries = await node_fs_1.promises.readdir(absolutePath, { withFileTypes: true });
            rootDiagnostics.push({
                rootId: root.id,
                kind: root.kind,
                absolutePath,
                status: 'readable',
            });
            const skillDir = entries.find((entry) => entry.isDirectory() && entry.name === providerSkill);
            if (!skillDir) {
                continue;
            }
            const skillDocumentPath = node_path_1.default.join(absolutePath, skillDir.name, 'SKILL.md');
            try {
                const stat = await node_fs_1.promises.stat(skillDocumentPath);
                if (!stat.isFile()) {
                    continue;
                }
            }
            catch {
                continue;
            }
            return {
                runtime,
                skill: {
                    skillName: providerSkill,
                    platformId: runtime.provider,
                    platformDisplayName: platform.displayName,
                    rootId: root.id,
                    rootKind: root.kind,
                    absolutePath: node_path_1.default.join(absolutePath, skillDir.name),
                    skillDocumentPath,
                },
                rootDiagnostics,
                fallbackSelected,
            };
        }
        catch (error) {
            rootDiagnostics.push({
                rootId: root.id,
                kind: root.kind,
                absolutePath,
                status: 'unreadable',
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }
    return null;
}
async function readPortableSkillSelection(deps, runtime, providerSkill, fallbackSelected) {
    if (!isInjectableSkillRuntime(runtime)) {
        return null;
    }
    const canStartRuntime = deps.canStartRuntime ?? defaultCanStartRuntime;
    if (!await canStartRuntime(runtime)) {
        return null;
    }
    const rootDiagnostics = [];
    const seenRoots = new Set();
    for (const root of (0, platformRegistry_1.getInstallSkillRoots)()) {
        const absolutePath = resolveSkillRootAbsolutePath(deps, root);
        const rootKey = node_path_1.default.resolve(absolutePath);
        if (seenRoots.has(rootKey)) {
            continue;
        }
        seenRoots.add(rootKey);
        try {
            await node_fs_1.promises.access(absolutePath);
            rootDiagnostics.push({
                rootId: root.id,
                kind: root.kind,
                absolutePath,
                status: 'readable',
            });
            const skillDocumentPath = node_path_1.default.join(absolutePath, providerSkill, 'SKILL.md');
            const stat = await node_fs_1.promises.stat(skillDocumentPath).catch(() => null);
            if (!stat?.isFile()) {
                continue;
            }
            const sourcePlatformId = (0, platformRegistry_1.isPlatformId)(root.platformId) ? root.platformId : runtime.provider;
            const platformDisplayName = (0, platformRegistry_1.isPlatformId)(root.platformId)
                ? (0, platformRegistry_1.getPlatformDefinition)(root.platformId).displayName
                : 'Shared Agents';
            return {
                runtime,
                skill: {
                    skillName: providerSkill,
                    platformId: sourcePlatformId,
                    platformDisplayName,
                    rootId: root.id,
                    rootKind: root.kind,
                    absolutePath: node_path_1.default.join(absolutePath, providerSkill),
                    skillDocumentPath,
                },
                rootDiagnostics,
                fallbackSelected,
            };
        }
        catch (error) {
            const code = error.code;
            rootDiagnostics.push({
                rootId: root.id,
                kind: root.kind,
                absolutePath,
                status: code === 'ENOENT' ? 'missing' : 'unreadable',
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }
    return null;
}
function isInjectableSkillRuntime(runtime) {
    return (0, platformRegistry_1.isPlatformId)(runtime.provider) && Boolean(normalizeText(runtime.binaryPath)) && runtime.health !== 'unavailable';
}
async function canRunInjectedSkillRuntime(deps, runtime) {
    if (!isInjectableSkillRuntime(runtime)) {
        return false;
    }
    const canStartRuntime = deps.canStartRuntime ?? defaultCanStartRuntime;
    return canStartRuntime(runtime);
}
async function readFallbackSelection(deps, fallbackRuntime, providerSkill, sourceSelection) {
    const fallbackSelection = await readRuntimeSelection(deps, fallbackRuntime, providerSkill, true);
    if (fallbackSelection) {
        return fallbackSelection;
    }
    const portableFallbackSelection = await readPortableSkillSelection(deps, fallbackRuntime, providerSkill, true);
    if (portableFallbackSelection) {
        return portableFallbackSelection;
    }
    if (!await canRunInjectedSkillRuntime(deps, fallbackRuntime)) {
        return null;
    }
    return {
        runtime: fallbackRuntime,
        skill: sourceSelection.skill,
        rootDiagnostics: sourceSelection.rootDiagnostics,
        fallbackSelected: true,
    };
}
function selectBinding(bindings, metaBotSlug, role) {
    return bindings
        .filter((entry) => entry.metaBotSlug === metaBotSlug && entry.role === role && entry.enabled)
        .sort((left, right) => left.priority - right.priority || right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))[0] ?? null;
}
async function readRuntimeResolutionState(input) {
    const [runtimeState, bindingState] = await Promise.all([
        input.runtimeStore.read(),
        input.bindingStore.read(),
    ]);
    const primaryBinding = selectBinding(bindingState.bindings, input.metaBotSlug, 'primary');
    const fallbackBinding = selectBinding(bindingState.bindings, input.metaBotSlug, 'fallback');
    return {
        primaryRuntime: primaryBinding
            ? runtimeState.runtimes.find((entry) => entry.id === primaryBinding.llmRuntimeId) ?? null
            : null,
        fallbackRuntime: fallbackBinding
            ? runtimeState.runtimes.find((entry) => entry.id === fallbackBinding.llmRuntimeId) ?? null
            : null,
    };
}
async function resolveFallbackRuntime(deps, primaryRuntime, configuredFallbackRuntime) {
    const explicitFallbackRuntime = await deps.getFallbackRuntime?.(primaryRuntime) ?? null;
    return explicitFallbackRuntime ?? configuredFallbackRuntime;
}
function buildProviderServiceOrderPrompt(input) {
    return buildPaidOrderSystemPrompt({
        serviceName: input.serviceName ?? '',
        displayName: input.displayName ?? '',
        providerSkill: input.providerSkill,
        outputType: input.outputType ?? '',
        userTask: input.userTask,
        taskContext: input.taskContext,
    });
}
function createProviderServiceRunner(input) {
    const sessionTimeoutMs = input.sessionTimeoutMs ?? 120_000;
    const pollIntervalMs = input.pollIntervalMs ?? 500;
    return {
        async execute(order) {
            if (!(0, platformSkillCatalog_1.isSafeProviderSkillName)(order.providerSkill)) {
                return (0, serviceRunnerContracts_1.createServiceRunnerFailedResult)('invalid_provider_skill', 'Provider skill name is unsafe.');
            }
            const resolutionState = await readRuntimeResolutionState(input);
            const primaryRuntime = resolutionState.primaryRuntime;
            const primarySelection = primaryRuntime ? await readRuntimeSelection(input, primaryRuntime, order.providerSkill, false) : null;
            let runtime = primaryRuntime;
            let selection = primarySelection
                ?? (primaryRuntime ? await readPortableSkillSelection(input, primaryRuntime, order.providerSkill, false) : null);
            if (!runtime || !selection) {
                runtime = await resolveFallbackRuntime(input, primaryRuntime, resolutionState.fallbackRuntime);
                if (!runtime) {
                    return (0, serviceRunnerContracts_1.createServiceRunnerFailedResult)('provider_runtime_unavailable', 'No primary or fallback runtime was available before provider execution started.');
                }
                selection = await readRuntimeSelection(input, runtime, order.providerSkill, true)
                    ?? await readPortableSkillSelection(input, runtime, order.providerSkill, true);
                if (!selection) {
                    return (0, serviceRunnerContracts_1.createServiceRunnerFailedResult)('provider_skill_missing', `providerSkill is not installed in the selected MetaBot primary runtime skill roots: ${order.providerSkill}`);
                }
            }
            const systemPrompt = buildPaidOrderSystemPrompt({
                serviceName: order.serviceName ?? '',
                displayName: order.displayName ?? '',
                providerSkill: order.providerSkill,
                outputType: order.outputType ?? 'text',
                userTask: order.userTask,
                taskContext: order.taskContext,
            });
            const executeWithSelection = async (selectedSelection) => {
                const selectedRuntime = selectedSelection.runtime;
                const sessionId = await input.llmExecutor.execute({
                    runtimeId: selectedRuntime.id,
                    runtime: selectedRuntime,
                    prompt: buildPaidOrderUserPrompt(order),
                    systemPrompt,
                    cwd: input.projectRoot,
                    skills: [order.providerSkill],
                    skillSourcePaths: {
                        [order.providerSkill]: selectedSelection.skill.absolutePath,
                    },
                    metaBotSlug: input.metaBotSlug,
                    timeout: sessionTimeoutMs,
                });
                return {
                    runtime: selectedRuntime,
                    selection: selectedSelection,
                    sessionId,
                    session: await waitForSession(input.llmExecutor, sessionId, sessionTimeoutMs, pollIntervalMs),
                };
            };
            const resolveFallbackSelection = async (failedRuntime, failedSelection) => {
                if (failedSelection.fallbackSelected) {
                    return null;
                }
                const fallbackRuntime = await resolveFallbackRuntime(input, primaryRuntime, resolutionState.fallbackRuntime);
                if (!fallbackRuntime || fallbackRuntime.id === failedRuntime.id) {
                    return null;
                }
                return readFallbackSelection(input, fallbackRuntime, order.providerSkill, failedSelection);
            };
            const executionFailure = (error, failedRuntime, failedSelection) => createRuntimeFailedResult('provider_execution_failed', error instanceof Error ? error.message : String(error), {
                runtime: failedRuntime,
                providerSkill: order.providerSkill,
                selection: failedSelection,
            });
            let run;
            try {
                run = await executeWithSelection(selection);
            }
            catch (error) {
                const fallbackSelection = await resolveFallbackSelection(runtime, selection);
                if (!fallbackSelection) {
                    return executionFailure(error, runtime, selection);
                }
                try {
                    run = await executeWithSelection(fallbackSelection);
                }
                catch (fallbackError) {
                    return executionFailure(fallbackError, fallbackSelection.runtime, fallbackSelection);
                }
            }
            let failure = buildSessionFailure(run, order.providerSkill);
            if (failure?.retryable) {
                const fallbackSelection = await resolveFallbackSelection(run.runtime, run.selection);
                if (fallbackSelection) {
                    try {
                        const fallbackRun = await executeWithSelection(fallbackSelection);
                        const fallbackFailure = buildSessionFailure(fallbackRun, order.providerSkill);
                        if (fallbackFailure) {
                            return fallbackFailure.result;
                        }
                        run = fallbackRun;
                        failure = null;
                    }
                    catch (fallbackError) {
                        return executionFailure(fallbackError, fallbackSelection.runtime, fallbackSelection);
                    }
                }
            }
            if (failure) {
                return failure.result;
            }
            runtime = run.runtime;
            selection = run.selection;
            const sessionId = run.sessionId;
            const session = run.session;
            const responseText = sanitizeProviderDeliverableText(session?.result?.output ?? '', order.providerSkill);
            if (!responseText) {
                return createRuntimeFailedResult('provider_execution_empty', 'The provider runtime returned an empty result.', {
                    runtime,
                    providerSkill: order.providerSkill,
                    sessionId,
                    selection,
                });
            }
            if (!isTextOutputType(order.outputType)) {
                return createRuntimeFailedResult('provider_deliverable_invalid', 'Non-text provider deliverables require validation and upload support before delivery.', {
                    runtime,
                    providerSkill: order.providerSkill,
                    sessionId,
                    selection,
                });
            }
            return {
                state: 'completed',
                responseText,
                metadata: {
                    runtimeId: runtime.id,
                    sessionId,
                    providerSkill: order.providerSkill,
                    fallbackSelected: selection.fallbackSelected,
                    selection,
                },
                runtimeId: runtime.id,
                sessionId,
                selection,
            };
        },
    };
}
