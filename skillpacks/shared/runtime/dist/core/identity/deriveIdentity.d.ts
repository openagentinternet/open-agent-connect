export interface DerivedIdentity {
    mnemonic: string;
    path: string;
    publicKey: string;
    chatPublicKey: string;
    mvcAddress: string;
    btcAddress: string;
    dogeAddress: string;
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
export declare function deriveIdentity(options?: DeriveIdentityOptions): Promise<DerivedIdentity>;
