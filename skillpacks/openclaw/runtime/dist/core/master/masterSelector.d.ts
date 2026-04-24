import type { MasterDirectoryItem } from './masterTypes';
export interface MasterSelectorInput {
    hostMode: string;
    preferredDisplayName?: string | null;
    preferredMasterKind?: string | null;
    preferredMasterPinId?: string | null;
    preferredProviderGlobalMetaId?: string | null;
    trustedMasters?: string[];
    onlineOnly?: boolean;
    candidates: MasterDirectoryItem[];
}
export type MasterSelectionFailureCode = 'master_not_found' | 'master_offline' | 'master_host_mode_mismatch';
export interface MasterSelectionResult {
    selectedMaster: MasterDirectoryItem | null;
    failureCode: MasterSelectionFailureCode | null;
    failureMessage: string | null;
}
export declare function rankMasterCandidates(input: MasterSelectorInput): MasterDirectoryItem[];
export declare function selectMasterCandidate(input: MasterSelectorInput): MasterDirectoryItem | null;
export declare function resolveMasterCandidate(input: MasterSelectorInput): MasterSelectionResult;
