"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runChatCommand = runChatCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
async function runChatCommand(args, context) {
    if (args[0] === 'private') {
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
    if (args[0] === 'conversations') {
        const handler = context.dependencies.chat?.conversations;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Chat conversations handler is not configured.');
        }
        return handler();
    }
    if (args[0] === 'messages') {
        const conversationId = (0, helpers_1.readFlagValue)(args, '--conversation-id');
        if (!conversationId) {
            return (0, helpers_1.commandMissingFlag)('--conversation-id');
        }
        const limitStr = (0, helpers_1.readFlagValue)(args, '--limit');
        const limit = limitStr ? Number(limitStr) : undefined;
        const handler = context.dependencies.chat?.messages;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Chat messages handler is not configured.');
        }
        return handler({
            conversationId: normalizeText(conversationId),
            limit: Number.isFinite(limit) ? limit : undefined,
        });
    }
    if (args[0] === 'auto-reply') {
        const subAction = args[1];
        if (subAction === 'status') {
            const handler = context.dependencies.chat?.autoReplyStatus;
            if (!handler) {
                return (0, commandResult_1.commandFailed)('not_implemented', 'Auto-reply status handler is not configured.');
            }
            return handler();
        }
        if (subAction === 'enable') {
            const handler = context.dependencies.chat?.setAutoReply;
            if (!handler) {
                return (0, commandResult_1.commandFailed)('not_implemented', 'Auto-reply config handler is not configured.');
            }
            const strategyId = (0, helpers_1.readFlagValue)(args, '--strategy') || undefined;
            return handler({ enabled: true, defaultStrategyId: strategyId });
        }
        if (subAction === 'disable') {
            const handler = context.dependencies.chat?.setAutoReply;
            if (!handler) {
                return (0, commandResult_1.commandFailed)('not_implemented', 'Auto-reply config handler is not configured.');
            }
            return handler({ enabled: false });
        }
        return (0, helpers_1.commandUnknownSubcommand)(`chat auto-reply ${normalizeText(subAction)}`);
    }
    return (0, helpers_1.commandUnknownSubcommand)(`chat ${args.join(' ')}`.trim());
}
