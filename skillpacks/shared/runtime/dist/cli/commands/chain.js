"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runChainCommand = runChainCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
async function runChainCommand(args, context) {
    if (args[0] !== 'write') {
        return (0, helpers_1.commandUnknownSubcommand)(`chain ${args.join(' ')}`.trim());
    }
    const requestFile = (0, helpers_1.readFlagValue)(args, '--request-file');
    if (!requestFile) {
        return (0, helpers_1.commandMissingFlag)('--request-file');
    }
    const chainFlag = (0, helpers_1.readAnyChainFlag)(args);
    if (chainFlag.error) {
        return chainFlag.error;
    }
    const handler = context.dependencies.chain?.write;
    if (!handler) {
        return (0, commandResult_1.commandFailed)('not_implemented', 'Chain write handler is not configured.');
    }
    const request = await (0, helpers_1.readJsonFile)(context, requestFile);
    return handler(chainFlag.chain ? { ...request, network: chainFlag.chain } : request);
}
