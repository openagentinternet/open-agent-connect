"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.kiroBackendFactory = void 0;
exports.createKiroBackend = createKiroBackend;
const acp_1 = require("./acp");
function normalizeKiroToolName(toolName) {
    let value = toolName.trim();
    const colonIndex = value.indexOf(':');
    if (colonIndex > 0)
        value = value.slice(0, colonIndex).trim();
    const lower = value.toLowerCase();
    switch (lower) {
        case 'read':
        case 'read file':
            return 'read_file';
        case 'write':
        case 'write file':
            return 'write_file';
        case 'edit':
        case 'patch':
            return 'edit_file';
        case 'shell':
        case 'bash':
        case 'terminal':
        case 'run command':
        case 'run shell command':
            return 'terminal';
        case 'grep':
        case 'search':
        case 'find':
            return 'search_files';
        case 'glob':
            return 'glob';
        case 'code':
            return 'code';
        case 'web search':
            return 'web_search';
        case 'fetch':
        case 'web fetch':
            return 'web_fetch';
        case 'todo':
        case 'todo write':
        case 'todo list':
        case 'todo_list':
            return 'todo_write';
        default:
            return lower.replaceAll(' ', '_') || 'tool';
    }
}
function createKiroBackend(binaryPath, env) {
    return (0, acp_1.createAcpBackend)({
        provider: 'kiro',
        binaryPath,
        env,
        baseArgs: ['acp', '--trust-all-tools'],
        blockedArgs: {
            acp: { takesValue: false },
            '-a': { takesValue: false },
            '--trust-all-tools': { takesValue: false },
            '--trust-tools': { takesValue: true },
        },
        resumeMethod: 'session/load',
        includeMcpServersInResume: true,
        sendPromptContentAlias: true,
        gateNotificationsUntilPrompt: true,
        normalizeToolName: normalizeKiroToolName,
    });
}
exports.kiroBackendFactory = createKiroBackend;
