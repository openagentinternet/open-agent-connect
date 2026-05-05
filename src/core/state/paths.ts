import path from 'node:path';

export interface MetabotPaths {
  systemHomeDir: string;
  metabotRoot: string;
  managerRoot: string;
  skillsRoot: string;
  globalServicesRoot: string;
  onlineServicesCachePath: string;
  profilesRoot: string;
  profileRoot: string;
  workspaceRoot: string;
  runtimeRoot: string;
  a2aRoot: string;
  sessionsRoot: string;
  exportsRoot: string;
  stateRoot: string;
  locksRoot: string;
  evolutionRoot: string;
  evolutionExecutionsRoot: string;
  evolutionAnalysesRoot: string;
  evolutionArtifactsRoot: string;
  evolutionIndexPath: string;
  evolutionRemoteRoot: string;
  evolutionRemoteArtifactsRoot: string;
  evolutionRemoteIndexPath: string;
  identityProfilesPath: string;
  activeHomePath: string;
  configPath: string;
  identitySecretsPath: string;
  providerSecretsPath: string;
  runtimeStatePath: string;
  daemonStatePath: string;
  runtimeDbPath: string;
  sessionStatePath: string;
  providerPresenceStatePath: string;
  ratingDetailStatePath: string;
  masterPendingAskStatePath: string;
  masterSuggestStatePath: string;
  masterAutoFeedbackStatePath: string;
  masterPublishedStatePath: string;
  directorySeedsPath: string;
  privateChatStatePath: string;
  chatStrategiesPath: string;
  soulMdPath: string;
  goalMdPath: string;
  roleMdPath: string;
  daemonLockPath: string;

  // LLM runtime / binding paths.
  llmRoot: string;
  llmRuntimesPath: string;
  llmBindingsPath: string;
  llmSecretsRoot: string;
  preferredLlmRuntimePath: string;
  llmExecutorRoot: string;
  llmExecutorSessionsRoot: string;
  llmExecutorTranscriptsRoot: string;

  // Temporary compatibility aliases for untouched later-task modules.
  baseRoot: string;
  exportRoot: string;
}

function normalizeInputHomeDir(homeDir: string): string {
  const normalizedHomeDir = typeof homeDir === 'string' ? homeDir.trim() : '';
  if (!normalizedHomeDir) {
    throw new Error('A home directory is required to resolve metabot paths.');
  }

  return path.resolve(normalizedHomeDir);
}

function normalizeProfileHomeDir(homeDir: string): {
  systemHomeDir: string;
  metabotRoot: string;
  profilesRoot: string;
  profileRoot: string;
} {
  const profileRoot = normalizeInputHomeDir(homeDir);
  const profilesRoot = path.dirname(profileRoot);
  const metabotRoot = path.dirname(profilesRoot);
  const systemHomeDir = path.dirname(metabotRoot);

  if (
    path.basename(profilesRoot) !== 'profiles'
    || path.basename(metabotRoot) !== '.metabot'
  ) {
    throw new Error(
      `Profile home must live under ~/.metabot/profiles/<slug>: ${profileRoot}`
    );
  }

  return {
    systemHomeDir,
    metabotRoot,
    profilesRoot,
    profileRoot,
  };
}

function buildMetabotPaths(input: {
  systemHomeDir: string;
  metabotRoot: string;
  managerRoot: string;
  skillsRoot: string;
  profilesRoot: string;
  profileRoot: string;
  workspaceRoot: string;
  runtimeRoot: string;
  sessionsRoot: string;
  exportsRoot: string;
  stateRoot: string;
  locksRoot: string;
  identitySecretsPath: string;
  providerSecretsPath: string;
  sessionStatePath: string;
  providerPresenceStatePath: string;
  ratingDetailStatePath: string;
  masterPendingAskStatePath: string;
  masterSuggestStatePath: string;
  masterAutoFeedbackStatePath: string;
  masterPublishedStatePath: string;
  directorySeedsPath: string;
  privateChatStatePath: string;
  chatStrategiesPath: string;
  soulMdPath: string;
  goalMdPath: string;
  roleMdPath: string;
  daemonLockPath: string;
  llmRoot: string;
  llmRuntimesPath: string;
  llmBindingsPath: string;
  llmSecretsRoot: string;
  preferredLlmRuntimePath: string;
  llmExecutorRoot: string;
  llmExecutorSessionsRoot: string;
  llmExecutorTranscriptsRoot: string;
}): MetabotPaths {
  const evolutionRoot = path.join(input.runtimeRoot, 'evolution');
  const a2aRoot = path.join(input.runtimeRoot, 'A2A');
  const evolutionExecutionsRoot = path.join(evolutionRoot, 'executions');
  const evolutionAnalysesRoot = path.join(evolutionRoot, 'analyses');
  const evolutionArtifactsRoot = path.join(evolutionRoot, 'artifacts');
  const evolutionIndexPath = path.join(evolutionRoot, 'index.json');
  const evolutionRemoteRoot = path.join(evolutionRoot, 'remote');
  const evolutionRemoteArtifactsRoot = path.join(evolutionRemoteRoot, 'artifacts');
  const evolutionRemoteIndexPath = path.join(evolutionRemoteRoot, 'index.json');

  return {
    systemHomeDir: input.systemHomeDir,
    metabotRoot: input.metabotRoot,
    managerRoot: input.managerRoot,
    skillsRoot: input.skillsRoot,
    globalServicesRoot: path.join(input.metabotRoot, 'services'),
    onlineServicesCachePath: path.join(input.metabotRoot, 'services', 'services.json'),
    profilesRoot: input.profilesRoot,
    profileRoot: input.profileRoot,
    workspaceRoot: input.workspaceRoot,
    runtimeRoot: input.runtimeRoot,
    a2aRoot,
    sessionsRoot: input.sessionsRoot,
    exportsRoot: input.exportsRoot,
    stateRoot: input.stateRoot,
    locksRoot: input.locksRoot,
    evolutionRoot,
    evolutionExecutionsRoot,
    evolutionAnalysesRoot,
    evolutionArtifactsRoot,
    evolutionIndexPath,
    evolutionRemoteRoot,
    evolutionRemoteArtifactsRoot,
    evolutionRemoteIndexPath,
    identityProfilesPath: path.join(input.managerRoot, 'identity-profiles.json'),
    activeHomePath: path.join(input.managerRoot, 'active-home.json'),
    configPath: path.join(input.runtimeRoot, 'config.json'),
    identitySecretsPath: input.identitySecretsPath,
    providerSecretsPath: input.providerSecretsPath,
    runtimeStatePath: path.join(input.runtimeRoot, 'runtime-state.json'),
    daemonStatePath: path.join(input.runtimeRoot, 'daemon.json'),
    runtimeDbPath: path.join(input.runtimeRoot, 'runtime.sqlite'),
    sessionStatePath: input.sessionStatePath,
    providerPresenceStatePath: input.providerPresenceStatePath,
    ratingDetailStatePath: input.ratingDetailStatePath,
    masterPendingAskStatePath: input.masterPendingAskStatePath,
    masterSuggestStatePath: input.masterSuggestStatePath,
    masterAutoFeedbackStatePath: input.masterAutoFeedbackStatePath,
    masterPublishedStatePath: input.masterPublishedStatePath,
    directorySeedsPath: input.directorySeedsPath,
    privateChatStatePath: input.privateChatStatePath,
    chatStrategiesPath: input.chatStrategiesPath,
    soulMdPath: input.soulMdPath,
    goalMdPath: input.goalMdPath,
    roleMdPath: input.roleMdPath,
    daemonLockPath: input.daemonLockPath,

    // LLM paths.
    llmRoot: input.llmRoot,
    llmRuntimesPath: input.llmRuntimesPath,
    llmBindingsPath: input.llmBindingsPath,
    llmSecretsRoot: input.llmSecretsRoot,
    preferredLlmRuntimePath: input.preferredLlmRuntimePath,
    llmExecutorRoot: input.llmExecutorRoot,
    llmExecutorSessionsRoot: input.llmExecutorSessionsRoot,
    llmExecutorTranscriptsRoot: input.llmExecutorTranscriptsRoot,

    // Temporary compatibility aliases for untouched later-task modules.
    baseRoot: input.metabotRoot,
    exportRoot: input.exportsRoot,
  };
}

export function resolveMetabotPaths(homeDir: string): MetabotPaths {
  const normalizedHomeDir = normalizeInputHomeDir(homeDir);
  const {
    systemHomeDir,
    metabotRoot,
    profilesRoot,
    profileRoot,
  } = normalizeProfileHomeDir(normalizedHomeDir);
  const managerRoot = path.join(metabotRoot, 'manager');
  const skillsRoot = path.join(metabotRoot, 'skills');
  const runtimeRoot = path.join(profileRoot, '.runtime');
  const sessionsRoot = path.join(runtimeRoot, 'sessions');
  const exportsRoot = path.join(runtimeRoot, 'exports');
  const stateRoot = path.join(runtimeRoot, 'state');
  const locksRoot = path.join(runtimeRoot, 'locks');
  const llmExecutorRoot = path.join(metabotRoot, 'LLM', 'executor');

  return buildMetabotPaths({
    systemHomeDir,
    metabotRoot,
    managerRoot,
    skillsRoot,
    profilesRoot,
    profileRoot,
    workspaceRoot: profileRoot,
    runtimeRoot,
    sessionsRoot,
    exportsRoot,
    stateRoot,
    locksRoot,
    identitySecretsPath: path.join(runtimeRoot, 'identity-secrets.json'),
    providerSecretsPath: path.join(runtimeRoot, 'provider-secrets.json'),
    sessionStatePath: path.join(sessionsRoot, 'a2a-session-state.json'),
    providerPresenceStatePath: path.join(stateRoot, 'provider-presence.json'),
    ratingDetailStatePath: path.join(stateRoot, 'rating-detail.json'),
    masterPendingAskStatePath: path.join(stateRoot, 'master-pending-asks.json'),
    masterSuggestStatePath: path.join(stateRoot, 'master-suggest-state.json'),
    masterAutoFeedbackStatePath: path.join(stateRoot, 'master-auto-feedback-state.json'),
    masterPublishedStatePath: path.join(stateRoot, 'master-service-state.json'),
    directorySeedsPath: path.join(stateRoot, 'directory-seeds.json'),
    privateChatStatePath: path.join(stateRoot, 'private-chat-state.json'),
    chatStrategiesPath: path.join(stateRoot, 'chat-strategies.json'),
    soulMdPath: path.join(profileRoot, 'SOUL.md'),
    goalMdPath: path.join(profileRoot, 'GOAL.md'),
    roleMdPath: path.join(profileRoot, 'ROLE.md'),
    daemonLockPath: path.join(locksRoot, 'daemon.lock'),
    llmRoot: path.join(metabotRoot, 'LLM'),
    llmRuntimesPath: path.join(metabotRoot, 'LLM', 'runtimes.json'),
    llmBindingsPath: path.join(profileRoot, 'llmbindings.json'),
    llmSecretsRoot: path.join(metabotRoot, 'LLM', 'secrets'),
    preferredLlmRuntimePath: path.join(profileRoot, 'preferred-llm-runtime.json'),
    llmExecutorRoot,
    llmExecutorSessionsRoot: path.join(llmExecutorRoot, 'sessions'),
    llmExecutorTranscriptsRoot: path.join(llmExecutorRoot, 'transcripts'),
  });
}
