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
function hasFlag(args, flag) {
    return args.includes(flag);
}
async function runSkillsCommand(args, context) {
    const subcommand = args[0];
    if (subcommand === 'resolve') {
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
    if (subcommand === 'install') {
        const handler = context.dependencies.skills?.install;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Skills install handler is not configured.');
        }
        const pin = (0, helpers_1.readFlagValue)(args, '--pin');
        const uri = (0, helpers_1.readFlagValue)(args, '--uri');
        if (!pin && !uri) {
            return (0, commandResult_1.commandFailed)('invalid_argument', 'Pass --pin <metabot-skill pinId> (recommended; reads the pin payload for the package URI) or --uri <metafile://…|https://…> for a direct package zip.');
        }
        return handler({
            ...(pin ? { pin } : {}),
            ...(uri ? { uri } : {}),
            ...((0, helpers_1.readFlagValue)(args, '--name') ? { name: (0, helpers_1.readFlagValue)(args, '--name') } : {}),
            confirm: hasFlag(args, '--confirm'),
            force: hasFlag(args, '--force'),
            noRebind: hasFlag(args, '--no-rebind'),
        });
    }
    if (subcommand === 'publish') {
        const handler = context.dependencies.skills?.publish;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Skills publish handler is not configured.');
        }
        const dir = (0, helpers_1.readFlagValue)(args, '--dir');
        if (!dir) {
            return (0, commandResult_1.commandFailed)('invalid_argument', 'Pass --dir <skill directory> — the directory whose root (or single subdirectory) carries SKILL.md.');
        }
        return handler({
            skillDir: dir,
            ...((0, helpers_1.readFlagValue)(args, '--name') ? { name: (0, helpers_1.readFlagValue)(args, '--name') } : {}),
            ...((0, helpers_1.readFlagValue)(args, '--skill-version') ? { version: (0, helpers_1.readFlagValue)(args, '--skill-version') } : {}),
            ...((0, helpers_1.readFlagValue)(args, '--description') ? { description: (0, helpers_1.readFlagValue)(args, '--description') } : {}),
            ...((0, helpers_1.readFlagValue)(args, '--network') ? { network: (0, helpers_1.readFlagValue)(args, '--network') } : {}),
            ...((0, helpers_1.readFlagValue)(args, '--from') ? { from: (0, helpers_1.readFlagValue)(args, '--from') } : {}),
            confirm: hasFlag(args, '--confirm'),
        });
    }
    if (subcommand === 'list') {
        const handler = context.dependencies.skills?.list;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Skills list handler is not configured.');
        }
        return handler({ json: hasFlag(args, '--json') });
    }
    if (subcommand === 'read') {
        const handler = context.dependencies.skills?.read;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Skills read handler is not configured.');
        }
        const name = (0, helpers_1.readFlagValue)(args, '--name');
        if (!name) {
            return (0, helpers_1.commandMissingFlag)('--name');
        }
        return handler({ name });
    }
    if (subcommand === 'uninstall') {
        const handler = context.dependencies.skills?.uninstall;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Skills uninstall handler is not configured.');
        }
        const name = (0, helpers_1.readFlagValue)(args, '--name');
        if (!name) {
            return (0, helpers_1.commandMissingFlag)('--name');
        }
        return handler({ name, confirm: hasFlag(args, '--confirm') });
    }
    return (0, helpers_1.commandUnknownSubcommand)(`skills ${args.join(' ')}`.trim());
}
