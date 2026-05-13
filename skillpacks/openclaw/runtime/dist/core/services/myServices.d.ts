import type { RuntimeIdentityRecord } from '../state/runtimeStateStore';
import type { SellerOrderRecord } from '../orders/sellerOrderState';
import type { RatingDetailItem } from '../ratings/ratingDetailState';
import { type PublishedServiceDraft, type PublishedServiceRecord } from './publishService';
export type MyServiceMutationAction = 'modify' | 'revoke';
export interface MyServicesProfileInput {
    slug: string;
    name: string;
    homeDir?: string | null;
    identity: RuntimeIdentityRecord | null;
    services: PublishedServiceRecord[];
    sellerOrders: SellerOrderRecord[];
    ratingDetails: RatingDetailItem[];
}
export interface MyServiceSummary {
    id: string;
    currentPinId: string;
    sourceServicePinId: string;
    chainPinIds: string[];
    serviceName: string;
    displayName: string;
    description: string;
    price: string;
    currency: string;
    paymentChain: string | null;
    settlementKind: string | null;
    mrc20Ticker: string | null;
    mrc20Id: string | null;
    providerGlobalMetaId: string;
    providerAddress: string;
    paymentAddress: string;
    serviceIcon: string | null;
    providerSkill: string | null;
    outputType: string | null;
    creatorMetabotId: number | null;
    creatorMetabotSlug: string;
    creatorMetabotName: string;
    creatorMetabotHomeDir: string;
    canModify: boolean;
    canRevoke: boolean;
    blockedReason: string | null;
    successCount: number;
    refundCount: number;
    grossRevenue: string;
    netIncome: string;
    ratingAvg: number;
    ratingCount: number;
    updatedAt: number;
}
export interface MyServiceOrderRating {
    pinId?: string | null;
    rate: number;
    comment: string | null;
    createdAt: number | null;
    raterGlobalMetaId: string | null;
    raterMetaId: string | null;
}
export interface MyServiceOrderDetail {
    id: string;
    status: string;
    traceId: string;
    paymentTxid: string | null;
    orderMessageTxid: string | null;
    paymentAmount: string;
    paymentCurrency: string;
    servicePinId: string | null;
    createdAt: number | null;
    deliveredAt: number | null;
    refundCompletedAt: number | null;
    counterpartyGlobalMetaid: string | null;
    counterpartyName?: string | null;
    counterpartyAvatar?: string | null;
    coworkSessionId: string | null;
    runtimeId: string | null;
    runtimeProvider: string | null;
    llmSessionId: string | null;
    rating: MyServiceOrderRating | null;
}
export interface MyServicePageResult<T> {
    items: T[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
}
export interface MyServiceMutationTarget {
    profileSlug: string;
    profileName: string;
    profileHomeDir: string;
    identity: RuntimeIdentityRecord | null;
    service: PublishedServiceRecord | null;
}
export interface MyServiceMutationValidationResult {
    ok: boolean;
    error?: string;
    errorCode?: string;
    creatorMetabotId?: number;
}
export declare function buildMyServiceSummaries(input: {
    profiles: MyServicesProfileInput[];
    page: number;
    pageSize: number;
}): MyServicePageResult<MyServiceSummary>;
export declare function buildMyServiceOrderDetails(input: {
    serviceId: string;
    profiles: MyServicesProfileInput[];
    page: number;
    pageSize: number;
}): MyServicePageResult<MyServiceOrderDetail>;
export declare function validateMyServiceMutation(input: {
    action: MyServiceMutationAction;
    target: MyServiceMutationTarget | null | undefined;
}): MyServiceMutationValidationResult;
export declare function buildMyServiceModifyChainWrite(input: {
    targetPinId: string;
    payloadJson: string;
    network?: string;
}): {
    operation: string;
    path: string;
    payload: string;
    contentType: string;
    network: string;
};
export declare function buildMyServiceRevokeChainWrite(input: {
    targetPinId: string;
    network?: string;
}): {
    operation: string;
    path: string;
    payload: string;
    contentType: string;
    network: string;
};
export declare function buildMyServicePayload(input: {
    draft: PublishedServiceDraft;
    providerGlobalMetaId: string;
    paymentAddress: string;
}): Record<string, string | null>;
export declare function buildMyServiceModifyRecord(input: {
    service: PublishedServiceRecord;
    currentPinId: string;
    providerGlobalMetaId: string;
    paymentAddress: string;
    draft: PublishedServiceDraft;
    payloadJson: string;
    now: number;
}): PublishedServiceRecord;
export declare function buildMyServiceRevokeRecord(input: {
    service: PublishedServiceRecord;
    now: number;
}): PublishedServiceRecord;
export declare function resolveMyServicePaymentAddress(input: {
    identity: RuntimeIdentityRecord | null;
    currency: string;
    fallback: string;
}): string;
