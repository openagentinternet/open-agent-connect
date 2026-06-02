export type ProviderServiceRunnerTerminalState = 'completed' | 'needs_clarification' | 'failed';
export interface ProviderServiceRunnerRequest {
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
export interface ProviderServiceRunnerCompletedResult {
    state: 'completed';
    responseText: string;
    /**
     * Runner-level metadata can include outputType, sessionCwd, attemptWorkspaceCwd,
     * runtimeId, and sessionId for later provider-side artifact resolution without
     * adding upload or signer coupling here.
     */
    metadata?: Record<string, unknown> | null;
}
export interface ProviderServiceRunnerClarificationResult {
    state: 'needs_clarification';
    question: string;
    metadata?: Record<string, unknown> | null;
}
export interface ProviderServiceRunnerFailedResult {
    state: 'failed';
    code: string;
    message: string;
    retryable?: boolean;
    metadata?: Record<string, unknown> | null;
}
export type ProviderServiceRunnerResult = ProviderServiceRunnerCompletedResult | ProviderServiceRunnerClarificationResult | ProviderServiceRunnerFailedResult;
export type ProviderServiceRunner = (input: ProviderServiceRunnerRequest) => ProviderServiceRunnerResult | Promise<ProviderServiceRunnerResult>;
export interface ProviderServiceRunnerRegistration {
    servicePinId?: string | null;
    providerSkill?: string | null;
    runner: ProviderServiceRunner;
}
export declare function isProviderServiceRunnerResult(value: unknown): value is ProviderServiceRunnerResult;
export declare function createServiceRunnerFailedResult(code: string, message: string, retryable?: boolean): ProviderServiceRunnerFailedResult;
