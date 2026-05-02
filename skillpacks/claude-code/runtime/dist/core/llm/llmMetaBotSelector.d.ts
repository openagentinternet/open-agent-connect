import type { LlmRuntimeStore } from './llmRuntimeStore';
import type { LlmBindingStore } from './llmBindingStore';
export interface LlmMetaBotSelectorDeps {
    runtimeStore: LlmRuntimeStore;
    getBindingStoreForSlug: (slug: string) => LlmBindingStore;
    getPreferredRuntimeId: (slug: string) => Promise<string | null>;
    listAllProfileSlugs: () => Promise<string[]>;
}
export declare function createLlmMetaBotSelector(deps: LlmMetaBotSelectorDeps): {
    /**
     * Find the best MetaBot for a given provider.
     * Iterates all profiles, collects their enabled bindings matching the provider,
     * sorts by lastUsedAt descending.
     */
    selectBestMetaBotForProvider(targetProvider: string): Promise<{
        metaBotSlug: string;
        binding: {
            id: string;
            llmRuntimeId: string;
            role: string;
            priority: number;
            lastUsedAt?: string;
        };
        runtime: {
            id: string;
            provider: string;
        };
    } | null>;
};
