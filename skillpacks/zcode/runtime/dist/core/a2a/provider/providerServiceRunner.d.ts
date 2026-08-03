import type { LlmExecutor } from '../../llm/executor';
import type { LlmBindingStore } from '../../llm/llmBindingStore';
import type { LlmRuntimeStore } from '../../llm/llmRuntimeStore';
import type { LlmRuntime } from '../../llm/llmTypes';
import { type PlatformSkillCatalogEntry, type PlatformSkillRootDiagnostic } from '../../services/platformSkillCatalog';
import { type ProviderServiceRunnerResult } from './serviceRunnerContracts';
export interface ProviderServiceOrderInput {
    servicePinId: string;
    providerSkill: string;
    providerSkills?: string[] | null;
    providerGlobalMetaId: string;
    userTask: string;
    taskContext: string;
    serviceName?: string | null;
    displayName?: string | null;
    outputType?: string | null;
    executionReminder?: string | null;
    rawRequest?: string | null;
    metadata?: Record<string, unknown> | null;
}
export interface ProviderServiceRunnerDependencies {
    metaBotSlug: string;
    systemHomeDir: string;
    projectRoot: string;
    runtimeStore: LlmRuntimeStore;
    bindingStore: LlmBindingStore;
    llmExecutor: Pick<LlmExecutor, 'execute' | 'getSession' | 'cancel'>;
    sessionTimeoutMs?: number;
    pollIntervalMs?: number;
    env?: NodeJS.ProcessEnv;
    getFallbackRuntime?: (primaryRuntime: LlmRuntime | null) => Promise<LlmRuntime | null> | LlmRuntime | null;
    canStartRuntime?: (runtime: LlmRuntime) => Promise<boolean> | boolean;
}
export interface ProviderServiceRunnerSelection {
    runtime: LlmRuntime;
    skill: PlatformSkillCatalogEntry;
    skills: PlatformSkillCatalogEntry[];
    rootDiagnostics: PlatformSkillRootDiagnostic[];
    fallbackSelected: boolean;
}
type ProviderServiceRunnerResultWithRuntime = ProviderServiceRunnerResult & {
    runtimeId?: string;
    sessionId?: string;
    selection?: ProviderServiceRunnerSelection | null;
};
export declare function buildProviderServiceOrderPrompt(input: {
    serviceName?: string | null;
    displayName?: string | null;
    providerSkill: string;
    providerSkills?: string[] | null;
    outputType?: string | null;
    userTask: string;
    taskContext: string;
    executionReminder?: string | null;
}): string;
export declare const DEFAULT_PROVIDER_ORDER_EXECUTION_TIMEOUT_MS: number;
export declare const VIDEO_PROVIDER_ORDER_EXECUTION_TIMEOUT_MS: number;
export declare const MIN_PROVIDER_ORDER_EXECUTION_TIMEOUT_MS = 30000;
export declare const MAX_PROVIDER_ORDER_EXECUTION_TIMEOUT_MS: number;
/**
 * Execution timeout for one provider service order. The published service
 * schema carries no timeout field and none is added; a service record that
 * nevertheless has a positive `executionTimeoutMs` is honored as an override,
 * clamped to [30s, 30min]. Otherwise video output gets 20 minutes and every
 * other output type gets 5 minutes (mirrors the IDBots reference behavior).
 */
export declare function resolveProviderOrderExecutionTimeoutMs(service: {
    outputType?: string | null;
    executionTimeoutMs?: number | null;
}): number;
export declare function createProviderServiceRunner(input: ProviderServiceRunnerDependencies): {
    execute(order: ProviderServiceOrderInput): Promise<ProviderServiceRunnerResultWithRuntime>;
    /**
     * IDBots MAX_MISSING_ARTIFACT_CONTINUATION_ATTEMPTS parity: one forced
     * continuation run after a completed non-text execution left no
     * deliverable artifact. The continuation reuses the previous run's
     * selection and attempt workspace (no new workspace, no fallback retry)
     * and prompts the runtime that it MUST generate the expected file.
     */
    executeContinuation(order: ProviderServiceOrderInput, previousResult: ProviderServiceRunnerResult): Promise<ProviderServiceRunnerResultWithRuntime>;
};
export {};
