"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPersonaSessionSystemPrompt = buildPersonaSessionSystemPrompt;
/**
 * System prompt for unattended persona-driven sessions (MetaWeb surf, nightly
 * study, QA surf): scenario framing + the shared identity block + the
 * experience hot layer (self-identity / value boundaries / work reviews /
 * recent dream diaries). Scoped owner memories are deliberately NOT included
 * — these sessions act publicly on MetaWeb, and the prompts previously
 * referenced a persona that was never injected.
 */
const chatPersonaLoader_1 = require("../chat/chatPersonaLoader");
const memoryService_1 = require("../memory/memoryService");
const compose_1 = require("./compose");
const metabotIdentity_1 = require("./metabotIdentity");
async function buildPersonaSessionSystemPrompt(paths, input) {
    const persona = await (0, chatPersonaLoader_1.loadChatPersona)(paths).catch(() => null);
    const experienceXml = await (0, memoryService_1.buildExperienceContext)(paths);
    return (0, compose_1.composeSystemPrompt)([
        { name: 'scenario', order: compose_1.SYSTEM_PROMPT_ORDER.scenario, text: input.scenario },
        {
            name: 'identity',
            order: compose_1.SYSTEM_PROMPT_ORDER.identity,
            text: persona
                ? (0, metabotIdentity_1.buildMetabotIdentityBlock)({
                    name: persona.identity?.name,
                    globalMetaId: persona.identity?.globalMetaId,
                    role: persona.role,
                    soul: persona.soul,
                    goal: persona.goal,
                })
                : '',
        },
        { name: 'experience', order: compose_1.SYSTEM_PROMPT_ORDER.experience, text: experienceXml },
    ]);
}
