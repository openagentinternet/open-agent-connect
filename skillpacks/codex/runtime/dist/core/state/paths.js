"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveMetabotPaths = resolveMetabotPaths;
const node_path_1 = __importDefault(require("node:path"));
function normalizeInputHomeDir(homeDir) {
    const normalizedHomeDir = typeof homeDir === 'string' ? homeDir.trim() : '';
    if (!normalizedHomeDir) {
        throw new Error('A home directory is required to resolve metabot paths.');
    }
    return node_path_1.default.resolve(normalizedHomeDir);
}
function normalizeProfileHomeDir(homeDir) {
    const profileRoot = normalizeInputHomeDir(homeDir);
    const profilesRoot = node_path_1.default.dirname(profileRoot);
    const metabotRoot = node_path_1.default.dirname(profilesRoot);
    const systemHomeDir = node_path_1.default.dirname(metabotRoot);
    if (node_path_1.default.basename(profilesRoot) !== 'profiles'
        || node_path_1.default.basename(metabotRoot) !== '.metabot') {
        throw new Error(`Profile home must live under ~/.metabot/profiles/<slug>: ${profileRoot}`);
    }
    return {
        systemHomeDir,
        metabotRoot,
        profilesRoot,
        profileRoot,
    };
}
function buildMetabotPaths(input) {
    const evolutionRoot = node_path_1.default.join(input.runtimeRoot, 'evolution');
    const evolutionExecutionsRoot = node_path_1.default.join(evolutionRoot, 'executions');
    const evolutionAnalysesRoot = node_path_1.default.join(evolutionRoot, 'analyses');
    const evolutionArtifactsRoot = node_path_1.default.join(evolutionRoot, 'artifacts');
    const evolutionIndexPath = node_path_1.default.join(evolutionRoot, 'index.json');
    const evolutionRemoteRoot = node_path_1.default.join(evolutionRoot, 'remote');
    const evolutionRemoteArtifactsRoot = node_path_1.default.join(evolutionRemoteRoot, 'artifacts');
    const evolutionRemoteIndexPath = node_path_1.default.join(evolutionRemoteRoot, 'index.json');
    return {
        systemHomeDir: input.systemHomeDir,
        metabotRoot: input.metabotRoot,
        managerRoot: input.managerRoot,
        skillsRoot: input.skillsRoot,
        profilesRoot: input.profilesRoot,
        profileRoot: input.profileRoot,
        workspaceRoot: input.workspaceRoot,
        runtimeRoot: input.runtimeRoot,
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
        identityProfilesPath: node_path_1.default.join(input.managerRoot, 'identity-profiles.json'),
        activeHomePath: node_path_1.default.join(input.managerRoot, 'active-home.json'),
        configPath: node_path_1.default.join(input.runtimeRoot, 'config.json'),
        identitySecretsPath: input.identitySecretsPath,
        providerSecretsPath: input.providerSecretsPath,
        runtimeStatePath: node_path_1.default.join(input.runtimeRoot, 'runtime-state.json'),
        daemonStatePath: node_path_1.default.join(input.runtimeRoot, 'daemon.json'),
        runtimeDbPath: node_path_1.default.join(input.runtimeRoot, 'runtime.sqlite'),
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
        // Temporary compatibility aliases for untouched later-task modules.
        baseRoot: input.metabotRoot,
        exportRoot: input.exportsRoot,
    };
}
function resolveMetabotPaths(homeDir) {
    const normalizedHomeDir = normalizeInputHomeDir(homeDir);
    const { systemHomeDir, metabotRoot, profilesRoot, profileRoot, } = normalizeProfileHomeDir(normalizedHomeDir);
    const managerRoot = node_path_1.default.join(metabotRoot, 'manager');
    const skillsRoot = node_path_1.default.join(metabotRoot, 'skills');
    const runtimeRoot = node_path_1.default.join(profileRoot, '.runtime');
    const sessionsRoot = node_path_1.default.join(runtimeRoot, 'sessions');
    const exportsRoot = node_path_1.default.join(runtimeRoot, 'exports');
    const stateRoot = node_path_1.default.join(runtimeRoot, 'state');
    const locksRoot = node_path_1.default.join(runtimeRoot, 'locks');
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
        identitySecretsPath: node_path_1.default.join(runtimeRoot, 'identity-secrets.json'),
        providerSecretsPath: node_path_1.default.join(runtimeRoot, 'provider-secrets.json'),
        sessionStatePath: node_path_1.default.join(sessionsRoot, 'a2a-session-state.json'),
        providerPresenceStatePath: node_path_1.default.join(stateRoot, 'provider-presence.json'),
        ratingDetailStatePath: node_path_1.default.join(stateRoot, 'rating-detail.json'),
        masterPendingAskStatePath: node_path_1.default.join(stateRoot, 'master-pending-asks.json'),
        masterSuggestStatePath: node_path_1.default.join(stateRoot, 'master-suggest-state.json'),
        masterAutoFeedbackStatePath: node_path_1.default.join(stateRoot, 'master-auto-feedback-state.json'),
        masterPublishedStatePath: node_path_1.default.join(stateRoot, 'master-service-state.json'),
        directorySeedsPath: node_path_1.default.join(stateRoot, 'directory-seeds.json'),
        privateChatStatePath: node_path_1.default.join(stateRoot, 'private-chat-state.json'),
        chatStrategiesPath: node_path_1.default.join(stateRoot, 'chat-strategies.json'),
        soulMdPath: node_path_1.default.join(profileRoot, 'SOUL.md'),
        goalMdPath: node_path_1.default.join(profileRoot, 'GOAL.md'),
        roleMdPath: node_path_1.default.join(profileRoot, 'ROLE.md'),
        daemonLockPath: node_path_1.default.join(locksRoot, 'daemon.lock'),
    });
}
