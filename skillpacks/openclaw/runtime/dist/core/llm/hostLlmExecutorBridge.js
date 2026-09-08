"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_HOST_LLM_GENERATE_TIMEOUT_MS = void 0;
exports.createHostLlmExecutorBridge = createHostLlmExecutorBridge;
exports.getActiveHostLlmExecutorBridge = getActiveHostLlmExecutorBridge;
exports.setActiveHostLlmExecutorBridge = setActiveHostLlmExecutorBridge;
exports.createDshPairHostLlmGenerate = createDshPairHostLlmGenerate;
exports.createHostFirstCompletion = createHostFirstCompletion;
/**
 * Host LLM executor bridge.
 *
 * Lets a connected host process (the DSH plugin today) execute LLM
 * generations on behalf of the daemon. The daemon owns the reply
 * orchestration; only the model call is delegated. Transport is
 * daemon-pushed SSE requests plus host-posted results — the same shape as
 * the browser-command channel — so the host never needs a callable HTTP
 * origin (Electron hosts have none) and every connection is host-initiated
 * loopback.
 */
const node_crypto_1 = require("node:crypto");
const dshLlm_1 = require("../bot/dshLlm");
exports.DEFAULT_HOST_LLM_GENERATE_TIMEOUT_MS = 60_000;
function createHostLlmExecutorBridge(options) {
    const createRequestId = options?.createRequestId ?? (() => (0, node_crypto_1.randomUUID)());
    const now = options?.now ?? (() => new Date().toISOString());
    const defaultTimeoutMs = options?.generateTimeoutMs ?? exports.DEFAULT_HOST_LLM_GENERATE_TIMEOUT_MS;
    const sinks = new Set();
    const pending = new Map();
    let lastConnectedAt = null;
    return {
        attach(sink) {
            sinks.add(sink);
            lastConnectedAt = now();
            return () => {
                sinks.delete(sink);
            };
        },
        connectedExecutors() {
            return sinks.size;
        },
        status() {
            return { connected: sinks.size, lastConnectedAt };
        },
        generate(input) {
            if (sinks.size === 0)
                return Promise.resolve(null);
            const requestId = createRequestId();
            const request = {
                type: 'generate',
                requestId,
                ...(input.botSlug ? { botSlug: input.botSlug } : {}),
                provider: input.provider,
                model: input.model,
                ...(input.reasoningEffort !== undefined && input.reasoningEffort !== null
                    ? { reasoningEffort: input.reasoningEffort }
                    : {}),
                ...(input.fallback ? { fallback: input.fallback } : {}),
                system: input.system,
                prompt: input.prompt,
                timeoutMs: input.timeoutMs ?? defaultTimeoutMs,
                ...(input.skills && input.skills.length > 0 ? { skills: input.skills } : {}),
                ...(input.cwd ? { cwd: input.cwd } : {}),
            };
            return new Promise((resolve) => {
                const timer = setTimeout(() => {
                    if (pending.delete(requestId)) {
                        resolve({ ok: false, error: `Host LLM executor timed out after ${request.timeoutMs}ms.` });
                    }
                }, request.timeoutMs);
                pending.set(requestId, { resolve, timer });
                for (const sink of sinks) {
                    try {
                        sink(request);
                    }
                    catch {
                        // One broken sink must not block the broadcast; its detach runs on
                        // stream close.
                    }
                }
            });
        },
        submitResult(result) {
            const entry = pending.get(result.requestId);
            if (!entry)
                return false;
            pending.delete(result.requestId);
            clearTimeout(entry.timer);
            entry.resolve({
                ok: result.ok === true,
                ...(typeof result.output === 'string' ? { output: result.output } : {}),
                ...(typeof result.error === 'string' ? { error: result.error } : {}),
            });
            return true;
        },
    };
}
let activeHostLlmExecutorBridge = null;
function getActiveHostLlmExecutorBridge() {
    return activeHostLlmExecutorBridge;
}
function setActiveHostLlmExecutorBridge(bridge) {
    activeHostLlmExecutorBridge = bridge;
}
function createDshPairHostLlmGenerate(options) {
    const resolveBridge = options.resolveBridge ?? getActiveHostLlmExecutorBridge;
    return async (input) => {
        const bridge = resolveBridge();
        if (!bridge || bridge.connectedExecutors() === 0)
            return null;
        let binding;
        try {
            binding = await (0, dshLlm_1.readDshLlmBinding)(options.dshLlmPath);
        }
        catch {
            return null;
        }
        const provider = binding.dshLlmProvider?.trim() ?? '';
        const model = binding.dshLlmModel?.trim() ?? '';
        if (!provider || !model)
            return null;
        const fallbackProvider = binding.dshLlmFallbackProvider?.trim() ?? '';
        const fallbackModel = binding.dshLlmFallbackModel?.trim() ?? '';
        return bridge.generate({
            ...(input.metaBotSlug ? { botSlug: input.metaBotSlug } : {}),
            provider,
            model,
            reasoningEffort: binding.dshLlmReasoningEffort,
            ...(fallbackProvider && fallbackModel
                ? {
                    fallback: {
                        provider: fallbackProvider,
                        model: fallbackModel,
                        reasoningEffort: binding.dshLlmFallbackReasoningEffort,
                    },
                }
                : {}),
            system: input.systemPrompt,
            prompt: input.prompt,
            ...(input.skills && input.skills.length > 0 ? { skills: input.skills } : {}),
            ...(input.cwd ? { cwd: input.cwd } : {}),
            ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        });
    };
}
/**
 * Host-first completion for daemon-side passive turns (group-task chair
 * turns, study drains, memory deep consolidation, headless scheduled tasks):
 * one plain completion through the connected host executor with the Bot's DSH
 * pair. Returns the model text, or null when the host path is unusable (no
 * executor connected, no pair, or a failed generation) so the caller falls
 * through to its local-runtime chain unchanged.
 */
function createHostFirstCompletion(options) {
    const generate = createDshPairHostLlmGenerate({
        dshLlmPath: options.dshLlmPath,
        ...(options.resolveBridge ? { resolveBridge: options.resolveBridge } : {}),
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
    return async (request) => {
        try {
            const outcome = await generate({
                ...(request.botSlug ? { metaBotSlug: request.botSlug } : {}),
                prompt: request.user,
                systemPrompt: request.system,
                ...(request.maxTokens !== undefined ? { maxTokens: request.maxTokens } : {}),
            });
            if (outcome && outcome.ok && typeof outcome.output === 'string' && outcome.output.trim()) {
                return outcome.output;
            }
            if (outcome && !outcome.ok) {
                options.logWarning?.('[host llm completion]', outcome.error ?? 'Host LLM generation failed.');
            }
        }
        catch (error) {
            options.logWarning?.('[host llm completion]', error instanceof Error ? error.message : String(error));
        }
        return null;
    };
}
