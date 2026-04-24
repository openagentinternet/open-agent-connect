"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDaemonCommand = runDaemonCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
async function runDaemonCommand(args, context) {
    if (args[0] !== 'start') {
        return (0, helpers_1.commandUnknownSubcommand)(`daemon ${args.join(' ')}`.trim());
    }
    const handler = context.dependencies.daemon?.start;
    if (!handler) {
        return (0, commandResult_1.commandFailed)('not_implemented', 'Daemon start handler is not configured.');
    }
    return handler();
}
