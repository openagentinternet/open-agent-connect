"use strict";
/**
 * `metabot qanda …` — on-chain Q&A (docs/metaid_protocols/08-qanda.md):
 * simplequestion / simpleanswer / paylike writes through the daemon, and the
 * read-only Q&A recall verbs (search / latest / detail / answers) over the
 * metaso-p2p Q&A APIs. OAC port of the IDBots feat/metaweb-qa tools.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runQandaCommand = runQandaCommand;
const node_path_1 = __importDefault(require("node:path"));
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
function commandNotImplemented(command) {
    return {
        ok: false,
        state: 'failed',
        code: 'not_implemented',
        message: `The "${command}" qanda command is not configured in this runtime.`,
    };
}
function readNumberFlag(args, flag) {
    const raw = (0, helpers_1.readFlagValue)(args, flag);
    if (raw == null)
        return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
}
function readBooleanFlag(args, flag) {
    const raw = (0, helpers_1.readFlagValue)(args, flag);
    if (raw == null)
        return undefined;
    return raw === 'true' || raw === '1';
}
/** Resolve relative attachment paths against the request file (metafile:// passes through). */
function resolveFileList(baseDir, value) {
    if (!Array.isArray(value))
        return value;
    return value.map((entry) => {
        if (typeof entry !== 'string')
            return entry;
        if (node_path_1.default.isAbsolute(entry) || /^[a-z][a-z0-9+.-]*:\/\//i.test(entry))
            return entry;
        return node_path_1.default.resolve(baseDir, entry);
    });
}
async function runQandaCommand(args, context) {
    const subcommand = args[0];
    if (subcommand === 'question' || subcommand === 'answer' || subcommand === 'like') {
        const requestFile = (0, helpers_1.readFlagValue)(args, '--request-file');
        if (!requestFile) {
            return (0, helpers_1.commandMissingFlag)('--request-file');
        }
        const from = (0, helpers_1.readFromFlag)(args);
        const chainFlag = (0, helpers_1.readChainWriteFlag)(args);
        if (chainFlag.error) {
            return chainFlag.error;
        }
        const handler = context.dependencies.qanda?.[subcommand];
        if (!handler) {
            return commandNotImplemented(subcommand);
        }
        const request = await (0, helpers_1.readJsonFile)(context, requestFile);
        const requestDir = node_path_1.default.dirname(node_path_1.default.isAbsolute(requestFile) ? requestFile : node_path_1.default.resolve(context.cwd, requestFile));
        const attachments = resolveFileList(requestDir, request.attachments);
        const resolvedRequest = {
            ...request,
            // content_type mirrors the CLI-facing name the tools use.
            ...(request.content_type != null && request.contentType == null
                ? { contentType: request.content_type }
                : {}),
            ...(request.answer_to != null && request.answerTo == null ? { answerTo: request.answer_to } : {}),
            ...(request.pin_id != null && request.pinId == null ? { pinId: request.pin_id } : {}),
            ...(request.is_like != null && request.isLike == null ? { isLike: request.is_like } : {}),
            ...(request.allow_repeat != null && request.allowRepeat == null ? { allowRepeat: request.allow_repeat } : {}),
            ...(attachments === undefined ? {} : { attachments }),
            ...(chainFlag.chain ? { network: chainFlag.chain } : {}),
            ...(from ? { from } : {}),
        };
        return handler(resolvedRequest);
    }
    if (subcommand === 'search') {
        const query = (0, helpers_1.readFlagValue)(args, '--query');
        if (!query)
            return (0, helpers_1.commandMissingFlag)('--query');
        const handler = context.dependencies.qanda?.search;
        if (!handler)
            return commandNotImplemented('search');
        const answered = readBooleanFlag(args, '--answered');
        return handler({
            query,
            ...((0, helpers_1.readFlagValue)(args, '--tags') ? { tags: (0, helpers_1.readFlagValue)(args, '--tags').split(',').map((tag) => tag.trim()).filter(Boolean) } : {}),
            ...((0, helpers_1.readFlagValue)(args, '--publisher') ? { publisher: (0, helpers_1.readFlagValue)(args, '--publisher') } : {}),
            ...(answered != null ? { answered } : {}),
            ...((0, helpers_1.readFlagValue)(args, '--newest') ? { sort: 'newest' } : {}),
            ...(readNumberFlag(args, '--size') ? { size: readNumberFlag(args, '--size') } : {}),
            ...((0, helpers_1.readFlagValue)(args, '--cursor') ? { cursor: (0, helpers_1.readFlagValue)(args, '--cursor') } : {}),
        });
    }
    if (subcommand === 'latest') {
        const handler = context.dependencies.qanda?.latest;
        if (!handler)
            return commandNotImplemented('latest');
        return handler({
            ...((0, helpers_1.readFlagValue)(args, '--tags') ? { tags: (0, helpers_1.readFlagValue)(args, '--tags').split(',').map((tag) => tag.trim()).filter(Boolean) } : {}),
            ...(readNumberFlag(args, '--min-answers') != null ? { minAnswers: readNumberFlag(args, '--min-answers') } : {}),
            ...(readNumberFlag(args, '--max-answers') != null ? { maxAnswers: readNumberFlag(args, '--max-answers') } : {}),
            ...((0, helpers_1.readFlagValue)(args, '--hot') ? { sort: 'hot' } : {}),
            ...(readNumberFlag(args, '--size') ? { size: readNumberFlag(args, '--size') } : {}),
            ...((0, helpers_1.readFlagValue)(args, '--cursor') ? { cursor: (0, helpers_1.readFlagValue)(args, '--cursor') } : {}),
        });
    }
    if (subcommand === 'detail') {
        const pinId = (0, helpers_1.readFlagValue)(args, '--pin');
        if (!pinId)
            return (0, helpers_1.commandMissingFlag)('--pin');
        const handler = context.dependencies.qanda?.detail;
        if (!handler)
            return commandNotImplemented('detail');
        return handler({ pinId });
    }
    if (subcommand === 'answers') {
        const pinId = (0, helpers_1.readFlagValue)(args, '--pin');
        if (!pinId)
            return (0, helpers_1.commandMissingFlag)('--pin');
        const handler = context.dependencies.qanda?.answers;
        if (!handler)
            return commandNotImplemented('answers');
        return handler({
            pinId,
            ...((0, helpers_1.readFlagValue)(args, '--publisher') ? { publisher: (0, helpers_1.readFlagValue)(args, '--publisher') } : {}),
            ...(readNumberFlag(args, '--size') ? { size: readNumberFlag(args, '--size') } : {}),
            ...((0, helpers_1.readFlagValue)(args, '--cursor') ? { cursor: (0, helpers_1.readFlagValue)(args, '--cursor') } : {}),
        });
    }
    if (subcommand === undefined) {
        return (0, commandResult_1.commandFailed)('missing_subcommand', 'Usage: metabot qanda <question|answer|like|search|latest|detail|answers> …');
    }
    return (0, helpers_1.commandUnknownSubcommand)(`qanda ${args.join(' ')}`.trim());
}
