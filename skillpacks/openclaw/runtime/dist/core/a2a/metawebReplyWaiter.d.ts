export interface AwaitMetaWebServiceReplyInput {
    callerGlobalMetaId: string;
    callerPrivateKeyHex: string;
    providerGlobalMetaId: string;
    providerChatPublicKey?: string | null;
    servicePinId: string;
    paymentTxid: string;
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
export declare function createSocketIoMetaWebReplyWaiter(): MetaWebServiceReplyWaiter;
