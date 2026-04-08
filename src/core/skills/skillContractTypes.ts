export type SkillHost = 'codex' | 'claude-code' | 'openclaw';
export type SkillRenderFormat = 'json' | 'markdown';
export type SkillResolutionSource = 'base' | 'merged';
export type SkillVariantStatus = 'active' | 'inactive';

export interface SkillPermissionScope {
  allowedCommands: string[];
  chainRead: boolean;
  chainWrite: boolean;
  localUiOpen: boolean;
  remoteDelegation: boolean;
}

export interface BaseSkillContract {
  skillName: string;
  title: string;
  summary: string;
  instructions: string;
  commandTemplate: string;
  outputExpectation: string;
  fallbackPolicy: string;
  scope: SkillPermissionScope;
}

export interface SkillVariantScopeMetadata {
  sameSkill: boolean;
  sameScope: boolean;
  scopeHash: string | null;
}

export interface SkillContractPatch {
  instructionsPatch?: string;
  commandTemplatePatch?: string;
  outputExpectationPatch?: string;
  fallbackPolicyPatch?: string;
}

export interface SkillVariantArtifact {
  variantId: string;
  skillName: string;
  status: SkillVariantStatus;
  scope: SkillPermissionScope;
  metadata: SkillVariantScopeMetadata;
  patch: SkillContractPatch;
}

export interface ResolveSkillContractInput {
  skillName: string;
  evolutionNetworkEnabled: boolean;
  activeVariant?: SkillVariantArtifact | null;
}

export interface ResolvedSkillContract extends BaseSkillContract {
  source: SkillResolutionSource;
  activeVariantId: string | null;
  scopeMetadata: SkillVariantScopeMetadata;
}

export interface RenderResolvedSkillContractInput extends ResolveSkillContractInput {
  host: SkillHost;
  format: SkillRenderFormat;
}

export interface RenderedSkillContractJson {
  host: SkillHost;
  format: 'json';
  contract: ResolvedSkillContract;
}

export interface RenderedSkillContractMarkdown {
  host: SkillHost;
  format: 'markdown';
  markdown: string;
  contract: ResolvedSkillContract;
}

export type RenderedSkillContract = RenderedSkillContractJson | RenderedSkillContractMarkdown;
