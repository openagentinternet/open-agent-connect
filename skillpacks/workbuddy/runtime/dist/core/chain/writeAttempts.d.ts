/**
 * Content-hash ledger for chain writes with unknown broadcast finality.
 * When a broadcast's outcome is unknown (timeout / network drop), the daemon
 * records the attempt keyed by a stable content hash. A retry of identical
 * content soon after returns the recorded candidates instead of blindly
 * re-broadcasting — the definitive fix for "error shown → user retries →
 * duplicate on-chain note".
 */
export interface ChainWriteAttemptRecord {
    contentHash: string;
    kind: string;
    candidateTxids: string[];
    at: number;
    message: string;
}
export declare function stableChainWriteHash(kind: string, parts: Array<string | undefined | null>): string;
export interface ChainWriteAttemptStore {
    /** A recent (<=24h) unknown-broadcast attempt for this hash, if any. */
    findRecent(contentHash: string, now?: number): Promise<ChainWriteAttemptRecord | null>;
    record(input: Omit<ChainWriteAttemptRecord, 'at'>): Promise<void>;
}
export declare function createChainWriteAttemptStore(systemHomeDir: string): ChainWriteAttemptStore;
