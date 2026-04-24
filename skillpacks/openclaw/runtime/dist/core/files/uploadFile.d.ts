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
export declare function uploadLocalFileToChain(input: {
    filePath: string;
    contentType?: string;
    network?: string;
    signer: Signer;
}): Promise<UploadLocalFileToChainResult>;
