"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runServicesCommand = runServicesCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
async function runServicesCommand(args, context) {
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
        const handler = context.dependencies.services?.publish;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Services publish handler is not configured.');
        }
        const payload = await (0, helpers_1.readJsonFile)(context, payloadFile);
        return handler(chainFlag.chain ? { ...payload, network: chainFlag.chain } : payload);
    }
    if (subcommand === 'call') {
        const requestFile = (0, helpers_1.readFlagValue)(args, '--request-file');
        if (!requestFile) {
            return (0, helpers_1.commandMissingFlag)('--request-file');
        }
        const handler = context.dependencies.services?.call;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Services call handler is not configured.');
        }
        const request = await (0, helpers_1.readJsonFile)(context, requestFile);
        return handler(request);
    }
    if (subcommand === 'rate') {
        const requestFile = (0, helpers_1.readFlagValue)(args, '--request-file');
        if (!requestFile) {
            return (0, helpers_1.commandMissingFlag)('--request-file');
        }
        const chainFlag = (0, helpers_1.readChainFlag)(args);
        if (chainFlag.error) {
            return chainFlag.error;
        }
        const handler = context.dependencies.services?.rate;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Services rate handler is not configured.');
        }
        const request = await (0, helpers_1.readJsonFile)(context, requestFile);
        return handler(chainFlag.chain ? { ...request, network: chainFlag.chain } : request);
    }
    return (0, helpers_1.commandUnknownSubcommand)(`services ${args.join(' ')}`.trim());
}
