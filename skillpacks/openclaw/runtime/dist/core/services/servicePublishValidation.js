"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateServicePublishProviderSkill = validateServicePublishProviderSkill;
const platformSkillCatalog_1 = require("./platformSkillCatalog");
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
async function validateServicePublishProviderSkill(input) {
    const providerSkill = normalizeText(input.providerSkill);
    if (!(0, platformSkillCatalog_1.isSafeProviderSkillName)(providerSkill)) {
        return {
            ok: false,
            code: 'invalid_provider_skill',
            message: 'providerSkill must be a single safe skill directory name.',
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
    const skill = catalogResult.skills.find((entry) => entry.skillName === providerSkill);
    if (!skill) {
        return {
            ok: false,
            code: 'provider_skill_missing',
            message: `providerSkill is not installed in the selected MetaBot primary runtime skill roots: ${providerSkill}`,
            runtime: catalogResult.runtime,
            platform: catalogResult.platform,
            rootDiagnostics: catalogResult.rootDiagnostics,
        };
    }
    return {
        ok: true,
        skill,
        runtime: catalogResult.runtime,
        platform: catalogResult.platform,
        rootDiagnostics: catalogResult.rootDiagnostics,
    };
}
