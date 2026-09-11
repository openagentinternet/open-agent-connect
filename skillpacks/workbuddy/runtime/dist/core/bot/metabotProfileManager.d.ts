import type { IdentityProfileRecord } from '../identity/identityProfiles';
import { type MetabotHomepage } from './metabotHomepage';
import type { ChainWriteEncoding } from '../chain/writePin';
import type { LlmProvider, LlmRuntime } from '../llm/llmTypes';
import type { ChainWriteResult } from '../chain/writePin';
import type { Signer } from '../signing/signer';
import { type ProfilePublishPayloadInput } from './profilePublishState';
import { type MetabotBotType } from './botRole';
/** Hard cap on local MetaBot profiles per machine (enforced by the daemon create route). */
export declare const MAX_LOCAL_BOT_PROFILES = 100;
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
    dshLlmProvider?: string | null;
    dshLlmModel?: string | null;
    dshLlmReasoningEffort?: string | null;
    dshLlmFallbackProvider?: string | null;
    dshLlmFallbackModel?: string | null;
    dshLlmFallbackReasoningEffort?: string | null;
    botType?: MetabotBotType | null;
    ownerGlobalMetaId?: string | null;
    isAvailable?: boolean;
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
    dshLlmProvider?: string | null;
    dshLlmModel?: string | null;
    dshLlmReasoningEffort?: string | null;
    dshLlmFallbackProvider?: string | null;
    dshLlmFallbackModel?: string | null;
    dshLlmFallbackReasoningEffort?: string | null;
    botType?: MetabotBotType | null;
    ownerGlobalMetaId?: string | null;
    isAvailable?: boolean;
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
    dshLlmProvider?: string | null;
    dshLlmModel?: string | null;
    dshLlmReasoningEffort?: string | null;
    dshLlmFallbackProvider?: string | null;
    dshLlmFallbackModel?: string | null;
    dshLlmFallbackReasoningEffort?: string | null;
    botType?: MetabotBotType | null;
    ownerGlobalMetaId?: string | null;
    isAvailable?: boolean;
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
/**
 * A Bot is available for picker lists and passive invocation (delegation,
 * group-task seats, host scheduler turns) when its Settings toggle is on AND
 * a DSH LLM pair is configured. Toggle-off or LLM-unset Bots are unavailable
 * and stay out of those surfaces. Daemon-side ticks that exist precisely to
 * serve bots without a DSH pair (headless scheduled tasks, nightly study)
 * gate on `isAvailable === false` only.
 */
export declare function isMetabotProfileAvailable(profile: Pick<MetabotProfileFull, 'isAvailable' | 'dshLlmProvider' | 'dshLlmModel'>): boolean;
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
