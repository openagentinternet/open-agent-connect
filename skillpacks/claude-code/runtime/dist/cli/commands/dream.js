"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDreamCommand = runDreamCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
function requireDreamHandler(context, key) {
    const handler = context.dependencies.dream?.[key];
    if (!handler) {
        return (0, commandResult_1.commandFailed)('not_implemented', `Dream ${String(key)} handler is not configured.`);
    }
    return handler;
}
function isFailure(value) {
    return Boolean(value && typeof value === 'object' && value.ok === false);
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function readDateFlag(args) {
    const raw = (0, helpers_1.readFlagValue)(args, '--date');
    if (raw === null)
        return undefined;
    return DATE_RE.test(raw.trim()) ? raw.trim() : 'invalid';
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
async function runDreamCommand(args, context) {
    const [subcommand] = args;
    const from = (0, helpers_1.readFromFlag)(args);
    if (subcommand === 'due' || subcommand === 'status') {
        const handler = requireDreamHandler(context, subcommand);
        if (isFailure(handler))
            return handler;
        return handler({ from });
    }
    if (subcommand === 'plan' || subcommand === 'run') {
        const handler = requireDreamHandler(context, subcommand);
        if (isFailure(handler))
            return handler;
        const date = readDateFlag(args);
        if (date === 'invalid') {
            return (0, commandResult_1.commandFailed)('invalid_flag', '--date must be YYYY-MM-DD.');
        }
        const payload = await readPayload(context, args, { required: false });
        if (isFailure(payload))
            return payload;
        return handler({ from, ...(date ? { date } : {}), payload });
    }
    if (subcommand === 'synthesize' || subcommand === 'commit') {
        const handler = requireDreamHandler(context, subcommand);
        if (isFailure(handler))
            return handler;
        const payload = await readPayload(context, args, { required: true });
        if (isFailure(payload))
            return payload;
        if (typeof payload.date !== 'string' || !DATE_RE.test(payload.date)) {
            return (0, commandResult_1.commandFailed)('invalid_payload', 'payload.date (YYYY-MM-DD) is required.');
        }
        if (subcommand === 'synthesize'
            && (!payload.fragmentOutputs || typeof payload.fragmentOutputs !== 'object' || Array.isArray(payload.fragmentOutputs))) {
            return (0, commandResult_1.commandFailed)('invalid_payload', 'payload.fragmentOutputs (object keyed by fragmentKey) is required.');
        }
        if (subcommand === 'commit' && typeof payload.outputText !== 'string') {
            return (0, commandResult_1.commandFailed)('invalid_payload', 'payload.outputText is required.');
        }
        return handler({ from, payload });
    }
    if (subcommand === 'fail') {
        const handler = requireDreamHandler(context, 'fail');
        if (isFailure(handler))
            return handler;
        const payload = await readPayload(context, args, { required: true });
        if (isFailure(payload))
            return payload;
        if (typeof payload.date !== 'string' || !DATE_RE.test(payload.date)) {
            return (0, commandResult_1.commandFailed)('invalid_payload', 'payload.date (YYYY-MM-DD) is required.');
        }
        return handler({ from, payload });
    }
    if (subcommand === 'summaries') {
        const handler = requireDreamHandler(context, 'summaries');
        if (isFailure(handler))
            return handler;
        const rawLimit = (0, helpers_1.readFlagValue)(args, '--limit');
        const limit = rawLimit === null ? undefined : Number(rawLimit);
        if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
            return (0, commandResult_1.commandFailed)('invalid_flag', '--limit must be a positive integer.');
        }
        return handler({
            from,
            ...(limit !== undefined ? { limit } : {}),
            before: (0, helpers_1.readFlagValue)(args, '--before') ?? undefined,
        });
    }
    if (subcommand === 'self-identity') {
        const handler = requireDreamHandler(context, 'selfIdentity');
        if (isFailure(handler))
            return handler;
        return handler({ from });
    }
    return (0, helpers_1.commandUnknownSubcommand)(`dream ${String(subcommand ?? '')}`.trim());
}
