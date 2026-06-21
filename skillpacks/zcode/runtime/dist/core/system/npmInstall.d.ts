import { type MetabotCommandResult } from '../contracts/commandResult';
import { type BoundPlatformSkillRootResult } from '../host/hostSkillBinding';
import type { PlatformId } from '../platform/platformRegistry';
export interface NpmInstallContext {
    env: NodeJS.ProcessEnv;
    cwd: string;
    packageRoot?: string;
}
export interface NpmInstallInput {
    host?: string;
}
export interface NpmInstallResult {
    host?: PlatformId;
    packageRoot: string;
    sharedSkillRoot: string;
    metabotShimPath: string;
    installedSkills: string[];
    boundRoots: BoundPlatformSkillRootResult[];
    skippedRoots: BoundPlatformSkillRootResult[];
    failedRoots: BoundPlatformSkillRootResult[];
    version: string;
    hostSkillRoot?: string;
    boundSkills?: string[];
}
export declare function runNpmInstall(input: NpmInstallInput, context: NpmInstallContext): Promise<MetabotCommandResult<NpmInstallResult>>;
export declare function runNpmDoctor(input: NpmInstallInput, context: NpmInstallContext): Promise<MetabotCommandResult<NpmInstallResult>>;
