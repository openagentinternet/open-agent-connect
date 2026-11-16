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
    dshLlmPath: string;
    botRoleStatePath: string;
    /** Per-profile Grok Bot assistant binding (`.runtime/state/grok-bot-binding.json`). */
    grokBotBindingPath: string;
    /** Grok Bot webhook LLM task handoff dir (`.runtime/state/grok-bot-llm-tasks/`). */
    grokBotLlmTasksRoot: string;
    bioMdPath: string;
    soulMdPath: string;
    goalMdPath: string;
    roleMdPath: string;
    daemonLockPath: string;
    workspaceMemoryRoot: string;
    memorySelfIdentityPath: string;
    memoryRoot: string;
    memoryMemoriesPath: string;
    memoryKnowledgePath: string;
    memoryImpressionsPath: string;
    memoryExperiencePath: string;
    memoryDreamRunsPath: string;
    memoryDreamSummariesPath: string;
    memoryPolicyPath: string;
    memoryOrchestrationPath: string;
    memoryTranscriptsRoot: string;
    /** Memory hygiene run ledger (`.runtime/memory/hygiene.json`). */
    memoryHygienePath: string;
    /** L3b capability drafts from dreams (`.runtime/memory/capability-drafts.json`). */
    memoryCapabilityDraftsPath: string;
    chainHistoryRoot: string;
    schedulePath: string;
    surfRoot: string;
    surfRunsPath: string;
    surfProtocolStatePath: string;
    surfSeenPinsPath: string;
    surfSettingsPath: string;
    longtermRoot: string;
    longtermTasksPath: string;
    longtermSubtasksPath: string;
    longtermEventsPath: string;
    longtermNudgeStatePath: string;
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
    /** Append-only lifecycle journal (start/stop/crash/respawn) next to daemon.json. */
    daemonEventsPath: string;
    daemonLockPath: string;
    daemonLogPath: string;
    migrationStatePath: string;
}
export declare function resolveMetabotPaths(homeDir: string): MetabotPaths;
export declare function resolveMetabotDaemonPaths(systemHomeDir: string): MetabotDaemonPaths;
/**
 * Machine-wide owner-layer state paths (trust tiers design; storage-layout
 * v2 amendment 2026-10-16). These live under `~/.metabot/owner/` next to
 * the existing device identity (`identity.json`); they are intentionally
 * NOT part of the per-profile MetabotPaths model.
 */
export interface MetabotOwnerPaths {
    systemHomeDir: string;
    ownerRoot: string;
    /** The existing machine-wide identity record; semantically the Device Identity. */
    deviceIdentityPath: string;
    /** The human's portable Owner Identity record (0600, at most one per machine). */
    rootOwnerIdentityPath: string;
    /** Resolved root owners keyed by subject GlobalMetaID, invalidated by pinId changes. */
    trustCachePath: string;
    /** Device-level blocklist + explicit contacts (P2 of the trust tiers design). */
    trustLocalPath: string;
    /** Remote team Bot gmids (P4b candidates; P5 `metabot team add` populates). */
    teamRegistryPath: string;
}
export declare function resolveMetabotOwnerPaths(systemHomeDir: string): MetabotOwnerPaths;
/**
 * Machine-wide local-session-layer state paths (local session adapters
 * design; storage-layout v2 amendment 2026-11-11). Local agent sessions
 * are machine facts — they belong to no single Bot profile — so they live
 * under `~/.metabot/sessions/`, NOT in the per-profile MetabotPaths model
 * (same split as the owner layer above).
 */
export interface MetabotSessionPaths {
    systemHomeDir: string;
    sessionsRoot: string;
    /** The local session registry (`.metabot/sessions/local-sessions.json`). */
    localSessionsPath: string;
    /** Per-session mail queue (`.metabot/sessions/session-mail.json`). */
    sessionMailPath: string;
}
export declare function resolveMetabotSessionPaths(systemHomeDir: string): MetabotSessionPaths;
