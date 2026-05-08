import { type PlatformDefinition, type PlatformId, type PlatformSkillRoot } from '../platform/platformRegistry';
import type { LlmBinding } from '../llm/llmTypes';
import type { LlmBindingStore } from '../llm/llmBindingStore';
import type { LlmRuntimeStore } from '../llm/llmRuntimeStore';
import type { LlmRuntime } from '../llm/llmTypes';
export type PlatformSkillRootStatus = 'readable' | 'missing' | 'unreadable';
export interface PlatformSkillRootDiagnostic {
    rootId: string;
    kind: PlatformSkillRoot['kind'];
    absolutePath: string;
    status: PlatformSkillRootStatus;
    message?: string;
}
export interface PlatformSkillCatalogEntry {
    skillName: string;
    title?: string;
    description?: string;
    platformId: PlatformId;
    platformDisplayName: string;
    rootId: string;
    rootKind: PlatformSkillRoot['kind'];
    absolutePath: string;
    skillDocumentPath: string;
}
export interface PrimaryRuntimeSkillCatalogSuccess {
    ok: true;
    metaBotSlug: string;
    runtime: LlmRuntime;
    binding: LlmBinding;
    platform: Pick<PlatformDefinition, 'id' | 'displayName' | 'logoPath'>;
    skills: PlatformSkillCatalogEntry[];
    rootDiagnostics: PlatformSkillRootDiagnostic[];
}
export interface PrimaryRuntimeSkillCatalogFailure {
    ok: false;
    code: 'primary_runtime_missing' | 'primary_runtime_unavailable' | 'primary_runtime_provider_unsupported';
    message: string;
    metaBotSlug: string;
    runtime?: LlmRuntime;
    binding?: LlmBinding;
    rootDiagnostics: PlatformSkillRootDiagnostic[];
}
export type PrimaryRuntimeSkillCatalogResult = PrimaryRuntimeSkillCatalogSuccess | PrimaryRuntimeSkillCatalogFailure;
export interface PlatformSkillCatalog {
    listPrimaryRuntimeSkills(input: {
        metaBotSlug: string;
    }): Promise<PrimaryRuntimeSkillCatalogResult>;
}
export interface CreatePlatformSkillCatalogOptions {
    runtimeStore: LlmRuntimeStore;
    bindingStore: LlmBindingStore;
    systemHomeDir: string;
    projectRoot: string;
    env?: NodeJS.ProcessEnv;
}
export declare function isSafeProviderSkillName(value: unknown): boolean;
export declare function createPlatformSkillCatalog(options: CreatePlatformSkillCatalogOptions): PlatformSkillCatalog;
