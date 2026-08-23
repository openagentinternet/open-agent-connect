"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeSystemHomeDir = normalizeSystemHomeDir;
exports.resolveMetabotManagerLayout = resolveMetabotManagerLayout;
exports.hasLegacyOnlyMetabotLayout = hasLegacyOnlyMetabotLayout;
exports.resolveMetabotHomeSelection = resolveMetabotHomeSelection;
exports.resolveMetabotHomeSelectionSync = resolveMetabotHomeSelectionSync;
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const identityProfiles_1 = require("../identity/identityProfiles");
const paths_1 = require("./paths");
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeWindowsProfileHome(env) {
    const userProfile = normalizeText(env.USERPROFILE);
    if (userProfile) {
        return userProfile;
    }
    const homeDrive = normalizeText(env.HOMEDRIVE);
    const homePath = normalizeText(env.HOMEPATH);
    return homeDrive && homePath ? `${homeDrive}${homePath}` : '';
}
function readJsonFileSync(filePath) {
    try {
        const raw = node_fs_1.default.readFileSync(filePath, 'utf8');
        return JSON.parse(raw);
    }
    catch (error) {
        const code = error.code;
        if (code === 'ENOENT' || error instanceof SyntaxError) {
            return null;
        }
        throw error;
    }
}
function normalizeRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value;
}
function normalizeIndexedHomeDirs(value) {
    const record = normalizeRecord(value);
    const profiles = Array.isArray(record?.profiles) ? record.profiles : [];
    const indexedHomeDirs = new Set();
    for (const entry of profiles) {
        const normalized = normalizeRecord(entry);
        const homeDir = normalizeText(normalized?.homeDir);
        if (homeDir) {
            indexedHomeDirs.add(node_path_1.default.resolve(homeDir));
        }
    }
    return indexedHomeDirs;
}
function normalizeSystemHomeDir(env, cwd) {
    const home = normalizeText(env.HOME)
        || normalizeWindowsProfileHome(env)
        || normalizeText(process.env.HOME)
        || normalizeWindowsProfileHome(process.env)
        || normalizeText(node_os_1.default.homedir());
    const fallback = normalizeText(cwd);
    const systemHomeDir = node_path_1.default.resolve(home || fallback);
    if (!systemHomeDir) {
        throw new Error('A system home directory is required.');
    }
    return systemHomeDir;
}
function resolveMetabotManagerLayout(systemHomeDir) {
    const normalizedSystemHome = normalizeText(systemHomeDir);
    if (!normalizedSystemHome) {
        throw new Error('A system home directory is required to resolve the metabot manager layout.');
    }
    const resolvedSystemHome = node_path_1.default.resolve(normalizedSystemHome);
    const metabotRoot = node_path_1.default.join(resolvedSystemHome, '.metabot');
    const managerPaths = (0, identityProfiles_1.resolveIdentityManagerPaths)(resolvedSystemHome);
    return {
        systemHomeDir: resolvedSystemHome,
        metabotRoot,
        managerRoot: managerPaths.managerRoot,
        skillsRoot: node_path_1.default.join(metabotRoot, 'skills'),
        profilesRoot: node_path_1.default.join(metabotRoot, 'profiles'),
        identityProfilesPath: managerPaths.profilesPath,
    };
}
function hasLegacyOnlyMetabotLayout(systemHomeDir) {
    const layout = resolveMetabotManagerLayout(systemHomeDir);
    const legacyHotRoot = node_path_1.default.join(layout.metabotRoot, 'hot');
    return (node_fs_1.default.existsSync(legacyHotRoot)
        && !node_fs_1.default.existsSync(layout.managerRoot)
        && !node_fs_1.default.existsSync(layout.profilesRoot));
}
function assertNoLegacyOnlyLayout(systemHomeDir) {
    if (!hasLegacyOnlyMetabotLayout(systemHomeDir)) {
        return;
    }
    throw new Error('Legacy pre-v2 MetaBot layout detected. This pre-release layout change is not migrated automatically; clean or reinitialize the local MetaBot root before using v2.');
}
function isDirectProfileHome(profilesRoot, candidateHomeDir) {
    return node_path_1.default.dirname(candidateHomeDir) === profilesRoot;
}
function validateExplicitMetabotHome(input) {
    const layout = resolveMetabotManagerLayout(input.systemHomeDir);
    const normalizedHomeDir = node_path_1.default.resolve(normalizeText(input.homeDir));
    if (!normalizedHomeDir) {
        throw new Error('METABOT_HOME must not be empty.');
    }
    if (!isDirectProfileHome(layout.profilesRoot, normalizedHomeDir)) {
        throw new Error(`METABOT_HOME must point to ~/.metabot/profiles/<slug>, received: ${normalizedHomeDir}`);
    }
    if (input.allowUnindexedExplicitHome === true) {
        return normalizedHomeDir;
    }
    const indexedHomeDirs = normalizeIndexedHomeDirs(readJsonFileSync(layout.identityProfilesPath));
    if (!indexedHomeDirs.has(normalizedHomeDir)) {
        throw new Error(`METABOT_HOME must point to a manager-indexed profile for existing-profile operations, received unindexed profile: ${normalizedHomeDir}`);
    }
    return normalizedHomeDir;
}
/**
 * The machine default Bot is the Twin Bot (see core/bot/twinRole.ts); there is
 * no separate active-home pointer anymore. Resolved sync from the manager
 * index plus each profile's bot-role.json: the twin's home, else the
 * earliest-created profile's (the same pick the twin invariant's repair
 * makes), else null when no indexed profiles exist. A stale manager-level
 * active-home.json from older versions is deliberately not consulted.
 */
function resolveIndexedTwinHome(systemHomeDir) {
    const layout = resolveMetabotManagerLayout(systemHomeDir);
    const record = normalizeRecord(readJsonFileSync(layout.identityProfilesPath));
    const rawProfiles = Array.isArray(record?.profiles) ? record.profiles : [];
    let twinHome = null;
    let earliest = null;
    for (const rawEntry of rawProfiles) {
        const entry = normalizeRecord(rawEntry);
        const homeDirRaw = normalizeText(entry?.homeDir);
        if (!homeDirRaw)
            continue;
        const homeDir = node_path_1.default.resolve(homeDirRaw);
        if (!isDirectProfileHome(layout.profilesRoot, homeDir))
            continue;
        if (!twinHome) {
            const role = normalizeRecord(readJsonFileSync((0, paths_1.resolveMetabotPaths)(homeDir).botRoleStatePath));
            if (role?.botType === 'twin') {
                twinHome = homeDir;
            }
        }
        const createdAt = typeof entry?.createdAt === 'number' && Number.isFinite(entry.createdAt)
            ? entry.createdAt
            : Number.POSITIVE_INFINITY;
        if (!earliest || createdAt < earliest.createdAt) {
            earliest = { homeDir, createdAt };
        }
    }
    return twinHome ?? earliest?.homeDir ?? null;
}
function resolveMetabotHomeSelection(input) {
    const systemHomeDir = normalizeSystemHomeDir(input.env, input.cwd);
    assertNoLegacyOnlyLayout(systemHomeDir);
    const explicitHome = normalizeText(input.env.METABOT_HOME);
    if (explicitHome) {
        const homeDir = validateExplicitMetabotHome({
            systemHomeDir,
            homeDir: explicitHome,
            allowUnindexedExplicitHome: input.allowUnindexedExplicitHome,
        });
        return {
            systemHomeDir,
            homeDir,
            paths: (0, paths_1.resolveMetabotPaths)(homeDir),
            source: 'explicit',
        };
    }
    const twinHomeDir = resolveIndexedTwinHome(systemHomeDir);
    if (!twinHomeDir) {
        throw new Error('No Twin Bot initialized.');
    }
    return {
        systemHomeDir,
        homeDir: twinHomeDir,
        paths: (0, paths_1.resolveMetabotPaths)(twinHomeDir),
        source: 'twin',
    };
}
function resolveMetabotHomeSelectionSync(input) {
    return resolveMetabotHomeSelection(input);
}
