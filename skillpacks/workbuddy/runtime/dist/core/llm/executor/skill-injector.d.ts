export interface SkillInjectorInput {
    skills: string[];
    skillsRoot: string;
    skillSourcePaths?: Record<string, string>;
    provider: string;
    cwd: string;
    systemHomeDir?: string;
    env?: NodeJS.ProcessEnv;
}
export interface SkillInjectionResult {
    injected: string[];
    errors: Array<{
        skill: string;
        error: string;
    }>;
}
export declare function resolveProviderSkillRoot(provider: string, cwd: string, options?: {
    systemHomeDir?: string;
    env?: NodeJS.ProcessEnv;
}): string;
export declare function injectSkills(input: SkillInjectorInput): Promise<SkillInjectionResult>;
