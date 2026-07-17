"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runHostCommand = runHostCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const platformRegistry_1 = require("../../core/platform/platformRegistry");
const helpers_1 = require("./helpers");
const SUPPORTED_HOSTS = [...platformRegistry_1.SUPPORTED_PLATFORM_IDS];
const SUPPORTED_PERSONA_HOSTS = ['codex'];
function readPersonaHost(args) {
    const host = (0, helpers_1.readFlagValue)(args, '--host');
    if (!host) {
        return (0, helpers_1.commandMissingFlag)('--host');
    }
    if (host !== 'codex') {
        return (0, commandResult_1.commandFailed)('invalid_argument', `Unsupported persona --host value: ${host}. Supported values: ${SUPPORTED_PERSONA_HOSTS.join(', ')}.`);
    }
    return host;
}
async function runHostCommand(args, context) {
    if (args[0] === 'persona') {
        const action = args[1];
        const handler = action === 'bind'
            ? context.dependencies.host?.bindPersona
            : action === 'status'
                ? context.dependencies.host?.personaStatus
                : action === 'unbind'
                    ? context.dependencies.host?.unbindPersona
                    : undefined;
        if (!handler) {
            if (!['bind', 'status', 'unbind'].includes(action ?? '')) {
                return (0, helpers_1.commandUnknownSubcommand)(`host ${args.join(' ')}`.trim());
            }
            return (0, commandResult_1.commandFailed)('not_implemented', `Host persona ${action} handler is not configured.`);
        }
        const host = readPersonaHost(args);
        if (host !== 'codex') {
            return host;
        }
        return handler({ host, from: (0, helpers_1.readFlagValue)(args, '--from') ?? undefined });
    }
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
    if (!(0, platformRegistry_1.isPlatformId)(host)) {
        return (0, commandResult_1.commandFailed)('invalid_argument', `Unsupported --host value: ${host}. Supported values: ${SUPPORTED_HOSTS.join(', ')}.`);
    }
    return handler({ host });
}
