import type { LlmBindingStore } from '../llm/llmBindingStore';
import type { LlmRuntimeStore } from '../llm/llmRuntimeStore';
import type { MetabotPaths } from '../state/paths';
export interface PrivateChatAllowedSkillScope {
    skills: string[];
    skillSourcePaths: Record<string, string>;
    skippedSkills: string[];
    warning: string | null;
}
export type PrivateChatAllowedSkillsResolver = () => Promise<PrivateChatAllowedSkillScope>;
export declare function emptyPrivateChatAllowedSkillScope(): PrivateChatAllowedSkillScope;
export declare function createPrivateChatAllowedSkillsResolver(input: {
    paths: MetabotPaths;
    metaBotSlug: string;
    runtimeStore: LlmRuntimeStore;
    bindingStore: LlmBindingStore;
    env?: NodeJS.ProcessEnv;
    logWarning?: (scope: string, message: string) => void;
}): PrivateChatAllowedSkillsResolver;
