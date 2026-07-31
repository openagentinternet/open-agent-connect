import type { LlmBindingStore } from '../llm/llmBindingStore';
import type { LlmRuntimeStore } from '../llm/llmRuntimeStore';
import type { MetabotPaths } from '../state/paths';
import { getMetabotProfile } from '../bot/metabotProfileManager';
import { resolveAllowChatSkillsForRuntime, writeChatSkillResolution } from '../services/chatSkillPolicy';

export interface PrivateChatAllowedSkillDetail {
  name: string;
  description: string | null;
  // Absolute path to the skill's SKILL.md in its source root. The chat prompt
  // points the model here so it always reads the fresh skill document.
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

export function emptyPrivateChatAllowedSkillScope(): PrivateChatAllowedSkillScope {
  return {
    skills: [],
    skillSourcePaths: {},
    skillDetails: [],
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
  // Persist the last resolution outcome so operators can see configured
  // skills that no longer resolve. Strictly best-effort: a failed write must
  // never affect the chat turn.
  const persistResolution = (scope: PrivateChatAllowedSkillScope) => writeChatSkillResolution(
    input.paths.chatSkillResolutionPath,
    {
      resolved: scope.skills,
      skipped: scope.skippedSkills,
      warning: scope.warning,
      checkedAt: new Date().toISOString(),
    },
  ).catch(() => undefined);

  return async () => {
    const profile = await getMetabotProfile(input.paths.systemHomeDir, input.metaBotSlug);
    if (!profile || profile.allowChatSkills.length === 0) {
      const emptyScope = emptyPrivateChatAllowedSkillScope();
      await persistResolution(emptyScope);
      return emptyScope;
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

    const scope = {
      skills: result.skills.map((skill) => skill.skillName),
      skillSourcePaths: result.skillSourcePaths,
      skillDetails: result.skills.map((skill) => ({
        name: skill.skillName,
        description: typeof skill.description === 'string' && skill.description.trim()
          ? skill.description.trim()
          : null,
        location: typeof skill.skillDocumentPath === 'string' && skill.skillDocumentPath.trim()
          ? skill.skillDocumentPath.trim()
          : null,
      })),
      skippedSkills: result.skippedSkills,
      warning: result.warning ?? null,
    };
    await persistResolution(scope);
    return scope;
  };
}
