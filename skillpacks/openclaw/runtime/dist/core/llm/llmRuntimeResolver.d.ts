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
    excludeRuntimeIds?: string[];
}
export interface ResolveRuntimeResult {
    runtime: LlmRuntime | null;
    bindingId?: string;
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
    markRuntimeUnavailable(runtimeId: string): Promise<void>;
}
export declare function createLlmRuntimeResolver(options: LlmRuntimeResolverOptions): LlmRuntimeResolver;
