import type { LlmBindingStore } from '../llm/llmBindingStore';
import type { LlmRuntimeStore } from '../llm/llmRuntimeStore';
import type { MetabotPaths } from '../state/paths';
export interface PrivateChatAllowedSkillDetail {
    name: string;
    description: string | null;
    location: string | null;
}
export interface PrivateChatAllowedSkillScope {
    skills: string[];
    skillSourcePaths: Record<string, string>;
    skillDetails: PrivateChatAllowedSkillDetail[];
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
    /**
     * While a host executor is connected, allowed skills resolve against the
     * DSH platform scope (~/.dsh/skills + ~/.agents/skills) — the surface the
     * reply turn actually executes on in host agent mode — instead of the
     * primary local runtime's platform. Defaults to the active bridge.
     */
    hostExecutorConnected?: () => boolean;
}): PrivateChatAllowedSkillsResolver;
