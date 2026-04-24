"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listBaseSkillNames = listBaseSkillNames;
exports.getBaseSkillContract = getBaseSkillContract;
const BASE_SKILL_REGISTRY = {
    'metabot-ask-master': {
        skillName: 'metabot-ask-master',
        title: 'MetaBot Ask Master',
        summary: 'Preview, confirm, and inspect one Ask Master request across the public manual / suggest flows through the validated master runtime.',
        instructions: 'Use metabot master list to resolve a target Master. In manual flow, start with metabot master ask --request-file so the runtime can prepare preview metadata. In suggest flow, start with metabot master suggest --request-file so the runtime can evaluate a structured stuck/risk observation and surface one Ask Master suggestion. Accepted suggestions follow the same preview/confirm/send path as manual asks. Keep the public release contract on preview first, explicit confirm second. Stop on failure instead of falling back to private chat, advisor commands, simplemsg, or services call.',
        commandTemplate: 'metabot master ask --request-file master-request.json',
        outputExpectation: 'Return structured JSON. Manual asks surface awaiting_confirmation with preview, traceId, and requestId before send. Suggest flows first surface a structured suggestion, then accepted suggestions enter the same preview/confirm path. After confirm, follow with metabot master trace --id when more evidence is needed.',
        fallbackPolicy: 'If no matching Master is available, the runtime declines to suggest, or the human declines confirmation, stop and surface the failure. Do not fall back to private chat, simplemsg, advisor commands, or services call.',
        scope: {
            allowedCommands: [
                'metabot master list --online',
                'metabot master suggest --request-file master-suggest.json',
                'metabot master ask --request-file master-request.json',
                'metabot master ask --trace-id trace-master-123 --confirm',
                'metabot master trace --id trace-master-123',
            ],
            chainRead: true,
            chainWrite: true,
            localUiOpen: false,
            remoteDelegation: true,
        },
    },
    'metabot-network-directory': {
        skillName: 'metabot-network-directory',
        title: 'MetaBot Network Directory',
        summary: 'Resolve machine-first online MetaBot services before optional human UI browsing.',
        instructions: 'Run the machine-first online services command and prefer structured output for agent continuation.',
        commandTemplate: 'metabot network services --online',
        outputExpectation: 'Return structured JSON with a services array suitable for selecting a remote MetaBot.',
        fallbackPolicy: 'Only open the local hub page when a human explicitly asks to browse services.',
        scope: {
            allowedCommands: [
                'metabot network services --online',
                'metabot ui open --page hub',
            ],
            chainRead: true,
            chainWrite: false,
            localUiOpen: true,
            remoteDelegation: false,
        },
    },
    'metabot-network-manage': {
        skillName: 'metabot-network-manage',
        title: 'MetaBot Network Manage',
        summary: 'Manage MetaWeb discovery with machine-first online bot and service reads plus local source registry operations.',
        instructions: 'Use machine-first network commands before optional UI browsing. For online MetaBots, start with metabot network bots --online --limit 10. For service discovery, prefer metabot network services --online. Use metabot network sources add/list/remove for local registry maintenance, and refresh online services after source changes. Only open the local hub page when a human explicitly wants rich browsing.',
        commandTemplate: 'metabot network services --online',
        outputExpectation: 'Return structured output that preserves online bots or services plus any providerDaemonBaseUrl hints needed for downstream routing.',
        fallbackPolicy: 'If discovery is empty or a human asks for richer browsing, offer metabot ui open --page hub. Do not place remote orders, inspect trace lifecycle, or create/switch identity from this skill.',
        scope: {
            allowedCommands: [
                'metabot network bots --online --limit 10',
                'metabot network services --online',
                'metabot ui open --page hub',
                'metabot network sources add --base-url http://127.0.0.1:4827 --label weather-demo',
                'metabot network sources list',
                'metabot network sources remove --base-url http://127.0.0.1:4827',
            ],
            chainRead: true,
            chainWrite: false,
            localUiOpen: true,
            remoteDelegation: false,
        },
    },
};
function cloneScope(scope) {
    return {
        allowedCommands: [...scope.allowedCommands],
        chainRead: scope.chainRead,
        chainWrite: scope.chainWrite,
        localUiOpen: scope.localUiOpen,
        remoteDelegation: scope.remoteDelegation,
    };
}
function cloneBaseSkillContract(contract) {
    return {
        skillName: contract.skillName,
        title: contract.title,
        summary: contract.summary,
        instructions: contract.instructions,
        commandTemplate: contract.commandTemplate,
        outputExpectation: contract.outputExpectation,
        fallbackPolicy: contract.fallbackPolicy,
        scope: cloneScope(contract.scope),
    };
}
function listBaseSkillNames() {
    return Object.keys(BASE_SKILL_REGISTRY);
}
function getBaseSkillContract(skillName) {
    const contract = BASE_SKILL_REGISTRY[skillName];
    if (!contract) {
        throw new Error(`Unknown base skill contract: ${skillName}`);
    }
    return cloneBaseSkillContract(contract);
}
