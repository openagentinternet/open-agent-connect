import type { IdentityProfileRecord } from '../identity/identityProfiles';
import { type MetabotHomepage } from './metabotHomepage';
import type { ChainWriteEncoding } from '../chain/writePin';
import type { LlmProvider, LlmRuntime } from '../llm/llmTypes';
import type { ChainWriteResult } from '../chain/writePin';
import type { Signer } from '../signing/signer';
import { type ProfilePublishPayloadInput } from './profilePublishState';
export { validateAvatarDataUrl } from '../identity/avatarChainWrite';
export interface MetabotProfileFull extends IdentityProfileRecord {
    bio: string;
    role: string;
    soul: string;
    goal: string;
    avatarDataUrl?: string;
    primaryProvider?: LlmProvider | null;
    fallbackProvider?: LlmProvider | null;
    allowChatSkills: string[];
    homepage?: MetabotHomepage;
}
export interface CreateMetabotInput {
    name: string;
    bio?: string;
    role?: string;
    soul?: string;
    goal?: string;
    avatarDataUrl?: string;
    primaryProvider?: LlmProvider | null;
    fallbackProvider?: LlmProvider | null;
    allowChatSkills?: string[];
}
export interface CreateMetabotFromIdentityInput extends CreateMetabotInput {
    homeDir: string;
    globalMetaId: string;
    mvcAddress: string;
    /** Roles whose provider came from system defaulting (not user request); binding writes for them accept any availability tier. */
    systemDefaultProviderRoles?: Array<'primary' | 'fallback'>;
}
export interface UpdateMetabotInfoInput {
    name?: string;
    bio?: string;
    role?: string;
    soul?: string;
    goal?: string;
    avatarDataUrl?: string;
    primaryProvider?: LlmProvider | null;
    fallbackProvider?: LlmProvider | null;
    allowChatSkills?: string[];
    homepage?: MetabotHomepage | null;
}
export interface SyncMetabotInfoToChainOptions {
    delayMs?: number;
    operation?: 'create' | 'modify';
    deferPublishStateWrite?: boolean;
}
export interface MetabotInfoPublishTarget extends ProfilePublishPayloadInput {
    encoding: ChainWriteEncoding;
    operation?: 'create' | 'modify' | 'revoke';
    skipIfUnpublished?: boolean;
}
export interface MetabotWalletInfo {
    slug: string;
    name: string;
    addresses: {
        btc: string;
        mvc: string;
        doge: string;
        opcat: string;
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
export declare function runtimeAvailabilityTier(runtime: LlmRuntime): number;
export declare function selectRuntimeForProvider(runtimes: LlmRuntime[], provider: LlmProvider): LlmRuntime;
export declare function selectBestRuntimeForProvider(runtimes: LlmRuntime[], provider: LlmProvider): LlmRuntime | null;
export declare function selectDefaultMetabotProviders(input: {
    runtimes: LlmRuntime[];
    preferredProvider?: LlmProvider | null;
    primaryProvider?: LlmProvider | null;
    fallbackProvider?: LlmProvider | null;
}): {
    primaryProvider?: LlmProvider | null;
    fallbackProvider?: LlmProvider | null;
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
export declare function buildMetabotInfoPublishTargets(profile: MetabotProfileFull, fields: Iterable<string>): MetabotInfoPublishTarget[];
export declare function recordMetabotInfoPublishResults(profile: MetabotProfileFull | {
    homeDir: string;
}, targets: MetabotInfoPublishTarget[], results: ChainWriteResult[]): Promise<void>;
export declare function syncMetabotInfoToChain(signer: Signer, profile: MetabotProfileFull, fieldsOrTargets: string[] | MetabotInfoPublishTarget[], options?: SyncMetabotInfoToChainOptions): Promise<ChainWriteResult[]>;
