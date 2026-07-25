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
/**
 * Parse `browser tab open --uri <uri>`. The `tab open` form requires a URI:
 * opening an empty tab is a page-only affordance, not a CLI one (the CLI has no
 * way to target a specific open page, so an empty open would be a no-op).
 * `args` starts at `open` (i.e. everything after `browser tab`).
 */
function parseBrowserTabOpenArgs(args) {
    if (args[0] !== 'open') {
        return { error: (0, helpers_1.commandUnknownSubcommand)(`browser tab ${args.join(' ')}`.trim()) };
    }
    const parsed = parseBrowserOpenArgs(args);
    if (parsed.error) {
        return parsed;
    }
    if (!parsed.uri) {
        return {
            error: (0, commandResult_1.commandFailed)('invalid_flag', 'Missing value for --uri. Use "browser open" to open the Browser itself.'),
        };
    }
    return { uri: parsed.uri };
}
async function runBrowserCommand(args, context) {
    if (args[0] === 'tab') {
        const parsed = parseBrowserTabOpenArgs(args.slice(1));
        if (parsed.error) {
            return parsed.error;
        }
        const handler = context.dependencies.browser?.tabOpen;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Browser tab open handler is not configured.');
        }
        return handler({ uri: parsed.uri });
    }
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
