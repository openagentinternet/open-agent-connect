"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSkillContract = resolveSkillContract;
exports.renderResolvedSkillContract = renderResolvedSkillContract;
const baseSkillRegistry_1 = require("./baseSkillRegistry");
const DEFAULT_SCOPE_METADATA = {
    sameSkill: true,
    sameScope: true,
    scopeHash: null,
};
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function isStringArray(value) {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
function isBoolean(value) {
    return typeof value === 'boolean';
}
function isValidSkillPermissionScope(value) {
    if (!isRecord(value)) {
        return false;
    }
    return isStringArray(value.allowedCommands)
        && isBoolean(value.chainRead)
        && isBoolean(value.chainWrite)
        && isBoolean(value.localUiOpen)
        && isBoolean(value.remoteDelegation);
}
function isValidScopeMetadata(value) {
    if (!isRecord(value)) {
        return false;
    }
    const scopeHash = value.scopeHash;
    return isBoolean(value.sameSkill)
        && isBoolean(value.sameScope)
        && (typeof scopeHash === 'string' || scopeHash === null);
}
function isValidPatch(value) {
    if (!isRecord(value)) {
        return false;
    }
    const optionalFields = [
        value.instructionsPatch,
        value.commandTemplatePatch,
        value.outputExpectationPatch,
        value.fallbackPolicyPatch,
    ];
    return optionalFields.every((field) => field === undefined || typeof field === 'string');
}
function cloneScope(scope) {
    return {
        allowedCommands: [...scope.allowedCommands],
        chainRead: scope.chainRead,
        chainWrite: scope.chainWrite,
        localUiOpen: scope.localUiOpen,
        remoteDelegation: scope.remoteDelegation,
    };
}
function cloneScopeMetadata(metadata) {
    return {
        sameSkill: metadata.sameSkill,
        sameScope: metadata.sameScope,
        scopeHash: metadata.scopeHash,
    };
}
function parseActiveVariantForSkill(activeVariant, skillName) {
    if (!isRecord(activeVariant)) {
        return null;
    }
    if (activeVariant.status !== 'active' || activeVariant.skillName !== skillName) {
        return null;
    }
    if (typeof activeVariant.variantId !== 'string') {
        return null;
    }
    if (!isValidSkillPermissionScope(activeVariant.scope)) {
        return null;
    }
    if (!isValidScopeMetadata(activeVariant.metadata)) {
        return null;
    }
    if (!isValidPatch(activeVariant.patch)) {
        return null;
    }
    const patch = activeVariant.patch;
    return {
        variantId: activeVariant.variantId,
        skillName: skillName,
        status: 'active',
        scope: cloneScope(activeVariant.scope),
        metadata: cloneScopeMetadata(activeVariant.metadata),
        patch: {
            instructionsPatch: typeof patch.instructionsPatch === 'string' ? patch.instructionsPatch : undefined,
            commandTemplatePatch: typeof patch.commandTemplatePatch === 'string' ? patch.commandTemplatePatch : undefined,
            outputExpectationPatch: typeof patch.outputExpectationPatch === 'string' ? patch.outputExpectationPatch : undefined,
            fallbackPolicyPatch: typeof patch.fallbackPolicyPatch === 'string' ? patch.fallbackPolicyPatch : undefined,
        },
    };
}
function normalizeAllowedCommands(commands) {
    return [...new Set(commands)].sort();
}
function areScopesEquivalent(baseScope, variantScope) {
    const baseCommands = normalizeAllowedCommands(baseScope.allowedCommands);
    const variantCommands = normalizeAllowedCommands(variantScope.allowedCommands);
    if (baseCommands.length !== variantCommands.length) {
        return false;
    }
    for (let index = 0; index < baseCommands.length; index += 1) {
        if (baseCommands[index] !== variantCommands[index]) {
            return false;
        }
    }
    return baseScope.chainRead === variantScope.chainRead
        && baseScope.chainWrite === variantScope.chainWrite
        && baseScope.localUiOpen === variantScope.localUiOpen
        && baseScope.remoteDelegation === variantScope.remoteDelegation;
}
function buildBaseResolvedContract(skillName) {
    const base = (0, baseSkillRegistry_1.getBaseSkillContract)(skillName);
    return {
        skillName: base.skillName,
        title: base.title,
        summary: base.summary,
        instructions: base.instructions,
        commandTemplate: base.commandTemplate,
        outputExpectation: base.outputExpectation,
        fallbackPolicy: base.fallbackPolicy,
        scope: cloneScope(base.scope),
        source: 'base',
        activeVariantId: null,
        activeVariantSource: null,
        scopeMetadata: cloneScopeMetadata(DEFAULT_SCOPE_METADATA),
    };
}
function normalizeActiveVariantSource(source) {
    if (source === 'local' || source === 'remote') {
        return source;
    }
    return null;
}
function mergeWithActiveVariant(base, activeVariant, activeVariantSource) {
    const mergedScope = cloneScope(activeVariant.scope);
    const sameScope = areScopesEquivalent(base.scope, mergedScope);
    return {
        skillName: base.skillName,
        title: base.title,
        summary: base.summary,
        instructions: activeVariant.patch.instructionsPatch ?? base.instructions,
        commandTemplate: activeVariant.patch.commandTemplatePatch ?? base.commandTemplate,
        outputExpectation: activeVariant.patch.outputExpectationPatch ?? base.outputExpectation,
        fallbackPolicy: activeVariant.patch.fallbackPolicyPatch ?? base.fallbackPolicy,
        scope: mergedScope,
        source: 'merged',
        activeVariantId: activeVariant.variantId,
        activeVariantSource,
        scopeMetadata: {
            sameSkill: activeVariant.skillName === base.skillName,
            sameScope,
            scopeHash: activeVariant.metadata.scopeHash,
        },
    };
}
function maxBacktickRun(source) {
    let max = 0;
    const matches = source.match(/`+/g) ?? [];
    for (const sequence of matches) {
        if (sequence.length > max) {
            max = sequence.length;
        }
    }
    return max;
}
function renderCommandTemplateMarkdown(commandTemplate) {
    const fence = '`'.repeat(Math.max(3, maxBacktickRun(commandTemplate) + 1));
    return `${fence}bash\n${commandTemplate}\n${fence}`;
}
function renderScopeMarkdown(scope) {
    return [
        `- Allowed commands: ${scope.allowedCommands.map((command) => `\`${command}\``).join(', ')}`,
        `- Chain read: ${scope.chainRead ? 'allowed' : 'forbidden'}`,
        `- Chain write: ${scope.chainWrite ? 'allowed' : 'forbidden'}`,
        `- Local UI open: ${scope.localUiOpen ? 'allowed' : 'forbidden'}`,
        `- Remote delegation: ${scope.remoteDelegation ? 'allowed' : 'forbidden'}`,
    ].join('\n');
}
function renderMarkdownContract(host, contract) {
    return [
        `# Resolved Skill Contract: ${contract.skillName}`,
        '',
        `Host: \`${host}\``,
        `Source: \`${contract.source}\``,
        `Active variant: \`${contract.activeVariantId ?? 'none'}\``,
        `Active variant source: \`${contract.activeVariantSource ?? 'none'}\``,
        '',
        '## Summary',
        contract.summary,
        '',
        '## Instructions',
        contract.instructions,
        '',
        '## Command Template',
        renderCommandTemplateMarkdown(contract.commandTemplate),
        '',
        '## Output Expectation',
        contract.outputExpectation,
        '',
        '## Fallback Policy',
        contract.fallbackPolicy,
        '',
        '## Scope',
        renderScopeMarkdown(contract.scope),
        '',
        '## Scope Metadata',
        `- sameSkill: ${contract.scopeMetadata.sameSkill}`,
        `- sameScope: ${contract.scopeMetadata.sameScope}`,
        `- scopeHash: ${contract.scopeMetadata.scopeHash ?? 'null'}`,
    ].join('\n');
}
function resolveSkillContract(input) {
    const base = buildBaseResolvedContract(input.skillName);
    if (!input.evolutionNetworkEnabled) {
        return base;
    }
    const activeVariant = parseActiveVariantForSkill(input.activeVariant, input.skillName);
    if (!activeVariant) {
        return base;
    }
    return mergeWithActiveVariant(base, activeVariant, normalizeActiveVariantSource(input.activeVariantSource));
}
function renderResolvedSkillContract(input) {
    const resolvedHost = input.host ?? 'shared';
    const requestedHost = input.host;
    const resolutionMode = input.host ? 'host_override' : 'shared_default';
    const resolved = resolveSkillContract(input);
    if (input.format === 'json') {
        return {
            host: resolvedHost,
            requestedHost,
            resolutionMode,
            format: 'json',
            contract: resolved,
        };
    }
    return {
        host: resolvedHost,
        requestedHost,
        resolutionMode,
        format: 'markdown',
        markdown: renderMarkdownContract(resolvedHost, resolved),
        contract: resolved,
    };
}
