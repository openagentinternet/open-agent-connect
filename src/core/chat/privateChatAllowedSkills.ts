import type { LlmBindingStore } from '../llm/llmBindingStore';
import type { LlmRuntimeStore } from '../llm/llmRuntimeStore';
import type { MetabotPaths } from '../state/paths';
import { getMetabotProfile } from '../bot/metabotProfileManager';
import { resolveAllowChatSkillsForRuntime } from '../services/chatSkillPolicy';

export interface PrivateChatAllowedSkillScope {
  skills: string[];
  skillSourcePaths: Record<string, string>;
  skippedSkills: string[];
  warning: string | null;
}

export type PrivateChatAllowedSkillsResolver = () => Promise<PrivateChatAllowedSkillScope>;

export function emptyPrivateChatAllowedSkillScope(): PrivateChatAllowedSkillScope {
  return {
    skills: [],
    skillSourcePaths: {},
    skippedSkills: [],
    warning: null,
  };
}

export function createPrivateChatAllowedSkillsResolver(input: {
  paths: MetabotPaths;
  metaBotSlug: string;
  runtimeStore: LlmRuntimeStore;
  bindingStore: LlmBindingStore;
  env?: NodeJS.ProcessEnv;
  logWarning?: (scope: string, message: string) => void;
}): PrivateChatAllowedSkillsResolver {
  return async () => {
    const profile = await getMetabotProfile(input.paths.systemHomeDir, input.metaBotSlug);
    if (!profile || profile.allowChatSkills.length === 0) {
      return emptyPrivateChatAllowedSkillScope();
    }

    const result = await resolveAllowChatSkillsForRuntime({
      metaBotSlug: input.metaBotSlug,
      allowChatSkills: profile.allowChatSkills,
      runtimeStore: input.runtimeStore,
      bindingStore: input.bindingStore,
      systemHomeDir: input.paths.systemHomeDir,
      projectRoot: input.paths.profileRoot,
      env: input.env,
    });

    if (result.warning) {
      input.logWarning?.('[private chat allowed skills]', result.warning);
    }

    return {
      skills: result.skills.map((skill) => skill.skillName),
      skillSourcePaths: result.skillSourcePaths,
      skippedSkills: result.skippedSkills,
      warning: result.warning ?? null,
    };
  };
}
