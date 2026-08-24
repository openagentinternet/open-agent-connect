"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_GROUP_TASK_ENGINE_LOG_MAX_BYTES = exports.GROUP_TASK_ENGINE_LOG_FILE_NAME = void 0;
exports.resolveGroupTaskEngineLogPath = resolveGroupTaskEngineLogPath;
exports.createGroupTaskEngineLogWriter = createGroupTaskEngineLogWriter;
exports.readGroupTaskEngineLogTail = readGroupTaskEngineLogTail;
/**
 * Size-capped append-only log for the group task engine + OpenTeam intake.
 *
 * The engine runs inside the detached daemon whose stdio is ignored: without
 * this file every `ctx.log` failure line — expired invites, failed LLM turns,
 * indexer errors — evaporates. Writes are serialized and best-effort: a
 * logging failure must never break the 5s tick. One rolled generation
 * (`<file>.1`) keeps the on-disk footprint bounded.
 */
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
exports.GROUP_TASK_ENGINE_LOG_FILE_NAME = 'grouptask-engine.log';
exports.DEFAULT_GROUP_TASK_ENGINE_LOG_MAX_BYTES = 1024 * 1024;
function resolveGroupTaskEngineLogPath(logsRoot) {
    return node_path_1.default.join(logsRoot, exports.GROUP_TASK_ENGINE_LOG_FILE_NAME);
}
function createGroupTaskEngineLogWriter(options) {
    const maxBytes = options.maxBytes ?? exports.DEFAULT_GROUP_TASK_ENGINE_LOG_MAX_BYTES;
    let queue = Promise.resolve();
    const append = async (line) => {
        try {
            await node_fs_1.promises.mkdir(node_path_1.default.dirname(options.logFile), { recursive: true });
            const size = await node_fs_1.promises.stat(options.logFile).then((stat) => stat.size, () => 0);
            if (size > maxBytes) {
                await node_fs_1.promises.rename(options.logFile, `${options.logFile}.1`).catch(() => undefined);
            }
            await node_fs_1.promises.appendFile(options.logFile, line, 'utf8');
        }
        catch {
            // Logging must never break the engine tick.
        }
    };
    const write = ((message) => {
        const line = `[${new Date().toISOString()}] ${message}\n`;
        queue = queue.then(() => append(line));
    });
    write.flush = () => queue;
    return write;
}
/**
 * Read the trailing bytes of the engine log (plus its rolled generation when
 * the live file is shorter than requested). Best-effort: returns '' when the
 * log does not exist or cannot be read.
 */
async function readGroupTaskEngineLogTail(logFile, tailBytes = 8192) {
    const readEnd = async (filePath, budget) => {
        if (budget <= 0)
            return '';
        try {
            const stat = await node_fs_1.promises.stat(filePath);
            const start = Math.max(0, stat.size - budget);
            const handle = await node_fs_1.promises.open(filePath, 'r');
            try {
                const buffer = Buffer.alloc(stat.size - start);
                await handle.read(buffer, 0, buffer.length, start);
                return buffer.toString('utf8');
            }
            finally {
                await handle.close();
            }
        }
        catch {
            return '';
        }
    };
    const live = await readEnd(logFile, tailBytes);
    if (live.length >= tailBytes)
        return live;
    const rolled = await readEnd(`${logFile}.1`, tailBytes - live.length);
    return rolled + live;
}
