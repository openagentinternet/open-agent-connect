"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveProviderSkillRoot = resolveProviderSkillRoot;
exports.injectSkills = injectSkills;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const platformRegistry_1 = require("../../platform/platformRegistry");
const FALLBACK_SKILL_ROOT = node_path_1.default.join('.agent_context', 'skills');
function resolveProviderSkillRoot(provider, cwd, options = {}) {
    if ((0, platformRegistry_1.isPlatformId)(provider)) {
        const projectRoot = (0, platformRegistry_1.getProjectSkillRoot)(provider);
        if (projectRoot)
            return node_path_1.default.resolve(cwd, projectRoot.path);
        const systemHomeDir = normalizeOptionalPath(options.systemHomeDir);
        if (systemHomeDir) {
            const globalRoot = (0, platformRegistry_1.getPlatformSkillRoots)(provider).find((root) => root.kind === 'global');
            if (globalRoot) {
                return (0, platformRegistry_1.resolvePlatformSkillRootPath)(globalRoot, systemHomeDir, options.env);
            }
        }
    }
    return node_path_1.default.resolve(cwd, FALLBACK_SKILL_ROOT);
}
function assertSafeSkillName(skillName) {
    if (!skillName || skillName.includes('/') || skillName.includes('\\') || skillName.includes('..')) {
        throw new Error(`Unsafe skill name: ${skillName}`);
    }
}
function normalizeOptionalPath(value) {
    return typeof value === 'string' ? value.trim() : '';
}
async function findReadableSkillSource(input, skillName) {
    const explicitSource = normalizeOptionalPath(input.skillSourcePaths?.[skillName]);
    const candidates = [
        explicitSource,
        node_path_1.default.join(input.skillsRoot, skillName),
    ].filter(Boolean);
    const errors = [];
    for (const candidate of candidates) {
        try {
            await node_fs_1.promises.access(candidate);
            return candidate;
        }
        catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
        }
    }
    throw new Error(errors[0] ?? `Skill source not found: ${skillName}`);
}
// Cheap change detection for one skill directory: a sorted listing of
// "relativePath:mtime:size" entries for every file in the tree. Copies are
// made with preserveTimestamps, so an unchanged source fingerprints
// identically to its injected copy and each turn only pays a stat pass.
// mtimes are compared at whole-millisecond precision because fs.cp restores
// timestamps through Date values, which round sub-millisecond fractions to
// the nearest millisecond; rounding both sides keeps an unchanged copy
// fingerprint-identical to its source.
// Content hashing would also catch mtime-preserving external edits, but it
// costs a full read of every file on every chat turn, which is not worth it
// for docs-plus-scripts skill trees.
async function fingerprintSkillTree(rootDir) {
    const parts = [];
    const walk = async (relativeDir) => {
        const entries = await node_fs_1.promises.readdir(node_path_1.default.join(rootDir, relativeDir), { withFileTypes: true });
        for (const entry of entries) {
            const relativePath = relativeDir ? node_path_1.default.join(relativeDir, entry.name) : entry.name;
            if (entry.isDirectory()) {
                await walk(relativePath);
                continue;
            }
            const stat = await node_fs_1.promises.stat(node_path_1.default.join(rootDir, relativePath)).catch(() => null);
            if (stat?.isFile()) {
                parts.push(`${relativePath}:${Math.round(stat.mtimeMs)}:${stat.size}`);
            }
        }
    };
    try {
        await walk('');
    }
    catch {
        return null;
    }
    return parts.sort().join('\n');
}
// Swap a skill directory without ever exposing a half-copied tree under its
// real name: copy into a dot-prefixed sibling, move any previous copy aside,
// put the new one in place, then drop the old copy. A crash can leave
// dot-prefixed temp dirs behind (skill discovery ignores them), but never a
// partially written skill.
async function replaceSkillDir(srcDir, dstDir) {
    const parentDir = node_path_1.default.dirname(dstDir);
    const stamp = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const incomingDir = node_path_1.default.join(parentDir, `.${node_path_1.default.basename(dstDir)}.incoming-${stamp}`);
    const replacedDir = node_path_1.default.join(parentDir, `.${node_path_1.default.basename(dstDir)}.replaced-${stamp}`);
    await node_fs_1.promises.cp(srcDir, incomingDir, { recursive: true, preserveTimestamps: true });
    let movedAside = false;
    try {
        await node_fs_1.promises.rename(dstDir, replacedDir);
        movedAside = true;
    }
    catch (error) {
        if (error.code !== 'ENOENT') {
            await node_fs_1.promises.rm(incomingDir, { recursive: true, force: true }).catch(() => undefined);
            throw error;
        }
    }
    try {
        await node_fs_1.promises.rename(incomingDir, dstDir);
    }
    catch (error) {
        if (movedAside) {
            await node_fs_1.promises.rename(replacedDir, dstDir).catch(() => undefined);
        }
        await node_fs_1.promises.rm(incomingDir, { recursive: true, force: true }).catch(() => undefined);
        throw error;
    }
    if (movedAside) {
        await node_fs_1.promises.rm(replacedDir, { recursive: true, force: true }).catch(() => undefined);
    }
}
async function injectSkills(input) {
    const skillRoot = resolveProviderSkillRoot(input.provider, input.cwd, {
        systemHomeDir: input.systemHomeDir,
        env: input.env,
    });
    await node_fs_1.promises.mkdir(skillRoot, { recursive: true });
    const injected = [];
    const errors = [];
    for (const skillName of input.skills) {
        try {
            assertSafeSkillName(skillName);
            const srcDir = await findReadableSkillSource(input, skillName);
            const dstDir = node_path_1.default.join(skillRoot, skillName);
            if (node_path_1.default.resolve(srcDir) === node_path_1.default.resolve(dstDir)) {
                injected.push(skillName);
                continue;
            }
            // Refresh-on-change: an existing destination is reused only while its
            // fingerprint still matches the source, so skill updates reach the
            // persistent chat workspace and cached strict-isolation scopes instead
            // of serving a stale copy forever.
            const [srcFingerprint, dstFingerprint] = await Promise.all([
                fingerprintSkillTree(srcDir),
                fingerprintSkillTree(dstDir),
            ]);
            if (srcFingerprint !== null && srcFingerprint === dstFingerprint) {
                injected.push(skillName);
                continue;
            }
            await replaceSkillDir(srcDir, dstDir);
            injected.push(skillName);
        }
        catch (error) {
            errors.push({ skill: skillName, error: error instanceof Error ? error.message : String(error) });
        }
    }
    return { injected, errors };
}
