export interface AwaitMetaWebServiceReplyInput {
    callerGlobalMetaId: string;
    callerPrivateKeyHex: string;
    providerGlobalMetaId: string;
    providerChatPublicKey?: string | null;
    servicePinId: string;
    paymentTxid: string;
    orderTxid?: string | null;
    timeoutMs: number;
}
export type AwaitMetaWebServiceReplyResult = {
    state: 'completed';
    responseText: string;
    deliveryPinId: string | null;
    observedAt: number | null;
    rawMessage: Record<string, unknown> | null;
    ratingRequestText?: string | null;
} | {
    state: 'timeout';
};
export interface MetaWebServiceReplyWaiter {
    awaitServiceReply(input: AwaitMetaWebServiceReplyInput): Promise<AwaitMetaWebServiceReplyResult>;
}
export declare function normalizeOrderProtocolReference(value: unknown): string;
export declare function shouldAcceptServiceDeliveryForReplyWaiter(input: {
    delivery: {
        orderTxid?: unknown;
        paymentTxid?: unknown;
        servicePinId?: unknown;
    };
    expected: {
        orderTxid?: unknown;
        paymentTxid?: unknown;
        servicePinId?: unknown;
    };
}): boolean;
export declare function shouldAcceptServiceRatingRequestForReplyWaiter(input: {
    ratingOrderTxid?: unknown;
    expectedOrderTxid?: unknown;
    pendingDeliveryOrderTxid?: unknown;
}): boolean;
export declare function createSocketIoMetaWebReplyWaiter(): MetaWebServiceReplyWaiter;
