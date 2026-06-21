export interface ChatViewerUserInfo {
    globalMetaId?: string;
    metaid?: string;
    metaId?: string;
    name?: string;
    nickname?: string;
    avatar?: string;
    avatarUri?: string;
}
export interface ChatViewerMessage {
    id: string;
    pinId?: string;
    txId?: string;
    protocol: string;
    type?: '2';
    content: string;
    contentType?: string;
    timestamp: number;
    index: number;
    fromGlobalMetaId: string;
    toGlobalMetaId: string;
    fromUserInfo?: ChatViewerUserInfo | null;
    toUserInfo?: ChatViewerUserInfo | null;
    userInfo?: ChatViewerUserInfo | null;
    replyPin?: string;
    replyInfo?: Record<string, unknown> | null;
    mention?: Array<unknown>;
    chain?: string;
}
export interface FetchPrivateHistoryInput {
    selfGlobalMetaId: string;
    peerGlobalMetaId: string;
    afterIndex?: number;
    limit: number;
}
export interface FetchPrivateHistoryPageInput {
    selfGlobalMetaId: string;
    peerGlobalMetaId: string;
    startIndex?: number;
    limit: number;
}
export interface PrivateChatHistoryPage {
    rows: unknown[];
    total: number | null;
    nextTimestamp: number | null;
}
export type FetchPrivateHistory = (input: FetchPrivateHistoryInput) => Promise<unknown[]>;
export interface PrivateConversationResponse {
    ok: true;
    selfGlobalMetaId: string;
    peerGlobalMetaId: string;
    messages: ChatViewerMessage[];
    nextPollAfterIndex: number;
    serverTime: number;
}
export declare function normalizeConversationLimit(value: unknown): number;
export declare function normalizeConversationAfterIndex(value: unknown): number | undefined;
export declare function fetchPrivateChatHistoryPage(input: FetchPrivateHistoryPageInput & {
    fetchImpl?: typeof fetch;
    idChatApiBaseUrl?: string;
}): Promise<PrivateChatHistoryPage>;
export declare function fetchPrivateChatHistory(input: FetchPrivateHistoryInput & {
    fetchImpl?: typeof fetch;
    idChatApiBaseUrl?: string;
}): Promise<unknown[]>;
