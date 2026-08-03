import type { LlmBindingStore } from '../llm/llmBindingStore';
import type { LlmRuntimeStore } from '../llm/llmRuntimeStore';
import type { LlmRuntime } from '../llm/llmTypes';
import type { PlatformDefinition } from '../platform/platformRegistry';
import { type PlatformSkillCatalogEntry, type PlatformSkillRootDiagnostic } from './platformSkillCatalog';
export type ChatSkillPolicyFailureCode = 'invalid_allow_chat_skills' | 'primary_runtime_missing' | 'primary_runtime_unavailable' | 'primary_runtime_provider_unsupported' | 'chat_skill_missing';
export interface ChatSkillPolicyInput {
    metaBotSlug: string;
    allowChatSkills: unknown;
    runtimeStore: LlmRuntimeStore;
    bindingStore: LlmBindingStore;
    systemHomeDir: string;
    projectRoot: string;
    env?: NodeJS.ProcessEnv;
}
export interface ChatSkillPolicySuccess {
    ok: true;
    allowChatSkills: string[];
    skills: PlatformSkillCatalogEntry[];
    skillSourcePaths: Record<string, string>;
    skippedSkills: string[];
    warning?: string;
    runtime?: LlmRuntime;
    platform?: Pick<PlatformDefinition, 'id' | 'displayName' | 'logoPath'>;
    rootDiagnostics: PlatformSkillRootDiagnostic[];
}
export interface ChatSkillPolicyValidationFailure {
    ok: false;
    code: ChatSkillPolicyFailureCode;
    message: string;
    allowChatSkills?: string[];
    missingSkills?: string[];
    runtime?: LlmRuntime;
    platform?: Pick<PlatformDefinition, 'id' | 'displayName' | 'logoPath'>;
    rootDiagnostics: PlatformSkillRootDiagnostic[];
}
export type ChatSkillPolicyValidationResult = ChatSkillPolicySuccess | ChatSkillPolicyValidationFailure;
export declare function normalizeAllowChatSkills(value: unknown): string[];
export declare function validateAllowChatSkills(input: ChatSkillPolicyInput): Promise<ChatSkillPolicyValidationResult>;
export declare function resolveAllowChatSkillsForRuntime(input: ChatSkillPolicyInput): Promise<ChatSkillPolicySuccess>;
export interface ChatSkillResolutionRecord {
    resolved: string[];
    skipped: string[];
    warning: string | null;
    checkedAt: string;
}
export declare function writeChatSkillResolution(filePath: string, record: ChatSkillResolutionRecord): Promise<void>;
export declare function readChatSkillResolution(filePath: string): Promise<ChatSkillResolutionRecord | null>;
