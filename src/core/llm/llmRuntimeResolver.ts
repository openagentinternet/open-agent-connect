import type {
  LlmRuntime,
  LlmBinding,
  LlmBindingRole,
  LlmProvider,
} from './llmTypes';
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
  excludeRuntimeIds?: string[];
}

export interface ResolveRuntimeResult {
  runtime: LlmRuntime | null;
  bindingId?: string;
  bindingRole?: LlmBindingRole;
}

export interface ResolvedLlmRuntimeSummary {
  [key: string]: unknown;
  provider: LlmProvider;
  displayName: string;
  health: LlmRuntime['health'];
  selectedRole: LlmBindingRole | 'unbound';
  version?: string;
  logoPath?: string;
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
  resolveRuntime(input: ResolveRuntimeInput): Promise<ResolveRuntimeResult>;
  selectMetaBot(input: SelectMetaBotInput): Promise<SelectMetaBotResult | null>;
  markBindingUsed(bindingId: string): Promise<void>;
  markRuntimeUnavailable(runtimeId: string, reason?: string): Promise<void>;
}

const DEFAULT_UNAVAILABLE_COOLDOWN_MS = 15 * 60 * 1000;

function bindingRoleRank(role: LlmBindingRole): number {
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

function compareBindingSelection(left: LlmBinding, right: LlmBinding): number {
  const roleDelta = bindingRoleRank(left.role) - bindingRoleRank(right.role);
  if (roleDelta !== 0) return roleDelta;
  if (left.priority !== right.priority) return left.priority - right.priority;
  if (left.updatedAt !== right.updatedAt) return right.updatedAt.localeCompare(left.updatedAt);
  return left.id.localeCompare(right.id);
}

export function summarizeResolvedLlmRuntime(
  resolved: ResolveRuntimeResult,
): ResolvedLlmRuntimeSummary | undefined {
  if (!resolved.runtime) return undefined;
  return {
    provider: resolved.runtime.provider,
    displayName: resolved.runtime.displayName,
    health: resolved.runtime.health,
    selectedRole: resolved.bindingRole ?? 'unbound',
    ...(resolved.runtime.version ? { version: resolved.runtime.version } : {}),
    ...(resolved.runtime.logoPath ? { logoPath: resolved.runtime.logoPath } : {}),
  };
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
      if (runtimes.length === 0) return { runtime: null };

      const runtimeById = new Map(runtimes.map((r) => [r.id, r]));
      const excludedRuntimeIds = new Set(input.excludeRuntimeIds ?? []);
      const isExcluded = (runtime: LlmRuntime): boolean => excludedRuntimeIds.has(runtime.id);
      const isSelectable = (runtime: LlmRuntime): boolean => !isExcluded(runtime) && runtime.health === 'healthy';

      // 1. Explicit runtimeId — use it directly.
      if (input.explicitRuntimeId) {
        const rt = runtimeById.get(input.explicitRuntimeId);
        if (rt && isSelectable(rt)) return { runtime: rt };
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
          if (rt && isSelectable(rt)) return { runtime: rt };
        }
      }

      // 4. First healthy runtime.
      const healthy = runtimes.find((r) => !isExcluded(r) && r.health === 'healthy');
      if (healthy) return { runtime: healthy };

      return { runtime: null };
    },

    async selectMetaBot(input) {
      const runtimes = await loadRuntimes();
      const runtimeById = new Map(runtimes.map((r) => [r.id, r]));
      const state = await bindingStore.read();
      const allBindings = state.bindings;

      const matching: Array<{ binding: LlmBinding; runtime: LlmRuntime }> = [];
      for (const binding of allBindings) {
        if (!binding.enabled) continue;
        const rt = runtimeById.get(binding.llmRuntimeId);
        if (rt && rt.provider === input.targetProvider && rt.health === 'healthy') {
          matching.push({ binding, runtime: rt });
        }
      }

      if (matching.length === 0) return null;

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

    async markRuntimeUnavailable(runtimeId, reason) {
      const now = new Date();
      await options.runtimeStore.updateHealth(runtimeId, 'unavailable', {
        reason,
        healthCheckedAt: now.toISOString(),
        unavailableUntil: new Date(now.getTime() + DEFAULT_UNAVAILABLE_COOLDOWN_MS).toISOString(),
      });
    },
  };
}
