"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runConfigCommand = runConfigCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
function readConfigPositionals(args) {
    const positionals = [];
    for (let index = 1; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--from') {
            index += 1;
            continue;
        }
        if (arg.startsWith('--from=')) {
            continue;
        }
        positionals.push(arg);
    }
    return positionals;
}
async function runConfigCommand(args, context) {
    const subcommand = args[0];
    const from = (0, helpers_1.readFromFlag)(args);
    const positionals = readConfigPositionals(args);
    if (subcommand === 'get') {
        const handler = context.dependencies.config?.get;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Config get handler is not configured.');
        }
        const key = positionals[0];
        if (!key) {
            return (0, commandResult_1.commandFailed)('missing_argument', 'Missing required config key.');
        }
        return handler({ ...(from ? { from } : {}), key });
    }
    if (subcommand === 'set') {
        const handler = context.dependencies.config?.set;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Config set handler is not configured.');
        }
        const key = positionals[0];
        if (!key) {
            return (0, commandResult_1.commandFailed)('missing_argument', 'Missing required config key.');
        }
        const rawValue = positionals[1];
        if (!rawValue) {
            return (0, commandResult_1.commandFailed)('missing_argument', 'Missing required config value.');
        }
        return handler({
            ...(from ? { from } : {}),
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
