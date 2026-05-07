import type { LlmBindingStore } from '../llm/llmBindingStore';
import type { LlmRuntimeStore } from '../llm/llmRuntimeStore';
import {
  createPlatformSkillCatalog,
  isSafeProviderSkillName,
  type PlatformSkillCatalogEntry,
  type PlatformSkillRootDiagnostic,
} from './platformSkillCatalog';
import type { LlmRuntime } from '../llm/llmTypes';
import type { PlatformDefinition } from '../platform/platformRegistry';

export type ServicePublishValidationFailureCode =
  | 'invalid_provider_skill'
  | 'primary_runtime_missing'
  | 'primary_runtime_unavailable'
  | 'primary_runtime_provider_unsupported'
  | 'provider_skill_missing';

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

export type ServicePublishProviderSkillValidationResult =
  | ServicePublishProviderSkillValidationSuccess
  | ServicePublishProviderSkillValidationFailure;

export interface ValidateServicePublishProviderSkillInput {
  metaBotSlug: string;
  providerSkill: string;
  runtimeStore: LlmRuntimeStore;
  bindingStore: LlmBindingStore;
  systemHomeDir: string;
  projectRoot: string;
  env?: NodeJS.ProcessEnv;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function validateServicePublishProviderSkill(
  input: ValidateServicePublishProviderSkillInput,
): Promise<ServicePublishProviderSkillValidationResult> {
  const providerSkill = normalizeText(input.providerSkill);
  if (!isSafeProviderSkillName(providerSkill)) {
    return {
      ok: false,
      code: 'invalid_provider_skill',
      message: 'providerSkill must be a single safe skill directory name.',
      rootDiagnostics: [],
    };
  }

  const catalog = createPlatformSkillCatalog({
    runtimeStore: input.runtimeStore,
    bindingStore: input.bindingStore,
    systemHomeDir: input.systemHomeDir,
    projectRoot: input.projectRoot,
    env: input.env,
  });
  const catalogResult = await catalog.listPrimaryRuntimeSkills({
    metaBotSlug: input.metaBotSlug,
  });

  if (!catalogResult.ok) {
    return {
      ok: false,
      code: catalogResult.code,
      message: catalogResult.message,
      runtime: catalogResult.runtime,
      rootDiagnostics: catalogResult.rootDiagnostics,
    };
  }

  const skill = catalogResult.skills.find((entry) => entry.skillName === providerSkill);
  if (!skill) {
    return {
      ok: false,
      code: 'provider_skill_missing',
      message: `providerSkill is not installed in the selected MetaBot primary runtime skill roots: ${providerSkill}`,
      runtime: catalogResult.runtime,
      platform: catalogResult.platform,
      rootDiagnostics: catalogResult.rootDiagnostics,
    };
  }

  return {
    ok: true,
    skill,
    runtime: catalogResult.runtime,
    platform: catalogResult.platform,
    rootDiagnostics: catalogResult.rootDiagnostics,
  };
}
