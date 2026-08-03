import type { A2ASessionStateStore } from '../a2a/sessionStateStore';
import type { SessionTraceRecord } from '../chat/sessionTrace';
import type { RuntimeStateStore } from '../state/runtimeStateStore';
import type { SellerOrderRecord } from './sellerOrderState';
export declare function isSellerOrderActiveForChatSuppression(order: Pick<SellerOrderRecord, 'state'>): boolean;
export declare function isBuyerTraceOrderActiveForChatSuppression(order: NonNullable<SessionTraceRecord['order']>): boolean;
export declare function createHasActiveOrderWithPeer(input: {
    runtimeStateStore: RuntimeStateStore;
    sessionStateStore: A2ASessionStateStore;
}): (peerGlobalMetaId: string) => Promise<boolean>;
