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
    /** Avatar as an image data URL (PNG/JPEG/WebP/GIF, ≤200KB); absent when unset. */
    avatarDataUrl?: string;
    createdAt: string;
    updatedAt: string;
}
/** Everything except the mnemonic; safe to surface in UI / CLI output. */
export type OwnerIdentityPublic = Omit<OwnerIdentityRecord, 'mnemonic'>;
export declare class OwnerIdentityError extends Error {
    readonly code: 'owner_exists' | 'owner_missing' | 'invalid_mnemonic' | 'invalid_name' | 'invalid_avatar';
    constructor(code: 'owner_exists' | 'owner_missing' | 'invalid_mnemonic' | 'invalid_name' | 'invalid_avatar', message: string);
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
/**
 * Update the owner profile fields (name and/or avatar). An empty avatar data
 * URL clears the stored avatar. Callers that publish on-chain write the chain
 * FIRST and call this only after the publish succeeded (chain-first ordering,
 * same as the Bot profile update handler).
 */
export declare function updateOwnerIdentityProfile(systemHomeDir: string, input: {
    name?: string;
    avatarDataUrl?: string;
}): Promise<OwnerIdentityRecord>;
/** Reveal the stored mnemonic (for the backup view). */
export declare function revealOwnerMnemonic(systemHomeDir: string): Promise<string>;
/** Delete the owner identity (logout). */
export declare function deleteOwnerIdentity(systemHomeDir: string): Promise<void>;
