import { type MetabotCommandResult } from '../contracts/commandResult';
import type { ConcreteSkillHost } from '../skills/skillContractTypes';
export interface NpmInstallContext {
    env: NodeJS.ProcessEnv;
    cwd: string;
    packageRoot?: string;
}
export interface NpmInstallInput {
    host?: string;
}
export interface NpmInstallResult {
    host: ConcreteSkillHost;
    packageRoot: string;
    sharedSkillRoot: string;
    metabotShimPath: string;
    installedSkills: string[];
    hostSkillRoot: string;
    boundSkills: string[];
    version: string;
}
export declare function runNpmInstall(input: NpmInstallInput, context: NpmInstallContext): Promise<MetabotCommandResult<NpmInstallResult>>;
export declare function runNpmDoctor(input: NpmInstallInput, context: NpmInstallContext): Promise<MetabotCommandResult<NpmInstallResult>>;
