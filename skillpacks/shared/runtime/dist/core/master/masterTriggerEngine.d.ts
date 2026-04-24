import { type AskMasterConfig } from '../config/configTypes';
export interface TriggerObservation {
    now: number;
    traceId?: string | null;
    hostMode: string;
    workspaceId?: string | null;
    userIntent?: {
        explicitlyAskedForMaster?: boolean;
        explicitlyRejectedSuggestion?: boolean;
        explicitlyRejectedAutoAsk?: boolean;
    };
    activity?: {
        recentUserMessages?: number;
        recentAssistantMessages?: number;
        recentToolCalls?: number;
        recentFailures?: number;
        repeatedFailureCount?: number;
        noProgressWindowMs?: number | null;
    };
    diagnostics?: {
        failingTests?: number;
        failingCommands?: number;
        repeatedErrorSignatures?: string[];
        uncertaintySignals?: string[];
    };
    workState?: {
        hasPlan?: boolean;
        todoBlocked?: boolean;
        diffChangedRecently?: boolean;
        onlyReadingWithoutConverging?: boolean;
    };
    directory?: {
        availableMasters?: number;
        trustedMasters?: number;
        onlineMasters?: number;
    };
    candidateMasterKindHint?: string | null;
}
export type TriggerDecision = {
    action: 'no_action';
    reason: string;
} | {
    action: 'suggest';
    reason: string;
    confidence: number;
    candidateMasterKind?: string | null;
} | {
    action: 'auto_candidate';
    reason: string;
    confidence: number;
    candidateMasterKind?: string | null;
} | {
    action: 'manual_requested';
    reason: string;
};
export interface MasterTriggerMemoryState {
    suggestedTraceIds: string[];
    rejectedMasterKinds: string[];
    recentFailureSignatures: string[];
    manuallyRequestedMasterKinds: string[];
}
export interface CollectAndEvaluateMasterTriggerResult {
    collected: boolean;
    observation: NormalizedTriggerObservation | null;
    decision: TriggerDecision;
}
interface NormalizedTriggerObservation {
    now: number;
    traceId: string | null;
    hostMode: string;
    workspaceId: string | null;
    userIntent: {
        explicitlyAskedForMaster: boolean;
        explicitlyRejectedSuggestion: boolean;
        explicitlyRejectedAutoAsk: boolean;
    };
    activity: {
        recentUserMessages: number;
        recentAssistantMessages: number;
        recentToolCalls: number;
        recentFailures: number;
        repeatedFailureCount: number;
        noProgressWindowMs: number | null;
    };
    diagnostics: {
        failingTests: number;
        failingCommands: number;
        repeatedErrorSignatures: string[];
        uncertaintySignals: string[];
    };
    workState: {
        hasPlan: boolean;
        todoBlocked: boolean;
        diffChangedRecently: boolean;
        onlyReadingWithoutConverging: boolean;
    };
    directory: {
        availableMasters: number;
        trustedMasters: number;
        onlineMasters: number;
    };
    candidateMasterKindHint: string | null;
}
export declare function createMasterTriggerMemoryState(): MasterTriggerMemoryState;
export declare function mergeMasterTriggerMemoryStates(...states: Array<Partial<MasterTriggerMemoryState> | null | undefined>): MasterTriggerMemoryState;
export declare function collectAndEvaluateMasterTrigger(input: {
    config?: Partial<AskMasterConfig> | null;
    suppression?: Partial<MasterTriggerMemoryState> | null;
    collectObservation: () => TriggerObservation | Promise<TriggerObservation>;
}): Promise<CollectAndEvaluateMasterTriggerResult>;
export declare function evaluateMasterTrigger(input: {
    config?: Partial<AskMasterConfig> | null;
    observation: TriggerObservation;
    suppression?: Partial<MasterTriggerMemoryState> | null;
}): TriggerDecision;
export declare function recordMasterTriggerOutcome(input: {
    state?: Partial<MasterTriggerMemoryState> | null;
    observation: TriggerObservation | NormalizedTriggerObservation;
    decision: TriggerDecision;
}): MasterTriggerMemoryState;
export {};
