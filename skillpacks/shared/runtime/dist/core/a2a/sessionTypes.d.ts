export type A2ASessionRole = 'caller' | 'provider';
export type A2ASessionState = 'discovered' | 'awaiting_confirmation' | 'requesting_remote' | 'remote_received' | 'remote_executing' | 'completed' | 'manual_action_required' | 'remote_failed' | 'timeout';
export type A2ATaskRunState = 'queued' | 'running' | 'needs_clarification' | 'completed' | 'failed' | 'timeout';
export interface A2AClarificationRoundRecord {
    round: number;
    askedAt: number | null;
    answeredAt: number | null;
    question: string | null;
    answer: string | null;
    status: 'pending' | 'answered' | 'expired' | 'skipped';
}
export interface A2ATaskRunRecord {
    runId: string;
    sessionId: string;
    state: A2ATaskRunState;
    createdAt: number;
    updatedAt: number;
    startedAt: number | null;
    completedAt: number | null;
    failureCode: string | null;
    failureReason: string | null;
    clarificationRounds: A2AClarificationRoundRecord[];
}
export interface A2ASessionRecord {
    sessionId: string;
    traceId: string;
    role: A2ASessionRole;
    state: A2ASessionState;
    createdAt: number;
    updatedAt: number;
    callerGlobalMetaId: string;
    providerGlobalMetaId: string;
    servicePinId: string;
    currentTaskRunId: string | null;
    latestTaskRunState: A2ATaskRunState | null;
}
export type DelegationPolicyMode = 'confirm_all' | 'confirm_paid_only' | 'auto_when_safe';
export type DelegationPolicyReason = 'confirm_all_requires_confirmation' | 'policy_mode_not_publicly_enabled';
export interface DelegationPolicyDecision {
    requiresConfirmation: boolean;
    policyMode: DelegationPolicyMode;
    policyReason: DelegationPolicyReason;
    requestedPolicyMode: DelegationPolicyMode;
    confirmationBypassed: boolean;
    bypassReason: string | null;
}
