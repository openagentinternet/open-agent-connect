"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runUiCommand = runUiCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
async function runUiCommand(args, context) {
    if (args[0] !== 'open') {
        return (0, helpers_1.commandUnknownSubcommand)(`ui ${args.join(' ')}`.trim());
    }
    const page = (0, helpers_1.readFlagValue)(args, '--page');
    const traceId = (0, helpers_1.readFlagValue)(args, '--trace-id') || undefined;
    if (!page) {
        return (0, helpers_1.commandMissingFlag)('--page');
    }
    const handler = context.dependencies.ui?.open;
    if (!handler) {
        return (0, commandResult_1.commandFailed)('not_implemented', 'UI open handler is not configured.');
    }
    return handler(traceId ? { page, traceId } : { page });
}
