"use strict";
/**
 * `metabot metatask …` — MetaTask read verbs (P1). Each subcommand parses
 * flags and delegates to context.dependencies.metatask, which the runtime
 * wires to the daemon's /api/metatask/* routes (the daemon is the single
 * writer of the shared projection cache). Write verbs (claim/submit/verify/
 * publish/amend) land with the P3 write path.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMetaTaskCommand = runMetaTaskCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function requireHandler(context, key) {
    const handler = context.dependencies.metatask?.[key];
    return (handler ?? null);
}
async function runMetaTaskCommand(args, context) {
    const action = normalizeText(args[0]);
    if (action === 'list' || action === 'board') {
        const handler = requireHandler(context, 'list');
        if (!handler)
            return (0, commandResult_1.commandFailed)('not_implemented', 'MetaTask list handler is not configured.');
        return handler({ ...((0, helpers_1.hasFlag)(args, '--refresh') ? { refresh: true } : {}) });
    }
    if (action === 'get' || action === 'detail') {
        const handler = requireHandler(context, 'get');
        if (!handler)
            return (0, commandResult_1.commandFailed)('not_implemented', 'MetaTask get handler is not configured.');
        const root = normalizeText((0, helpers_1.readFlagValue)(args, '--root'));
        if (!root)
            return (0, helpers_1.commandMissingFlag)('--root');
        return handler({ root, ...((0, helpers_1.hasFlag)(args, '--refresh') ? { refresh: true } : {}) });
    }
    if (action === 'replay') {
        const handler = requireHandler(context, 'replay');
        if (!handler)
            return (0, commandResult_1.commandFailed)('not_implemented', 'MetaTask replay handler is not configured.');
        const root = normalizeText((0, helpers_1.readFlagValue)(args, '--root'));
        if (!root)
            return (0, helpers_1.commandMissingFlag)('--root');
        return handler({ root });
    }
    if (action === 'refresh') {
        const handler = requireHandler(context, 'refresh');
        if (!handler)
            return (0, commandResult_1.commandFailed)('not_implemented', 'MetaTask refresh handler is not configured.');
        return handler({ reason: 'cli-refresh' });
    }
    if (action === 'claim') {
        const handler = requireHandler(context, 'claim');
        if (!handler)
            return (0, commandResult_1.commandFailed)('not_implemented', 'MetaTask claim handler is not configured.');
        const root = normalizeText((0, helpers_1.readFlagValue)(args, '--root'));
        if (!root)
            return (0, helpers_1.commandMissingFlag)('--root');
        const node = normalizeText((0, helpers_1.readFlagValue)(args, '--node'));
        if (!node)
            return (0, helpers_1.commandMissingFlag)('--node');
        return handler({ root, node, ...actorArg(args) });
    }
    if (action === 'release') {
        const handler = requireHandler(context, 'release');
        if (!handler)
            return (0, commandResult_1.commandFailed)('not_implemented', 'MetaTask release handler is not configured.');
        const root = normalizeText((0, helpers_1.readFlagValue)(args, '--root'));
        if (!root)
            return (0, helpers_1.commandMissingFlag)('--root');
        const node = normalizeText((0, helpers_1.readFlagValue)(args, '--node'));
        if (!node)
            return (0, helpers_1.commandMissingFlag)('--node');
        const claimPinId = normalizeText((0, helpers_1.readFlagValue)(args, '--claim'));
        if (!claimPinId)
            return (0, helpers_1.commandMissingFlag)('--claim');
        return handler({ root, node, claimPinId, ...actorArg(args) });
    }
    if (action === 'submit' || action === 'verify' || action === 'publish'
        || action === 'publish-spec' || action === 'amend') {
        const verb = action === 'publish-spec' ? 'publishSpec' : action;
        const handler = requireHandler(context, verb);
        if (!handler)
            return (0, commandResult_1.commandFailed)('not_implemented', `MetaTask ${action} handler is not configured.`);
        const requestFile = normalizeText((0, helpers_1.readFlagValue)(args, '--request-file'));
        if (!requestFile)
            return (0, helpers_1.commandMissingFlag)('--request-file');
        let body;
        try {
            body = await (0, helpers_1.readJsonFile)(context, requestFile);
        }
        catch (error) {
            return (0, commandResult_1.commandFailed)('invalid_request_file', error instanceof Error ? error.message : 'Cannot read the request file.');
        }
        // Canonical aliases: --root feeds rootPinId; publish accepts the
        // --allow-pre-activation escape hatch as a flag override.
        if (!body.root && (action === 'submit' || action === 'amend')) {
            const root = normalizeText((0, helpers_1.readFlagValue)(args, '--root'));
            if (root)
                body.root = root;
        }
        if (action === 'publish' && (0, helpers_1.hasFlag)(args, '--allow-pre-activation')) {
            body.allowPreActivation = true;
        }
        return handler({ ...body, ...actorArg(args) });
    }
    return (0, commandResult_1.commandFailed)('unknown_subcommand', 'Unknown metatask subcommand. Use: list | get | replay | refresh | claim | release | submit | verify | publish | publish-spec | amend.');
}
/** `--from <bot-slug>` selects the acting MetaBot for write verbs. */
function actorArg(args) {
    const from = normalizeText((0, helpers_1.readFlagValue)(args, '--from'));
    return from ? { from } : {};
}
