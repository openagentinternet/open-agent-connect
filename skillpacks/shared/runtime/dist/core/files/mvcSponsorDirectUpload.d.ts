import type { Signer } from '../signing/signer';
import type { MvcSponsorAddressInfo, MvcSponsorCommitResult, MvcSponsorPreResult } from '../subsidy/mvcSponsorV2Client';
import { type UploadLocalFileToChainResult } from './uploadFile';
export type MvcSponsorFeeAssistMode = 'mvc_sponsor_v2' | 'self_paid';
export type MvcSponsorFeeAssistReason = 'service_unavailable' | 'no_user_utxo' | 'insufficient_quota' | 'pre_rejected' | 'commit_failed';
export type MvcSponsorFeeAssistStage = 'address_info' | 'challenge' | 'pre' | 'commit' | 'done';
export interface MvcSponsorFeeAssistMetadata {
    attempted: boolean;
    used: boolean;
    mode: MvcSponsorFeeAssistMode;
    sponsor: 'mvc_sponsor_v2';
    reason?: MvcSponsorFeeAssistReason;
    stage?: MvcSponsorFeeAssistStage;
    orderId?: string;
    quotaBefore?: MvcSponsorAddressInfo;
    quotaAfter?: MvcSponsorAddressInfo;
    advisoryFeeEstimate?: number;
    sponsoredMinerFee?: number;
    savedFee?: number;
}
export interface MvcSponsorV2DirectUploadClient {
    getAddressInfo(payload: {
        address: string;
    }): Promise<MvcSponsorAddressInfo>;
    getChallenge(): Promise<{
        challengeId: string;
        message: string;
        expiresAt?: string;
        raw: Record<string, unknown>;
    }>;
    preSponsor(payload: {
        address: string;
        txHex: string;
        challengeId: string;
        publicKey: string;
        signature: string;
    }): Promise<MvcSponsorPreResult>;
    commitSponsor(payload: {
        orderId: string;
        signedTxHex: string;
        publicKey: string;
        signature: string;
        message?: string;
    }): Promise<MvcSponsorCommitResult>;
}
export type MvcSponsorDirectUploadResult = UploadLocalFileToChainResult & {
    feeAssist: MvcSponsorFeeAssistMetadata;
};
export declare function uploadMvcSponsorDirectFile(input: {
    filePath: string;
    fileName: string;
    contentType: string;
    bytes: number;
    extension: string;
    network: string;
    signer: Signer;
    mvcSponsorClient: MvcSponsorV2DirectUploadClient;
}): Promise<MvcSponsorDirectUploadResult>;
