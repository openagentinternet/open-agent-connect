"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HostSkillBindingError = void 0;
exports.bindHostSkills = bindHostSkills;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
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
function normalizeOptionalEnvPath(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function resolveHostHomeDir(systemHomeDir, host, env = {}) {
    switch (host) {
        case 'codex':
            return node_path_1.default.resolve(normalizeOptionalEnvPath(env.CODEX_HOME) || node_path_1.default.join(systemHomeDir, '.codex'));
        case 'claude-code':
            return node_path_1.default.resolve(normalizeOptionalEnvPath(env.CLAUDE_HOME) || node_path_1.default.join(systemHomeDir, '.claude'));
        case 'openclaw':
            return node_path_1.default.resolve(normalizeOptionalEnvPath(env.OPENCLAW_HOME) || node_path_1.default.join(systemHomeDir, '.openclaw'));
    }
}
function toRelativeSymlinkTarget(destinationPath, sourcePath) {
    return node_path_1.default.relative(node_path_1.default.dirname(destinationPath), sourcePath) || '.';
}
async function ensureHostSkillRoot(host, hostSkillRoot) {
    try {
        await node_fs_1.promises.mkdir(hostSkillRoot, { recursive: true });
        const stat = await node_fs_1.promises.stat(hostSkillRoot);
        if (!stat.isDirectory()) {
            throw new Error('Resolved host skill root is not a directory.');
        }
    }
    catch (error) {
        throw new HostSkillBindingError('host_skill_root_unresolved', `Unable to resolve the ${host} host skill root: ${hostSkillRoot}`, {
            host,
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
async function bindHostSkills(input) {
    const systemHomeDir = node_path_1.default.resolve(input.systemHomeDir);
    const sharedSkillRoot = node_path_1.default.join(systemHomeDir, '.metabot', 'skills');
    const boundSkills = await listSharedMetabotSkills(sharedSkillRoot);
    if (boundSkills.length === 0) {
        throw new HostSkillBindingError('shared_skills_missing', `No shared metabot-* skills were found under ${sharedSkillRoot}.`, {
            sharedSkillRoot,
        });
    }
    const hostSkillRoot = node_path_1.default.join(resolveHostHomeDir(systemHomeDir, input.host, input.env), 'skills');
    await ensureHostSkillRoot(input.host, hostSkillRoot);
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
    return {
        host: input.host,
        hostSkillRoot,
        sharedSkillRoot,
        boundSkills,
        replacedEntries,
        unchangedEntries,
    };
}
