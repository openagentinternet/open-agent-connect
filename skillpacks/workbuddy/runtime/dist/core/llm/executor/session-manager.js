"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSafeLlmSessionId = isSafeLlmSessionId;
exports.createFileSessionManager = createFileSessionManager;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
function isSafeLlmSessionId(sessionId) {
    return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(sessionId);
}
let atomicWriteSequence = 0;
const sessionOperationQueues = new Map();
function sessionPath(root, sessionId) {
    if (!isSafeLlmSessionId(sessionId)) {
        throw new Error(`Invalid LLM session id: ${sessionId}`);
    }
    return node_path_1.default.join(root, `${sessionId}.json`);
}
function nextAtomicWriteSuffix() {
    atomicWriteSequence += 1;
    return `${process.pid}.${Date.now()}.${atomicWriteSequence}`;
}
function queueSessionOperation(filePath, operation) {
    const previous = sessionOperationQueues.get(filePath) ?? Promise.resolve();
    const run = previous.then(operation, operation);
    const pending = run.then(() => undefined, () => undefined);
    sessionOperationQueues.set(filePath, pending);
    pending.then(() => {
        if (sessionOperationQueues.get(filePath) === pending) {
            sessionOperationQueues.delete(filePath);
        }
    }, () => undefined);
    return run;
}
async function readJsonFile(filePath) {
    try {
        const raw = await node_fs_1.promises.readFile(filePath, 'utf8');
        return JSON.parse(raw);
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return null;
        if (error instanceof SyntaxError) {
            throw new Error(`Malformed LLM session JSON: ${filePath}`);
        }
        throw error;
    }
}
async function writeSessionFile(filePath, record) {
    await node_fs_1.promises.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${nextAtomicWriteSuffix()}.tmp`;
    try {
        await node_fs_1.promises.writeFile(tempPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
        await node_fs_1.promises.rename(tempPath, filePath);
    }
    catch (error) {
        await node_fs_1.promises.rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
    }
}
function createFileSessionManager(sessionsRoot) {
    return {
        async create(record) {
            const filePath = sessionPath(sessionsRoot, record.sessionId);
            await queueSessionOperation(filePath, async () => {
                await writeSessionFile(filePath, record);
            });
        },
        async update(sessionId, patch) {
            const filePath = sessionPath(sessionsRoot, sessionId);
            await queueSessionOperation(filePath, async () => {
                const current = await readJsonFile(filePath);
                if (!current) {
                    throw new Error(`LLM session not found: ${sessionId}`);
                }
                await writeSessionFile(filePath, { ...current, ...patch, sessionId });
            });
        },
        async get(sessionId) {
            return readJsonFile(sessionPath(sessionsRoot, sessionId));
        },
        async list(limit = 20, options = {}) {
            try {
                const entries = await node_fs_1.promises.readdir(sessionsRoot, { withFileTypes: true });
                const records = [];
                for (const entry of entries) {
                    if (!entry.isFile() || !entry.name.endsWith('.json'))
                        continue;
                    const record = await readJsonFile(node_path_1.default.join(sessionsRoot, entry.name));
                    if (record)
                        records.push(record);
                }
                records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
                const scopedRecords = options.metaBotSlug
                    ? records.filter((record) => record.metaBotSlug === options.metaBotSlug)
                    : records;
                return scopedRecords.slice(0, Math.max(0, limit));
            }
            catch (error) {
                if (error.code === 'ENOENT')
                    return [];
                throw error;
            }
        },
        async delete(sessionId) {
            const filePath = sessionPath(sessionsRoot, sessionId);
            await queueSessionOperation(filePath, async () => {
                try {
                    await node_fs_1.promises.unlink(filePath);
                }
                catch (error) {
                    if (error.code !== 'ENOENT')
                        throw error;
                }
            });
        },
    };
}
