"use strict";
/**
 * Content-hash ledger for chain writes with unknown broadcast finality.
 * When a broadcast's outcome is unknown (timeout / network drop), the daemon
 * records the attempt keyed by a stable content hash. A retry of identical
 * content soon after returns the recorded candidates instead of blindly
 * re-broadcasting — the definitive fix for "error shown → user retries →
 * duplicate on-chain note".
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stableChainWriteHash = stableChainWriteHash;
exports.createChainWriteAttemptStore = createChainWriteAttemptStore;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
const RETENTION_MS = 24 * 60 * 60 * 1000;
function attemptsPath(systemHomeDir) {
    return node_path_1.default.join(systemHomeDir, '.metabot', 'runtime', 'state', 'chain-write-attempts.json');
}
async function readAttempts(filePath) {
    try {
        const raw = await node_fs_1.promises.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed?.attempts)
            ? parsed.attempts.filter((row) => row && typeof row.contentHash === 'string')
            : [];
    }
    catch {
        return [];
    }
}
function stableChainWriteHash(kind, parts) {
    return (0, node_crypto_1.createHash)('sha256')
        .update(JSON.stringify([kind, ...parts.map((part) => (part ?? '').trim())]), 'utf8')
        .digest('hex');
}
function createChainWriteAttemptStore(systemHomeDir) {
    const filePath = attemptsPath(systemHomeDir);
    let queue = Promise.resolve();
    const enqueue = (work) => {
        const next = queue.then(work, work);
        queue = next.catch(() => undefined);
        return next;
    };
    async function writePruned(attempts, now) {
        const kept = attempts.filter((row) => now - row.at < RETENTION_MS).slice(-500);
        await node_fs_1.promises.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
        const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
        await node_fs_1.promises.writeFile(tmpPath, JSON.stringify({ attempts: kept }, null, 2), 'utf8');
        await node_fs_1.promises.rename(tmpPath, filePath);
    }
    return {
        findRecent: async (contentHash, now = Date.now()) => {
            const attempts = await readAttempts(filePath);
            return attempts.find((row) => row.contentHash === contentHash && now - row.at < RETENTION_MS) ?? null;
        },
        record: (input) => enqueue(async () => {
            const now = Date.now();
            const attempts = await readAttempts(filePath);
            attempts.push({ ...input, at: now });
            await writePruned(attempts, now);
        }),
    };
}
