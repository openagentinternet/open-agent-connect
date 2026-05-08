import type { SessionTraceRecord } from '../chat/sessionTrace';
import type { SellerOrderRecord } from '../orders/sellerOrderState';
import type { RatingDetailItem } from '../ratings/ratingDetailState';
import type { PublishedMasterRecord } from '../master/masterTypes';
import type { PublishedServiceRecord } from '../services/publishService';
type ProviderConsoleTraceOrder = NonNullable<SessionTraceRecord['order']> & {
    status?: string | null;
    refundRequestPinId?: string | null;
    coworkSessionId?: string | null;
};
export interface ProviderConsoleTraceRecord extends Omit<SessionTraceRecord, 'order'> {
    order: ProviderConsoleTraceOrder | null;
    ratingMessageSent?: boolean | null;
    ratingMessageError?: string | null;
}
export type ProviderConsoleOrderRatingStatus = 'not_requested' | 'requested_unrated' | 'rated_on_chain' | 'rated_on_chain_followup_unconfirmed' | 'sync_error';
export type ProviderConsoleRatingSyncState = 'ready' | 'sync_error';
export interface ProviderConsoleServiceRow {
    servicePinId: string;
    sourceServicePinId: string;
    serviceName: string;
    displayName: string;
    price: string;
    currency: string;
    available: boolean;
    updatedAt: number;
}
export interface ProviderConsoleOrderRow {
    traceId: string;
    orderId: string;
    servicePinId: string;
    serviceName: string;
    paymentTxid: string | null;
    paymentAmount: string | null;
    paymentCurrency: string | null;
    buyerGlobalMetaId: string | null;
    buyerName: string | null;
    publicStatus: string | null;
    state?: string | null;
    providerSkill?: string | null;
    a2aSessionId?: string | null;
    a2aTaskRunId?: string | null;
    llmSessionId?: string | null;
    runtimeId?: string | null;
    runtimeProvider?: string | null;
    fallbackSelected?: boolean | null;
    failureReason?: string | null;
    refundRequestPinId?: string | null;
    refundTxid?: string | null;
    refundFinalizePinId?: string | null;
    refundBlockingReason?: string | null;
    createdAt: number;
    updatedAt?: number;
    ratingStatus: ProviderConsoleOrderRatingStatus;
    ratingValue: number | null;
    ratingComment: string | null;
    ratingPinId: string | null;
    ratingCreatedAt: number | null;
}
export interface ProviderConsoleManualActionRow {
    kind: 'refund';
    traceId: string;
    orderId: string;
    refundRequestPinId: string | null;
    sessionId: string | null;
}
export interface ProviderConsoleMasterRequestRow {
    traceId: string;
    servicePinId: string;
    serviceName: string;
    displayName: string;
    masterKind: string;
    callerGlobalMetaId: string | null;
    callerName: string | null;
    publicStatus: string | null;
    latestEvent: string | null;
    createdAt: number;
}
export interface ProviderConsoleSnapshot {
    services: ProviderConsoleServiceRow[];
    recentOrders: ProviderConsoleOrderRow[];
    manualActions: ProviderConsoleManualActionRow[];
    recentMasterRequests: ProviderConsoleMasterRequestRow[];
    totals: {
        serviceCount: number;
        activeServiceCount: number;
        sellerOrderCount: number;
        manualActionCount: number;
        masterRequestCount: number;
    };
}
export declare function buildProviderConsoleSnapshot(input: {
    services: PublishedServiceRecord[];
    masters?: PublishedMasterRecord[];
    traces: ProviderConsoleTraceRecord[];
    sellerOrders?: SellerOrderRecord[];
    ratingDetails?: RatingDetailItem[];
    ratingSyncState?: ProviderConsoleRatingSyncState;
}): ProviderConsoleSnapshot;
export {};
