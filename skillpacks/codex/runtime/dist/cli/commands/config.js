"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runConfigCommand = runConfigCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
async function runConfigCommand(args, context) {
    const subcommand = args[0];
    if (subcommand === 'get') {
        const handler = context.dependencies.config?.get;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Config get handler is not configured.');
        }
        const key = args[1];
        if (!key) {
            return (0, commandResult_1.commandFailed)('missing_argument', 'Missing required config key.');
        }
        return handler({ key });
    }
    if (subcommand === 'set') {
        const handler = context.dependencies.config?.set;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Config set handler is not configured.');
        }
        const key = args[1];
        if (!key) {
            return (0, commandResult_1.commandFailed)('missing_argument', 'Missing required config key.');
        }
        const rawValue = args[2];
        if (!rawValue) {
            return (0, commandResult_1.commandFailed)('missing_argument', 'Missing required config value.');
        }
        return handler({
            key,
            value: rawValue === 'true'
                ? true
                : rawValue === 'false'
                    ? false
                    : rawValue,
        });
    }
    return (0, helpers_1.commandUnknownSubcommand)(`config ${args.join(' ')}`.trim());
}
