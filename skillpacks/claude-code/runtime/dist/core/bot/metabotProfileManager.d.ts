import type { IdentityProfileRecord } from '../identity/identityProfiles';
import type { LlmProvider } from '../llm/llmTypes';
import type { ChainWriteResult } from '../chain/writePin';
import type { Signer } from '../signing/signer';
export interface MetabotProfileFull extends IdentityProfileRecord {
    role: string;
    soul: string;
    goal: string;
    avatarDataUrl?: string;
    primaryProvider?: LlmProvider | null;
    fallbackProvider?: LlmProvider | null;
}
export interface CreateMetabotInput {
    name: string;
    role?: string;
    soul?: string;
    goal?: string;
    avatarDataUrl?: string;
    primaryProvider?: LlmProvider | null;
    fallbackProvider?: LlmProvider | null;
}
export interface CreateMetabotFromIdentityInput extends CreateMetabotInput {
    homeDir: string;
    globalMetaId: string;
    mvcAddress: string;
}
export interface UpdateMetabotInfoInput {
    name?: string;
    role?: string;
    soul?: string;
    goal?: string;
    avatarDataUrl?: string;
    primaryProvider?: LlmProvider | null;
    fallbackProvider?: LlmProvider | null;
}
export interface SyncMetabotInfoToChainOptions {
    delayMs?: number;
    operation?: 'create' | 'modify';
}
export interface MetabotWalletInfo {
    slug: string;
    name: string;
    addresses: {
        btc: string;
        mvc: string;
    };
}
export interface MetabotMnemonicBackup {
    slug: string;
    name: string;
    words: string[];
}
export interface DeleteMetabotProfileResult {
    profile: IdentityProfileRecord;
    removedExecutorSessions: string[];
}
export declare function readTextFile(filePath: string): Promise<string>;
export declare function validateAvatarDataUrl(dataUrl: string, maxBytes?: number): {
    valid: boolean;
    error?: string;
};
export declare function listMetabotProfiles(systemHomeDir: string): Promise<MetabotProfileFull[]>;
export declare function getMetabotProfile(systemHomeDir: string, slug: string): Promise<MetabotProfileFull | null>;
export declare function createMetabotProfile(systemHomeDir: string, input: CreateMetabotInput): Promise<MetabotProfileFull>;
export declare function buildMetabotProfileDraftFromIdentity(input: CreateMetabotFromIdentityInput): MetabotProfileFull;
export declare function createMetabotProfileFromIdentity(systemHomeDir: string, input: CreateMetabotFromIdentityInput): Promise<MetabotProfileFull>;
export declare function getMetabotWalletInfo(systemHomeDir: string, slug: string): Promise<MetabotWalletInfo>;
export declare function getMetabotMnemonicBackup(systemHomeDir: string, slug: string): Promise<MetabotMnemonicBackup>;
export declare function deleteMetabotProfile(systemHomeDir: string, slug: string): Promise<DeleteMetabotProfileResult>;
export declare function updateMetabotProfile(systemHomeDir: string, slug: string, input: UpdateMetabotInfoInput): Promise<MetabotProfileFull>;
export declare function syncMetabotInfoToChain(signer: Signer, profile: MetabotProfileFull, changedFields: string[], options?: SyncMetabotInfoToChainOptions): Promise<ChainWriteResult[]>;
