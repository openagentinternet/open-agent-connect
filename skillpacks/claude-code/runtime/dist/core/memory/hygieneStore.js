"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHygieneStore = createHygieneStore;
// Memory hygiene run ledger (`.runtime/memory/hygiene.json`). One file per
// profile holding the single latest run record plus the deep-consolidation
// cadence stamp — the file-port counterpart of IDBots' cowork_config rows
// (memoryHygieneLastRun / memoryHygieneDeepConsolidation). One bot per
// profile, so the deep-consolidation stamp is a single timestamp, not a
// per-bot map. Writes follow the store conventions: atomic write-then-rename,
// serialized through the per-store write queue.
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
let atomicWriteSequence = 0;
function normalizeRunStats(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const record = value;
    if (typeof record.dateKey !== 'string' || !record.dateKey)
        return null;
    if (typeof record.ranAt !== 'number' || !Number.isFinite(record.ranAt))
        return null;
    const counts = {};
    if (record.counts && typeof record.counts === 'object' && !Array.isArray(record.counts)) {
        for (const [key, count] of Object.entries(record.counts)) {
            if (typeof count === 'number' && Number.isFinite(count))
                counts[key] = count;
        }
    }
    return {
        dateKey: record.dateKey,
        ranAt: record.ranAt,
        trigger: record.trigger === 'manual' ? 'manual' : 'scheduled',
        counts,
        errors: Array.isArray(record.errors)
            ? record.errors.filter((error) => typeof error === 'string')
            : [],
    };
}
function normalizeLedger(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { version: 1, lastRun: null, deepConsolidationLastRunAt: null };
    }
    const record = value;
    const deepConsolidationLastRunAt = typeof record.deepConsolidationLastRunAt === 'string'
        && Number.isFinite(Date.parse(record.deepConsolidationLastRunAt))
        ? record.deepConsolidationLastRunAt
        : null;
    return {
        version: 1,
        lastRun: normalizeRunStats(record.lastRun),
        deepConsolidationLastRunAt,
    };
}
function createHygieneStore(paths) {
    const filePath = paths.memoryHygienePath;
    let writeQueue = Promise.resolve();
    function enqueue(task) {
        const run = writeQueue.then(task, task);
        writeQueue = run.catch(() => undefined);
        return run;
    }
    async function readFile() {
        try {
            const raw = await node_fs_1.promises.readFile(filePath, 'utf8');
            return normalizeLedger(JSON.parse(raw));
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                return { version: 1, lastRun: null, deepConsolidationLastRunAt: null };
            }
            throw error;
        }
    }
    async function writeFile(next) {
        await node_fs_1.promises.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
        atomicWriteSequence += 1;
        const tempPath = `${filePath}.${process.pid}.${Date.now()}.${atomicWriteSequence}.tmp`;
        try {
            await node_fs_1.promises.writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
            await node_fs_1.promises.rename(tempPath, filePath);
        }
        catch (error) {
            await node_fs_1.promises.rm(tempPath, { force: true }).catch(() => undefined);
            throw error;
        }
    }
    return {
        async getLedger() {
            return readFile();
        },
        async getLastRun() {
            return (await readFile()).lastRun;
        },
        async setLastRun(stats) {
            await enqueue(async () => {
                const file = await readFile();
                file.lastRun = stats;
                await writeFile(file);
            });
        },
        async getDeepConsolidationLastRunAt() {
            const stamp = (await readFile()).deepConsolidationLastRunAt;
            return stamp ? Date.parse(stamp) : null;
        },
        async setDeepConsolidationLastRunAt(ranAtMs) {
            await enqueue(async () => {
                const file = await readFile();
                file.deepConsolidationLastRunAt = new Date(ranAtMs).toISOString();
                await writeFile(file);
            });
        },
    };
}
