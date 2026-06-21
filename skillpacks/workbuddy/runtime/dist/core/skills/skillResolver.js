"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSkillContract = resolveSkillContract;
exports.renderResolvedSkillContract = renderResolvedSkillContract;
const baseSkillRegistry_1 = require("./baseSkillRegistry");
function cloneScope(scope) {
    return {
        allowedCommands: [...scope.allowedCommands],
        chainRead: scope.chainRead,
        chainWrite: scope.chainWrite,
        localUiOpen: scope.localUiOpen,
        remoteDelegation: scope.remoteDelegation,
    };
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
    ].join('\n');
}
function resolveSkillContract(input) {
    return buildBaseResolvedContract(input.skillName);
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
