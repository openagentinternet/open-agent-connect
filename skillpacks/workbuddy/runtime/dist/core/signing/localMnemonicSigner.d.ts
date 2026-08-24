import type { ChainAdapter } from '../chain/adapters/types';
import type { ChainAdapterRegistry } from '../chain/adapters/types';
import type { SecretStore } from '../secrets/secretStore';
import type { Signer } from './signer';
/**
 * A broadcast-phase failure with UNKNOWN finality: the signed transactions
 * left the wallet but the node never confirmed acceptance (timeout, network
 * drop, ambiguous node error). Retrying blindly mints duplicates — the
 * transaction may already be on-chain. Handlers must surface this as
 * manual_action_required with the candidate txids, never as a plain failure.
 */
export declare class ChainBroadcastUnknownError extends Error {
    /** Candidate txids derived from the signed raw transactions (verify on-chain). */
    readonly candidateTxids: string[];
    /** Txids that DID broadcast successfully before the failure. */
    readonly confirmedTxids: string[];
    constructor(input: {
        candidateTxids: string[];
        confirmedTxids: string[];
        cause: unknown;
    });
}
/**
 * Create a local mnemonic signer backed by a ChainAdapterRegistry.
 *
 * The Signer delegates all chain-specific operations (inscription building, broadcasting)
 * to the appropriate ChainAdapter. No chain-dispatch logic (`if network === 'mvc'`, etc.)
 * lives in the Signer itself.
 */
export declare function createLocalMnemonicSigner(input: {
    secretStore: SecretStore;
    adapters?: ChainAdapterRegistry;
    /** Optional per-chain fee rates. If not provided, each adapter fetches its own. */
    feeRates?: Partial<Record<string, number>>;
}): Signer;
/**
 * Convenience helper: execute a transfer using an adapter's buildTransfer + broadcastTx.
 * Replaces the old `executeMvcTransfer` / `executeBtcTransfer` per-chain functions.
 */
export declare function executeTransfer(adapter: ChainAdapter, input: {
    mnemonic: string;
    path: string;
    toAddress: string;
    amountSatoshis: number;
    feeRate?: number;
}): Promise<{
    txid: string;
    fee: number;
}>;
