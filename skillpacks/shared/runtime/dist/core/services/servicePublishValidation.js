"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateServicePublishProviderSkills = validateServicePublishProviderSkills;
exports.validateServicePublishProviderSkill = validateServicePublishProviderSkill;
const platformSkillCatalog_1 = require("./platformSkillCatalog");
const skillServiceProtocol_1 = require("./skillServiceProtocol");
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeRawProviderSkillCandidates(input) {
    const source = Array.isArray(input.providerSkills) && input.providerSkills.length > 0
        ? input.providerSkills
        : [input.providerSkill];
    const seen = new Set();
    const result = [];
    for (const candidate of source) {
        const skillName = normalizeText(candidate);
        if (!skillName || seen.has(skillName)) {
            continue;
        }
        seen.add(skillName);
        result.push(skillName);
    }
    return result;
}
async function validateServicePublishProviderSkills(input) {
    const rawProviderSkills = normalizeRawProviderSkillCandidates(input);
    const providerSkills = (0, skillServiceProtocol_1.normalizeProviderSkillList)(rawProviderSkills);
    if (rawProviderSkills.length === 0
        || providerSkills.length !== rawProviderSkills.length
        || rawProviderSkills.some((providerSkill) => !(0, platformSkillCatalog_1.isSafeProviderSkillName)(providerSkill))) {
        return {
            ok: false,
            code: 'invalid_provider_skill',
            message: 'providerSkill must contain one or more safe skill directory names.',
            rootDiagnostics: [],
        };
    }
    const catalog = (0, platformSkillCatalog_1.createPlatformSkillCatalog)({
        runtimeStore: input.runtimeStore,
        bindingStore: input.bindingStore,
        systemHomeDir: input.systemHomeDir,
        projectRoot: input.projectRoot,
        env: input.env,
    });
    const catalogResult = await catalog.listPrimaryRuntimeSkills({
        metaBotSlug: input.metaBotSlug,
    });
    if (!catalogResult.ok) {
        return {
            ok: false,
            code: catalogResult.code,
            message: catalogResult.message,
            runtime: catalogResult.runtime,
            rootDiagnostics: catalogResult.rootDiagnostics,
        };
    }
    const skillsByName = new Map(catalogResult.skills.map((entry) => [entry.skillName, entry]));
    const missingSkills = providerSkills.filter((providerSkill) => !skillsByName.has(providerSkill));
    if (missingSkills.length > 0) {
        return {
            ok: false,
            code: 'provider_skill_missing',
            message: `providerSkill is not installed in the selected MetaBot primary runtime skill roots: ${missingSkills.join(', ')}`,
            runtime: catalogResult.runtime,
            platform: catalogResult.platform,
            rootDiagnostics: catalogResult.rootDiagnostics,
        };
    }
    const skills = providerSkills
        .map((providerSkill) => skillsByName.get(providerSkill))
        .filter((entry) => Boolean(entry));
    return {
        ok: true,
        skill: skills[0],
        skills,
        providerSkills,
        runtime: catalogResult.runtime,
        platform: catalogResult.platform,
        rootDiagnostics: catalogResult.rootDiagnostics,
    };
}
async function validateServicePublishProviderSkill(input) {
    return validateServicePublishProviderSkills({
        ...input,
        providerSkills: [input.providerSkill],
    });
}
