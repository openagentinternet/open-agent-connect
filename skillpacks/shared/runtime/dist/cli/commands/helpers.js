"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readFlagValue = readFlagValue;
exports.readChainWriteFlag = readChainWriteFlag;
exports.readFileUploadChainFlag = readFileUploadChainFlag;
exports.hasFlag = hasFlag;
exports.readJsonFile = readJsonFile;
exports.commandMissingFlag = commandMissingFlag;
exports.commandUnknownSubcommand = commandUnknownSubcommand;
const node_path_1 = __importDefault(require("node:path"));
const commandResult_1 = require("../../core/contracts/commandResult");
function readFlagValue(args, flag) {
    const index = args.indexOf(flag);
    if (index === -1)
        return null;
    const value = args[index + 1];
    return typeof value === 'string' ? value : null;
}
function readSupportedChainFlag(args, supportedValues, unsupportedSuffix = '') {
    const index = args.indexOf('--chain');
    if (index === -1) {
        return { chain: null, error: null };
    }
    const supportedText = supportedValues.join(', ');
    const rawValue = args[index + 1];
    if (typeof rawValue !== 'string' || rawValue.startsWith('--')) {
        return {
            chain: null,
            error: (0, commandResult_1.commandFailed)('invalid_flag', `Missing value for --chain. Supported values: ${supportedText}.`),
        };
    }
    const normalized = rawValue.trim().toLowerCase();
    if (!supportedValues.includes(normalized)) {
        return {
            chain: null,
            error: (0, commandResult_1.commandFailed)('invalid_flag', `Unsupported --chain value: ${rawValue}. Supported values: ${supportedText}.${unsupportedSuffix}`),
        };
    }
    return {
        chain: normalized,
        error: null,
    };
}
function readChainWriteFlag(args) {
    return readSupportedChainFlag(args, ['mvc', 'btc', 'doge', 'opcat']);
}
function readFileUploadChainFlag(args) {
    return readSupportedChainFlag(args, ['mvc', 'btc', 'opcat'], ' DOGE is not supported for file upload.');
}
function hasFlag(args, flag) {
    return args.includes(flag);
}
async function readJsonFile(context, filePath) {
    const resolved = node_path_1.default.isAbsolute(filePath) ? filePath : node_path_1.default.resolve(context.cwd, filePath);
    const raw = await context.readTextFile(resolved);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Expected JSON object input.');
    }
    return parsed;
}
function commandMissingFlag(flag) {
    return (0, commandResult_1.commandFailed)('missing_flag', `Missing required flag ${flag}.`);
}
function commandUnknownSubcommand(command) {
    return (0, commandResult_1.commandFailed)('unknown_command', `Unknown command: ${command}`);
}
