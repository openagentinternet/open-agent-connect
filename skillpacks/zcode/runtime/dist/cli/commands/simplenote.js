"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSimpleNoteCommand = runSimpleNoteCommand;
const node_path_1 = __importDefault(require("node:path"));
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
function resolveMaybeRelativePath(baseDir, filePath) {
    if (typeof filePath !== 'string')
        return undefined;
    if (node_path_1.default.isAbsolute(filePath))
        return filePath;
    // URI-shaped values (metafile://…) pass through untouched.
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(filePath))
        return filePath;
    return node_path_1.default.resolve(baseDir, filePath);
}
function resolveFileList(baseDir, value) {
    if (!Array.isArray(value))
        return value;
    return value.map((entry) => resolveMaybeRelativePath(baseDir, entry) ?? entry);
}
async function runSimpleNoteCommand(args, context) {
    if (args[0] !== 'post') {
        return (0, helpers_1.commandUnknownSubcommand)(`simplenote ${args.join(' ')}`.trim());
    }
    const requestFile = (0, helpers_1.readFlagValue)(args, '--request-file');
    if (!requestFile) {
        return (0, helpers_1.commandMissingFlag)('--request-file');
    }
    const from = (0, helpers_1.readFromFlag)(args);
    const chainFlag = (0, helpers_1.readChainWriteFlag)(args);
    if (chainFlag.error) {
        return chainFlag.error;
    }
    const handler = context.dependencies.simplenote?.post;
    if (!handler) {
        return (0, commandResult_1.commandFailed)('not_implemented', 'SimpleNote post handler is not configured.');
    }
    const request = await (0, helpers_1.readJsonFile)(context, requestFile);
    const requestDir = node_path_1.default.dirname(node_path_1.default.isAbsolute(requestFile) ? requestFile : node_path_1.default.resolve(context.cwd, requestFile));
    const cover = resolveMaybeRelativePath(requestDir, request.cover);
    const attachments = resolveFileList(requestDir, request.attachments);
    const resolvedRequest = {
        ...request,
        // content_type mirrors the CLI-facing name the skill uses.
        contentType: request.contentType ?? request.content_type,
        ...(cover ? { cover } : {}),
        ...(attachments === undefined ? {} : { attachments }),
        ...(chainFlag.chain ? { network: chainFlag.chain } : {}),
        ...(from ? { from } : {}),
    };
    return handler(resolvedRequest);
}
