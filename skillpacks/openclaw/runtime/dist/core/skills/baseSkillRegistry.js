"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listBaseSkillNames = listBaseSkillNames;
exports.getBaseSkillContract = getBaseSkillContract;
const BASE_SKILL_REGISTRY = {
    'metabot-network-directory': {
        skillName: 'metabot-network-directory',
        title: 'MetaBot Network Directory',
        summary: 'Resolve cached online MetaBot services with machine-first search before optional human UI browsing.',
        instructions: 'Run the machine-first online services command. When a user intent is known, add --query with concise task keywords so the runtime refreshes and searches the local online skill-service cache before agent continuation.',
        commandTemplate: 'metabot network services --online',
        outputExpectation: 'Return structured JSON with a services array preserving servicePinId, providerGlobalMetaId, price, ratingAvg, ratingCount, updatedAt, and providerDaemonBaseUrl when present.',
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
        summary: 'Manage MetaWeb discovery with machine-first online bot reads, cached online service search, and local source registry operations.',
        instructions: 'Use machine-first network commands before optional UI browsing. For online MetaBots, start with metabot network bots --online --limit 20. For service discovery, prefer metabot network services --online, and add --query when the user has a concrete task intent. Use metabot network sources add/list/remove for local registry maintenance, and refresh online services after source changes. Only open the local hub page when a human explicitly wants rich browsing.',
        commandTemplate: 'metabot network services --online',
        outputExpectation: 'Return structured output that preserves online bots or services plus any providerDaemonBaseUrl hints needed for downstream routing.',
        fallbackPolicy: 'If discovery is empty or a human asks for richer browsing, offer metabot ui open --page hub. Do not place remote orders, inspect trace lifecycle, or create/switch identity from this skill.',
        scope: {
            allowedCommands: [
                'metabot network bots --online --limit 20',
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
    'metabot-browser-open': {
        skillName: 'metabot-browser-open',
        title: 'MetaBot Browser Open',
        summary: 'Open Agent Internet Browser for public Bot pages, domain aliases, chain pins, MetaApps, and MetaFiles through the local Browser entrypoint.',
        instructions: 'Use the Browser CLI directly. Open Browser with no URI when the human asks for the Browser itself. When a Bot page, domain alias, chain pin, MetaApp, or MetaFile target is already known, pass the corresponding metaid://, pin://, metaapp://, or metafile:// URI. Treat dot-separated aliases such as sunnyfung.eth as metaid:// aliases. Treat 64-hex pin ids ending in i0 as pin:// resources. Do not search, create identities, or open Bot Hub from this skill.',
        commandTemplate: 'metabot browser open',
        outputExpectation: 'Return the Browser localUiUrl plus the opened URI when one was requested.',
        fallbackPolicy: 'If the target resource is unknown, ask for the Bot globalMetaId, domain alias, chain pinId, MetaApp pinId, or MetaFile pinId instead of guessing.',
        scope: {
            allowedCommands: [
                'metabot browser open',
                'metabot browser open --uri metaid://idq1example',
                'metabot browser open --uri metaid://sunnyfung.eth',
                'metabot browser open --uri pin://0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdefi0',
                'metabot browser open --uri metaapp://0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdefi0',
                'metabot browser open --uri metafile://0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdefi0.png',
            ],
            chainRead: false,
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
