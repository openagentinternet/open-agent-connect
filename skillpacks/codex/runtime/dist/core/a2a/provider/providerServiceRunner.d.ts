import type { LlmExecutor } from '../../llm/executor';
import type { LlmBindingStore } from '../../llm/llmBindingStore';
import type { LlmRuntimeStore } from '../../llm/llmRuntimeStore';
import type { LlmRuntime } from '../../llm/llmTypes';
import { type PlatformSkillCatalogEntry, type PlatformSkillRootDiagnostic } from '../../services/platformSkillCatalog';
import { type ProviderServiceRunnerResult } from './serviceRunnerContracts';
export interface ProviderServiceOrderInput {
    servicePinId: string;
    providerSkill: string;
    providerGlobalMetaId: string;
    userTask: string;
    taskContext: string;
    serviceName?: string | null;
    displayName?: string | null;
    outputType?: string | null;
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
    outputType?: string | null;
    userTask: string;
    taskContext: string;
}): string;
export declare function createProviderServiceRunner(input: ProviderServiceRunnerDependencies): {
    execute(order: ProviderServiceOrderInput): Promise<ProviderServiceRunnerResultWithRuntime>;
};
export {};
