"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureProfileWorkspace = ensureProfileWorkspace;
exports.resolveIdentityCreateProfileHome = resolveIdentityCreateProfileHome;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const configTypes_1 = require("../config/configTypes");
const profileNameResolution_1 = require("./profileNameResolution");
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function resolveProfilesRoot(systemHomeDir) {
    return node_path_1.default.join(node_path_1.default.resolve(normalizeText(systemHomeDir)), '.metabot', 'profiles');
}
function resolveCanonicalProfileHome(systemHomeDir, slug) {
    return node_path_1.default.join(resolveProfilesRoot(systemHomeDir), slug);
}
async function ensureDirectory(dirPath) {
    await node_fs_1.promises.mkdir(dirPath, { recursive: true });
}
async function writeFileIfMissing(filePath, content) {
    try {
        await node_fs_1.promises.access(filePath);
    }
    catch (error) {
        const code = error.code;
        if (code !== 'ENOENT') {
            throw error;
        }
        await node_fs_1.promises.writeFile(filePath, content, 'utf8');
    }
}
function buildStarterFiles(name) {
    return {
        'AGENTS.md': [
            '# Agent Instructions',
            '',
            '- Keep profile-specific operating rules here.',
            '- Update this file intentionally when the profile behavior changes.',
            '',
        ].join('\n'),
        'SOUL.md': [
            `# ${name}`,
            '',
            'Describe the persona, tone, boundaries, and communication style for this MetaBot here.',
            '',
        ].join('\n'),
        'IDENTITY.md': [
            `# ${name}`,
            '',
            `Display name: ${name}`,
            '',
            'Capture the public-facing identity summary for this MetaBot here.',
            '',
        ].join('\n'),
        'USER.md': [
            '# User',
            '',
            'Store stable facts and preferences about the primary user here.',
            '',
        ].join('\n'),
        'MEMORY.md': [
            '# Memory',
            '',
            'Store curated long-term memory for this MetaBot here.',
            '',
        ].join('\n'),
    };
}
function buildDuplicateNameMessage(requestedName, matchedProfile) {
    return `Local MetaBot name "${requestedName}" already exists. Use metabot identity assign --name "${matchedProfile.name}".`;
}
function reserveAvailableSlug(baseSlug, profiles) {
    const usedSlugs = new Set(profiles
        .map((profile) => normalizeText(profile.slug) || node_path_1.default.basename(normalizeText(profile.homeDir)))
        .filter(Boolean));
    if (!usedSlugs.has(baseSlug)) {
        return baseSlug;
    }
    let suffix = 2;
    while (usedSlugs.has(`${baseSlug}-${suffix}`)) {
        suffix += 1;
    }
    return `${baseSlug}-${suffix}`;
}
async function ensureProfileWorkspace(input) {
    const homeDir = node_path_1.default.resolve(normalizeText(input.homeDir));
    const name = normalizeText(input.name) || 'MetaBot';
    if (!homeDir) {
        throw new Error('Profile workspace requires a non-empty homeDir.');
    }
    await Promise.all([
        ensureDirectory(homeDir),
        ensureDirectory(node_path_1.default.join(homeDir, 'memory')),
        ensureDirectory(node_path_1.default.join(homeDir, '.runtime')),
        ensureDirectory(node_path_1.default.join(homeDir, '.runtime', 'sessions')),
        ensureDirectory(node_path_1.default.join(homeDir, '.runtime', 'evolution')),
        ensureDirectory(node_path_1.default.join(homeDir, '.runtime', 'exports')),
        ensureDirectory(node_path_1.default.join(homeDir, '.runtime', 'state')),
        ensureDirectory(node_path_1.default.join(homeDir, '.runtime', 'locks')),
    ]);
    const starterFiles = buildStarterFiles(name);
    await Promise.all(Object.entries(starterFiles).map(([relativePath, content]) => (writeFileIfMissing(node_path_1.default.join(homeDir, relativePath), content))));
    await writeFileIfMissing(node_path_1.default.join(homeDir, '.runtime', 'config.json'), `${JSON.stringify((0, configTypes_1.createDefaultConfig)(), null, 2)}\n`);
}
function resolveIdentityCreateProfileHome(input) {
    const requestedName = normalizeText(input.requestedName);
    if (!requestedName) {
        return {
            status: 'duplicate',
            message: 'MetaBot identity name is required.',
        };
    }
    const duplicateMatch = (0, profileNameResolution_1.resolveProfileNameMatch)(requestedName, input.profiles);
    if (duplicateMatch.status === 'matched' && duplicateMatch.matchType !== 'ranked') {
        return {
            status: 'duplicate',
            message: buildDuplicateNameMessage(requestedName, duplicateMatch.match),
        };
    }
    if (duplicateMatch.status === 'ambiguous') {
        return {
            status: 'duplicate',
            message: duplicateMatch.message,
        };
    }
    const slug = reserveAvailableSlug((0, profileNameResolution_1.generateProfileSlug)(requestedName), input.profiles);
    return {
        status: 'resolved',
        slug,
        homeDir: resolveCanonicalProfileHome(input.systemHomeDir, slug),
    };
}
