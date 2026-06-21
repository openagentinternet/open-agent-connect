"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runBrowserCommand = runBrowserCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
function parseBrowserOpenArgs(args) {
    let uri;
    for (let index = 1; index < args.length; index += 1) {
        const token = args[index];
        if (token === '--uri') {
            const rawValue = args[index + 1];
            if (typeof rawValue !== 'string' || rawValue.startsWith('--') || !rawValue.trim()) {
                return {
                    error: (0, commandResult_1.commandFailed)('invalid_flag', 'Missing value for --uri.'),
                };
            }
            uri = rawValue;
            index += 1;
            continue;
        }
        if (token.startsWith('--')) {
            return {
                error: (0, commandResult_1.commandFailed)('invalid_flag', `Unsupported flag: ${token}.`),
            };
        }
        return {
            error: (0, commandResult_1.commandFailed)('invalid_flag', `Unexpected argument: ${token}.`),
        };
    }
    return { uri };
}
async function runBrowserCommand(args, context) {
    if (args[0] !== 'open') {
        return (0, helpers_1.commandUnknownSubcommand)(`browser ${args.join(' ')}`.trim());
    }
    const parsed = parseBrowserOpenArgs(args);
    if (parsed.error) {
        return parsed.error;
    }
    const handler = context.dependencies.browser?.open;
    if (!handler) {
        return (0, commandResult_1.commandFailed)('not_implemented', 'Browser open handler is not configured.');
    }
    return handler(parsed.uri ? { uri: parsed.uri } : {});
}
