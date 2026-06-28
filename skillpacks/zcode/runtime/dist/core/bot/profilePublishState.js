"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashProfilePublishPayload = hashProfilePublishPayload;
exports.buildProfilePublishRecord = buildProfilePublishRecord;
exports.createProfilePublishStateStore = createProfilePublishStateStore;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const runtimeStateStore_1 = require("../state/runtimeStateStore");
const paths_1 = require("../state/paths");
let atomicWriteSequence = 0;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeEncoding(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized === 'base64' || normalized === 'binary') {
        return normalized;
    }
    return 'utf-8';
}
function normalizeNetwork(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized === 'btc' || normalized === 'doge' || normalized === 'opcat') {
        return normalized;
    }
    return 'mvc';
}
function normalizeTxids(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.map((entry) => normalizeText(entry)).filter(Boolean);
}
function createEmptyProfilePublishState() {
    return {
        version: 1,
        records: {},
    };
}
function normalizeProfilePublishRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const record = value;
    const payloadHash = normalizeText(record.payloadHash);
    const contentType = normalizeText(record.contentType);
    const pinId = normalizeText(record.pinId);
    if (!payloadHash || !contentType || !pinId) {
        return null;
    }
    return {
        payloadHash,
        contentType,
        encoding: normalizeEncoding(record.encoding),
        network: normalizeNetwork(record.network),
        pinId,
        txids: normalizeTxids(record.txids),
        publishedAt: normalizeText(record.publishedAt) || new Date(0).toISOString(),
    };
}
function normalizeProfilePublishState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return createEmptyProfilePublishState();
    }
    const recordsInput = value.records;
    if (!recordsInput || typeof recordsInput !== 'object' || Array.isArray(recordsInput)) {
        return createEmptyProfilePublishState();
    }
    const records = {};
    for (const [rawPath, rawRecord] of Object.entries(recordsInput)) {
        const recordPath = normalizeText(rawPath);
        const record = normalizeProfilePublishRecord(rawRecord);
        if (recordPath && record) {
            records[recordPath] = record;
        }
    }
    return {
        version: 1,
        records,
    };
}
async function readJsonFile(filePath) {
    try {
        const raw = await node_fs_1.promises.readFile(filePath, 'utf8');
        return JSON.parse(raw);
    }
    catch (error) {
        if (error instanceof SyntaxError) {
            return null;
        }
        const code = error.code;
        if (code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}
function nextAtomicWriteSuffix() {
    atomicWriteSequence += 1;
    return `${process.pid}.${Date.now()}.${atomicWriteSequence}`;
}
async function writeJsonAtomic(filePath, value) {
    await node_fs_1.promises.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${nextAtomicWriteSuffix()}.tmp`;
    await node_fs_1.promises.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await node_fs_1.promises.rename(tempPath, filePath);
}
function payloadForHash(payload, encoding) {
    if (Buffer.isBuffer(payload)) {
        return Buffer.from(payload).toString('base64');
    }
    if (encoding === 'binary') {
        return Buffer.from(payload, 'utf8').toString('base64');
    }
    return payload;
}
function hashProfilePublishPayload(input) {
    const encoding = normalizeEncoding(input.encoding);
    const normalized = JSON.stringify({
        path: normalizeText(input.path),
        contentType: normalizeText(input.contentType),
        encoding,
        payload: payloadForHash(input.payload, encoding),
    });
    return (0, node_crypto_1.createHash)('sha256').update(normalized).digest('hex');
}
function buildProfilePublishRecord(input) {
    return {
        payloadHash: hashProfilePublishPayload(input.target),
        contentType: normalizeText(input.result.contentType) || normalizeText(input.target.contentType),
        encoding: normalizeEncoding(input.result.encoding || input.target.encoding),
        network: normalizeNetwork(input.result.network),
        pinId: normalizeText(input.result.pinId),
        txids: normalizeTxids(input.result.txids),
        publishedAt: normalizeText(input.publishedAt) || new Date().toISOString(),
    };
}
function createProfilePublishStateStore(homeDirOrPaths) {
    const paths = typeof homeDirOrPaths === 'string' ? (0, paths_1.resolveMetabotPaths)(homeDirOrPaths) : homeDirOrPaths;
    return {
        paths,
        async read() {
            await (0, runtimeStateStore_1.ensureRuntimeLayout)(paths);
            return normalizeProfilePublishState(await readJsonFile(paths.profilePublishStatePath));
        },
        async write(nextState) {
            await (0, runtimeStateStore_1.ensureRuntimeLayout)(paths);
            const normalized = normalizeProfilePublishState(nextState);
            await writeJsonAtomic(paths.profilePublishStatePath, normalized);
            return normalized;
        },
        async update(updater) {
            const currentState = await this.read();
            const nextState = await updater(currentState);
            return this.write(nextState);
        },
    };
}
