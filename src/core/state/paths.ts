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
  identityProfilesPath: string;
  activeHomePath: string;
  infrastructureConfigPath: string;
  configPath: string;
  identitySecretsPath: string;
  providerSecretsPath: string;
  runtimeStatePath: string;
  daemonStatePath: string;
  runtimeDbPath: string;
  sessionStatePath: string;
  providerPresenceStatePath: string;
  ratingDetailStatePath: string;
  directorySeedsPath: string;
  privateChatStatePath: string;
  chatStrategiesPath: string;
  chatSkillPolicyPath: string;
  chatSkillResolutionPath: string;
  profilePublishStatePath: string;
  homepageStatePath: string;
  bioMdPath: string;
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

/**
 * Machine-wide paths for the one local daemon instance. These intentionally
 * live outside profile runtimes: profile state remains private to its profile,
 * while process ownership and the selected local endpoint are installation
 * concerns.
 */
export interface MetabotDaemonPaths {
  systemHomeDir: string;
  metabotRoot: string;
  managerRoot: string;
  infrastructureConfigPath: string;
  runtimeRoot: string;
  locksRoot: string;
  logsRoot: string;
  recoveryRoot: string;
  installationPath: string;
  daemonStatePath: string;
  daemonLockPath: string;
  daemonLogPath: string;
  migrationStatePath: string;
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
  directorySeedsPath: string;
  privateChatStatePath: string;
  chatStrategiesPath: string;
  chatSkillPolicyPath: string;
  chatSkillResolutionPath: string;
  profilePublishStatePath: string;
  bioMdPath: string;
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
  const a2aRoot = path.join(input.runtimeRoot, 'A2A');

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
    identityProfilesPath: path.join(input.managerRoot, 'identity-profiles.json'),
    activeHomePath: path.join(input.managerRoot, 'active-home.json'),
    infrastructureConfigPath: path.join(input.managerRoot, 'infrastructure.json'),
    configPath: path.join(input.runtimeRoot, 'config.json'),
    identitySecretsPath: input.identitySecretsPath,
    providerSecretsPath: input.providerSecretsPath,
    runtimeStatePath: path.join(input.runtimeRoot, 'runtime-state.json'),
    daemonStatePath: path.join(input.runtimeRoot, 'daemon.json'),
    runtimeDbPath: path.join(input.runtimeRoot, 'runtime.sqlite'),
    sessionStatePath: input.sessionStatePath,
    providerPresenceStatePath: input.providerPresenceStatePath,
    ratingDetailStatePath: input.ratingDetailStatePath,
    directorySeedsPath: input.directorySeedsPath,
    privateChatStatePath: input.privateChatStatePath,
    chatStrategiesPath: input.chatStrategiesPath,
    chatSkillPolicyPath: input.chatSkillPolicyPath,
    chatSkillResolutionPath: input.chatSkillResolutionPath,
    profilePublishStatePath: input.profilePublishStatePath,
    homepageStatePath: path.join(input.stateRoot, 'homepage.json'),
    bioMdPath: input.bioMdPath,
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
    directorySeedsPath: path.join(stateRoot, 'directory-seeds.json'),
    privateChatStatePath: path.join(stateRoot, 'private-chat-state.json'),
    chatStrategiesPath: path.join(stateRoot, 'chat-strategies.json'),
    chatSkillPolicyPath: path.join(stateRoot, 'chat-skill-policy.json'),
    chatSkillResolutionPath: path.join(stateRoot, 'chat-skill-resolution.json'),
    profilePublishStatePath: path.join(stateRoot, 'profile-publish-state.json'),
    bioMdPath: path.join(profileRoot, 'BIO.md'),
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

export function resolveMetabotDaemonPaths(systemHomeDir: string): MetabotDaemonPaths {
  const normalizedSystemHomeDir = normalizeInputHomeDir(systemHomeDir);
  const metabotRoot = path.join(normalizedSystemHomeDir, '.metabot');
  const managerRoot = path.join(metabotRoot, 'manager');
  const runtimeRoot = path.join(metabotRoot, 'runtime');
  const locksRoot = path.join(runtimeRoot, 'locks');
  const logsRoot = path.join(runtimeRoot, 'logs');
  const recoveryRoot = path.join(runtimeRoot, 'recovery');

  return {
    systemHomeDir: normalizedSystemHomeDir,
    metabotRoot,
    managerRoot,
    infrastructureConfigPath: path.join(managerRoot, 'infrastructure.json'),
    runtimeRoot,
    locksRoot,
    logsRoot,
    recoveryRoot,
    installationPath: path.join(runtimeRoot, 'installation.json'),
    daemonStatePath: path.join(runtimeRoot, 'daemon.json'),
    daemonLockPath: path.join(locksRoot, 'daemon.lock'),
    daemonLogPath: path.join(logsRoot, 'daemon.log'),
    migrationStatePath: path.join(recoveryRoot, 'migration.json'),
  };
}
