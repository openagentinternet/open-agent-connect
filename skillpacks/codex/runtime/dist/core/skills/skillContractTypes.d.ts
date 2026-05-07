import type { PlatformId } from '../platform/platformRegistry';
export type SkillHost = 'shared' | PlatformId;
export type ConcreteSkillHost = Exclude<SkillHost, 'shared'>;
export type SkillRenderFormat = 'json' | 'markdown';
export type SkillResolutionSource = 'base' | 'merged';
export type ActiveVariantSource = 'local' | 'remote' | null;
export type SkillVariantStatus = 'active' | 'inactive';
export type SkillResolutionMode = 'shared_default' | 'host_override';
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
    activeVariantSource?: ActiveVariantSource;
}
export interface ResolvedSkillContract extends BaseSkillContract {
    source: SkillResolutionSource;
    activeVariantId: string | null;
    activeVariantSource: ActiveVariantSource;
    scopeMetadata: SkillVariantScopeMetadata;
}
export interface RenderResolvedSkillContractInput extends ResolveSkillContractInput {
    host?: ConcreteSkillHost;
    format: SkillRenderFormat;
}
export interface RenderedSkillContractJson {
    host: SkillHost;
    requestedHost?: ConcreteSkillHost;
    resolutionMode: SkillResolutionMode;
    format: 'json';
    contract: ResolvedSkillContract;
}
export interface RenderedSkillContractMarkdown {
    host: SkillHost;
    requestedHost?: ConcreteSkillHost;
    resolutionMode: SkillResolutionMode;
    format: 'markdown';
    markdown: string;
    contract: ResolvedSkillContract;
}
export type RenderedSkillContract = RenderedSkillContractJson | RenderedSkillContractMarkdown;
