"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runConversationsCommand = runConversationsCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
function readLocalFlag(args) {
    return (0, helpers_1.readFlagValue)(args, '--local')
        ?? (0, helpers_1.readFromFlag)(args)
        ?? undefined;
}
function readPositiveIntFlag(args, flag) {
    const raw = (0, helpers_1.readFlagValue)(args, flag);
    if (raw === null)
        return undefined;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 'invalid';
}
function readNumberFlag(args, flag) {
    const raw = (0, helpers_1.readFlagValue)(args, flag);
    if (raw === null)
        return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 'invalid';
}
async function runConversationsCommand(args, context) {
    const [subcommand] = args;
    if (subcommand === 'list') {
        const handler = context.dependencies.conversations?.list;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Conversations list handler is not configured.');
        }
        const local = readLocalFlag(args);
        if (!local) {
            return (0, helpers_1.commandMissingFlag)('--local');
        }
        const limit = readPositiveIntFlag(args, '--limit');
        if (limit === 'invalid') {
            return (0, commandResult_1.commandFailed)('invalid_flag', '--limit must be a positive integer.');
        }
        return handler({ local, ...(limit !== undefined ? { limit } : {}) });
    }
    if (subcommand === 'messages') {
        const handler = context.dependencies.conversations?.messages;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Conversations messages handler is not configured.');
        }
        const local = readLocalFlag(args);
        if (!local) {
            return (0, helpers_1.commandMissingFlag)('--local');
        }
        const peer = (0, helpers_1.readFlagValue)(args, '--peer') || undefined;
        if (!peer) {
            return (0, helpers_1.commandMissingFlag)('--peer');
        }
        const limit = readPositiveIntFlag(args, '--limit');
        if (limit === 'invalid') {
            return (0, commandResult_1.commandFailed)('invalid_flag', '--limit must be a positive integer.');
        }
        const before = readNumberFlag(args, '--before');
        if (before === 'invalid') {
            return (0, commandResult_1.commandFailed)('invalid_flag', '--before must be a number.');
        }
        const after = readNumberFlag(args, '--after');
        if (after === 'invalid') {
            return (0, commandResult_1.commandFailed)('invalid_flag', '--after must be a number.');
        }
        return handler({
            local,
            peer,
            ...(limit !== undefined ? { limit } : {}),
            ...(before !== undefined ? { before } : {}),
            ...(after !== undefined ? { after } : {}),
        });
    }
    if (subcommand === 'guidance') {
        const handler = context.dependencies.conversations?.guidance;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Conversations guidance handler is not configured.');
        }
        const local = readLocalFlag(args);
        if (!local) {
            return (0, helpers_1.commandMissingFlag)('--local');
        }
        const peer = (0, helpers_1.readFlagValue)(args, '--peer') || undefined;
        if (!peer) {
            return (0, helpers_1.commandMissingFlag)('--peer');
        }
        const guidance = (0, helpers_1.readFlagValue)(args, '--guidance') || undefined;
        if (!guidance) {
            return (0, helpers_1.commandMissingFlag)('--guidance');
        }
        return handler({ local, peer, guidance });
    }
    return (0, helpers_1.commandUnknownSubcommand)(`conversations ${String(subcommand ?? '')}`.trim());
}
