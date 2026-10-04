"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readFlagValue = readFlagValue;
exports.readFromFlag = readFromFlag;
exports.readChainWriteFlag = readChainWriteFlag;
exports.readFileUploadChainFlag = readFileUploadChainFlag;
exports.hasFlag = hasFlag;
exports.readJsonFile = readJsonFile;
exports.readStdinText = readStdinText;
exports.commandMissingFlag = commandMissingFlag;
exports.redactSensitiveArgs = redactSensitiveArgs;
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
function readFromFlag(args, options = {}) {
    return readFlagValue(args, '--from')
        ?? (options.allowSlugAlias ? readFlagValue(args, '--slug') : null)
        ?? undefined;
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
/**
 * Drain a stdin stream to EOF and return its content as UTF-8 text. Commands
 * that receive secrets (e.g. the owner mnemonic) read them through this
 * instead of argv, so the value never lands in shell history or process
 * listings.
 */
async function readStdinText(stream = process.stdin) {
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
}
function commandMissingFlag(flag) {
    return (0, commandResult_1.commandFailed)('missing_flag', `Missing required flag ${flag}.`);
}
/** Flags whose VALUES are secrets; echoing them back redacts the value only. */
const SENSITIVE_VALUE_FLAGS = new Set([
    '--mnemonic',
    '--password',
    '--token',
    '--private-key',
    '--secret',
]);
/**
 * Replace the values of secret-bearing flags with '***' before raw argv is
 * echoed back in error output: a typo like `user improt --mnemonic "<words>"`
 * must not leak the mnemonic into stdout, logs, or agent session records.
 * Handles both the `--flag value` and inline `--flag=value` forms; exact flag
 * names only, so `--mnemonic-stdin` is never treated as a value flag.
 */
function redactSensitiveArgs(args) {
    const redacted = [];
    let redactNext = false;
    for (const arg of args) {
        if (redactNext) {
            redacted.push('***');
            redactNext = false;
            continue;
        }
        const eqIndex = arg.indexOf('=');
        const flag = eqIndex >= 0 ? arg.slice(0, eqIndex) : arg;
        if (SENSITIVE_VALUE_FLAGS.has(flag)) {
            if (eqIndex >= 0) {
                redacted.push(`${flag}=***`);
                continue;
            }
            redacted.push(arg);
            redactNext = true;
            continue;
        }
        redacted.push(arg);
    }
    return redacted;
}
function commandUnknownSubcommand(command) {
    return (0, commandResult_1.commandFailed)('unknown_command', `Unknown command: ${command}`);
}
