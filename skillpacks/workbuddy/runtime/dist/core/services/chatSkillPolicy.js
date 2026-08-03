"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeAllowChatSkills = normalizeAllowChatSkills;
exports.validateAllowChatSkills = validateAllowChatSkills;
exports.resolveAllowChatSkillsForRuntime = resolveAllowChatSkillsForRuntime;
exports.writeChatSkillResolution = writeChatSkillResolution;
exports.readChatSkillResolution = readChatSkillResolution;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const platformSkillCatalog_1 = require("./platformSkillCatalog");
function normalizeText(value) {
    return value.trim();
}
function normalizeAllowChatSkills(value) {
    if (!Array.isArray(value)) {
        throw new TypeError('allowChatSkills must be an array.');
    }
    const seen = new Set();
    const result = [];
    for (const entry of value) {
        if (typeof entry !== 'string') {
            throw new TypeError('allowChatSkills entries must be strings.');
        }
        const skillName = normalizeText(entry);
        if (!skillName) {
            continue;
        }
        if (!(0, platformSkillCatalog_1.isSafeProviderSkillName)(skillName)) {
            throw new TypeError('allowChatSkills entries must be safe skill directory names.');
        }
        if (!seen.has(skillName)) {
            seen.add(skillName);
            result.push(skillName);
        }
    }
    return result;
}
function createEmptySuccess(overrides = {}) {
    return {
        ok: true,
        allowChatSkills: [],
        skills: [],
        skillSourcePaths: {},
        skippedSkills: [],
        rootDiagnostics: [],
        ...overrides,
    };
}
function mapResolvedSkills(input) {
    const skillsByName = new Map(input.catalogSkills.map((entry) => [entry.skillName, entry]));
    const skills = [];
    const skippedSkills = [];
    for (const skillName of input.allowChatSkills) {
        const skill = skillsByName.get(skillName);
        if (skill) {
            skills.push(skill);
        }
        else {
            skippedSkills.push(skillName);
        }
    }
    return {
        allowChatSkills: skills.map((skill) => skill.skillName),
        skills,
        skippedSkills,
        skillSourcePaths: Object.fromEntries(skills.map((skill) => [skill.skillName, skill.absolutePath])),
    };
}
async function validateAllowChatSkills(input) {
    let allowChatSkills;
    try {
        allowChatSkills = normalizeAllowChatSkills(input.allowChatSkills);
    }
    catch (error) {
        return {
            ok: false,
            code: 'invalid_allow_chat_skills',
            message: error instanceof Error ? error.message : 'allowChatSkills is invalid.',
            rootDiagnostics: [],
        };
    }
    if (allowChatSkills.length === 0) {
        return createEmptySuccess();
    }
    const catalog = (0, platformSkillCatalog_1.createPlatformSkillCatalog)({
        runtimeStore: input.runtimeStore,
        bindingStore: input.bindingStore,
        systemHomeDir: input.systemHomeDir,
        projectRoot: input.projectRoot,
        env: input.env,
    });
    const catalogResult = await catalog.listPrimaryRuntimeSkills({ metaBotSlug: input.metaBotSlug });
    if (!catalogResult.ok) {
        return {
            ok: false,
            code: catalogResult.code,
            message: catalogResult.message,
            allowChatSkills,
            runtime: catalogResult.runtime,
            rootDiagnostics: catalogResult.rootDiagnostics,
        };
    }
    const resolved = mapResolvedSkills({
        allowChatSkills,
        catalogSkills: catalogResult.skills,
    });
    if (resolved.skippedSkills.length > 0) {
        return {
            ok: false,
            code: 'chat_skill_missing',
            message: `allowChatSkills contains skills that are not installed in the selected MetaBot primary runtime skill roots: ${resolved.skippedSkills.join(', ')}`,
            allowChatSkills,
            missingSkills: resolved.skippedSkills,
            runtime: catalogResult.runtime,
            platform: catalogResult.platform,
            rootDiagnostics: catalogResult.rootDiagnostics,
        };
    }
    return createEmptySuccess({
        ...resolved,
        skippedSkills: [],
        runtime: catalogResult.runtime,
        platform: catalogResult.platform,
        rootDiagnostics: catalogResult.rootDiagnostics,
    });
}
async function resolveAllowChatSkillsForRuntime(input) {
    let allowChatSkills;
    try {
        allowChatSkills = normalizeAllowChatSkills(input.allowChatSkills);
    }
    catch (error) {
        return createEmptySuccess({
            warning: error instanceof Error
                ? `Ignoring invalid allowChatSkills: ${error.message}`
                : 'Ignoring invalid allowChatSkills.',
        });
    }
    if (allowChatSkills.length === 0) {
        return createEmptySuccess();
    }
    const catalog = (0, platformSkillCatalog_1.createPlatformSkillCatalog)({
        runtimeStore: input.runtimeStore,
        bindingStore: input.bindingStore,
        systemHomeDir: input.systemHomeDir,
        projectRoot: input.projectRoot,
        env: input.env,
    });
    const catalogResult = await catalog.listPrimaryRuntimeSkills({ metaBotSlug: input.metaBotSlug });
    if (!catalogResult.ok) {
        return createEmptySuccess({
            skippedSkills: allowChatSkills,
            warning: `Primary runtime skill catalog could not be resolved: ${catalogResult.message}`,
            rootDiagnostics: catalogResult.rootDiagnostics,
            runtime: catalogResult.runtime,
        });
    }
    const resolved = mapResolvedSkills({
        allowChatSkills,
        catalogSkills: catalogResult.skills,
    });
    return createEmptySuccess({
        ...resolved,
        runtime: catalogResult.runtime,
        platform: catalogResult.platform,
        rootDiagnostics: catalogResult.rootDiagnostics,
        ...(resolved.skippedSkills.length > 0
            ? { warning: `Skipping unavailable chat skills: ${resolved.skippedSkills.join(', ')}` }
            : {}),
    });
}
function normalizeSkillNameList(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter((entry) => entry.length > 0);
}
async function writeChatSkillResolution(filePath, record) {
    await node_fs_1.promises.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
    await node_fs_1.promises.writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}
async function readChatSkillResolution(filePath) {
    try {
        const parsed = JSON.parse(await node_fs_1.promises.readFile(filePath, 'utf8'));
        if (!parsed || typeof parsed !== 'object') {
            return null;
        }
        return {
            resolved: normalizeSkillNameList(parsed.resolved),
            skipped: normalizeSkillNameList(parsed.skipped),
            warning: typeof parsed.warning === 'string' && parsed.warning.trim() ? parsed.warning.trim() : null,
            checkedAt: typeof parsed.checkedAt === 'string' ? parsed.checkedAt : '',
        };
    }
    catch {
        return null;
    }
}
