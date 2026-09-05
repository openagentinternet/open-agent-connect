import type { Signer } from '../signing/signer';
import type { MvcSponsorAddressInfo, MvcSponsorCommitResult, MvcSponsorPreResult, MvcSponsorTrafficAccount } from '../subsidy/mvcSponsorV2Client';
import { type MvcSponsorFeeAssistMetadata, type MvcSponsorTrafficDeps } from '../subsidy/feeAssist';
import { type UploadLocalFileToChainResult } from './uploadFile';
export type { MvcSponsorFeeAssistMode, MvcSponsorFeeAssistReason, MvcSponsorFeeAssistStage, MvcSponsorFeeAssistMetadata, MvcSponsorTrafficDeps, MvcSponsorTrafficSpendRecord, } from '../subsidy/feeAssist';
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
        trafficAccount?: MvcSponsorTrafficAccount;
    }): Promise<MvcSponsorPreResult>;
    commitSponsor(payload: {
        orderId: string;
        signedTxHex: string;
        publicKey: string;
        signature: string;
        message?: string;
    }): Promise<MvcSponsorCommitResult>;
    /**
     * Traffic-account billing (流量), attached by the daemon wiring only when
     * traffic mode is on. Absent = today's legacy quota flow, untouched.
     */
    traffic?: MvcSponsorTrafficDeps;
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
