"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLlmMetaBotSelector = createLlmMetaBotSelector;
const llmRuntimeResolver_1 = require("./llmRuntimeResolver");
function createLlmMetaBotSelector(deps) {
    const runtimeResolvers = new Map();
    function getResolver(slug) {
        let resolver = runtimeResolvers.get(slug);
        if (!resolver) {
            resolver = (0, llmRuntimeResolver_1.createLlmRuntimeResolver)({
                runtimeStore: deps.runtimeStore,
                bindingStore: deps.getBindingStoreForSlug(slug),
                getPreferredRuntimeId: deps.getPreferredRuntimeId,
            });
            runtimeResolvers.set(slug, resolver);
        }
        return resolver;
    }
    return {
        /**
         * Find the best MetaBot for a given provider.
         * Iterates all profiles, collects their enabled bindings matching the provider,
         * sorts by lastUsedAt descending.
         */
        async selectBestMetaBotForProvider(targetProvider) {
            const slugs = await deps.listAllProfileSlugs();
            const allMatches = [];
            for (const slug of slugs) {
                const resolver = getResolver(slug);
                const result = await resolver.selectMetaBot({ targetProvider: targetProvider });
                if (result) {
                    allMatches.push(result);
                }
            }
            if (allMatches.length === 0)
                return null;
            // Sort by lastUsedAt descending (most recently used first).
            allMatches.sort((a, b) => {
                const aTime = a.binding.lastUsedAt ?? '';
                const bTime = b.binding.lastUsedAt ?? '';
                return bTime.localeCompare(aTime);
            });
            return allMatches[0];
        },
    };
}
