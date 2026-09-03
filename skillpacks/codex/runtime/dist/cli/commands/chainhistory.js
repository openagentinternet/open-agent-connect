"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runChainhistoryCommand = runChainhistoryCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
function requireChainhistoryHandler(context, key) {
    const handler = context.dependencies.chainhistory?.[key];
    if (!handler) {
        return (0, commandResult_1.commandFailed)('not_implemented', `Chain history ${String(key)} handler is not configured.`);
    }
    return handler;
}
function isFailure(value) {
    return Boolean(value && typeof value === 'object' && value.ok === false);
}
function readOptionalString(payload, key) {
    const value = payload[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
/** recall date flags mirror the chain_history_recall tool contract (YYYY-MM-DD). */
const RECALL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
async function runChainhistoryCommand(args, context) {
    const [subcommand, nested] = args;
    const from = (0, helpers_1.readFromFlag)(args);
    if (subcommand === 'read' && nested === 'record') {
        const handler = requireChainhistoryHandler(context, 'recordRead');
        if (isFailure(handler))
            return handler;
        const payloadFile = (0, helpers_1.readFlagValue)(args, '--payload-file');
        if (!payloadFile) {
            return (0, helpers_1.commandMissingFlag)('--payload-file');
        }
        let payload;
        try {
            payload = await (0, helpers_1.readJsonFile)(context, payloadFile);
        }
        catch (error) {
            return (0, commandResult_1.commandFailed)('invalid_payload', error instanceof Error ? error.message : String(error));
        }
        const pinId = readOptionalString(payload, 'pinId');
        if (!pinId) {
            return (0, commandResult_1.commandFailed)('invalid_payload', 'payload.pinId is required.');
        }
        const input = {
            pinId,
            ...(readOptionalString(payload, 'path') ? { path: readOptionalString(payload, 'path') } : {}),
            ...(readOptionalString(payload, 'protocol') ? { protocol: readOptionalString(payload, 'protocol') } : {}),
            ...(readOptionalString(payload, 'title') ? { title: readOptionalString(payload, 'title') } : {}),
            ...(readOptionalString(payload, 'authorGlobalMetaId')
                ? { authorGlobalMetaId: readOptionalString(payload, 'authorGlobalMetaId') }
                : {}),
            ...(typeof payload.contentText === 'string' ? { contentText: payload.contentText } : {}),
            ...(readOptionalString(payload, 'source') ? { source: readOptionalString(payload, 'source') } : {}),
        };
        return handler({ from, input });
    }
    if (subcommand === 'read') {
        return (0, helpers_1.commandUnknownSubcommand)(`chainhistory read ${String(nested ?? '')}`.trim());
    }
    if (subcommand === 'recall') {
        const handler = requireChainhistoryHandler(context, 'recall');
        if (isFailure(handler))
            return handler;
        const kind = (0, helpers_1.readFlagValue)(args, '--kind');
        if (kind !== null && kind !== 'write' && kind !== 'read') {
            return (0, commandResult_1.commandFailed)('invalid_flag', '--kind must be "write" or "read".');
        }
        const fromDate = (0, helpers_1.readFlagValue)(args, '--from-date');
        const toDate = (0, helpers_1.readFlagValue)(args, '--to-date');
        if (fromDate !== null && !RECALL_DATE_PATTERN.test(fromDate)) {
            return (0, commandResult_1.commandFailed)('invalid_flag', '--from-date must be YYYY-MM-DD.');
        }
        if (toDate !== null && !RECALL_DATE_PATTERN.test(toDate)) {
            return (0, commandResult_1.commandFailed)('invalid_flag', '--to-date must be YYYY-MM-DD.');
        }
        if (fromDate !== null && toDate !== null && fromDate > toDate) {
            return (0, commandResult_1.commandFailed)('invalid_flag', '--from-date must not be after --to-date.');
        }
        const rawLimit = (0, helpers_1.readFlagValue)(args, '--limit');
        const limit = rawLimit === null ? undefined : Number(rawLimit);
        if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
            return (0, commandResult_1.commandFailed)('invalid_flag', '--limit must be a positive integer.');
        }
        const query = (0, helpers_1.readFlagValue)(args, '--query');
        return handler({
            from,
            ...(query !== null && query.trim() ? { query: query.trim() } : {}),
            ...(kind !== null ? { kind: kind } : {}),
            ...(fromDate !== null ? { fromDate } : {}),
            ...(toDate !== null ? { toDate } : {}),
            ...(limit !== undefined ? { limit } : {}),
        });
    }
    if (subcommand === 'summary' && nested === 'pending') {
        const handler = requireChainhistoryHandler(context, 'summaryPending');
        if (isFailure(handler))
            return handler;
        const rawLimit = (0, helpers_1.readFlagValue)(args, '--limit');
        const limit = rawLimit === null ? undefined : Number(rawLimit);
        if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
            return (0, commandResult_1.commandFailed)('invalid_flag', '--limit must be a positive integer.');
        }
        return handler({ from, ...(limit !== undefined ? { limit } : {}) });
    }
    if (subcommand === 'summary' && nested === 'apply') {
        const handler = requireChainhistoryHandler(context, 'summaryApply');
        if (isFailure(handler))
            return handler;
        const payloadFile = (0, helpers_1.readFlagValue)(args, '--payload-file');
        if (!payloadFile) {
            return (0, helpers_1.commandMissingFlag)('--payload-file');
        }
        let payload;
        try {
            payload = await (0, helpers_1.readJsonFile)(context, payloadFile);
        }
        catch (error) {
            return (0, commandResult_1.commandFailed)('invalid_payload', error instanceof Error ? error.message : String(error));
        }
        const kind = readOptionalString(payload, 'kind');
        if (kind !== 'write' && kind !== 'read') {
            return (0, commandResult_1.commandFailed)('invalid_payload', 'payload.kind must be "write" or "read".');
        }
        const pinId = readOptionalString(payload, 'pinId');
        if (!pinId) {
            return (0, commandResult_1.commandFailed)('invalid_payload', 'payload.pinId is required.');
        }
        const outcome = readOptionalString(payload, 'outcome');
        if (outcome !== 'done' && outcome !== 'failed') {
            return (0, commandResult_1.commandFailed)('invalid_payload', 'payload.outcome must be "done" or "failed".');
        }
        const summary = typeof payload.summary === 'string' ? payload.summary : undefined;
        if (outcome === 'done' && !(summary && summary.trim())) {
            return (0, commandResult_1.commandFailed)('invalid_payload', 'payload.summary is required when outcome is "done".');
        }
        return handler({
            from,
            kind: kind,
            pinId,
            outcome,
            ...(summary !== undefined ? { summary } : {}),
        });
    }
    if (subcommand === 'summary') {
        return (0, helpers_1.commandUnknownSubcommand)(`chainhistory summary ${String(nested ?? '')}`.trim());
    }
    return (0, helpers_1.commandUnknownSubcommand)(`chainhistory ${String(subcommand ?? '')}`.trim());
}
