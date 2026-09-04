type SponsorStage = 'address_info' | 'challenge' | 'pre' | 'commit';
export type SponsorReason = 'insufficient_quota' | 'insufficient_traffic' | 'service_unavailable' | 'commit_failed' | 'pre_rejected' | 'invalid_request';
export interface MvcSponsorV2ClientError extends Error {
    code: string;
    stage: SponsorStage;
    reason: SponsorReason;
    serviceMessage: string;
    status?: number;
    data?: unknown;
    retryable?: boolean;
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
/** trafficAccount block attached to a sponsor pre call (traffic-account billing). */
export interface MvcSponsorTrafficAccount {
    accountId: string;
    authSignature: string;
    timestamp: number;
}
export interface MvcSponsorOrder {
    orderId: string;
    status: string;
    txId?: string;
    txSize: number;
    minerFee: number;
    pending: boolean;
    final: boolean;
    failureReason?: string;
    raw: Record<string, unknown>;
}
export interface CreateMvcSponsorV2ClientInput {
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    requestTimeoutMs?: number;
    retryDelaysMs?: number[];
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
        /** Traffic-account billing pass-through (traffic mode); omitted on the legacy quota path. */
        trafficAccount?: MvcSponsorTrafficAccount;
    }): Promise<MvcSponsorPreResult>;
    getSponsorOrder(payload: {
        orderId: string;
    }): Promise<MvcSponsorOrder>;
    commitSponsor(payload: {
        orderId: string;
        signedTxHex: string;
        publicKey: string;
        signature: string;
    }): Promise<MvcSponsorCommitResult>;
};
export {};
