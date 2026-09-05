/**
 * Shared fee-assist (sponsor v2) metadata + error plumbing.
 * Extracted from src/core/files/mvcSponsorDirectUpload.ts so the sponsored
 * pin-write flow (mvcSponsorWritePin.ts) and the sponsored file-upload flow
 * attach the exact same diagnostics shape, matching IDBots'
 * mvcSponsorUpload.ts / mvcSponsorCreatePin.ts semantics.
 */
import type { MvcSponsorAddressInfo, MvcSponsorTrafficAccount } from './mvcSponsorV2Client';
export type MvcSponsorFeeAssistMode = 'mvc_sponsor_v2' | 'self_paid';
export type MvcSponsorFeeAssistReason = 'service_unavailable' | 'no_user_utxo' | 'insufficient_quota' | 'insufficient_traffic' | 'pre_rejected' | 'commit_failed';
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
    /** Billing channel of the committed order (traffic account or legacy quota). */
    billedBy?: 'traffic' | 'quota';
    /** Committed transaction size in bytes (as reported by the sponsor service). */
    txSize?: number;
}
/** One locally-initiated sponsored spend, journaled by the traffic service. */
export interface MvcSponsorTrafficSpendRecord {
    txId: string;
    botAddress: string;
    orderId?: string;
    txSize?: number;
    sponsoredMinerFee?: number;
    savedFee?: number;
    billedBy?: 'traffic' | 'quota';
    /** Pin protocol path or purpose tag (e.g. /protocols/simplemsg, /file). */
    kind?: string;
}
/**
 * Traffic-account billing seams shared by the sponsored write/upload flows.
 * resolveTrafficAccount never throws: it returns undefined to keep the legacy
 * quota path (traffic mode off, no account, unbound bot, backend 404).
 */
export interface MvcSponsorTrafficDeps {
    resolveTrafficAccount(input: {
        botAddress: string;
        challengeId: string;
        botMnemonic?: string;
        botWalletPath?: string;
    }): Promise<MvcSponsorTrafficAccount | undefined>;
    recordSpend(entry: MvcSponsorTrafficSpendRecord): Promise<void>;
}
export declare function normalizeSponsorReason(value: unknown, fallback: MvcSponsorFeeAssistReason): MvcSponsorFeeAssistReason;
export declare function getStableErrorCode(error: unknown, fallback: string): string;
export declare function getErrorMessage(error: unknown, fallback: string): string;
/** True when a draft build failed because the wallet has no usable UTXOs. */
export declare function isNoUserUtxoDraftError(error: unknown): boolean;
/**
 * Rethrow a sponsor-flow failure with feeAssist diagnostics attached on
 * error.data (same contract as the upload path). Never returns.
 */
export declare function attachFeeAssistError(input: {
    error: unknown;
    fallbackCode: string;
    fallbackReason: MvcSponsorFeeAssistReason;
    stage: MvcSponsorFeeAssistStage;
    orderId?: string;
    quotaBefore?: MvcSponsorAddressInfo;
    advisoryFeeEstimate?: number;
    sponsoredMinerFee?: number;
}): never;
