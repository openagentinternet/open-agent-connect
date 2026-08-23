"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runTwinCommand = runTwinCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
function requireTwinHandler(context, key) {
    const handler = context.dependencies.twin?.[key];
    if (!handler) {
        return (0, commandResult_1.commandFailed)('not_implemented', `Twin ${String(key)} handler is not configured.`);
    }
    return handler;
}
function isFailure(value) {
    return Boolean(value && typeof value === 'object' && value.ok === false);
}
async function runTwinCommand(args, context) {
    const [subcommand, nested] = args;
    const from = (0, helpers_1.readFromFlag)(args);
    if (subcommand === 'current') {
        const handler = requireTwinHandler(context, 'current');
        if (isFailure(handler))
            return handler;
        return handler();
    }
    if (subcommand === 'workers') {
        const handler = requireTwinHandler(context, 'workers');
        if (isFailure(handler))
            return handler;
        return handler({ from });
    }
    if (subcommand === 'tasks') {
        if (nested === 'create') {
            const handler = requireTwinHandler(context, 'tasksCreate');
            if (isFailure(handler))
                return handler;
            const payloadFile = (0, helpers_1.readFlagValue)(args, '--payload-file');
            if (!payloadFile)
                return (0, helpers_1.commandMissingFlag)('--payload-file');
            let payload;
            try {
                payload = await (0, helpers_1.readJsonFile)(context, payloadFile);
            }
            catch (error) {
                return (0, commandResult_1.commandFailed)('invalid_payload', error instanceof Error ? error.message : String(error));
            }
            if (typeof payload.title !== 'string' || !payload.title.trim()) {
                return (0, commandResult_1.commandFailed)('invalid_payload', 'payload.title is required.');
            }
            return handler({ from, payload });
        }
        if (nested === 'list') {
            const handler = requireTwinHandler(context, 'tasksList');
            if (isFailure(handler))
                return handler;
            const rawLimit = (0, helpers_1.readFlagValue)(args, '--limit');
            const limit = rawLimit === null ? undefined : Number(rawLimit);
            if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
                return (0, commandResult_1.commandFailed)('invalid_flag', '--limit must be a positive integer.');
            }
            return handler({
                from,
                status: (0, helpers_1.readFlagValue)(args, '--status') ?? undefined,
                ...(limit !== undefined ? { limit } : {}),
            });
        }
        if (nested === 'show') {
            const handler = requireTwinHandler(context, 'tasksShow');
            if (isFailure(handler))
                return handler;
            const taskId = (0, helpers_1.readFlagValue)(args, '--task-id');
            if (!taskId)
                return (0, helpers_1.commandMissingFlag)('--task-id');
            return handler({ from, taskId });
        }
        if (nested === 'update') {
            const handler = requireTwinHandler(context, 'tasksUpdate');
            if (isFailure(handler))
                return handler;
            const payloadFile = (0, helpers_1.readFlagValue)(args, '--payload-file');
            if (!payloadFile)
                return (0, helpers_1.commandMissingFlag)('--payload-file');
            let payload;
            try {
                payload = await (0, helpers_1.readJsonFile)(context, payloadFile);
            }
            catch (error) {
                return (0, commandResult_1.commandFailed)('invalid_payload', error instanceof Error ? error.message : String(error));
            }
            if (typeof payload.taskId !== 'string' || !payload.taskId.trim()) {
                return (0, commandResult_1.commandFailed)('invalid_payload', 'payload.taskId is required.');
            }
            return handler({ from, payload });
        }
        if (nested === 'pending-notify') {
            const handler = requireTwinHandler(context, 'tasksPendingNotify');
            if (isFailure(handler))
                return handler;
            return handler({ from });
        }
        return (0, helpers_1.commandUnknownSubcommand)(`twin tasks ${String(nested ?? '')}`.trim());
    }
    return (0, helpers_1.commandUnknownSubcommand)(`twin ${String(subcommand ?? '')}`.trim());
}
