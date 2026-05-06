export type LlmProvider = 'claude-code' | 'codex' | 'copilot' | 'opencode' | 'openclaw' | 'hermes' | 'gemini' | 'pi' | 'cursor' | 'kimi' | 'kiro' | 'custom';
export type LlmAuthState = 'unknown' | 'authenticated' | 'unauthenticated';
export type LlmHealth = 'healthy' | 'degraded' | 'unavailable';
export type LlmBindingRole = 'primary' | 'fallback' | 'reviewer' | 'specialist';
export declare const SUPPORTED_LLM_PROVIDERS: LlmProvider[];
export declare const HOST_BINARY_MAP: Record<string, string>;
export declare const PROVIDER_DISPLAY_NAMES: Record<string, string>;
export declare const HOST_SEARCH_ORDER: LlmProvider[];
export interface LlmRuntime {
    id: string;
    provider: LlmProvider;
    displayName: string;
    binaryPath?: string;
    version?: string;
    authState: LlmAuthState;
    health: LlmHealth;
    capabilities: string[];
    lastSeenAt: string;
    baseUrl?: string;
    model?: string;
    createdAt: string;
    updatedAt: string;
}
export interface LlmBinding {
    id: string;
    metaBotSlug: string;
    llmRuntimeId: string;
    role: LlmBindingRole;
    priority: number;
    enabled: boolean;
    lastUsedAt?: string;
    createdAt: string;
    updatedAt: string;
}
export interface LlmRuntimesState {
    version: number;
    runtimes: LlmRuntime[];
}
export interface LlmBindingsState {
    version: number;
    bindings: LlmBinding[];
}
export declare function isLlmProvider(value: unknown): value is LlmProvider;
export declare function isLlmBindingRole(value: unknown): value is LlmBindingRole;
export declare function normalizeLlmRuntime(value: unknown): LlmRuntime | null;
export declare function normalizeLlmBinding(value: unknown): LlmBinding | null;
export declare function normalizeLlmRuntimesState(value: unknown): LlmRuntimesState;
export declare function normalizeLlmBindingsState(value: unknown): LlmBindingsState;
