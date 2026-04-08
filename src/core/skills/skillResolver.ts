import { getBaseSkillContract } from './baseSkillRegistry';
import type {
  RenderResolvedSkillContractInput,
  RenderedSkillContract,
  ResolvedSkillContract,
  ResolveSkillContractInput,
  SkillHost,
  SkillPermissionScope,
  SkillVariantArtifact,
  SkillVariantScopeMetadata,
} from './skillContractTypes';

const DEFAULT_SCOPE_METADATA: SkillVariantScopeMetadata = {
  sameSkill: true,
  sameScope: true,
  scopeHash: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isValidSkillPermissionScope(value: unknown): value is SkillPermissionScope {
  if (!isRecord(value)) {
    return false;
  }
  return isStringArray(value.allowedCommands)
    && isBoolean(value.chainRead)
    && isBoolean(value.chainWrite)
    && isBoolean(value.localUiOpen)
    && isBoolean(value.remoteDelegation);
}

function isValidScopeMetadata(value: unknown): value is SkillVariantScopeMetadata {
  if (!isRecord(value)) {
    return false;
  }
  const scopeHash = value.scopeHash;
  return isBoolean(value.sameSkill)
    && isBoolean(value.sameScope)
    && (typeof scopeHash === 'string' || scopeHash === null);
}

function isValidPatch(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const optionalFields = [
    value.instructionsPatch,
    value.commandTemplatePatch,
    value.outputExpectationPatch,
    value.fallbackPolicyPatch,
  ];
  return optionalFields.every((field) => field === undefined || typeof field === 'string');
}

function cloneScope(scope: SkillPermissionScope): SkillPermissionScope {
  return {
    allowedCommands: [...scope.allowedCommands],
    chainRead: scope.chainRead,
    chainWrite: scope.chainWrite,
    localUiOpen: scope.localUiOpen,
    remoteDelegation: scope.remoteDelegation,
  };
}

function cloneScopeMetadata(metadata: SkillVariantScopeMetadata): SkillVariantScopeMetadata {
  return {
    sameSkill: metadata.sameSkill,
    sameScope: metadata.sameScope,
    scopeHash: metadata.scopeHash,
  };
}

function parseActiveVariantForSkill(
  activeVariant: unknown,
  skillName: string
): SkillVariantArtifact | null {
  if (!isRecord(activeVariant)) {
    return null;
  }
  if (activeVariant.status !== 'active' || activeVariant.skillName !== skillName) {
    return null;
  }
  if (typeof activeVariant.variantId !== 'string') {
    return null;
  }
  if (!isValidSkillPermissionScope(activeVariant.scope)) {
    return null;
  }
  if (!isValidScopeMetadata(activeVariant.metadata)) {
    return null;
  }
  if (!isValidPatch(activeVariant.patch)) {
    return null;
  }
  const patch = activeVariant.patch as Record<string, unknown>;
  return {
    variantId: activeVariant.variantId,
    skillName: skillName,
    status: 'active',
    scope: cloneScope(activeVariant.scope),
    metadata: cloneScopeMetadata(activeVariant.metadata),
    patch: {
      instructionsPatch: typeof patch.instructionsPatch === 'string' ? patch.instructionsPatch : undefined,
      commandTemplatePatch: typeof patch.commandTemplatePatch === 'string' ? patch.commandTemplatePatch : undefined,
      outputExpectationPatch: typeof patch.outputExpectationPatch === 'string' ? patch.outputExpectationPatch : undefined,
      fallbackPolicyPatch: typeof patch.fallbackPolicyPatch === 'string' ? patch.fallbackPolicyPatch : undefined,
    },
  };
}

function normalizeAllowedCommands(commands: string[]): string[] {
  return [...new Set(commands)].sort();
}

function areScopesEquivalent(baseScope: SkillPermissionScope, variantScope: SkillPermissionScope): boolean {
  const baseCommands = normalizeAllowedCommands(baseScope.allowedCommands);
  const variantCommands = normalizeAllowedCommands(variantScope.allowedCommands);
  if (baseCommands.length !== variantCommands.length) {
    return false;
  }
  for (let index = 0; index < baseCommands.length; index += 1) {
    if (baseCommands[index] !== variantCommands[index]) {
      return false;
    }
  }
  return baseScope.chainRead === variantScope.chainRead
    && baseScope.chainWrite === variantScope.chainWrite
    && baseScope.localUiOpen === variantScope.localUiOpen
    && baseScope.remoteDelegation === variantScope.remoteDelegation;
}

function buildBaseResolvedContract(skillName: string): ResolvedSkillContract {
  const base = getBaseSkillContract(skillName);
  return {
    skillName: base.skillName,
    title: base.title,
    summary: base.summary,
    instructions: base.instructions,
    commandTemplate: base.commandTemplate,
    outputExpectation: base.outputExpectation,
    fallbackPolicy: base.fallbackPolicy,
    scope: cloneScope(base.scope),
    source: 'base',
    activeVariantId: null,
    scopeMetadata: cloneScopeMetadata(DEFAULT_SCOPE_METADATA),
  };
}

function mergeWithActiveVariant(
  base: ResolvedSkillContract,
  activeVariant: SkillVariantArtifact
): ResolvedSkillContract {
  const mergedScope = cloneScope(activeVariant.scope);
  const sameScope = areScopesEquivalent(base.scope, mergedScope);
  return {
    skillName: base.skillName,
    title: base.title,
    summary: base.summary,
    instructions: activeVariant.patch.instructionsPatch ?? base.instructions,
    commandTemplate: activeVariant.patch.commandTemplatePatch ?? base.commandTemplate,
    outputExpectation: activeVariant.patch.outputExpectationPatch ?? base.outputExpectation,
    fallbackPolicy: activeVariant.patch.fallbackPolicyPatch ?? base.fallbackPolicy,
    scope: mergedScope,
    source: 'merged',
    activeVariantId: activeVariant.variantId,
    scopeMetadata: {
      sameSkill: activeVariant.skillName === base.skillName,
      sameScope,
      scopeHash: activeVariant.metadata.scopeHash,
    },
  };
}

function maxBacktickRun(source: string): number {
  let max = 0;
  const matches = source.match(/`+/g) ?? [];
  for (const sequence of matches) {
    if (sequence.length > max) {
      max = sequence.length;
    }
  }
  return max;
}

function renderCommandTemplateMarkdown(commandTemplate: string): string {
  const fence = '`'.repeat(Math.max(3, maxBacktickRun(commandTemplate) + 1));
  return `${fence}bash\n${commandTemplate}\n${fence}`;
}

function renderScopeMarkdown(scope: SkillPermissionScope): string {
  return [
    `- Allowed commands: ${scope.allowedCommands.map((command) => `\`${command}\``).join(', ')}`,
    `- Chain read: ${scope.chainRead ? 'allowed' : 'forbidden'}`,
    `- Chain write: ${scope.chainWrite ? 'allowed' : 'forbidden'}`,
    `- Local UI open: ${scope.localUiOpen ? 'allowed' : 'forbidden'}`,
    `- Remote delegation: ${scope.remoteDelegation ? 'allowed' : 'forbidden'}`,
  ].join('\n');
}

function renderMarkdownContract(host: SkillHost, contract: ResolvedSkillContract): string {
  return [
    `# Resolved Skill Contract: ${contract.skillName}`,
    '',
    `Host: \`${host}\``,
    `Source: \`${contract.source}\``,
    `Active variant: \`${contract.activeVariantId ?? 'none'}\``,
    '',
    '## Summary',
    contract.summary,
    '',
    '## Instructions',
    contract.instructions,
    '',
    '## Command Template',
    renderCommandTemplateMarkdown(contract.commandTemplate),
    '',
    '## Output Expectation',
    contract.outputExpectation,
    '',
    '## Fallback Policy',
    contract.fallbackPolicy,
    '',
    '## Scope',
    renderScopeMarkdown(contract.scope),
    '',
    '## Scope Metadata',
    `- sameSkill: ${contract.scopeMetadata.sameSkill}`,
    `- sameScope: ${contract.scopeMetadata.sameScope}`,
    `- scopeHash: ${contract.scopeMetadata.scopeHash ?? 'null'}`,
  ].join('\n');
}

export function resolveSkillContract(input: ResolveSkillContractInput): ResolvedSkillContract {
  const base = buildBaseResolvedContract(input.skillName);
  if (!input.evolutionNetworkEnabled) {
    return base;
  }
  const activeVariant = parseActiveVariantForSkill(input.activeVariant, input.skillName);
  if (!activeVariant) {
    return base;
  }
  return mergeWithActiveVariant(base, activeVariant);
}

export function renderResolvedSkillContract(
  input: RenderResolvedSkillContractInput
): RenderedSkillContract {
  const resolved = resolveSkillContract(input);
  if (input.format === 'json') {
    return {
      host: input.host,
      format: 'json',
      contract: resolved,
    };
  }
  return {
    host: input.host,
    format: 'markdown',
    markdown: renderMarkdownContract(input.host, resolved),
    contract: resolved,
  };
}
