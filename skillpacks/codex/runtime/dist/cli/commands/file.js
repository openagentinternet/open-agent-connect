"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runFileCommand = runFileCommand;
const node_path_1 = __importDefault(require("node:path"));
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
const UPLOAD_LARGE_SOURCE_MESSAGE = 'Choose exactly one upload file source: --file, positional path, or --request-file.';
const UPLOAD_LARGE_POSITIONAL_VALUE_FLAGS = new Set([
    '--request-file',
    '--file',
    '--content-type',
    '--from',
    '--chain',
]);
function resolveMaybeRelativePath(baseDir, filePath) {
    if (typeof filePath !== 'string')
        return undefined;
    return node_path_1.default.isAbsolute(filePath) ? filePath : node_path_1.default.resolve(baseDir, filePath);
}
function readNonEmptyFlagValue(args, flag) {
    const value = (0, helpers_1.readFlagValue)(args, flag);
    if (typeof value !== 'string' || value.startsWith('--') || value.trim() === '') {
        return undefined;
    }
    return value;
}
function validateDirectInputFlagValue(args, flag) {
    const index = args.indexOf(flag);
    if (index === -1) {
        return null;
    }
    const value = args[index + 1];
    if (typeof value !== 'string' || value.startsWith('--') || value.trim() === '') {
        return (0, commandResult_1.commandFailed)('invalid_flag', `Missing value for ${flag}.`);
    }
    return null;
}
function collectUploadLargePositionalPaths(args) {
    const positionalPaths = [];
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (UPLOAD_LARGE_POSITIONAL_VALUE_FLAGS.has(arg)) {
            index += 1;
            continue;
        }
        if (arg.startsWith('--')) {
            continue;
        }
        positionalPaths.push(arg);
    }
    return positionalPaths;
}
async function runFileCommand(args, context) {
    const subcommand = args[0];
    if (subcommand !== 'upload' && subcommand !== 'upload-large') {
        return (0, helpers_1.commandUnknownSubcommand)(`file ${args.join(' ')}`.trim());
    }
    const commandArgs = args.slice(1);
    if (subcommand === 'upload') {
        const requestFile = (0, helpers_1.readFlagValue)(commandArgs, '--request-file');
        if (!requestFile) {
            return (0, helpers_1.commandMissingFlag)('--request-file');
        }
        const from = (0, helpers_1.readFromFlag)(commandArgs);
        const chainFlag = (0, helpers_1.readFileUploadChainFlag)(commandArgs);
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
            ...(from ? { from } : {}),
        };
        return handler(resolvedRequest);
    }
    const from = (0, helpers_1.readFromFlag)(commandArgs);
    const chainFlag = (0, helpers_1.readFileUploadChainFlag)(commandArgs);
    if (chainFlag.error) {
        return chainFlag.error;
    }
    const requestFile = (0, helpers_1.readFlagValue)(commandArgs, '--request-file');
    const fileFlagError = validateDirectInputFlagValue(commandArgs, '--file');
    if (fileFlagError) {
        return fileFlagError;
    }
    const contentTypeFlagError = validateDirectInputFlagValue(commandArgs, '--content-type');
    if (contentTypeFlagError) {
        return contentTypeFlagError;
    }
    const fileFlag = readNonEmptyFlagValue(commandArgs, '--file');
    const positionalPaths = collectUploadLargePositionalPaths(commandArgs);
    if (positionalPaths.length > 1) {
        return (0, commandResult_1.commandFailed)('invalid_flag', UPLOAD_LARGE_SOURCE_MESSAGE);
    }
    const sourceCount = [requestFile, fileFlag, positionalPaths[0]].filter(Boolean).length;
    if (sourceCount > 1) {
        return (0, commandResult_1.commandFailed)('invalid_flag', UPLOAD_LARGE_SOURCE_MESSAGE);
    }
    if (sourceCount === 0) {
        return (0, helpers_1.commandMissingFlag)('--request-file');
    }
    const handler = context.dependencies.file?.uploadLarge;
    if (!handler) {
        return (0, commandResult_1.commandFailed)('not_implemented', 'Large file upload handler is not configured.');
    }
    if (!requestFile) {
        const contentType = readNonEmptyFlagValue(commandArgs, '--content-type')?.trim();
        const filePath = fileFlag ?? positionalPaths[0];
        return handler({
            filePath,
            ...(contentType ? { contentType } : {}),
            ...(chainFlag.chain ? { network: chainFlag.chain } : {}),
            ...(from ? { from } : {}),
            ...((0, helpers_1.hasFlag)(commandArgs, '--verify') ? { verify: true } : {}),
        });
    }
    const request = await (0, helpers_1.readJsonFile)(context, requestFile);
    const requestDir = node_path_1.default.dirname(node_path_1.default.isAbsolute(requestFile) ? requestFile : node_path_1.default.resolve(context.cwd, requestFile));
    const resolvedRequest = {
        ...request,
        filePath: resolveMaybeRelativePath(requestDir, request.filePath) ?? request.filePath,
        ...(chainFlag.chain ? { network: chainFlag.chain } : {}),
        ...(from ? { from } : {}),
        ...((0, helpers_1.hasFlag)(commandArgs, '--verify') ? { verify: true } : {}),
    };
    return handler(resolvedRequest);
}
