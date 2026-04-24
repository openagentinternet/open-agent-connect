"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runIdentityCommand = runIdentityCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
async function runIdentityCommand(args, context) {
    const subcommand = args[0];
    if (subcommand === 'create') {
        const name = (0, helpers_1.readFlagValue)(args, '--name');
        if (!name) {
            return (0, helpers_1.commandMissingFlag)('--name');
        }
        const handler = context.dependencies.identity?.create;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Identity create handler is not configured.');
        }
        return handler({ name });
    }
    if (subcommand === 'who') {
        const handler = context.dependencies.identity?.who;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Identity who handler is not configured.');
        }
        return handler();
    }
    if (subcommand === 'list') {
        const handler = context.dependencies.identity?.list;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Identity list handler is not configured.');
        }
        return handler();
    }
    if (subcommand === 'assign') {
        const name = (0, helpers_1.readFlagValue)(args, '--name');
        if (!name) {
            return (0, helpers_1.commandMissingFlag)('--name');
        }
        const handler = context.dependencies.identity?.assign;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Identity assign handler is not configured.');
        }
        return handler({ name });
    }
    return (0, helpers_1.commandUnknownSubcommand)(`identity ${args.join(' ')}`.trim());
}
