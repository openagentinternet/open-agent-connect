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
async function injectSkills(input) {
    const skillRoot = resolveProviderSkillRoot(input.provider, input.cwd);
    await node_fs_1.promises.mkdir(skillRoot, { recursive: true });
    const injected = [];
    const errors = [];
    for (const skillName of input.skills) {
        try {
            assertSafeSkillName(skillName);
            const srcDir = node_path_1.default.join(input.skillsRoot, skillName);
            const dstDir = node_path_1.default.join(skillRoot, skillName);
            await node_fs_1.promises.access(srcDir);
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
