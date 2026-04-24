"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMasterCommand = runMasterCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
async function runMasterCommand(args, context) {
    const subcommand = args[0];
    if (subcommand === 'publish') {
        const payloadFile = (0, helpers_1.readFlagValue)(args, '--payload-file');
        if (!payloadFile) {
            return (0, helpers_1.commandMissingFlag)('--payload-file');
        }
        const chainFlag = (0, helpers_1.readChainFlag)(args);
        if (chainFlag.error) {
            return chainFlag.error;
        }
        const handler = context.dependencies.master?.publish;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Master publish handler is not configured.');
        }
        const payload = await (0, helpers_1.readJsonFile)(context, payloadFile);
        return handler(chainFlag.chain ? { ...payload, network: chainFlag.chain } : payload);
    }
    if (subcommand === 'list') {
        const handler = context.dependencies.master?.list;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Master list handler is not configured.');
        }
        return handler({
            online: (0, helpers_1.hasFlag)(args, '--online') ? true : undefined,
            masterKind: (0, helpers_1.readFlagValue)(args, '--kind') ?? undefined,
        });
    }
    if (subcommand === 'ask') {
        const handler = context.dependencies.master?.ask;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Master ask handler is not configured.');
        }
        const confirm = (0, helpers_1.hasFlag)(args, '--confirm');
        const traceId = (0, helpers_1.readFlagValue)(args, '--trace-id');
        if (traceId) {
            return handler({
                traceId,
                confirm,
            });
        }
        const requestFile = (0, helpers_1.readFlagValue)(args, '--request-file');
        if (!requestFile) {
            return (0, helpers_1.commandMissingFlag)('--request-file');
        }
        if (confirm) {
            return (0, commandResult_1.commandFailed)('invalid_argument', '`metabot master ask --confirm` requires `--trace-id <trace-id>` and cannot be combined with `--request-file`.');
        }
        const payload = await (0, helpers_1.readJsonFile)(context, requestFile);
        return handler({
            ...payload,
            confirm,
        });
    }
    if (subcommand === 'suggest') {
        const handler = context.dependencies.master?.suggest;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Master suggest handler is not configured.');
        }
        const requestFile = (0, helpers_1.readFlagValue)(args, '--request-file');
        if (!requestFile) {
            return (0, helpers_1.commandMissingFlag)('--request-file');
        }
        const payload = await (0, helpers_1.readJsonFile)(context, requestFile);
        return handler(payload);
    }
    if (subcommand === 'host-action') {
        const handler = context.dependencies.master?.hostAction;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Master host-action handler is not configured.');
        }
        const requestFile = (0, helpers_1.readFlagValue)(args, '--request-file');
        if (!requestFile) {
            return (0, helpers_1.commandMissingFlag)('--request-file');
        }
        const payload = await (0, helpers_1.readJsonFile)(context, requestFile);
        return handler(payload);
    }
    if (subcommand === 'trace') {
        const traceId = (0, helpers_1.readFlagValue)(args, '--id');
        if (!traceId) {
            return (0, helpers_1.commandMissingFlag)('--id');
        }
        const handler = context.dependencies.master?.trace;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Master trace handler is not configured.');
        }
        return handler({ traceId });
    }
    return (0, helpers_1.commandUnknownSubcommand)(`master ${args.join(' ')}`.trim());
}
