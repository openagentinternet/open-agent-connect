"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runChatCommand = runChatCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
async function runChatCommand(args, context) {
    if (args[0] !== 'private') {
        return (0, helpers_1.commandUnknownSubcommand)(`chat ${args.join(' ')}`.trim());
    }
    const requestFile = (0, helpers_1.readFlagValue)(args, '--request-file');
    if (!requestFile) {
        return (0, helpers_1.commandMissingFlag)('--request-file');
    }
    const handler = context.dependencies.chat?.private;
    if (!handler) {
        return (0, commandResult_1.commandFailed)('not_implemented', 'Chat private handler is not configured.');
    }
    const request = await (0, helpers_1.readJsonFile)(context, requestFile);
    return handler(request);
}
