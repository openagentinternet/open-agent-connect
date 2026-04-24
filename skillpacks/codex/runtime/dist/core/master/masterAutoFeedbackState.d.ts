import type { MasterTriggerMemoryState } from './masterTriggerEngine';
import { type MetabotPaths } from '../state/paths';
export declare const MASTER_AUTO_FEEDBACK_MAX_ITEMS = 100;
export declare const MASTER_AUTO_REJECTION_COOLDOWN_MS: number;
export declare const MASTER_AUTO_TIMEOUT_COOLDOWN_MS: number;
export declare const MASTER_AUTO_SIGNATURE_COOLDOWN_MS: number;
export type MasterAutoFeedbackStatus = 'prepared' | 'confirmed' | 'rejected' | 'sent' | 'timed_out' | 'completed';
export interface MasterAutoFeedbackRecord {
    traceId: string;
    masterKind: string | null;
    masterServicePinId: string | null;
    triggerReasonSignature: string | null;
    status: MasterAutoFeedbackStatus;
    createdAt: number;
    updatedAt: number;
}
export interface MasterAutoFeedbackState {
    items: MasterAutoFeedbackRecord[];
}
export interface MasterAutoFeedbackStateStore {
    paths: MetabotPaths;
    statePath: string;
    read(): Promise<MasterAutoFeedbackState>;
    write(nextState: MasterAutoFeedbackState): Promise<MasterAutoFeedbackState>;
    update(updater: (currentState: MasterAutoFeedbackState) => MasterAutoFeedbackState | Promise<MasterAutoFeedbackState>): Promise<MasterAutoFeedbackState>;
    get(traceId: string): Promise<MasterAutoFeedbackRecord>;
    put(record: MasterAutoFeedbackRecord): Promise<MasterAutoFeedbackRecord>;
}
export declare function deriveMasterTriggerMemoryStateFromAutoFeedbackState(input: {
    state: MasterAutoFeedbackState | null | undefined;
    now?: number;
}): MasterTriggerMemoryState;
export declare function findRecentAutoFeedbackForTarget(input: {
    state: MasterAutoFeedbackState | null | undefined;
    masterServicePinId: string | null | undefined;
    now?: number;
}): MasterAutoFeedbackRecord | null;
export declare function createMasterAutoFeedbackStateStore(homeDirOrPaths: string | MetabotPaths): MasterAutoFeedbackStateStore;
