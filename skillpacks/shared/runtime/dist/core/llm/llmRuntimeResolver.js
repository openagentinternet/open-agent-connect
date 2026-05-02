"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLlmRuntimeResolver = createLlmRuntimeResolver;
function createLlmRuntimeResolver(options) {
    const { runtimeStore, bindingStore, getPreferredRuntimeId } = options;
    async function loadRuntimes() {
        const state = await runtimeStore.read();
        return state.runtimes;
    }
    return {
        async resolveRuntime(input) {
            const runtimes = await loadRuntimes();
            if (runtimes.length === 0)
                return { runtime: null };
            const runtimeById = new Map(runtimes.map((r) => [r.id, r]));
            // 1. Explicit runtimeId — use it directly.
            if (input.explicitRuntimeId) {
                const rt = runtimeById.get(input.explicitRuntimeId);
                if (rt && rt.health !== 'unavailable')
                    return { runtime: rt };
            }
            // 2. Preferred runtime for this MetaBot slug.
            if (input.metaBotSlug) {
                const preferredId = await getPreferredRuntimeId(input.metaBotSlug);
                if (preferredId) {
                    const rt = runtimeById.get(preferredId);
                    if (rt && rt.health !== 'unavailable')
                        return { runtime: rt };
                }
                // 3. Enabled bindings sorted by priority → first healthy.
                const bindings = await bindingStore.listEnabledByMetaBotSlug(input.metaBotSlug);
                bindings.sort((a, b) => a.priority - b.priority);
                for (const binding of bindings) {
                    const rt = runtimeById.get(binding.llmRuntimeId);
                    if (rt && rt.health !== 'unavailable') {
                        return { runtime: rt, bindingId: binding.id };
                    }
                }
            }
            // 4. First healthy runtime.
            const healthy = runtimes.find((r) => r.health === 'healthy');
            if (healthy)
                return { runtime: healthy };
            // 5. First any runtime (absolute fallback).
            return { runtime: runtimes[0] };
        },
        async selectMetaBot(input) {
            const runtimes = await loadRuntimes();
            const runtimeById = new Map(runtimes.map((r) => [r.id, r]));
            const state = await bindingStore.read();
            const allBindings = state.bindings;
            const matching = [];
            for (const binding of allBindings) {
                if (!binding.enabled)
                    continue;
                const rt = runtimeById.get(binding.llmRuntimeId);
                if (rt && rt.provider === input.targetProvider) {
                    matching.push({ binding, runtime: rt });
                }
            }
            if (matching.length === 0)
                return null;
            matching.sort((a, b) => {
                const aTime = a.binding.lastUsedAt ?? '';
                const bTime = b.binding.lastUsedAt ?? '';
                return bTime.localeCompare(aTime);
            });
            const best = matching[0];
            return {
                metaBotSlug: best.binding.metaBotSlug,
                binding: best.binding,
                runtime: best.runtime,
            };
        },
        async markBindingUsed(bindingId) {
            await bindingStore.updateLastUsed(bindingId, new Date().toISOString());
        },
    };
}
