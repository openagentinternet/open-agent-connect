export interface PrivateChatIdentity {
    globalMetaId?: string | null;
    privateKeyHex?: string | Buffer | null;
}
export interface SendPrivateChatInput {
    fromIdentity: PrivateChatIdentity;
    toGlobalMetaId: string;
    peerChatPublicKey: string;
    content: string;
    replyPinId?: string | null;
    timestamp?: number;
    secretVariant?: 'sha256' | 'raw';
    sharedSecretOverride?: string | null;
}
export interface SendPrivateChatResult {
    path: '/protocols/simplemsg';
    encryption: '0';
    version: '1.0.0';
    contentType: 'application/json';
    payload: string;
    encryptedContent: string;
    sharedSecret: string;
    secretVariant: 'sha256' | 'raw';
}
export interface ReceivePrivateChatPayload {
    fromGlobalMetaId?: string | null;
    content?: string | null;
    rawData?: string | null;
    replyPinId?: string | null;
}
export interface ReceivePrivateChatInput {
    localIdentity: PrivateChatIdentity;
    peerChatPublicKey: string;
    payload: ReceivePrivateChatPayload;
}
export interface ReceivePrivateChatResult {
    fromGlobalMetaId: string;
    replyPinId: string;
    plaintext: string;
    plaintextJson: unknown | null;
    sharedSecret: string;
    secretVariant: 'sha256' | 'raw';
}
export declare function sendPrivateChat(input: SendPrivateChatInput): SendPrivateChatResult;
export declare function receivePrivateChat(input: ReceivePrivateChatInput): ReceivePrivateChatResult;
