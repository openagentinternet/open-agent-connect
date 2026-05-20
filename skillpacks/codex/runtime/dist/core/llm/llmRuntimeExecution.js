"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runLlmPromptWithRuntimeFallback = runLlmPromptWithRuntimeFallback;
function resultError(result) {
    return result.error || `LLM runtime ended with status ${result.status}.`;
}
async function runLlmPromptWithRuntimeFallback(input) {
    const now = input.now ?? (() => Date.now());
    const sleep = input.sleep ?? ((ms) => new Promise((resolve) => {
        setTimeout(resolve, ms);
    }));
    const excludedRuntimeIds = new Set();
    let lastSessionId;
    let lastError = `No healthy LLM runtime is available for MetaBot ${input.metaBotSlug}.`;
    const shouldMarkRuntimeUnavailable = input.markRuntimeUnavailableOnFailure !== false;
    const markUnavailable = async (runtimeId) => {
        if (shouldMarkRuntimeUnavailable) {
            await input.runtimeResolver.markRuntimeUnavailable(runtimeId).catch(() => { });
        }
    };
    while (true) {
        const resolved = await input.runtimeResolver.resolveRuntime({
            metaBotSlug: input.metaBotSlug,
            excludeRuntimeIds: Array.from(excludedRuntimeIds),
        });
        const runtime = resolved.runtime;
        if (!runtime || runtime.health !== 'healthy') {
            return {
                ...(lastSessionId ? { sessionId: lastSessionId } : {}),
                status: 'failed',
                output: '',
                error: lastError,
            };
        }
        if (excludedRuntimeIds.has(runtime.id)) {
            return {
                ...(lastSessionId ? { sessionId: lastSessionId } : {}),
                status: 'failed',
                output: '',
                error: lastError,
            };
        }
        let sessionId;
        try {
            sessionId = await input.llmExecutor.execute({
                runtimeId: runtime.id,
                runtime,
                prompt: input.prompt,
                ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
                timeout: input.timeoutMs,
                cwd: input.cwd,
                metaBotSlug: input.metaBotSlug,
            });
            lastSessionId = sessionId;
            const deadline = now() + input.timeoutMs;
            while (now() <= deadline) {
                const session = await input.llmExecutor.getSession(sessionId);
                if (session?.result) {
                    if (session.result.status === 'completed') {
                        if (resolved.bindingId) {
                            await input.runtimeResolver.markBindingUsed(resolved.bindingId).catch(() => { });
                        }
                        return {
                            sessionId,
                            status: session.result.status,
                            output: session.result.output,
                            error: session.result.error,
                        };
                    }
                    await markUnavailable(runtime.id);
                    excludedRuntimeIds.add(runtime.id);
                    lastError = resultError(session.result);
                    break;
                }
                await sleep(input.pollIntervalMs);
            }
            if (!excludedRuntimeIds.has(runtime.id)) {
                await markUnavailable(runtime.id);
                excludedRuntimeIds.add(runtime.id);
                lastError = 'LLM runtime timed out while running prompt.';
            }
        }
        catch (error) {
            await markUnavailable(runtime.id);
            excludedRuntimeIds.add(runtime.id);
            lastError = error instanceof Error ? error.message : 'LLM runtime is unavailable.';
        }
    }
}
