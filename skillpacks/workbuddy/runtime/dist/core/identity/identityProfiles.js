"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveIdentityManagerPaths = resolveIdentityManagerPaths;
exports.readIdentityProfilesState = readIdentityProfilesState;
exports.listIdentityProfiles = listIdentityProfiles;
exports.upsertIdentityProfile = upsertIdentityProfile;
exports.deleteIdentityProfile = deleteIdentityProfile;
exports.readActiveMetabotHomeSync = readActiveMetabotHomeSync;
exports.readActiveMetabotHome = readActiveMetabotHome;
exports.setActiveMetabotHome = setActiveMetabotHome;
const node_fs_1 = __importDefault(require("node:fs"));
const node_fs_2 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const profileNameResolution_1 = require("./profileNameResolution");
const MANAGER_DIR = 'manager';
const PROFILES_FILE = 'identity-profiles.json';
const ACTIVE_HOME_FILE = 'active-home.json';
const TRANSIENT_JSON_READ_RETRIES = 5;
const TRANSIENT_JSON_READ_DELAY_MS = 10;
let atomicWriteSequence = 0;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function toFiniteNumber(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }
    return value;
}
function normalizeRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value;
}
function resolveProfilesRoot(systemHomeDir) {
    return node_path_1.default.join(node_path_1.default.resolve(systemHomeDir), '.metabot', 'profiles');
}
function resolveCanonicalProfileHome(systemHomeDir, slug) {
    return node_path_1.default.join(resolveProfilesRoot(systemHomeDir), slug);
}
function isCanonicalProfileHome(systemHomeDir, homeDir) {
    return node_path_1.default.dirname(homeDir) === resolveProfilesRoot(systemHomeDir);
}
function normalizeAliases(value) {
    return Array.isArray(value)
        ? value
            .map((entry) => normalizeText(entry))
            .filter(Boolean)
        : [];
}
function resolveStableProfileSlug(systemHomeDir, profile) {
    if (isCanonicalProfileHome(systemHomeDir, profile.homeDir)) {
        return node_path_1.default.basename(profile.homeDir);
    }
    return normalizeText(profile.slug) || (0, profileNameResolution_1.generateProfileSlug)(profile.name);
}
function normalizeProfileRecord(systemHomeDir, value) {
    const record = normalizeRecord(value);
    if (!record) {
        return null;
    }
    const name = normalizeText(record.name);
    const homeDirRaw = normalizeText(record.homeDir);
    const resolvedHomeDir = homeDirRaw ? node_path_1.default.resolve(homeDirRaw) : '';
    const recordSlug = normalizeText(record.slug);
    const globalMetaId = normalizeText(record.globalMetaId);
    const mvcAddress = normalizeText(record.mvcAddress);
    const existingAliases = normalizeAliases(record.aliases);
    const createdAt = toFiniteNumber(record.createdAt) ?? Date.now();
    const updatedAt = toFiniteNumber(record.updatedAt) ?? createdAt;
    if (!name || !resolvedHomeDir) {
        return null;
    }
    const slug = resolveStableProfileSlug(systemHomeDir, {
        name,
        slug: recordSlug,
        homeDir: resolvedHomeDir,
    });
    const aliases = (0, profileNameResolution_1.buildProfileAliases)(name, slug, existingAliases);
    const homeDir = resolveCanonicalProfileHome(systemHomeDir, slug);
    return {
        name,
        slug,
        aliases,
        homeDir,
        globalMetaId,
        mvcAddress,
        createdAt,
        updatedAt,
    };
}
function sortProfiles(profiles) {
    return [...profiles].sort((left, right) => {
        if (right.updatedAt !== left.updatedAt) {
            return right.updatedAt - left.updatedAt;
        }
        return left.name.localeCompare(right.name);
    });
}
function reserveUniqueProfileSlug(slug, usedSlugs) {
    if (!usedSlugs.has(slug)) {
        usedSlugs.add(slug);
        return slug;
    }
    const match = slug.match(/^(.*?)-(\d+)$/);
    const baseSlug = match?.[1] || slug;
    let suffix = 2;
    while (usedSlugs.has(`${baseSlug}-${suffix}`)) {
        suffix += 1;
    }
    const uniqueSlug = `${baseSlug}-${suffix}`;
    usedSlugs.add(uniqueSlug);
    return uniqueSlug;
}
function normalizeProfilesState(systemHomeDir, value) {
    const record = normalizeRecord(value);
    if (!record) {
        return { profiles: [] };
    }
    const profiles = Array.isArray(record.profiles)
        ? record.profiles
            .map((entry) => normalizeProfileRecord(systemHomeDir, entry))
            .filter((entry) => Boolean(entry))
        : [];
    const usedSlugs = new Set();
    const normalizedProfiles = sortProfiles(profiles).map((profile) => {
        const uniqueSlug = reserveUniqueProfileSlug(profile.slug, usedSlugs);
        return {
            ...profile,
            slug: uniqueSlug,
            aliases: (0, profileNameResolution_1.buildProfileAliases)(profile.name, uniqueSlug, profile.aliases),
            homeDir: resolveCanonicalProfileHome(systemHomeDir, uniqueSlug),
        };
    });
    return {
        profiles: sortProfiles(normalizedProfiles),
    };
}
async function readJsonFile(filePath) {
    for (let attempt = 0; attempt <= TRANSIENT_JSON_READ_RETRIES; attempt += 1) {
        try {
            const raw = await node_fs_2.promises.readFile(filePath, 'utf8');
            return JSON.parse(raw);
        }
        catch (error) {
            const code = error.code;
            if (code === 'ENOENT') {
                return null;
            }
            if (error instanceof SyntaxError && attempt < TRANSIENT_JSON_READ_RETRIES) {
                await new Promise((resolve) => setTimeout(resolve, TRANSIENT_JSON_READ_DELAY_MS));
                continue;
            }
            throw error;
        }
    }
    return null;
}
async function ensureManagerRoot(paths) {
    await node_fs_2.promises.mkdir(paths.managerRoot, { recursive: true });
}
function serializeProfilesState(state) {
    return `${JSON.stringify(state, null, 2)}\n`;
}
function createAtomicWriteTempPath(filePath) {
    atomicWriteSequence += 1;
    return `${filePath}.${process.pid}.${Date.now()}.${atomicWriteSequence}.tmp`;
}
async function writeFileAtomic(filePath, content) {
    const tempPath = createAtomicWriteTempPath(filePath);
    try {
        await node_fs_2.promises.writeFile(tempPath, content, 'utf8');
        await node_fs_2.promises.rename(tempPath, filePath);
    }
    catch (error) {
        await node_fs_2.promises.rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
    }
}
function resolveIdentityManagerPaths(systemHomeDir) {
    const normalizedSystemHome = normalizeText(systemHomeDir);
    if (!normalizedSystemHome) {
        throw new Error('A system home directory is required to resolve identity manager paths.');
    }
    const managerRoot = node_path_1.default.join(node_path_1.default.resolve(normalizedSystemHome), '.metabot', MANAGER_DIR);
    return {
        managerRoot,
        profilesPath: node_path_1.default.join(managerRoot, PROFILES_FILE),
        activeHomePath: node_path_1.default.join(managerRoot, ACTIVE_HOME_FILE),
    };
}
async function readIdentityProfilesState(systemHomeDir) {
    const paths = resolveIdentityManagerPaths(systemHomeDir);
    await ensureManagerRoot(paths);
    const parsed = await readJsonFile(paths.profilesPath);
    const normalized = normalizeProfilesState(systemHomeDir, parsed);
    if (parsed !== null && JSON.stringify(parsed) !== JSON.stringify(normalized)) {
        await writeFileAtomic(paths.profilesPath, serializeProfilesState(normalized));
    }
    return normalized;
}
async function writeIdentityProfilesState(systemHomeDir, state) {
    const paths = resolveIdentityManagerPaths(systemHomeDir);
    await ensureManagerRoot(paths);
    const normalized = normalizeProfilesState(systemHomeDir, state);
    await writeFileAtomic(paths.profilesPath, serializeProfilesState(normalized));
    return normalized;
}
async function listIdentityProfiles(systemHomeDir) {
    const state = await readIdentityProfilesState(systemHomeDir);
    return state.profiles;
}
async function upsertIdentityProfile(input) {
    const now = input.now ?? Date.now;
    const name = normalizeText(input.name);
    const nextSlug = (0, profileNameResolution_1.generateProfileSlug)(name);
    const inputHomeDir = node_path_1.default.resolve(normalizeText(input.homeDir));
    const globalMetaId = normalizeText(input.globalMetaId);
    const mvcAddress = normalizeText(input.mvcAddress);
    if (!name || !inputHomeDir) {
        throw new Error('Identity profile upsert requires both name and homeDir.');
    }
    const current = await readIdentityProfilesState(input.systemHomeDir);
    const timestamp = now();
    let updated = null;
    const nextProfiles = current.profiles.map((profile) => {
        if (profile.homeDir === inputHomeDir
            || (globalMetaId && profile.globalMetaId && profile.globalMetaId === globalMetaId)) {
            const stableSlug = resolveStableProfileSlug(input.systemHomeDir, profile);
            const stableHomeDir = resolveCanonicalProfileHome(input.systemHomeDir, stableSlug);
            updated = {
                ...profile,
                name,
                slug: stableSlug,
                aliases: (0, profileNameResolution_1.buildProfileAliases)(name, stableSlug, profile.aliases),
                homeDir: stableHomeDir,
                globalMetaId: globalMetaId || profile.globalMetaId,
                mvcAddress: mvcAddress || profile.mvcAddress,
                updatedAt: timestamp,
            };
            return updated;
        }
        return profile;
    });
    if (!updated) {
        const stableHomeDir = isCanonicalProfileHome(input.systemHomeDir, inputHomeDir)
            ? inputHomeDir
            : resolveCanonicalProfileHome(input.systemHomeDir, nextSlug);
        const stableSlug = node_path_1.default.basename(stableHomeDir);
        updated = {
            name,
            slug: stableSlug,
            aliases: (0, profileNameResolution_1.buildProfileAliases)(name, stableSlug),
            homeDir: stableHomeDir,
            globalMetaId,
            mvcAddress,
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        nextProfiles.push(updated);
    }
    await writeIdentityProfilesState(input.systemHomeDir, {
        profiles: nextProfiles,
    });
    return updated;
}
async function deleteIdentityProfile(input) {
    const slug = normalizeText(input.slug);
    if (!slug) {
        throw new Error('Identity profile delete requires a non-empty slug.');
    }
    const current = await readIdentityProfilesState(input.systemHomeDir);
    const deleted = current.profiles.find((profile) => profile.slug === slug) ?? null;
    if (!deleted) {
        return null;
    }
    await writeIdentityProfilesState(input.systemHomeDir, {
        profiles: current.profiles.filter((profile) => profile.slug !== slug),
    });
    const paths = resolveIdentityManagerPaths(input.systemHomeDir);
    const activeHome = parseActiveHomePayload(await readJsonFile(paths.activeHomePath));
    if (activeHome && node_path_1.default.resolve(activeHome) === node_path_1.default.resolve(deleted.homeDir)) {
        await node_fs_2.promises.rm(paths.activeHomePath, { force: true });
    }
    return deleted;
}
function parseActiveHomePayload(value) {
    const record = normalizeRecord(value);
    if (!record) {
        return null;
    }
    const homeDirRaw = normalizeText(record.homeDir);
    if (!homeDirRaw) {
        return null;
    }
    return node_path_1.default.resolve(homeDirRaw);
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
function validateActiveHome(systemHomeDir, homeDir, profilesState) {
    if (!homeDir || !isCanonicalProfileHome(systemHomeDir, homeDir)) {
        return null;
    }
    return profilesState.profiles.some((profile) => profile.homeDir === homeDir) ? homeDir : null;
}
function readActiveMetabotHomeSync(systemHomeDir) {
    const paths = resolveIdentityManagerPaths(systemHomeDir);
    try {
        const parsed = readJsonFileSync(paths.activeHomePath);
        const profilesState = normalizeProfilesState(systemHomeDir, readJsonFileSync(paths.profilesPath));
        return validateActiveHome(systemHomeDir, parseActiveHomePayload(parsed), profilesState);
    }
    catch (error) {
        const code = error.code;
        if (code === 'ENOENT' || error instanceof SyntaxError) {
            return null;
        }
        return null;
    }
}
async function readActiveMetabotHome(systemHomeDir) {
    const paths = resolveIdentityManagerPaths(systemHomeDir);
    await ensureManagerRoot(paths);
    const [parsed, profilesState] = await Promise.all([
        readJsonFile(paths.activeHomePath),
        readIdentityProfilesState(systemHomeDir),
    ]);
    return validateActiveHome(systemHomeDir, parseActiveHomePayload(parsed), profilesState);
}
async function setActiveMetabotHome(input) {
    const now = input.now ?? Date.now;
    const homeDir = node_path_1.default.resolve(normalizeText(input.homeDir));
    if (!homeDir) {
        throw new Error('Active metabot home requires a non-empty homeDir.');
    }
    const paths = resolveIdentityManagerPaths(input.systemHomeDir);
    await ensureManagerRoot(paths);
    await writeFileAtomic(paths.activeHomePath, `${JSON.stringify({ homeDir, updatedAt: now() }, null, 2)}\n`);
    return homeDir;
}
