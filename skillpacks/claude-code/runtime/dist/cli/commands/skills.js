"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSkillsCommand = runSkillsCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
const platformRegistry_1 = require("../../core/platform/platformRegistry");
const SUPPORTED_HOSTS = [...platformRegistry_1.SUPPORTED_PLATFORM_IDS];
const SUPPORTED_FORMATS = ['json', 'markdown'];
function isSupportedFormat(value) {
    return SUPPORTED_FORMATS.includes(value);
}
async function runSkillsCommand(args, context) {
    if (args[0] !== 'resolve') {
        return (0, helpers_1.commandUnknownSubcommand)(`skills ${args.join(' ')}`.trim());
    }
    const handler = context.dependencies.skills?.resolve;
    if (!handler) {
        return (0, commandResult_1.commandFailed)('not_implemented', 'Skills resolve handler is not configured.');
    }
    const skill = (0, helpers_1.readFlagValue)(args, '--skill');
    if (!skill) {
        return (0, helpers_1.commandMissingFlag)('--skill');
    }
    const host = (0, helpers_1.readFlagValue)(args, '--host');
    if (host && !(0, platformRegistry_1.isPlatformId)(host)) {
        return (0, commandResult_1.commandFailed)('invalid_argument', `Unsupported --host value: ${host}. Supported values: ${SUPPORTED_HOSTS.join(', ')}.`);
    }
    const resolvedHost = host && (0, platformRegistry_1.isPlatformId)(host) ? host : undefined;
    const format = (0, helpers_1.readFlagValue)(args, '--format');
    if (!format) {
        return (0, helpers_1.commandMissingFlag)('--format');
    }
    if (!isSupportedFormat(format)) {
        return (0, commandResult_1.commandFailed)('invalid_argument', `Unsupported --format value: ${format}. Supported values: ${SUPPORTED_FORMATS.join(', ')}.`);
    }
    return handler({ skill, host: resolvedHost, format });
}
