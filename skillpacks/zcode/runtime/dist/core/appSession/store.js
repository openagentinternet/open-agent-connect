"use strict";
/**
 * App Session persistence. Sessions, task-level grants, internal cursors and
 * leases are written atomically to a single JSON file under the profile
 * runtime root; leases carry `expiresAt` so fencing survives daemon restarts.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePersistedAppSessionState = normalizePersistedAppSessionState;
exports.createAppSessionStore = createAppSessionStore;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const STORE_VERSION = 1;
const TRANSIENT_READ_RETRIES = 5;
const TRANSIENT_READ_DELAY_MS = 10;
let atomicWriteSequence = 0;
async function readJsonFile(filePath) {
    for (let attempt = 0; attempt <= TRANSIENT_READ_RETRIES; attempt += 1) {
        try {
            const raw = await node_fs_1.promises.readFile(filePath, 'utf8');
            return JSON.parse(raw);
        }
        catch (error) {
            const code = error.code;
            if (code === 'ENOENT') {
                return null;
            }
            if (error instanceof SyntaxError && attempt < TRANSIENT_READ_RETRIES) {
                await new Promise((resolve) => setTimeout(resolve, TRANSIENT_READ_DELAY_MS));
                continue;
            }
            throw error;
        }
    }
    return null;
}
function createAtomicWriteTempPath(filePath) {
    atomicWriteSequence += 1;
    return `${filePath}.${process.pid}.${Date.now()}.${atomicWriteSequence}.tmp`;
}
async function writeFileAtomic(filePath, content) {
    const tempPath = createAtomicWriteTempPath(filePath);
    try {
        await node_fs_1.promises.writeFile(tempPath, content, 'utf8');
        await node_fs_1.promises.rename(tempPath, filePath);
    }
    catch (error) {
        await node_fs_1.promises.rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
    }
}
function normalizePersistedAppSessionState(raw) {
    if (!raw || raw.version !== STORE_VERSION) {
        return { version: STORE_VERSION, sessions: [], grants: [], leases: [] };
    }
    return {
        version: STORE_VERSION,
        sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
        grants: Array.isArray(raw.grants) ? raw.grants : [],
        leases: Array.isArray(raw.leases) ? raw.leases : [],
    };
}
function createAppSessionStore(runtimeRoot) {
    const storeDir = node_path_1.default.join(node_path_1.default.resolve(runtimeRoot), 'app-session');
    const storePath = node_path_1.default.join(storeDir, 'runtime.json');
    return {
        async load() {
            const raw = await readJsonFile(storePath);
            return normalizePersistedAppSessionState(raw);
        },
        async save(state) {
            await node_fs_1.promises.mkdir(storeDir, { recursive: true });
            await writeFileAtomic(storePath, `${JSON.stringify(normalizePersistedAppSessionState(state), null, 2)}\n`);
        },
    };
}
