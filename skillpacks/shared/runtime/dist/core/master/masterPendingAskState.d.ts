import { type MetabotPaths } from '../state/paths';
import type { MasterRequestMessage } from './masterMessageSchema';
export interface PendingMasterAskRecord {
    traceId: string;
    requestId: string;
    createdAt: number;
    updatedAt: number;
    confirmationState: 'awaiting_confirmation' | 'sent';
    requestJson: string;
    request: MasterRequestMessage;
    target: Record<string, unknown>;
    preview: Record<string, unknown>;
    messagePinId?: string | null;
    sentAt?: number | null;
}
export interface PendingMasterAskState {
    items: PendingMasterAskRecord[];
}
export interface PendingMasterAskStateStore {
    paths: MetabotPaths;
    statePath: string;
    read(): Promise<PendingMasterAskState>;
    write(nextState: PendingMasterAskState): Promise<PendingMasterAskState>;
    update(updater: (currentState: PendingMasterAskState) => PendingMasterAskState | Promise<PendingMasterAskState>): Promise<PendingMasterAskState>;
    get(traceId: string): Promise<PendingMasterAskRecord>;
    put(record: PendingMasterAskRecord): Promise<PendingMasterAskRecord>;
}
export declare function createPendingMasterAskStateStore(homeDirOrPaths: string | MetabotPaths): PendingMasterAskStateStore;
