import type { PlatformId } from '../platform/platformRegistry';
import type { ConcreteSkillHost } from '../skills/skillContractTypes';
export interface BindHostSkillsInput {
    systemHomeDir: string;
    host: ConcreteSkillHost;
    env?: NodeJS.ProcessEnv;
}
export interface BindPlatformSkillsInput {
    systemHomeDir: string;
    env?: NodeJS.ProcessEnv;
    host?: PlatformId;
    mode: 'auto' | 'force-platform';
}
export interface BoundPlatformSkillRootResult {
    platformId: PlatformId | 'shared-agents';
    rootId: string;
    hostSkillRoot: string;
    status: 'bound' | 'skipped' | 'failed';
    reason?: string;
    boundSkills: string[];
    replacedEntries: string[];
    unchangedEntries: string[];
}
export interface BoundHostSkillsResult {
    host: ConcreteSkillHost;
    hostSkillRoot: string;
    sharedSkillRoot: string;
    boundSkills: string[];
    replacedEntries: string[];
    unchangedEntries: string[];
    boundRoots?: BoundPlatformSkillRootResult[];
    skippedRoots?: BoundPlatformSkillRootResult[];
    failedRoots?: BoundPlatformSkillRootResult[];
}
export declare class HostSkillBindingError extends Error {
    code: 'shared_skills_missing' | 'host_skill_root_unresolved' | 'host_skill_bind_failed';
    data: Record<string, unknown>;
    constructor(code: 'shared_skills_missing' | 'host_skill_root_unresolved' | 'host_skill_bind_failed', message: string, data: Record<string, unknown>);
}
export declare function bindPlatformSkills(input: BindPlatformSkillsInput): Promise<BoundPlatformSkillRootResult[]>;
export declare function bindHostSkills(input: BindHostSkillsInput): Promise<BoundHostSkillsResult>;
