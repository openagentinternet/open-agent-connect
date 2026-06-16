import type { Signer } from '../signing/signer';
export declare function inferUploadContentType(filePath: string): string;
export interface UploadLocalFileToChainResult {
    pinId: string;
    txids: string[];
    totalCost: number;
    network: string;
    filePath: string;
    fileName: string;
    contentType: string;
    bytes: number;
    extension: string;
    metafileUri: string;
    globalMetaId: string;
}
export interface UploadFileBufferToChainResult extends UploadLocalFileToChainResult {
}
export declare function uploadFileBufferToChain(input: {
    fileName: string;
    data: Buffer;
    contentType?: string;
    network?: string;
    signer: Signer;
}): Promise<UploadFileBufferToChainResult>;
export declare function uploadLocalFileToChain(input: {
    filePath: string;
    contentType?: string;
    network?: string;
    signer: Signer;
}): Promise<UploadLocalFileToChainResult>;
