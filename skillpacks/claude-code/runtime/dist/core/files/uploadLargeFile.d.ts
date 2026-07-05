import type { Signer } from '../signing/signer';
import { type MvcSponsorFeeAssistMetadata, type MvcSponsorV2DirectUploadClient } from './mvcSponsorDirectUpload';
export type { MvcSponsorDirectUploadResult, MvcSponsorFeeAssistMetadata, MvcSponsorFeeAssistMode, MvcSponsorFeeAssistReason, MvcSponsorFeeAssistStage, MvcSponsorV2DirectUploadClient, } from './mvcSponsorDirectUpload';
export declare const DIRECT_UPLOAD_MAX_BYTES: number;
export declare const FILE_UPLOAD_LARGE_DIRECT_MAX_BYTES: number;
export declare const MVC_SPONSOR_DIRECT_UPLOAD_MAX_BYTES: number;
export declare const LARGE_UPLOAD_MAX_BYTES: number;
export type UploadLargeFileMode = 'direct' | 'chunked';
export interface UploadLargeFileResult {
    pinId: string;
    txids: string[];
    totalCost: number;
    network: string;
    filePath?: string;
    fileName: string;
    contentType: string;
    bytes: number;
    extension: string;
    metafileUri: string;
    previewUrl: string;
    downloadUrl: string;
    globalMetaId: string;
    uploadMode: UploadLargeFileMode;
    feeAssist?: MvcSponsorFeeAssistMetadata;
    verification?: {
        ok: boolean;
        url: string | null;
        attempts: number;
        error?: string;
    };
}
export interface ProductionLargeFileUploader {
    upload(input: {
        filePath: string;
        fileName: string;
        contentType: string;
        bytes: number;
        extension: string;
        network: string;
        signer: Signer;
    }): Promise<Omit<UploadLargeFileResult, 'verification'>>;
}
export declare function uploadLargeFileToChain(input: {
    filePath: string;
    contentType?: string;
    network?: string;
    signer: Signer;
    largeUploader?: ProductionLargeFileUploader;
    verify?: boolean;
    verifyAvailability?: (pinId: string) => Promise<UploadLargeFileResult['verification']>;
    directMaxBytes?: number;
    sponsorDirectMaxBytes?: number;
    hardMaxBytes?: number;
    mvcSponsorClient?: MvcSponsorV2DirectUploadClient;
}): Promise<UploadLargeFileResult>;
