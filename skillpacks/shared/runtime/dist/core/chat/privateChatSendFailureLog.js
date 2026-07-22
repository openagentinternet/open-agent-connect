"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.describePrivateChatSendFailureError = describePrivateChatSendFailureError;
exports.privateChatSendFailureLogPath = privateChatSendFailureLogPath;
exports.createPrivateChatSendFailureFileLogger = createPrivateChatSendFailureFileLogger;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const SEND_FAILURE_LOG_FILE_NAME = 'private-chat-send-failures.jsonl';
const MAX_SEND_FAILURE_ERROR_LENGTH = 500;
function describePrivateChatSendFailureError(error) {
    const message = error instanceof Error ? error.message : String(error ?? '');
    return message.slice(0, MAX_SEND_FAILURE_ERROR_LENGTH);
}
function privateChatSendFailureLogPath(paths) {
    return node_path_1.default.join(paths.runtimeRoot, 'logs', SEND_FAILURE_LOG_FILE_NAME);
}
/**
 * Fire-and-forget JSONL appender. Writes are serialized through an internal
 * queue so concurrent failures cannot interleave lines, and all errors are
 * swallowed: logging must never break the send path it observes. The returned
 * promise is exposed only so tests can await a flush.
 */
function createPrivateChatSendFailureFileLogger(paths) {
    const logPath = privateChatSendFailureLogPath(paths);
    let queue = Promise.resolve();
    return (event) => {
        const line = `${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`;
        queue = queue
            .then(async () => {
            await promises_1.default.mkdir(node_path_1.default.dirname(logPath), { recursive: true });
            await promises_1.default.appendFile(logPath, line, 'utf8');
        })
            .catch(() => undefined);
        return queue;
    };
}
