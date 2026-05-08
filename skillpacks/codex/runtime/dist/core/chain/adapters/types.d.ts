import type { ChainWriteNetwork, NormalizedChainWriteRequest } from '../writePin';
import type { DerivedIdentity } from '../../identity/deriveIdentity';
/**
 * A single unspent transaction output for a given address.
 */
export interface ChainUtxo {
    /** Transaction hash (little-endian hex). */
    txId: string;
    /** Output index within the transaction. */
    outputIndex: number;
    /** Value in satoshis. */
    satoshis: number;
    /** Address that controls this UTXO. */
    address: string;
    /** Block height (0 for unconfirmed). */
    height: number;
    /** Raw transaction hex — required for P2PKH signing on some chains (BTC, DOGE). */
    rawTx?: string;
}
/**
 * Balance summary for a chain address.
 */
export interface ChainBalance {
    /** Chain network identifier. */
    chain: ChainWriteNetwork;
    /** Address this balance applies to. */
    address: string;
    /** Total confirmed + unconfirmed satoshis. */
    totalSatoshis: number;
    /** Confirmed satoshis. */
    confirmedSatoshis: number;
    /** Unconfirmed (mempool) satoshis. */
    unconfirmedSatoshis: number;
    /** Number of UTXOs. */
    utxoCount: number;
}
/**
 * Input for building a signed transfer transaction.
 */
export interface ChainTransferInput {
    /** BIP39 mnemonic for signing. */
    mnemonic: string;
    /** BIP44 derivation path. */
    path: string;
    /** Recipient address. */
    toAddress: string;
    /** Amount to send in satoshis. */
    amountSatoshis: number;
    /** Optional fee rate. If not provided, the adapter fetches the current rate. */
    feeRate?: number;
}
/**
 * Result of building (but not broadcasting) a transfer transaction.
 */
export interface ChainTransferResult {
    /** Signed raw transaction hex, ready for broadcast. */
    rawTx: string;
    /** Estimated fee in satoshis. */
    fee: number;
}
/**
 * Input for building a signed MetaID inscription (writePin) transaction.
 */
export interface ChainInscriptionInput {
    /** Normalized chain write request with operation, path, payload, etc. */
    request: NormalizedChainWriteRequest;
    /** The derived identity (contains mnemonic, path, addresses). */
    identity: DerivedIdentity;
    /** Optional fee rate. If not provided, the adapter fetches the current rate. */
    feeRate?: number;
}
/**
 * Result of building (but not broadcasting) an inscription transaction.
 */
export interface ChainInscriptionResult {
    /**
     * Signed raw transaction hex strings, in broadcast order.
     * For commit-reveal chains (BTC, DOGE): [commitTx, revealTx].
     * For single-TX chains (MVC): [inscriptionTx].
     */
    signedRawTxs: string[];
    /**
     * Indices within `signedRawTxs` that correspond to the "reveal" (pin-bearing)
     * transactions. For pinId derivation the first reveal txid is used.
     * For MVC: [0].  For BTC/DOGE: [1].
     */
    revealIndices: number[];
    /** Total fee cost across all transactions in satoshis. */
    totalCost: number;
}
/**
 * The ChainAdapter interface declares the complete contract for a blockchain network.
 * Every supported UTXO chain implements this interface. Adding a new chain requires
 * only one adapter file + one registry entry — no changes to Signer, CLI, or commands.
 */
export interface ChainAdapter {
    /**
     * Unique network identifier matching ChainWriteNetwork values.
     * E.g. "mvc", "btc", "doge".
     */
    readonly network: ChainWriteNetwork;
    /**
     * Base URL for block explorer, e.g. "https://dogechain.info".
     * Used by CLI to construct transaction URLs in transfer output.
     */
    readonly explorerBaseUrl: string;
    /**
     * Fee rate unit for this chain.
     * - "sat/byte" for MVC and BTC.
     * - "sat/KB" for DOGE.
     * The adapter handles unit conversion internally so callers always
     * get a usable fee rate number for transaction building.
     */
    readonly feeRateUnit: 'sat/byte' | 'sat/KB';
    /**
     * Minimum transfer amount in satoshis (dust limit or chain minimum).
     */
    readonly minTransferSatoshis: number;
    /**
     * Derive the chain-specific address from a BIP39 mnemonic and derivation path.
     * Each adapter knows its own coin type and address format.
     */
    deriveAddress(mnemonic: string, path: string): Promise<string>;
    /**
     * Fetch UTXOs for an address. Returns confirmed UTXOs with txid, outputIndex, satoshis.
     * For P2PKH chains, each UTXO SHOULD include `rawTx` for signing.
     */
    fetchUtxos(address: string): Promise<ChainUtxo[]>;
    /**
     * Fetch balance summary for an address.
     */
    fetchBalance(address: string): Promise<ChainBalance>;
    /**
     * Fetch current recommended fee rate.
     * Unit is adapter-specific — see `feeRateUnit`.
     * For DOGE this returns sat/KB; for MVC/BTC this returns sat/byte.
     */
    fetchFeeRate(): Promise<number>;
    /**
     * Fetch the raw transaction hex for a given txid.
     */
    fetchRawTx(txid: string): Promise<string>;
    /**
     * Broadcast a raw transaction hex to the network.
     * Returns the txid as assigned by the network.
     */
    broadcastTx(rawTx: string): Promise<string>;
    /**
     * Build and sign a transfer transaction.
     * Returns the signed raw transaction hex — does NOT broadcast.
     * Caller chains `broadcastTx()` afterward.
     */
    buildTransfer(input: ChainTransferInput): Promise<ChainTransferResult>;
    /**
     * Build and sign a MetaID inscription (writePin) transaction.
     *
     * For chains using commit-reveal (BTC, DOGE), builds both commit and reveal
     * transactions. signedRawTxs will be [commitTx, revealTx] and revealIndices [1].
     *
     * For chains using single-TX (MVC), builds one transaction.
     * signedRawTxs will be [inscriptionTx] and revealIndices [0].
     *
     * Does NOT broadcast — call `broadcastTx()` on each raw transaction afterward.
     */
    buildInscription(input: ChainInscriptionInput): Promise<ChainInscriptionResult>;
}
/**
 * A registry mapping chain network identifiers to their ChainAdapter instances.
 */
export type ChainAdapterRegistry = Map<ChainWriteNetwork, ChainAdapter>;
