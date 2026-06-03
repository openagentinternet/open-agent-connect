import type { ChainWriteOperation, ChainWriteRequest } from '../chain/writePin';
export declare const AVATAR_CHAIN_PATH = "/info/avatar";
export declare const MAX_AVATAR_BYTES: number;
export declare function parseAvatarDataUrl(dataUrl: string): {
    mimeType: string;
    base64: string;
} | null;
export declare function validateAvatarDataUrl(dataUrl: string, maxBytes?: number): {
    valid: boolean;
    error?: string;
};
export declare function buildAvatarChainWriteRequest(input: {
    avatarDataUrl?: string;
    operation?: ChainWriteOperation;
    network?: string;
    version?: string;
}): ChainWriteRequest;
export declare function validateAvatarChainWriteRequest(input: {
    path: string;
    payload: string;
    contentType: string;
    encoding: string;
}): void;
