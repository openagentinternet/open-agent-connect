import type { RuntimeState } from '../state/runtimeStateStore';
import type { ParsedServiceRefundFinalize, ParsedServiceRefundRequest } from './serviceRefundProtocol';
export interface ServiceRefundSyncIdentity {
    localMetabotId: number;
    localMetabotSlug: string;
    localGlobalMetaId: string;
}
export interface ServiceRefundSyncResult {
    nextState: RuntimeState;
    applied: {
        buyerRequests: number;
        sellerRequests: number;
        synthesizedSellerOrders: number;
        finalizations: number;
    };
    skipped: number;
    blocked: number;
}
export interface ApplyServiceRefundRequestsInput {
    state: RuntimeState;
    requests: ParsedServiceRefundRequest[];
    identity: ServiceRefundSyncIdentity;
    nowMs: number;
}
export interface ApplyServiceRefundFinalizationsInput {
    state: RuntimeState;
    finalizations: ParsedServiceRefundFinalize[];
    identity: ServiceRefundSyncIdentity;
    nowMs: number;
    verifyFinalize?: (finalize: ParsedServiceRefundFinalize) => boolean | Promise<boolean>;
}
export declare function applyServiceRefundRequestsToState(input: ApplyServiceRefundRequestsInput): ServiceRefundSyncResult;
export declare function applyServiceRefundFinalizationsToState(input: ApplyServiceRefundFinalizationsInput): Promise<ServiceRefundSyncResult>;
export declare function mergeServiceRefundSyncState(input: {
    currentState: RuntimeState;
    syncedState: RuntimeState;
}): RuntimeState;
