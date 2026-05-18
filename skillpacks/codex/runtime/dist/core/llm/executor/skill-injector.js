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
function resolveProviderSkillRoot(provider, cwd) {
    if ((0, platformRegistry_1.isPlatformId)(provider)) {
        const projectRoot = (0, platformRegistry_1.getProjectSkillRoot)(provider);
        if (projectRoot)
            return node_path_1.default.resolve(cwd, projectRoot.path);
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
async function injectSkills(input) {
    const skillRoot = resolveProviderSkillRoot(input.provider, input.cwd);
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
            try {
                await node_fs_1.promises.access(dstDir);
                injected.push(skillName);
                continue;
            }
            catch {
                // Destination does not exist yet.
            }
            await node_fs_1.promises.cp(srcDir, dstDir, { recursive: true });
            injected.push(skillName);
        }
        catch (error) {
            errors.push({ skill: skillName, error: error instanceof Error ? error.message : String(error) });
        }
    }
    return { injected, errors };
}
