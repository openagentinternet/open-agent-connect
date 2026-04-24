import type { Signer } from '../signing/signer';
import { type UploadLocalFileToChainResult } from '../files/uploadFile';
export interface PostBuzzToChainResult {
    pinId: string;
    txids: string[];
    totalCost: number;
    network: string;
    content: string;
    contentType: string;
    attachments: string[];
    uploadedFiles: UploadLocalFileToChainResult[];
    globalMetaId: string;
}
export declare function postBuzzToChain(input: {
    content: string;
    contentType?: string;
    attachments?: string[];
    quotePin?: string;
    network?: string;
    signer: Signer;
}): Promise<PostBuzzToChainResult>;
