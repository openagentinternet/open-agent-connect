import '../compat/nodeLocalStorage';
export interface DerivedIdentity {
    mnemonic: string;
    path: string;
    publicKey: string;
    chatPublicKey: string;
    /** Chain addresses keyed by ChainWriteNetwork. Always includes "mvc" at minimum. */
    addresses: Record<string, string>;
    /** Convenience field: same as addresses['mvc']. Preserved for backward compatibility. */
    mvcAddress: string;
    metaId: string;
    globalMetaId: string;
}
export interface DeriveIdentityOptions {
    mnemonic?: string;
    path?: string;
}
export declare const DEFAULT_DERIVATION_PATH = "m/44'/10001'/0'/0/0";
export declare function parseAddressIndexFromPath(path: string): number;
export declare function normalizeGlobalMetaId(value: unknown): string | null;
export declare function validateGlobalMetaId(value: string): boolean;
export declare function derivePrivateKeyHex(options?: DeriveIdentityOptions): Promise<string>;
export declare function convertToGlobalMetaId(address: string): string;
/**
 * Decode a GlobalMetaId back into its version and payload (pubkey hash /
 * script hash / witness program). Inverse of encodeIdAddress; returns null
 * for malformed input or checksum mismatch. Ported from the IDBots
 * globalMetaid service for offline owner-binding verification.
 */
export declare function decodeGlobalMetaIdPayload(globalMetaId: string): {
    version: number;
    payload: Uint8Array;
} | null;
export declare function deriveIdentity(options?: DeriveIdentityOptions): Promise<DerivedIdentity>;
