import type { MasterTriggerMemoryState } from './masterTriggerEngine';
import { type MetabotPaths } from '../state/paths';
export declare const MASTER_SUGGEST_REJECTION_COOLDOWN_MS: number;
export declare const MASTER_SUGGEST_SIGNATURE_COOLDOWN_MS: number;
export declare const MASTER_SUGGEST_ACCEPT_COOLDOWN_MS: number;
export declare const MASTER_SUGGEST_MAX_ITEMS = 100;
export interface StoredMasterSuggestTarget {
    servicePinId: string;
    providerGlobalMetaId: string;
    masterKind: string;
    displayName: string | null;
}
export interface StoredMasterSuggestRecord {
    suggestionId: string;
    traceId: string;
    createdAt: number;
    updatedAt: number;
    status: 'suggested' | 'accepted' | 'rejected';
    hostMode: string;
    candidateMasterKind: string | null;
    candidateDisplayName: string | null;
    reason: string;
    confidence: number;
    failureSignatures: string[];
    draft: Record<string, unknown>;
    target: StoredMasterSuggestTarget;
    rejectionReason?: string | null;
    acceptedAt?: number | null;
    rejectedAt?: number | null;
}
export interface MasterSuggestState {
    items: StoredMasterSuggestRecord[];
}
export interface MasterSuggestStateStore {
    paths: MetabotPaths;
    statePath: string;
    read(): Promise<MasterSuggestState>;
    write(nextState: MasterSuggestState): Promise<MasterSuggestState>;
    update(updater: (currentState: MasterSuggestState) => MasterSuggestState | Promise<MasterSuggestState>): Promise<MasterSuggestState>;
    get(traceId: string, suggestionId: string): Promise<StoredMasterSuggestRecord>;
    put(record: StoredMasterSuggestRecord): Promise<StoredMasterSuggestRecord>;
}
export declare function buildMasterSuggestionId(now: number): string;
export declare function deriveMasterTriggerMemoryStateFromSuggestState(input: {
    state: MasterSuggestState | null | undefined;
    now?: number;
}): MasterTriggerMemoryState;
export declare function createMasterSuggestStateStore(homeDirOrPaths: string | MetabotPaths): MasterSuggestStateStore;
