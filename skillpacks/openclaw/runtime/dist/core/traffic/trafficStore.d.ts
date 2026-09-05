export type TrafficPinMode = 'traffic' | 'selfpay';
export type TrafficFallbackPolicy = 'selfpay' | 'strict';
export interface TrafficAccountRecord {
    accountId: string;
    identityAddress: string;
    balanceBytes: number;
    reservedBytes: number;
    grantedBytesTotal: number;
    spentBytesTotal: number;
    status: number;
}
export interface TrafficAccountBinding {
    accountId: string;
    boundAt: number;
}
export interface TrafficFileState {
    version: 1;
    /** 'traffic' (account quota, default) | 'selfpay' (each MetaBot pays its own wallet). */
    mode: TrafficPinMode;
    /** Assist-service base URL override; '' = production default. */
    apiBase: string;
    account: TrafficAccountRecord | null;
    bindings: Record<string, TrafficAccountBinding>;
}
/** Settings snapshot, API-compatible with the IDBots trafficSettings module. */
export interface TrafficSettingsSnapshot {
    mode: TrafficPinMode;
    /** Stored 'strict' is ignored; account-quota mode always falls back to self-pay. */
    fallbackPolicy: TrafficFallbackPolicy;
    /** Configured assist-service base URL override; '' = production default. */
    apiBase: string;
}
export interface TrafficSpendJournalEntry {
    /** 1-based line number inside traffic-journal.jsonl (IDBots rowid analog). */
    id: number;
    txId: string;
    botAddress: string;
    orderId: string;
    txSize: number;
    sponsoredMinerFee: number;
    savedFee: number;
    /** 'traffic' = billed to the traffic account; 'quota' = legacy sponsor quota. */
    billedBy: 'traffic' | 'quota';
    /** Pin protocol path or purpose tag (e.g. /protocols/simplemsg, /file); '' when unknown. */
    kind: string;
    createdAt: number;
}
/** Row shape accepted by appendJournal (id + createdAt are assigned here). */
export type TrafficSpendJournalInput = Omit<TrafficSpendJournalEntry, 'id' | 'createdAt'> & {
    createdAt?: number;
};
export interface TrafficDailyUsageRow {
    date: string;
    botAddress: string;
    bytes: number;
    txCount: number;
}
export interface TrafficStorePaths {
    ownerRoot: string;
    trafficPath: string;
    journalPath: string;
}
export interface TrafficStore {
    paths: TrafficStorePaths;
    /** Full state; defaults when the file does not exist. Throws on malformed JSON. */
    read(): Promise<TrafficFileState>;
    write(state: TrafficFileState): Promise<void>;
    readSettings(): Promise<TrafficSettingsSnapshot>;
    /** Partial settings update; invalid apiBase values throw and are never persisted. */
    writeSettings(input: {
        mode?: unknown;
        apiBase?: unknown;
    }): Promise<TrafficSettingsSnapshot>;
    readAccount(): Promise<TrafficAccountRecord | null>;
    writeAccount(account: TrafficAccountRecord): Promise<void>;
    readBindings(): Promise<Record<string, TrafficAccountBinding>>;
    writeBinding(botAddress: string, accountId: string): Promise<void>;
    /** Append one journal row. Returns the stored row (without id), or null when txId/botAddress are empty. */
    appendJournal(entry: Partial<TrafficSpendJournalInput> & {
        txId?: unknown;
        botAddress?: unknown;
    }): Promise<Omit<TrafficSpendJournalEntry, 'id'> | null>;
    /** All rows, oldest first (id ASC). Malformed lines are skipped (torn tail on crash). */
    readJournal(): Promise<TrafficSpendJournalEntry[]>;
    /** Newest first (id DESC), optionally filtered by bot address and capped by limit. */
    listJournal(input?: {
        limit?: number;
        botAddress?: string;
    }): Promise<TrafficSpendJournalEntry[]>;
    /** Latest row per sponsor orderId (for ledger enrichment). */
    latestJournalByOrderId(input?: {
        limit?: number;
    }): Promise<Map<string, TrafficSpendJournalEntry>>;
    /** Local usage fallback: journal rows bucketed by UTC day + bot address. */
    aggregateDailyUsage(input?: {
        botAddress?: string;
        limit?: number;
    }): Promise<TrafficDailyUsageRow[]>;
}
export declare function resolveTrafficStorePaths(systemHomeDir: string): TrafficStorePaths;
export declare function normalizeTrafficPinMode(value: unknown): TrafficPinMode;
/** Stored 'strict' is ignored; account-quota mode always falls back to self-pay. */
export declare function normalizeTrafficFallbackPolicy(_value?: unknown): TrafficFallbackPolicy;
/**
 * Normalize an apiBase override for persistence: trims, strips trailing
 * slashes, '' clears the override. Throws on anything that is not an
 * http(s) URL (callers surface the error and must not persist).
 */
export declare function normalizeTrafficApiBase(value: unknown): string;
export declare function createDefaultTrafficFileState(): TrafficFileState;
export declare function createTrafficStore(systemHomeDir: string): TrafficStore;
