"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runFileCommand = runFileCommand;
const node_path_1 = __importDefault(require("node:path"));
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
function resolveMaybeRelativePath(baseDir, filePath) {
    if (typeof filePath !== 'string')
        return undefined;
    return node_path_1.default.isAbsolute(filePath) ? filePath : node_path_1.default.resolve(baseDir, filePath);
}
async function runFileCommand(args, context) {
    if (args[0] !== 'upload') {
        return (0, helpers_1.commandUnknownSubcommand)(`file ${args.join(' ')}`.trim());
    }
    const requestFile = (0, helpers_1.readFlagValue)(args, '--request-file');
    if (!requestFile) {
        return (0, helpers_1.commandMissingFlag)('--request-file');
    }
    const chainFlag = (0, helpers_1.readFileUploadChainFlag)(args);
    if (chainFlag.error) {
        return chainFlag.error;
    }
    const handler = context.dependencies.file?.upload;
    if (!handler) {
        return (0, commandResult_1.commandFailed)('not_implemented', 'File upload handler is not configured.');
    }
    const request = await (0, helpers_1.readJsonFile)(context, requestFile);
    const requestDir = node_path_1.default.dirname(node_path_1.default.isAbsolute(requestFile) ? requestFile : node_path_1.default.resolve(context.cwd, requestFile));
    const resolvedRequest = {
        ...request,
        filePath: resolveMaybeRelativePath(requestDir, request.filePath) ?? request.filePath,
        ...(chainFlag.chain ? { network: chainFlag.chain } : {}),
    };
    return handler(resolvedRequest);
}
