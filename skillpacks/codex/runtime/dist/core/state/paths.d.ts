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
    llmRoot: string;
    llmRuntimesPath: string;
    llmBindingsPath: string;
    llmSecretsRoot: string;
    preferredLlmRuntimePath: string;
    llmExecutorRoot: string;
    llmExecutorSessionsRoot: string;
    llmExecutorTranscriptsRoot: string;
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
export declare function resolveMetabotPaths(homeDir: string): MetabotPaths;
export declare function resolveMetabotDaemonPaths(systemHomeDir: string): MetabotDaemonPaths;
