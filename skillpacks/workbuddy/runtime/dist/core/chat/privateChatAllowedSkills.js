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
        skillDetails: [],
        skippedSkills: [],
        warning: null,
    };
}
function createPrivateChatAllowedSkillsResolver(input) {
    // Persist the last resolution outcome so operators can see configured
    // skills that no longer resolve. Strictly best-effort: a failed write must
    // never affect the chat turn.
    const persistResolution = (scope) => (0, chatSkillPolicy_1.writeChatSkillResolution)(input.paths.chatSkillResolutionPath, {
        resolved: scope.skills,
        skipped: scope.skippedSkills,
        warning: scope.warning,
        checkedAt: new Date().toISOString(),
    }).catch(() => undefined);
    return async () => {
        const profile = await (0, metabotProfileManager_1.getMetabotProfile)(input.paths.systemHomeDir, input.metaBotSlug);
        if (!profile || profile.allowChatSkills.length === 0) {
            const emptyScope = emptyPrivateChatAllowedSkillScope();
            await persistResolution(emptyScope);
            return emptyScope;
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
        const scope = {
            skills: result.skills.map((skill) => skill.skillName),
            skillSourcePaths: result.skillSourcePaths,
            skillDetails: result.skills.map((skill) => ({
                name: skill.skillName,
                description: typeof skill.description === 'string' && skill.description.trim()
                    ? skill.description.trim()
                    : null,
                location: typeof skill.skillDocumentPath === 'string' && skill.skillDocumentPath.trim()
                    ? skill.skillDocumentPath.trim()
                    : null,
            })),
            skippedSkills: result.skippedSkills,
            warning: result.warning ?? null,
        };
        await persistResolution(scope);
        return scope;
    };
}
