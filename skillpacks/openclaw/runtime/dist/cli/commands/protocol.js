"use strict";
/**
 * `metabot protocol …` — the MetaID protocol registry (/protocols/metaprotocol,
 * docs/metaid_protocols/metaprotocol-registry-agent-tools.md): read verbs
 * (list / read / versions / check) run in-process against the metaso-p2p
 * registry projection, and the publish / update writers go through the
 * daemon's /api/protocol/* routes with --request-file + --from. OAC port of
 * the IDBots feat/metaprotocol-registry-tools CLI surface.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runProtocolCommand = runProtocolCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
function commandNotImplemented(command) {
    return {
        ok: false,
        state: 'failed',
        code: 'not_implemented',
        message: `The "${command}" protocol command is not configured in this runtime.`,
    };
}
function readNumberFlag(args, flag) {
    const raw = (0, helpers_1.readFlagValue)(args, flag);
    if (raw == null)
        return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
}
function readLocator(args) {
    return {
        ...((0, helpers_1.readFlagValue)(args, '--path') ? { protocolPath: (0, helpers_1.readFlagValue)(args, '--path') } : {}),
        ...((0, helpers_1.readFlagValue)(args, '--name') ? { protocolName: (0, helpers_1.readFlagValue)(args, '--name') } : {}),
        ...((0, helpers_1.readFlagValue)(args, '--pin') ? { pinId: (0, helpers_1.readFlagValue)(args, '--pin') } : {}),
    };
}
async function runProtocolCommand(args, context) {
    const subcommand = args[0];
    if (subcommand === 'list') {
        const handler = context.dependencies.protocol?.list;
        if (!handler)
            return commandNotImplemented('list');
        return handler({
            ...((0, helpers_1.readFlagValue)(args, '--query') ? { query: (0, helpers_1.readFlagValue)(args, '--query') } : {}),
            ...((0, helpers_1.readFlagValue)(args, '--publisher') ? { publisher: (0, helpers_1.readFlagValue)(args, '--publisher') } : {}),
            ...(readNumberFlag(args, '--size') != null ? { size: readNumberFlag(args, '--size') } : {}),
            ...((0, helpers_1.readFlagValue)(args, '--cursor') ? { cursor: (0, helpers_1.readFlagValue)(args, '--cursor') } : {}),
        });
    }
    if (subcommand === 'read' || subcommand === 'versions') {
        const handler = subcommand === 'read' ? context.dependencies.protocol?.read : context.dependencies.protocol?.versions;
        if (!handler)
            return commandNotImplemented(subcommand);
        const locator = readLocator(args);
        if (!locator.protocolPath && !locator.protocolName && !locator.pinId) {
            return (0, helpers_1.commandMissingFlag)('--path');
        }
        return handler(locator);
    }
    if (subcommand === 'check') {
        const protocolPath = (0, helpers_1.readFlagValue)(args, '--path');
        if (!protocolPath)
            return (0, helpers_1.commandMissingFlag)('--path');
        const handler = context.dependencies.protocol?.check;
        if (!handler)
            return commandNotImplemented('check');
        return handler({ protocolPath });
    }
    if (subcommand === 'publish' || subcommand === 'update') {
        const requestFile = (0, helpers_1.readFlagValue)(args, '--request-file');
        if (!requestFile) {
            return (0, helpers_1.commandMissingFlag)('--request-file');
        }
        const from = (0, helpers_1.readFromFlag)(args);
        const chainFlag = (0, helpers_1.readChainWriteFlag)(args);
        if (chainFlag.error) {
            return chainFlag.error;
        }
        const handler = subcommand === 'publish' ? context.dependencies.protocol?.publish : context.dependencies.protocol?.update;
        if (!handler)
            return commandNotImplemented(subcommand);
        const request = await (0, helpers_1.readJsonFile)(context, requestFile);
        const resolvedRequest = {
            ...request,
            // snake_case mirrors of the tool-facing field names (qanda pattern).
            ...(request.protocol_name != null && request.protocolName == null
                ? { protocolName: request.protocol_name }
                : {}),
            ...(request.protocol_content_type != null && request.protocolContentType == null
                ? { protocolContentType: request.protocol_content_type }
                : {}),
            ...(request.protocol_content != null && request.protocolContent == null
                ? { protocolContent: request.protocol_content }
                : {}),
            ...(chainFlag.chain ? { network: chainFlag.chain } : {}),
            ...(from ? { from } : {}),
        };
        return handler(resolvedRequest);
    }
    if (subcommand === undefined) {
        return (0, commandResult_1.commandFailed)('missing_subcommand', 'Usage: metabot protocol <list|read|versions|check|publish|update> …');
    }
    return (0, helpers_1.commandUnknownSubcommand)(`protocol ${args.join(' ')}`.trim());
}
