export interface SkillInjectorInput {
    skills: string[];
    skillsRoot: string;
    provider: string;
    cwd: string;
}
export interface SkillInjectionResult {
    injected: string[];
    errors: Array<{
        skill: string;
        error: string;
    }>;
}
export declare function resolveProviderSkillRoot(provider: string, cwd: string): string;
export declare function injectSkills(input: SkillInjectorInput): Promise<SkillInjectionResult>;
