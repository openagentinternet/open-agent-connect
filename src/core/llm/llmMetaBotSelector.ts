import { createLlmRuntimeResolver } from './llmRuntimeResolver';
import type { LlmRuntimeResolver, ResolveRuntimeInput } from './llmRuntimeResolver';
import type { LlmRuntimeStore } from './llmRuntimeStore';
import type { LlmBindingStore } from './llmBindingStore';

export interface LlmMetaBotSelectorDeps {
  runtimeStore: LlmRuntimeStore;
  getBindingStoreForSlug: (slug: string) => LlmBindingStore;
  getPreferredRuntimeId: (slug: string) => Promise<string | null>;
  listAllProfileSlugs: () => Promise<string[]>;
}

export function createLlmMetaBotSelector(deps: LlmMetaBotSelectorDeps) {
  const runtimeResolvers = new Map<string, LlmRuntimeResolver>();

  function getResolver(slug: string): LlmRuntimeResolver {
    let resolver = runtimeResolvers.get(slug);
    if (!resolver) {
      resolver = createLlmRuntimeResolver({
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
    async selectBestMetaBotForProvider(targetProvider: string) {
      const slugs = await deps.listAllProfileSlugs();
      const allMatches: Array<{
        metaBotSlug: string;
        binding: { id: string; llmRuntimeId: string; role: string; priority: number; lastUsedAt?: string };
        runtime: { id: string; provider: string };
      }> = [];

      for (const slug of slugs) {
        const resolver = getResolver(slug);
        const result = await resolver.selectMetaBot({ targetProvider: targetProvider as never });
        if (result) {
          allMatches.push(result);
        }
      }

      if (allMatches.length === 0) return null;

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
