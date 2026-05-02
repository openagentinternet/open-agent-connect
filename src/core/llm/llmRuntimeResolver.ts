import type { LlmRuntime, LlmBinding, LlmProvider } from './llmTypes';
import type { LlmRuntimeStore } from './llmRuntimeStore';
import type { LlmBindingStore } from './llmBindingStore';

export interface LlmRuntimeResolverOptions {
  runtimeStore: LlmRuntimeStore;
  bindingStore: LlmBindingStore;
  getPreferredRuntimeId: (metaBotSlug: string) => Promise<string | null>;
}

export interface ResolveRuntimeInput {
  metaBotSlug?: string;
  explicitRuntimeId?: string;
}

export interface SelectMetaBotInput {
  targetProvider: LlmProvider;
}

export interface SelectMetaBotResult {
  metaBotSlug: string;
  binding: LlmBinding;
  runtime: LlmRuntime;
}

export interface LlmRuntimeResolver {
  resolveRuntime(input: ResolveRuntimeInput): Promise<LlmRuntime | null>;
  selectMetaBot(input: SelectMetaBotInput): Promise<SelectMetaBotResult | null>;
  markBindingUsed(bindingId: string): Promise<void>;
}

export function createLlmRuntimeResolver(options: LlmRuntimeResolverOptions): LlmRuntimeResolver {
  const { runtimeStore, bindingStore, getPreferredRuntimeId } = options;

  async function loadRuntimes(): Promise<LlmRuntime[]> {
    const state = await runtimeStore.read();
    return state.runtimes;
  }

  return {
    async resolveRuntime(input) {
      const runtimes = await loadRuntimes();
      if (runtimes.length === 0) return null;

      const runtimeById = new Map(runtimes.map((r) => [r.id, r]));

      // 1. Explicit runtimeId — use it directly.
      if (input.explicitRuntimeId) {
        const rt = runtimeById.get(input.explicitRuntimeId);
        if (rt && rt.health !== 'unavailable') return rt;
      }

      // 2. Preferred runtime for this MetaBot slug.
      if (input.metaBotSlug) {
        const preferredId = await getPreferredRuntimeId(input.metaBotSlug);
        if (preferredId) {
          const rt = runtimeById.get(preferredId);
          if (rt && rt.health !== 'unavailable') return rt;
        }

        // 3. Enabled bindings sorted by priority → first healthy.
        const bindings = await bindingStore.listEnabledByMetaBotSlug(input.metaBotSlug);
        bindings.sort((a, b) => a.priority - b.priority);
        for (const binding of bindings) {
          const rt = runtimeById.get(binding.llmRuntimeId);
          if (rt && rt.health !== 'unavailable') return rt;
        }
      }

      // 4. First healthy runtime.
      const healthy = runtimes.find((r) => r.health === 'healthy');
      if (healthy) return healthy;

      // 5. First any runtime (absolute fallback).
      return runtimes[0];
    },

    async selectMetaBot(input) {
      const runtimes = await loadRuntimes();
      const runtimeById = new Map(runtimes.map((r) => [r.id, r]));
      const state = await bindingStore.read();
      const allBindings = state.bindings;

      // Filter bindings to those matching the target provider, enabled only.
      const matching: Array<{ binding: LlmBinding; runtime: LlmRuntime }> = [];
      for (const binding of allBindings) {
        if (!binding.enabled) continue;
        const rt = runtimeById.get(binding.llmRuntimeId);
        if (rt && rt.provider === input.targetProvider) {
          matching.push({ binding, runtime: rt });
        }
      }

      if (matching.length === 0) return null;

      // Sort by lastUsedAt descending (most recently used first).
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
