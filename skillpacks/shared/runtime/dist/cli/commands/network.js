"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runNetworkCommand = runNetworkCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
function parseLimitFlag(args) {
    const rawLimit = (0, helpers_1.readFlagValue)(args, '--limit');
    if (rawLimit == null) {
        return {};
    }
    const parsed = Number.parseInt(rawLimit.trim(), 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
        return {
            error: (0, commandResult_1.commandFailed)('invalid_flag', `Unsupported --limit value: ${rawLimit}. Supported range: 1-100.`),
        };
    }
    return { limit: parsed };
}
async function runNetworkCommand(args, context) {
    if (args[0] === 'services') {
        const handler = context.dependencies.network?.listServices;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Network services handler is not configured.');
        }
        return handler({
            online: (0, helpers_1.hasFlag)(args, '--online') ? true : undefined,
        });
    }
    if (args[0] === 'bots') {
        const handler = context.dependencies.network?.listBots;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Network bots handler is not configured.');
        }
        const parsedLimit = parseLimitFlag(args);
        if (parsedLimit.error) {
            return parsedLimit.error;
        }
        return handler({
            online: (0, helpers_1.hasFlag)(args, '--online') ? true : undefined,
            limit: parsedLimit.limit,
        });
    }
    if (args[0] !== 'sources') {
        return (0, helpers_1.commandUnknownSubcommand)(`network ${args.join(' ')}`.trim());
    }
    const subcommand = args[1];
    if (subcommand === 'list') {
        const handler = context.dependencies.network?.listSources;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Network source list handler is not configured.');
        }
        return handler();
    }
    if (subcommand === 'add') {
        const handler = context.dependencies.network?.addSource;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Network source add handler is not configured.');
        }
        const baseUrl = (0, helpers_1.readFlagValue)(args, '--base-url');
        if (!baseUrl) {
            return (0, helpers_1.commandMissingFlag)('--base-url');
        }
        const label = (0, helpers_1.readFlagValue)(args, '--label') ?? undefined;
        return handler({ baseUrl, label });
    }
    if (subcommand === 'remove') {
        const handler = context.dependencies.network?.removeSource;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Network source remove handler is not configured.');
        }
        const baseUrl = (0, helpers_1.readFlagValue)(args, '--base-url');
        if (!baseUrl) {
            return (0, helpers_1.commandMissingFlag)('--base-url');
        }
        return handler({ baseUrl });
    }
    return (0, helpers_1.commandUnknownSubcommand)(`network ${args.join(' ')}`.trim());
}
