import type { LlmBindingStore } from '../llm/llmBindingStore';
import type { LlmRuntimeStore } from '../llm/llmRuntimeStore';
import {
  createPlatformSkillCatalog,
  isSafeProviderSkillName,
  type PlatformSkillCatalogEntry,
  type PlatformSkillRootDiagnostic,
} from './platformSkillCatalog';
import { normalizeProviderSkillList } from './skillServiceProtocol';
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
  skills: PlatformSkillCatalogEntry[];
  providerSkills: string[];
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

export interface ValidateServicePublishProviderSkillsInput {
  metaBotSlug: string;
  providerSkill?: string;
  providerSkills?: unknown;
  runtimeStore: LlmRuntimeStore;
  bindingStore: LlmBindingStore;
  systemHomeDir: string;
  projectRoot: string;
  env?: NodeJS.ProcessEnv;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeRawProviderSkillCandidates(input: ValidateServicePublishProviderSkillsInput): string[] {
  const source = Array.isArray(input.providerSkills) && input.providerSkills.length > 0
    ? input.providerSkills
    : input.providerSkills !== undefined && input.providerSkills !== null
      ? [input.providerSkills]
      : [input.providerSkill];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const candidate of source) {
    const skillName = normalizeText(candidate);
    if (!skillName || seen.has(skillName)) {
      continue;
    }
    seen.add(skillName);
    result.push(skillName);
  }

  return result;
}

export async function validateServicePublishProviderSkills(
  input: ValidateServicePublishProviderSkillsInput,
): Promise<ServicePublishProviderSkillValidationResult> {
  const rawProviderSkills = normalizeRawProviderSkillCandidates(input);
  const providerSkills = normalizeProviderSkillList(rawProviderSkills);
  if (
    rawProviderSkills.length === 0
    || providerSkills.length !== rawProviderSkills.length
    || rawProviderSkills.some((providerSkill) => !isSafeProviderSkillName(providerSkill))
  ) {
    return {
      ok: false,
      code: 'invalid_provider_skill',
      message: 'providerSkill must contain one or more safe skill directory names.',
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

  const skillsByName = new Map(catalogResult.skills.map((entry) => [entry.skillName, entry] as const));
  const missingSkills = providerSkills.filter((providerSkill) => !skillsByName.has(providerSkill));
  if (missingSkills.length > 0) {
    return {
      ok: false,
      code: 'provider_skill_missing',
      message: `providerSkill is not installed in the selected MetaBot primary runtime skill roots: ${missingSkills.join(', ')}`,
      runtime: catalogResult.runtime,
      platform: catalogResult.platform,
      rootDiagnostics: catalogResult.rootDiagnostics,
    };
  }

  const skills = providerSkills
    .map((providerSkill) => skillsByName.get(providerSkill))
    .filter((entry): entry is PlatformSkillCatalogEntry => Boolean(entry));

  return {
    ok: true,
    skill: skills[0],
    skills,
    providerSkills,
    runtime: catalogResult.runtime,
    platform: catalogResult.platform,
    rootDiagnostics: catalogResult.rootDiagnostics,
  };
}

export async function validateServicePublishProviderSkill(
  input: ValidateServicePublishProviderSkillInput,
): Promise<ServicePublishProviderSkillValidationResult> {
  return validateServicePublishProviderSkills({
    ...input,
    providerSkills: [input.providerSkill],
  });
}
