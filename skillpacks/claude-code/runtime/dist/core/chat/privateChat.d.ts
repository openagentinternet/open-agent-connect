export declare const PRIVATE_FILE_MSG_PATH = "/protocols/simplefilemsg";
export declare const PRIVATE_FILE_MAX_BYTES: number;
export interface PrivateFileChatAttachment {
    attachment: string;
    fileType: string;
    timestamp: number;
    replyPin: string | null;
}
/** Extracts the pin id and extension from a `metafile://<pinId>.<ext>` URI. */
export declare function parseMetafileAttachmentUri(value: string): {
    pinId: string;
    extension: string;
} | null;
/**
 * Parses an inbound simplefilemsg body (`{"to","encrypt","attachment",
 * "fileType","timestamp","replyPin"}`). Returns null for anything else so
 * callers can treat it as regular text chat.
 */
export declare function parsePrivateFileChatContent(content: string): PrivateFileChatAttachment | null;
/** Builds the simplefilemsg payload once the /file pin id is known. */
export declare function buildPrivateFileMsgPayload(input: {
    toGlobalMetaId: string;
    attachment: string;
    fileType: string;
    replyPinId?: string;
    timestamp?: number;
}): string;
/** Derives the display attachment URI from a /file write result. */
export declare function attachmentUriFromFileWrite(fileWrite: {
    pinId?: unknown;
    txids?: unknown;
}, fileType: string): string | null;
