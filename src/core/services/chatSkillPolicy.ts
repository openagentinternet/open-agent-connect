import type { LlmBindingStore } from '../llm/llmBindingStore';
import type { LlmRuntimeStore } from '../llm/llmRuntimeStore';
import type { LlmRuntime } from '../llm/llmTypes';
import type { PlatformDefinition } from '../platform/platformRegistry';
import {
  createPlatformSkillCatalog,
  isSafeProviderSkillName,
  type PlatformSkillCatalogEntry,
  type PlatformSkillRootDiagnostic,
} from './platformSkillCatalog';

export type ChatSkillPolicyFailureCode =
  | 'invalid_allow_chat_skills'
  | 'primary_runtime_missing'
  | 'primary_runtime_unavailable'
  | 'primary_runtime_provider_unsupported'
  | 'chat_skill_missing';

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

export type ChatSkillPolicyValidationResult =
  | ChatSkillPolicySuccess
  | ChatSkillPolicyValidationFailure;

function normalizeText(value: string): string {
  return value.trim();
}

export function normalizeAllowChatSkills(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new TypeError('allowChatSkills must be an array.');
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      throw new TypeError('allowChatSkills entries must be strings.');
    }
    const skillName = normalizeText(entry);
    if (!skillName) {
      continue;
    }
    if (!isSafeProviderSkillName(skillName)) {
      throw new TypeError('allowChatSkills entries must be safe skill directory names.');
    }
    if (!seen.has(skillName)) {
      seen.add(skillName);
      result.push(skillName);
    }
  }
  return result;
}

function createEmptySuccess(overrides: Partial<ChatSkillPolicySuccess> = {}): ChatSkillPolicySuccess {
  return {
    ok: true,
    allowChatSkills: [],
    skills: [],
    skillSourcePaths: {},
    skippedSkills: [],
    rootDiagnostics: [],
    ...overrides,
  };
}

function mapResolvedSkills(input: {
  allowChatSkills: string[];
  catalogSkills: PlatformSkillCatalogEntry[];
}): {
  allowChatSkills: string[];
  skills: PlatformSkillCatalogEntry[];
  skippedSkills: string[];
  skillSourcePaths: Record<string, string>;
} {
  const skillsByName = new Map(input.catalogSkills.map((entry) => [entry.skillName, entry] as const));
  const skills: PlatformSkillCatalogEntry[] = [];
  const skippedSkills: string[] = [];

  for (const skillName of input.allowChatSkills) {
    const skill = skillsByName.get(skillName);
    if (skill) {
      skills.push(skill);
    } else {
      skippedSkills.push(skillName);
    }
  }

  return {
    allowChatSkills: skills.map((skill) => skill.skillName),
    skills,
    skippedSkills,
    skillSourcePaths: Object.fromEntries(skills.map((skill) => [skill.skillName, skill.absolutePath])),
  };
}

export async function validateAllowChatSkills(
  input: ChatSkillPolicyInput,
): Promise<ChatSkillPolicyValidationResult> {
  let allowChatSkills: string[];
  try {
    allowChatSkills = normalizeAllowChatSkills(input.allowChatSkills);
  } catch (error) {
    return {
      ok: false,
      code: 'invalid_allow_chat_skills',
      message: error instanceof Error ? error.message : 'allowChatSkills is invalid.',
      rootDiagnostics: [],
    };
  }

  if (allowChatSkills.length === 0) {
    return createEmptySuccess();
  }

  const catalog = createPlatformSkillCatalog({
    runtimeStore: input.runtimeStore,
    bindingStore: input.bindingStore,
    systemHomeDir: input.systemHomeDir,
    projectRoot: input.projectRoot,
    env: input.env,
  });
  const catalogResult = await catalog.listPrimaryRuntimeSkills({ metaBotSlug: input.metaBotSlug });

  if (!catalogResult.ok) {
    return {
      ok: false,
      code: catalogResult.code,
      message: catalogResult.message,
      allowChatSkills,
      runtime: catalogResult.runtime,
      rootDiagnostics: catalogResult.rootDiagnostics,
    };
  }

  const resolved = mapResolvedSkills({
    allowChatSkills,
    catalogSkills: catalogResult.skills,
  });
  if (resolved.skippedSkills.length > 0) {
    return {
      ok: false,
      code: 'chat_skill_missing',
      message: `allowChatSkills contains skills that are not installed in the selected MetaBot primary runtime skill roots: ${resolved.skippedSkills.join(', ')}`,
      allowChatSkills,
      missingSkills: resolved.skippedSkills,
      runtime: catalogResult.runtime,
      platform: catalogResult.platform,
      rootDiagnostics: catalogResult.rootDiagnostics,
    };
  }

  return createEmptySuccess({
    ...resolved,
    skippedSkills: [],
    runtime: catalogResult.runtime,
    platform: catalogResult.platform,
    rootDiagnostics: catalogResult.rootDiagnostics,
  });
}

export async function resolveAllowChatSkillsForRuntime(
  input: ChatSkillPolicyInput,
): Promise<ChatSkillPolicySuccess> {
  let allowChatSkills: string[];
  try {
    allowChatSkills = normalizeAllowChatSkills(input.allowChatSkills);
  } catch (error) {
    return createEmptySuccess({
      warning: error instanceof Error
        ? `Ignoring invalid allowChatSkills: ${error.message}`
        : 'Ignoring invalid allowChatSkills.',
    });
  }

  if (allowChatSkills.length === 0) {
    return createEmptySuccess();
  }

  const catalog = createPlatformSkillCatalog({
    runtimeStore: input.runtimeStore,
    bindingStore: input.bindingStore,
    systemHomeDir: input.systemHomeDir,
    projectRoot: input.projectRoot,
    env: input.env,
  });
  const catalogResult = await catalog.listPrimaryRuntimeSkills({ metaBotSlug: input.metaBotSlug });

  if (!catalogResult.ok) {
    return createEmptySuccess({
      skippedSkills: allowChatSkills,
      warning: `Primary runtime skill catalog could not be resolved: ${catalogResult.message}`,
      rootDiagnostics: catalogResult.rootDiagnostics,
      runtime: catalogResult.runtime,
    });
  }

  const resolved = mapResolvedSkills({
    allowChatSkills,
    catalogSkills: catalogResult.skills,
  });
  return createEmptySuccess({
    ...resolved,
    runtime: catalogResult.runtime,
    platform: catalogResult.platform,
    rootDiagnostics: catalogResult.rootDiagnostics,
    ...(resolved.skippedSkills.length > 0
      ? { warning: `Skipping unavailable chat skills: ${resolved.skippedSkills.join(', ')}` }
      : {}),
  });
}
