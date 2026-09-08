import type { LlmBindingStore } from '../llm/llmBindingStore';
import type { LlmRuntimeStore } from '../llm/llmRuntimeStore';
import type { MetabotPaths } from '../state/paths';
import { getMetabotProfile } from '../bot/metabotProfileManager';
import {
  resolveAllowChatSkillsForPlatform,
  resolveAllowChatSkillsForRuntime,
  writeChatSkillResolution,
} from '../services/chatSkillPolicy';
import { getActiveHostLlmExecutorBridge } from '../llm/hostLlmExecutorBridge';

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
  /**
   * While a host executor is connected, allowed skills resolve against the
   * DSH platform scope (~/.dsh/skills + ~/.agents/skills) — the surface the
   * reply turn actually executes on in host agent mode — instead of the
   * primary local runtime's platform. Defaults to the active bridge.
   */
  hostExecutorConnected?: () => boolean;
}): PrivateChatAllowedSkillsResolver {
  const hostExecutorConnected = input.hostExecutorConnected
    ?? (() => (getActiveHostLlmExecutorBridge()?.connectedExecutors() ?? 0) > 0);
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

    const policyInput = {
      metaBotSlug: input.metaBotSlug,
      allowChatSkills: profile.allowChatSkills,
      runtimeStore: input.runtimeStore,
      bindingStore: input.bindingStore,
      systemHomeDir: input.paths.systemHomeDir,
      projectRoot: input.paths.profileRoot,
      env: input.env,
    };
    const result = hostExecutorConnected()
      ? await resolveAllowChatSkillsForPlatform({ ...policyInput, platformId: 'dsh' })
      : await resolveAllowChatSkillsForRuntime(policyInput);

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
