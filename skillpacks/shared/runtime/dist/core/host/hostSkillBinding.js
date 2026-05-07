"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HostSkillBindingError = void 0;
exports.bindPlatformSkills = bindPlatformSkills;
exports.bindHostSkills = bindHostSkills;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const platformRegistry_1 = require("../platform/platformRegistry");
class HostSkillBindingError extends Error {
    code;
    data;
    constructor(code, message, data) {
        super(message);
        this.name = 'HostSkillBindingError';
        this.code = code;
        this.data = data;
    }
}
exports.HostSkillBindingError = HostSkillBindingError;
function toRelativeSymlinkTarget(destinationPath, sourcePath) {
    return node_path_1.default.relative(node_path_1.default.dirname(destinationPath), sourcePath) || '.';
}
async function ensureHostSkillRoot(input) {
    const { platformId, rootId, hostSkillRoot } = input;
    try {
        await node_fs_1.promises.mkdir(hostSkillRoot, { recursive: true });
        const stat = await node_fs_1.promises.stat(hostSkillRoot);
        if (!stat.isDirectory()) {
            throw new Error('Resolved host skill root is not a directory.');
        }
    }
    catch (error) {
        throw new HostSkillBindingError('host_skill_root_unresolved', `Unable to resolve the ${platformId} skill root: ${hostSkillRoot}`, {
            host: platformId,
            platformId,
            rootId,
            hostSkillRoot,
            reason: error instanceof Error ? error.message : String(error),
        });
    }
}
async function listSharedMetabotSkills(sharedSkillRoot) {
    try {
        const entries = await node_fs_1.promises.readdir(sharedSkillRoot, { withFileTypes: true });
        return entries
            .filter((entry) => entry.isDirectory() && entry.name.startsWith('metabot-'))
            .map((entry) => entry.name)
            .sort();
    }
    catch (error) {
        const code = error.code;
        if (code === 'ENOENT') {
            return [];
        }
        throw new HostSkillBindingError('host_skill_bind_failed', `Unable to list shared MetaBot skills under ${sharedSkillRoot}.`, {
            sharedSkillRoot,
            failedPath: sharedSkillRoot,
            reason: error instanceof Error ? error.message : String(error),
        });
    }
}
async function inspectDestinationHostPath(input) {
    const { skillName, sourceSharedSkillPath, destinationHostPath } = input;
    try {
        const existing = await node_fs_1.promises.lstat(destinationHostPath);
        if (existing.isSymbolicLink()) {
            try {
                const target = await node_fs_1.promises.readlink(destinationHostPath);
                return {
                    kind: 'symlink',
                    resolvedTarget: node_path_1.default.resolve(node_path_1.default.dirname(destinationHostPath), target),
                };
            }
            catch (error) {
                throw new HostSkillBindingError('host_skill_bind_failed', `Unable to inspect destination host skill path for ${skillName}.`, {
                    sourceSharedSkillPath,
                    destinationHostPath,
                    reason: error instanceof Error ? error.message : String(error),
                });
            }
        }
        if (existing.isDirectory()) {
            return { kind: 'directory' };
        }
        return { kind: 'other' };
    }
    catch (error) {
        const code = error.code;
        if (code === 'ENOENT') {
            return { kind: 'missing' };
        }
        if (error instanceof HostSkillBindingError) {
            throw error;
        }
        throw new HostSkillBindingError('host_skill_bind_failed', `Unable to inspect destination host skill path for ${skillName}.`, {
            sourceSharedSkillPath,
            destinationHostPath,
            reason: error instanceof Error ? error.message : String(error),
        });
    }
}
async function preflightDestinationHostPath(input) {
    const { skillName, sourceSharedSkillPath, destinationHostPath, existingDestination, } = input;
    if (existingDestination.kind === 'other') {
        throw new HostSkillBindingError('host_skill_bind_failed', `Unable to bind ${skillName} because the destination host path is not replaceable.`, {
            sourceSharedSkillPath,
            destinationHostPath,
        });
    }
}
async function bindOneSkill(input) {
    const { skillName, sourceSharedSkillPath, destinationHostPath, replacedEntries, unchangedEntries, existingDestination, } = input;
    if (existingDestination.kind === 'symlink') {
        try {
            if (existingDestination.resolvedTarget === sourceSharedSkillPath) {
                unchangedEntries.push(skillName);
                return;
            }
            await node_fs_1.promises.unlink(destinationHostPath);
            replacedEntries.push(skillName);
        }
        catch (error) {
            throw new HostSkillBindingError('host_skill_bind_failed', `Unable to refresh host symlink for ${skillName}.`, {
                sourceSharedSkillPath,
                destinationHostPath,
                reason: error instanceof Error ? error.message : String(error),
            });
        }
    }
    else if (existingDestination.kind === 'directory') {
        try {
            await node_fs_1.promises.rm(destinationHostPath, { recursive: true, force: true });
            replacedEntries.push(skillName);
        }
        catch (error) {
            throw new HostSkillBindingError('host_skill_bind_failed', `Unable to replace copied host skill directory for ${skillName}.`, {
                sourceSharedSkillPath,
                destinationHostPath,
                reason: error instanceof Error ? error.message : String(error),
            });
        }
    }
    try {
        await node_fs_1.promises.symlink(toRelativeSymlinkTarget(destinationHostPath, sourceSharedSkillPath), destinationHostPath, 'dir');
    }
    catch (error) {
        throw new HostSkillBindingError('host_skill_bind_failed', `Unable to bind ${skillName} into the host skill root.`, {
            sourceSharedSkillPath,
            destinationHostPath,
            reason: error instanceof Error ? error.message : String(error),
        });
    }
}
async function parentExists(hostSkillRoot) {
    try {
        const stat = await node_fs_1.promises.stat(node_path_1.default.dirname(hostSkillRoot));
        return stat.isDirectory();
    }
    catch {
        return false;
    }
}
function rootResult(input) {
    return {
        platformId: input.root.platformId,
        rootId: input.root.id,
        hostSkillRoot: input.hostSkillRoot,
        status: input.status,
        reason: input.reason,
        boundSkills: input.boundSkills ?? [],
        replacedEntries: input.replacedEntries ?? [],
        unchangedEntries: input.unchangedEntries ?? [],
    };
}
async function bindOneRoot(input) {
    const { root, hostSkillRoot, sharedSkillRoot, boundSkills } = input;
    await ensureHostSkillRoot({
        platformId: root.platformId,
        rootId: root.id,
        hostSkillRoot,
    });
    const bindingPlan = await Promise.all(boundSkills.map(async (skillName) => {
        const sourceSharedSkillPath = node_path_1.default.join(sharedSkillRoot, skillName);
        const destinationHostPath = node_path_1.default.join(hostSkillRoot, skillName);
        const existingDestination = await inspectDestinationHostPath({
            skillName,
            sourceSharedSkillPath,
            destinationHostPath,
        });
        await preflightDestinationHostPath({
            skillName,
            sourceSharedSkillPath,
            destinationHostPath,
            existingDestination,
        });
        return {
            skillName,
            sourceSharedSkillPath,
            destinationHostPath,
            existingDestination,
        };
    }));
    const replacedEntries = [];
    const unchangedEntries = [];
    for (const plan of bindingPlan) {
        await bindOneSkill({
            skillName: plan.skillName,
            sourceSharedSkillPath: plan.sourceSharedSkillPath,
            destinationHostPath: plan.destinationHostPath,
            replacedEntries,
            unchangedEntries,
            existingDestination: plan.existingDestination,
        });
    }
    return rootResult({
        root,
        hostSkillRoot,
        status: 'bound',
        boundSkills,
        replacedEntries,
        unchangedEntries,
    });
}
function getRootsForInput(input) {
    if (input.mode === 'force-platform') {
        if (!input.host || !(0, platformRegistry_1.isPlatformId)(input.host)) {
            throw new HostSkillBindingError('host_skill_root_unresolved', 'A valid host is required for force-platform skill binding.', { host: input.host });
        }
        return (0, platformRegistry_1.getPlatformSkillRoots)(input.host)
            .filter((root) => root.kind === 'global')
            .map((root) => ({ ...root, platformId: input.host }));
    }
    return (0, platformRegistry_1.getInstallSkillRoots)();
}
async function bindPlatformSkills(input) {
    const systemHomeDir = node_path_1.default.resolve(input.systemHomeDir);
    const sharedSkillRoot = node_path_1.default.join(systemHomeDir, '.metabot', 'skills');
    const boundSkills = await listSharedMetabotSkills(sharedSkillRoot);
    if (boundSkills.length === 0) {
        throw new HostSkillBindingError('shared_skills_missing', `No shared metabot-* skills were found under ${sharedSkillRoot}.`, {
            sharedSkillRoot,
        });
    }
    const roots = getRootsForInput(input);
    const results = [];
    for (const root of roots) {
        const hostSkillRoot = (0, platformRegistry_1.resolvePlatformSkillRootPath)(root, systemHomeDir, input.env);
        if (input.mode === 'auto' && root.autoBind === 'when-parent-exists' && !(await parentExists(hostSkillRoot))) {
            results.push(rootResult({
                root,
                hostSkillRoot,
                status: 'skipped',
                reason: 'parent_missing',
            }));
            continue;
        }
        if (input.mode === 'auto' && root.autoBind === 'manual') {
            results.push(rootResult({
                root,
                hostSkillRoot,
                status: 'skipped',
                reason: 'manual',
            }));
            continue;
        }
        try {
            results.push(await bindOneRoot({ root, hostSkillRoot, sharedSkillRoot, boundSkills }));
        }
        catch (error) {
            if (error instanceof HostSkillBindingError) {
                const failed = rootResult({
                    root,
                    hostSkillRoot,
                    status: 'failed',
                    reason: error.message,
                });
                if (input.mode === 'force-platform' || root.autoBind === 'always') {
                    throw error;
                }
                results.push(failed);
                continue;
            }
            throw error;
        }
    }
    return results;
}
async function bindHostSkills(input) {
    const systemHomeDir = node_path_1.default.resolve(input.systemHomeDir);
    const results = await bindPlatformSkills({
        systemHomeDir,
        host: input.host,
        env: input.env,
        mode: 'force-platform',
    });
    const firstBound = results.find((result) => result.status === 'bound');
    return {
        host: input.host,
        hostSkillRoot: firstBound?.hostSkillRoot ?? '',
        sharedSkillRoot: node_path_1.default.join(systemHomeDir, '.metabot', 'skills'),
        boundSkills: firstBound?.boundSkills ?? [],
        replacedEntries: firstBound?.replacedEntries ?? [],
        unchangedEntries: firstBound?.unchangedEntries ?? [],
        boundRoots: results.filter((result) => result.status === 'bound'),
        skippedRoots: results.filter((result) => result.status === 'skipped'),
        failedRoots: results.filter((result) => result.status === 'failed'),
    };
}
