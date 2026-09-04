/**
 * Traffic account service client (account-quota billing, 「流量」).
 * Ported from IDBots src/main/services/trafficAccountService.ts onto OAC's
 * file-based stores: the machine-wide owner identity
 * (src/core/owner/ownerIdentity.ts) replaces IDBots' user_identity, the
 * identity-profile registry + per-profile secret stores replace the
 * MetaBot/wallet tables, and traffic.json + traffic-journal.jsonl under
 * ~/.metabot/owner/ (src/core/traffic/trafficStore.ts) replace the kvStore and
 * the SQLite traffic_spend_journal.
 *
 * Talks to the backend traffic APIs (/v1/traffic/*) with identity-signed
 * requests, manages the local account record and bot-address bindings, keeps
 * a ~30s in-memory balance cache (decremented locally on each sponsored
 * commit for instant UI feedback), and journals every locally-initiated
 * sponsored spend into the JSONL journal.
 *
 * Signature canonical strings follow the backend deployment doc
 * (assist-base-service docs/traffic-deployment.md §4) exactly:
 * - POST /v1/traffic/accounts:          "traffic-account:<accountId>:<ts>"
 * - POST /v1/traffic/accounts/bindings: "traffic-bind:<botAddress>:<accountId>:<ts>"
 *   (owner identity signs via X-Signature header, bot key signs via body botSignature)
 * - sponsor pre trafficAccount:         "traffic-pre:<accountId>:<challengeId>"
 * Headers: X-Identity-Address / X-Timestamp (unix seconds, ±300s) / X-Signature
 * (Bitcoin Signed Message compact, base64).
 *
 * Defensive by design: the accountId is always taken from the server response
 * and persisted locally (never assumed to equal the locally-computed
 * GlobalMetaID), and every failure in the sponsor-flow resolver degrades to
 * "no trafficAccount" so the legacy quota path keeps working while the
 * backend feature is off (404) or the bot is unbound.
 */
import type { MvcSponsorTrafficAccount } from '../subsidy/mvcSponsorV2Client';
import { type TrafficAccountRecord, type TrafficDailyUsageRow, type TrafficPinMode, type TrafficSettingsSnapshot, type TrafficSpendJournalEntry, type TrafficStore } from './trafficStore';
export declare const DEFAULT_TRAFFIC_API_BASE_URL = "https://www.metaso.network/assist-open-api";
/** clientApp reported to the free-grant claim endpoint (user decision: 'oac'). */
export declare const TRAFFIC_CLIENT_APP_ID = "oac";
export type TrafficApiStage = 'account' | 'bind' | 'balance' | 'ledger' | 'usage' | 'pricing' | 'recharge' | 'campaign' | 'redeem';
export declare class TrafficApiError extends Error {
    readonly code: string;
    readonly stage: TrafficApiStage;
    readonly status?: number;
    readonly serviceMessage: string;
    /** True when the backend returned 404 for /v1/traffic/* (feature disabled). */
    readonly featureUnavailable: boolean;
    /**
     * Backend error code delivered as data.errorCode (e.g. CAMPAIGN_DISABLED,
     * ALREADY_CLAIMED, CODE_USED), same envelope pattern as TRAFFIC_INSUFFICIENT
     * (backend-spec §12 errata 1). Empty when the backend sent none.
     */
    readonly errorCode: string;
    constructor(input: {
        stage: TrafficApiStage;
        message: string;
        status?: number;
        featureUnavailable?: boolean;
        errorCode?: string;
    });
}
export type { TrafficAccountRecord, TrafficDailyUsageRow, TrafficPinMode, TrafficSettingsSnapshot, TrafficSpendJournalEntry, } from './trafficStore';
export interface TrafficBindResultItem {
    botAddress: string;
    status: 'bound' | 'conflict' | 'failed';
    error?: string;
}
export interface TrafficBindSummary {
    accountId: string;
    results: TrafficBindResultItem[];
    boundCount: number;
    conflictCount: number;
    failedCount: number;
}
export interface TrafficLedgerEntry {
    id: number;
    direction: number;
    amountBytes: number;
    balanceAfter: number;
    sourceType: string;
    sourceId: string;
    remark: string;
    timestamp: number;
    /**
     * Local-journal enrichment, present only when this device committed the
     * sponsor order referenced by sourceId (cross-device spends and expired
     * reservations stay empty).
     */
    txId?: string;
    botAddress?: string;
    /** Pin protocol path or purpose tag recorded locally (e.g. /protocols/simplemsg, /file). */
    kind?: string;
}
export interface TrafficUsageSummary {
    todayBytes: number;
    weekBytes: number;
    monthBytes: number;
}
export interface TrafficPricingPlan {
    planId: string;
    chain: string;
    payCurrency: string;
    payAmount: number;
    trafficBytes: number;
    status: number;
    remark: string;
}
/** Recharge order status values delivered by the backend (int64 in JSON). */
export declare const TRAFFIC_RECHARGE_STATUS: {
    readonly CREATED: 1;
    readonly PAID: 2;
    readonly CREDITED: 3;
    readonly CLOSED: 4;
};
export interface TrafficRechargeOrder {
    orderId: string;
    payAmount: number;
    payCurrency: string;
    trafficBytes: number;
    gatewayParams: unknown;
}
export interface TrafficRechargeOrderStatus {
    orderId: string;
    status: number;
    paidAt?: number;
    creditedAt?: number;
}
export interface TrafficFreeGrantCampaignStatus {
    enabled: boolean;
    grantBytes: number;
    claimed: boolean;
    claimable: boolean;
}
export interface TrafficFreeGrantClaimResult {
    grantId: number;
    grantBytes: number;
    balanceAfter: number;
}
export interface TrafficRedeemCodeResult {
    codeId: number;
    trafficBytes: number;
    balanceAfter: number;
}
/** trafficAccount block attached to a sponsor pre call (see mvcSponsorV2Client). */
export type { MvcSponsorTrafficAccount } from '../subsidy/mvcSponsorV2Client';
/** Result of the journal-backed usage fallback used when the usage API fails. */
export interface TrafficDailyUsageResult {
    rows: TrafficDailyUsageRow[];
    source: 'remote' | 'local';
    /** Remote failure message when source is 'local'; empty otherwise. */
    error: string;
}
export interface TrafficAccountServiceDeps {
    /** Machine-wide home dir; owner identity + traffic state resolve under it. */
    systemHomeDir: string;
    fetchImpl?: typeof fetch;
    /** Overrides the stored traffic.apiBase setting (mainly tests). */
    baseUrl?: string;
    /** clientVersion reported to the free-grant claim endpoint; defaults to the OAC package version. */
    clientVersion?: string;
}
export interface TrafficAccountService {
    store: TrafficStore;
    ensureTrafficAccount(): Promise<TrafficAccountRecord>;
    getLocalTrafficAccount(): Promise<TrafficAccountRecord | null>;
    bindAllLocalBots(): Promise<TrafficBindSummary>;
    getTrafficBalance(options?: {
        forceRefresh?: boolean;
    }): Promise<TrafficAccountRecord>;
    getTrafficLedger(input?: {
        cursor?: number;
        limit?: number;
        direction?: number;
    }): Promise<{
        entries: TrafficLedgerEntry[];
        nextCursor: number;
    }>;
    getTrafficDailyUsage(input?: {
        from?: number;
        to?: number;
        botAddress?: string;
    }): Promise<TrafficDailyUsageRow[]>;
    getTrafficDailyUsageWithFallback(input?: {
        from?: number;
        to?: number;
        botAddress?: string;
    }): Promise<TrafficDailyUsageResult>;
    getTrafficUsageSummary(): Promise<TrafficUsageSummary>;
    getTrafficPricing(): Promise<TrafficPricingPlan[]>;
    createRechargeOrder(planId: string): Promise<TrafficRechargeOrder>;
    getRechargeOrder(orderId: string): Promise<TrafficRechargeOrderStatus>;
    mockConfirmRechargeOrder(orderId: string): Promise<TrafficRechargeOrderStatus>;
    getFreeGrantCampaignStatus(): Promise<TrafficFreeGrantCampaignStatus>;
    claimFreeGrant(): Promise<TrafficFreeGrantClaimResult>;
    redeemTrafficCode(code: string): Promise<TrafficRedeemCodeResult>;
    getTrafficPinMode(): Promise<TrafficPinMode>;
    getTrafficSettingsSnapshot(): Promise<TrafficSettingsSnapshot>;
    setTrafficSettingsSnapshot(input: {
        mode?: unknown;
        apiBase?: unknown;
    }): Promise<TrafficSettingsSnapshot>;
    getConfiguredTrafficApiBase(): Promise<string | undefined>;
    recordLocalTrafficSpend(entry: {
        txId: string;
        botAddress: string;
        orderId?: string;
        txSize?: number;
        sponsoredMinerFee?: number;
        savedFee?: number;
        billedBy?: 'traffic' | 'quota';
        kind?: string;
    }): Promise<void>;
    listLocalTrafficJournal(input?: {
        limit?: number;
        botAddress?: string;
    }): Promise<TrafficSpendJournalEntry[]>;
    resolveSponsorTrafficAccount(input: {
        botAddress: string;
        challengeId: string;
        botMnemonic?: string;
        botWalletPath?: string;
    }): Promise<MvcSponsorTrafficAccount | undefined>;
}
export declare function createTrafficAccountService(deps: TrafficAccountServiceDeps): TrafficAccountService;
