import { type MasterResponseMessage } from './masterMessageSchema';
export interface AwaitMetaWebMasterReplyInput {
    callerGlobalMetaId: string;
    callerPrivateKeyHex: string;
    providerGlobalMetaId: string;
    providerChatPublicKey?: string | null;
    masterServicePinId: string;
    requestId: string;
    traceId: string;
    timeoutMs: number;
}
export type AwaitMetaWebMasterReplyResult = {
    state: 'completed';
    response: MasterResponseMessage;
    responseJson: string;
    deliveryPinId: string | null;
    observedAt: number | null;
    rawMessage: Record<string, unknown> | null;
} | {
    state: 'timeout';
};
export interface MetaWebMasterReplyWaiter {
    awaitMasterReply(input: AwaitMetaWebMasterReplyInput): Promise<AwaitMetaWebMasterReplyResult>;
}
export declare function createSocketIoMetaWebMasterReplyWaiter(): MetaWebMasterReplyWaiter;
