"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runHostCommand = runHostCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
const SUPPORTED_HOSTS = ['codex', 'claude-code', 'openclaw'];
function isSupportedHost(value) {
    return SUPPORTED_HOSTS.includes(value);
}
async function runHostCommand(args, context) {
    if (args[0] !== 'bind-skills') {
        return (0, helpers_1.commandUnknownSubcommand)(`host ${args.join(' ')}`.trim());
    }
    const handler = context.dependencies.host?.bindSkills;
    if (!handler) {
        return (0, commandResult_1.commandFailed)('not_implemented', 'Host bind-skills handler is not configured.');
    }
    const host = (0, helpers_1.readFlagValue)(args, '--host');
    if (!host) {
        return (0, helpers_1.commandMissingFlag)('--host');
    }
    if (!isSupportedHost(host)) {
        return (0, commandResult_1.commandFailed)('invalid_argument', `Unsupported --host value: ${host}. Supported values: ${SUPPORTED_HOSTS.join(', ')}.`);
    }
    return handler({ host });
}
