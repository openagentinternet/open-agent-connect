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

function isActiveVariantForSkill(
  activeVariant: SkillVariantArtifact | null | undefined,
  skillName: string
): activeVariant is SkillVariantArtifact {
  return Boolean(
    activeVariant
    && activeVariant.status === 'active'
    && activeVariant.skillName === skillName
  );
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
  return {
    skillName: base.skillName,
    title: base.title,
    summary: base.summary,
    instructions: activeVariant.patch.instructionsPatch ?? base.instructions,
    commandTemplate: activeVariant.patch.commandTemplatePatch ?? base.commandTemplate,
    outputExpectation: activeVariant.patch.outputExpectationPatch ?? base.outputExpectation,
    fallbackPolicy: activeVariant.patch.fallbackPolicyPatch ?? base.fallbackPolicy,
    scope: cloneScope(activeVariant.scope),
    source: 'merged',
    activeVariantId: activeVariant.variantId,
    scopeMetadata: cloneScopeMetadata(activeVariant.metadata),
  };
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
    `\`${contract.commandTemplate}\``,
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
  if (!isActiveVariantForSkill(input.activeVariant, input.skillName)) {
    return base;
  }
  return mergeWithActiveVariant(base, input.activeVariant);
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
