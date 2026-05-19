"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.summarizeResolvedLlmRuntime = summarizeResolvedLlmRuntime;
exports.createLlmRuntimeResolver = createLlmRuntimeResolver;
function bindingRoleRank(role) {
    switch (role) {
        case 'primary':
            return 0;
        case 'fallback':
            return 1;
        case 'reviewer':
            return 2;
        case 'specialist':
            return 3;
        default:
            return 4;
    }
}
function compareBindingSelection(left, right) {
    const roleDelta = bindingRoleRank(left.role) - bindingRoleRank(right.role);
    if (roleDelta !== 0)
        return roleDelta;
    if (left.priority !== right.priority)
        return left.priority - right.priority;
    if (left.updatedAt !== right.updatedAt)
        return right.updatedAt.localeCompare(left.updatedAt);
    return left.id.localeCompare(right.id);
}
function summarizeResolvedLlmRuntime(resolved) {
    if (!resolved.runtime)
        return undefined;
    return {
        provider: resolved.runtime.provider,
        displayName: resolved.runtime.displayName,
        health: resolved.runtime.health,
        selectedRole: resolved.bindingRole ?? 'unbound',
        ...(resolved.runtime.version ? { version: resolved.runtime.version } : {}),
        ...(resolved.runtime.logoPath ? { logoPath: resolved.runtime.logoPath } : {}),
    };
}
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
            const excludedRuntimeIds = new Set(input.excludeRuntimeIds ?? []);
            const isExcluded = (runtime) => excludedRuntimeIds.has(runtime.id);
            const isSelectable = (runtime) => !isExcluded(runtime) && runtime.health === 'healthy';
            // 1. Explicit runtimeId — use it directly.
            if (input.explicitRuntimeId) {
                const rt = runtimeById.get(input.explicitRuntimeId);
                if (rt && isSelectable(rt))
                    return { runtime: rt };
            }
            // 2. MetaBot bindings are the canonical primary/fallback runtime configuration.
            if (input.metaBotSlug) {
                const bindings = await bindingStore.listEnabledByMetaBotSlug(input.metaBotSlug);
                bindings.sort(compareBindingSelection);
                for (const binding of bindings) {
                    const rt = runtimeById.get(binding.llmRuntimeId);
                    if (rt && isSelectable(rt)) {
                        return { runtime: rt, bindingId: binding.id, bindingRole: binding.role };
                    }
                }
                // 3. Preferred runtime remains a legacy fallback when no configured binding is usable.
                const preferredId = await getPreferredRuntimeId(input.metaBotSlug);
                if (preferredId) {
                    const rt = runtimeById.get(preferredId);
                    if (rt && isSelectable(rt))
                        return { runtime: rt };
                }
            }
            // 4. First healthy runtime.
            const healthy = runtimes.find((r) => !isExcluded(r) && r.health === 'healthy');
            if (healthy)
                return { runtime: healthy };
            return { runtime: null };
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
                if (rt && rt.provider === input.targetProvider && rt.health === 'healthy') {
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
        async markRuntimeUnavailable(runtimeId) {
            await options.runtimeStore.updateHealth(runtimeId, 'unavailable');
        },
    };
}
