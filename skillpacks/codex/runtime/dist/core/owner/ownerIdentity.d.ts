export declare const DEFAULT_OWNER_NAME = "User";
export interface OwnerIdentityRecord {
    version: 1;
    name: string;
    mnemonic: string;
    path: string;
    publicKey: string;
    chatPublicKey: string;
    mvcAddress: string;
    metaId: string;
    globalMetaId: string;
    createdAt: string;
    updatedAt: string;
}
/** Everything except the mnemonic; safe to surface in UI / CLI output. */
export type OwnerIdentityPublic = Omit<OwnerIdentityRecord, 'mnemonic'>;
export declare class OwnerIdentityError extends Error {
    readonly code: 'owner_exists' | 'owner_missing' | 'invalid_mnemonic' | 'invalid_name';
    constructor(code: 'owner_exists' | 'owner_missing' | 'invalid_mnemonic' | 'invalid_name', message: string);
}
export declare function resolveOwnerIdfilePath(systemHomeDir: string): string;
export declare function toOwnerIdentityPublic(record: OwnerIdentityRecord): OwnerIdentityPublic;
export declare function readOwnerIdentity(systemHomeDir: string): Promise<OwnerIdentityRecord | null>;
/** Create a brand-new owner identity (fresh mnemonic). Fails if one exists. */
export declare function createOwnerIdentity(systemHomeDir: string, input: {
    name: string;
}): Promise<OwnerIdentityRecord>;
/** Import an owner identity from an existing mnemonic. Fails if one exists. */
export declare function importOwnerIdentity(systemHomeDir: string, input: {
    name: string;
    mnemonic: string;
    path?: string;
}): Promise<OwnerIdentityRecord>;
/** Return the existing identity, creating one with a default name when absent. */
export declare function ensureOwnerIdentity(systemHomeDir: string, input?: {
    name?: string;
}): Promise<OwnerIdentityRecord>;
/** Rename the existing owner identity. */
export declare function renameOwnerIdentity(systemHomeDir: string, name: string): Promise<OwnerIdentityRecord>;
/** Reveal the stored mnemonic (for the backup view). */
export declare function revealOwnerMnemonic(systemHomeDir: string): Promise<string>;
/** Delete the owner identity (logout). */
export declare function deleteOwnerIdentity(systemHomeDir: string): Promise<void>;
