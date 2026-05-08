import type { LlmBindingStore } from '../llm/llmBindingStore';
import type { LlmRuntimeStore } from '../llm/llmRuntimeStore';
import { type PlatformSkillCatalogEntry, type PlatformSkillRootDiagnostic } from './platformSkillCatalog';
import type { LlmRuntime } from '../llm/llmTypes';
import type { PlatformDefinition } from '../platform/platformRegistry';
export type ServicePublishValidationFailureCode = 'invalid_provider_skill' | 'primary_runtime_missing' | 'primary_runtime_unavailable' | 'primary_runtime_provider_unsupported' | 'provider_skill_missing';
export interface ServicePublishProviderSkillValidationSuccess {
    ok: true;
    skill: PlatformSkillCatalogEntry;
    runtime: LlmRuntime;
    platform: Pick<PlatformDefinition, 'id' | 'displayName' | 'logoPath'>;
    rootDiagnostics: PlatformSkillRootDiagnostic[];
}
export interface ServicePublishProviderSkillValidationFailure {
    ok: false;
    code: ServicePublishValidationFailureCode;
    message: string;
    runtime?: LlmRuntime;
    platform?: Pick<PlatformDefinition, 'id' | 'displayName' | 'logoPath'>;
    rootDiagnostics: PlatformSkillRootDiagnostic[];
}
export type ServicePublishProviderSkillValidationResult = ServicePublishProviderSkillValidationSuccess | ServicePublishProviderSkillValidationFailure;
export interface ValidateServicePublishProviderSkillInput {
    metaBotSlug: string;
    providerSkill: string;
    runtimeStore: LlmRuntimeStore;
    bindingStore: LlmBindingStore;
    systemHomeDir: string;
    projectRoot: string;
    env?: NodeJS.ProcessEnv;
}
export declare function validateServicePublishProviderSkill(input: ValidateServicePublishProviderSkillInput): Promise<ServicePublishProviderSkillValidationResult>;
