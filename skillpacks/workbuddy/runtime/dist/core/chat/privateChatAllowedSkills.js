"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyPrivateChatAllowedSkillScope = emptyPrivateChatAllowedSkillScope;
exports.createPrivateChatAllowedSkillsResolver = createPrivateChatAllowedSkillsResolver;
const metabotProfileManager_1 = require("../bot/metabotProfileManager");
const chatSkillPolicy_1 = require("../services/chatSkillPolicy");
function emptyPrivateChatAllowedSkillScope() {
    return {
        skills: [],
        skillSourcePaths: {},
        skippedSkills: [],
        warning: null,
    };
}
function createPrivateChatAllowedSkillsResolver(input) {
    return async () => {
        const profile = await (0, metabotProfileManager_1.getMetabotProfile)(input.paths.systemHomeDir, input.metaBotSlug);
        if (!profile || profile.allowChatSkills.length === 0) {
            return emptyPrivateChatAllowedSkillScope();
        }
        const result = await (0, chatSkillPolicy_1.resolveAllowChatSkillsForRuntime)({
            metaBotSlug: input.metaBotSlug,
            allowChatSkills: profile.allowChatSkills,
            runtimeStore: input.runtimeStore,
            bindingStore: input.bindingStore,
            systemHomeDir: input.paths.systemHomeDir,
            projectRoot: input.paths.profileRoot,
            env: input.env,
        });
        if (result.warning) {
            input.logWarning?.('[private chat allowed skills]', result.warning);
        }
        return {
            skills: result.skills.map((skill) => skill.skillName),
            skillSourcePaths: result.skillSourcePaths,
            skippedSkills: result.skippedSkills,
            warning: result.warning ?? null,
        };
    };
}
