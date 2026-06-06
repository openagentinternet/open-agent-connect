import type { PlatformId } from '../platform/platformRegistry';

export type SkillHost = 'shared' | PlatformId;
export type ConcreteSkillHost = Exclude<SkillHost, 'shared'>;
export type SkillRenderFormat = 'json' | 'markdown';
export type SkillResolutionSource = 'base';
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

export interface ResolveSkillContractInput {
  skillName: string;
}

export interface ResolvedSkillContract extends BaseSkillContract {
  source: SkillResolutionSource;
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
