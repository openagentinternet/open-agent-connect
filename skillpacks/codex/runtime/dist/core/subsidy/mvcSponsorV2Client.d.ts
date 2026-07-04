type SponsorStage = 'address_info' | 'challenge' | 'pre' | 'commit';
type SponsorReason = 'insufficient_quota' | 'service_unavailable' | 'commit_failed' | 'pre_rejected' | 'invalid_request';
export interface MvcSponsorV2ClientError extends Error {
    code: string;
    stage: SponsorStage;
    reason: SponsorReason;
    serviceMessage: string;
    status?: number;
    data?: unknown;
}
export interface MvcSponsorAddressInfo {
    exists: boolean;
    balance: number;
    grantedAmount: number;
    reservedAmount: number;
    spentAmount: number;
    availableAmount: number;
    status: string;
    raw: Record<string, unknown>;
}
export interface MvcSponsorChallenge {
    challengeId: string;
    message: string;
    expiresAt?: string;
    raw: Record<string, unknown>;
}
export interface MvcSponsorPreResult {
    preparedTxHex: string;
    orderId: string;
    minerFee: number;
    userInputIndexes: number[];
    expiresAt?: string;
    raw: Record<string, unknown>;
}
export interface MvcSponsorCommitResult {
    txId: string;
    txSize?: number;
    minerFee?: number;
    raw: Record<string, unknown>;
}
export interface CreateMvcSponsorV2ClientInput {
    baseUrl?: string;
    fetchImpl?: typeof fetch;
}
export declare function createMvcSponsorV2Client(input?: CreateMvcSponsorV2ClientInput): {
    baseUrl: string;
    getAddressInfo(payload: {
        address: string;
    }): Promise<MvcSponsorAddressInfo>;
    getChallenge(): Promise<MvcSponsorChallenge>;
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
    }): Promise<MvcSponsorCommitResult>;
};
export {};
