"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMemoryCommand = runMemoryCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
function requireMemoryHandler(context, key) {
    const handler = context.dependencies.memory?.[key];
    if (!handler) {
        return (0, commandResult_1.commandFailed)('not_implemented', `Memory ${String(key)} handler is not configured.`);
    }
    return handler;
}
function isFailure(value) {
    return Boolean(value && typeof value === 'object' && value.ok === false);
}
function readOptionalLimit(args) {
    const raw = (0, helpers_1.readFlagValue)(args, '--limit');
    if (raw === null)
        return undefined;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 'invalid';
}
async function readPayload(context, args, options) {
    const payloadFile = (0, helpers_1.readFlagValue)(args, '--payload-file');
    if (!payloadFile) {
        if (options.required) {
            return (0, helpers_1.commandMissingFlag)('--payload-file');
        }
        return {};
    }
    try {
        return await (0, helpers_1.readJsonFile)(context, payloadFile);
    }
    catch (error) {
        return (0, commandResult_1.commandFailed)('invalid_payload', error instanceof Error ? error.message : String(error));
    }
}
async function runMemoryCommand(args, context) {
    const [subcommand, nested] = args;
    const from = (0, helpers_1.readFromFlag)(args);
    if (subcommand === 'list') {
        const handler = requireMemoryHandler(context, 'list');
        if (isFailure(handler))
            return handler;
        const limit = readOptionalLimit(args);
        if (limit === 'invalid') {
            return (0, commandResult_1.commandFailed)('invalid_flag', '--limit must be a positive integer.');
        }
        return handler({
            from,
            scopeKind: (0, helpers_1.readFlagValue)(args, '--scope-kind') ?? undefined,
            scopeKey: (0, helpers_1.readFlagValue)(args, '--scope-key') ?? undefined,
            usageClass: (0, helpers_1.readFlagValue)(args, '--usage-class') ?? undefined,
            status: (0, helpers_1.readFlagValue)(args, '--status') ?? undefined,
            origin: (0, helpers_1.readFlagValue)(args, '--origin') ?? undefined,
            query: (0, helpers_1.readFlagValue)(args, '--query') ?? undefined,
            includeDeleted: args.includes('--include-deleted'),
            ...(limit !== undefined ? { limit } : {}),
        });
    }
    if (subcommand === 'add' || subcommand === 'update' || subcommand === 'delete') {
        const handler = requireMemoryHandler(context, subcommand);
        if (isFailure(handler))
            return handler;
        const payload = await readPayload(context, args, { required: true });
        if (isFailure(payload))
            return payload;
        if ((subcommand === 'update' || subcommand === 'delete')
            && typeof payload.id !== 'string') {
            return (0, commandResult_1.commandFailed)('invalid_payload', 'payload.id is required.');
        }
        if (subcommand === 'add' && typeof payload.text !== 'string') {
            return (0, commandResult_1.commandFailed)('invalid_payload', 'payload.text is required.');
        }
        return handler({ from, payload });
    }
    if (subcommand === 'blocks') {
        const handler = requireMemoryHandler(context, 'blocks');
        if (isFailure(handler))
            return handler;
        const payload = await readPayload(context, args, { required: false });
        if (isFailure(payload))
            return payload;
        return handler({ from, payload });
    }
    if (subcommand === 'extract') {
        const handler = requireMemoryHandler(context, 'extract');
        if (isFailure(handler))
            return handler;
        const payload = await readPayload(context, args, { required: true });
        if (isFailure(payload))
            return payload;
        if (typeof payload.userText !== 'string' || typeof payload.assistantText !== 'string') {
            return (0, commandResult_1.commandFailed)('invalid_payload', 'payload.userText and payload.assistantText are required.');
        }
        return handler({ from, payload });
    }
    if (subcommand === 'policy') {
        if (nested === 'get') {
            const handler = requireMemoryHandler(context, 'policyGet');
            if (isFailure(handler))
                return handler;
            return handler({ from });
        }
        if (nested === 'set') {
            const handler = requireMemoryHandler(context, 'policySet');
            if (isFailure(handler))
                return handler;
            const payload = await readPayload(context, args, { required: true });
            if (isFailure(payload))
                return payload;
            return handler({ from, payload });
        }
        if (nested === 'delete') {
            const handler = requireMemoryHandler(context, 'policyDelete');
            if (isFailure(handler))
                return handler;
            return handler({ from });
        }
        return (0, helpers_1.commandUnknownSubcommand)(`memory policy ${String(nested ?? '')}`.trim());
    }
    if (subcommand === 'scopes') {
        const handler = requireMemoryHandler(context, 'scopes');
        if (isFailure(handler))
            return handler;
        return handler({ from });
    }
    if (subcommand === 'stats') {
        const handler = requireMemoryHandler(context, 'stats');
        if (isFailure(handler))
            return handler;
        return handler({
            from,
            scopeKind: (0, helpers_1.readFlagValue)(args, '--scope-kind') ?? undefined,
            scopeKey: (0, helpers_1.readFlagValue)(args, '--scope-key') ?? undefined,
        });
    }
    if (subcommand === 'transcript' && nested === 'append') {
        const handler = requireMemoryHandler(context, 'transcriptAppend');
        if (isFailure(handler))
            return handler;
        const payload = await readPayload(context, args, { required: true });
        if (isFailure(payload))
            return payload;
        if (typeof payload.sessionId !== 'string' || typeof payload.role !== 'string' || typeof payload.text !== 'string') {
            return (0, commandResult_1.commandFailed)('invalid_payload', 'payload.sessionId, payload.role and payload.text are required.');
        }
        return handler({ from, payload });
    }
    if (subcommand === 'chats') {
        const handler = requireMemoryHandler(context, 'chats');
        if (isFailure(handler))
            return handler;
        const limit = readOptionalLimit(args);
        if (limit === 'invalid') {
            return (0, commandResult_1.commandFailed)('invalid_flag', '--limit must be a positive integer.');
        }
        const sortOrder = (0, helpers_1.readFlagValue)(args, '--sort-order') ?? undefined;
        if (sortOrder !== undefined && sortOrder !== 'asc' && sortOrder !== 'desc') {
            return (0, commandResult_1.commandFailed)('invalid_flag', '--sort-order must be asc or desc.');
        }
        return handler({
            from,
            ...(limit !== undefined ? { limit } : {}),
            ...(sortOrder !== undefined ? { sortOrder: sortOrder } : {}),
        });
    }
    if (subcommand === 'search') {
        const handler = requireMemoryHandler(context, 'search');
        if (isFailure(handler))
            return handler;
        const payload = await readPayload(context, args, { required: true });
        if (isFailure(payload))
            return payload;
        if (typeof payload.query !== 'string') {
            return (0, commandResult_1.commandFailed)('invalid_payload', 'payload.query is required.');
        }
        return handler({ from, payload });
    }
    if (subcommand === 'recall') {
        const handler = requireMemoryHandler(context, 'recall');
        if (isFailure(handler))
            return handler;
        const payload = await readPayload(context, args, { required: false });
        if (isFailure(payload))
            return payload;
        return handler({ from, payload });
    }
    if (subcommand === 'knowledge') {
        if (nested === 'list') {
            const handler = requireMemoryHandler(context, 'knowledgeList');
            if (isFailure(handler))
                return handler;
            const limit = readOptionalLimit(args);
            if (limit === 'invalid') {
                return (0, commandResult_1.commandFailed)('invalid_flag', '--limit must be a positive integer.');
            }
            return handler({
                from,
                kind: (0, helpers_1.readFlagValue)(args, '--kind') ?? undefined,
                category: (0, helpers_1.readFlagValue)(args, '--category') ?? undefined,
                status: (0, helpers_1.readFlagValue)(args, '--status') ?? undefined,
                query: (0, helpers_1.readFlagValue)(args, '--query') ?? undefined,
                ...(limit !== undefined ? { limit } : {}),
            });
        }
        if (nested === 'upsert') {
            const handler = requireMemoryHandler(context, 'knowledgeUpsert');
            if (isFailure(handler))
                return handler;
            const payload = await readPayload(context, args, { required: true });
            if (isFailure(payload))
                return payload;
            if (typeof payload.topic !== 'string' || typeof payload.summary !== 'string') {
                return (0, commandResult_1.commandFailed)('invalid_payload', 'payload.topic and payload.summary are required.');
            }
            return handler({ from, payload });
        }
        if (nested === 'update' || nested === 'archive' || nested === 'delete') {
            const key = nested === 'update' ? 'knowledgeUpdate' : nested === 'archive' ? 'knowledgeArchive' : 'knowledgeDelete';
            const handler = requireMemoryHandler(context, key);
            if (isFailure(handler))
                return handler;
            const payload = await readPayload(context, args, { required: true });
            if (isFailure(payload))
                return payload;
            if (typeof payload.id !== 'string') {
                return (0, commandResult_1.commandFailed)('invalid_payload', 'payload.id is required.');
            }
            return handler({ from, payload });
        }
        return (0, helpers_1.commandUnknownSubcommand)(`memory knowledge ${String(nested ?? '')}`.trim());
    }
    if (subcommand === 'impressions') {
        if (nested === 'list') {
            const handler = requireMemoryHandler(context, 'impressionsList');
            if (isFailure(handler))
                return handler;
            return handler({ from });
        }
        if (nested === 'show') {
            const handler = requireMemoryHandler(context, 'impressionsShow');
            if (isFailure(handler))
                return handler;
            const subject = (0, helpers_1.readFlagValue)(args, '--subject');
            if (!subject) {
                return (0, helpers_1.commandMissingFlag)('--subject');
            }
            return handler({ from, subject });
        }
        return (0, helpers_1.commandUnknownSubcommand)(`memory impressions ${String(nested ?? '')}`.trim());
    }
    return (0, helpers_1.commandUnknownSubcommand)(`memory ${String(subcommand ?? '')}`.trim());
}
