"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEmptyLoomRawCacheState = createEmptyLoomRawCacheState;
exports.createLoomRawCacheStore = createLoomRawCacheStore;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("../state/paths");
const protocols_1 = require("./protocols");
function emptyBuckets() {
    return {
        task: [],
        claim: [],
        status: [],
        delivery: [],
        acceptance: [],
        'claim-reject': [],
    };
}
function createEmptyLoomRawCacheState() {
    return {
        version: 1,
        updatedAt: 0,
        records: emptyBuckets(),
    };
}
function isMetabotPaths(value) {
    return Boolean(value
        && typeof value === 'object'
        && typeof value.metabotRoot === 'string');
}
function resolveCachePath(homeDirOrPaths) {
    const paths = isMetabotPaths(homeDirOrPaths)
        ? homeDirOrPaths
        : (0, paths_1.resolveMetabotPaths)(homeDirOrPaths);
    return node_path_1.default.join(paths.metabotRoot, 'loom', 'records.json');
}
function normalizeRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const record = value;
    if (typeof record.pinId !== 'string'
        || !protocols_1.LOOM_PROTOCOL_NAMES.includes(record.protocol)) {
        return null;
    }
    return {
        ...record,
        path: typeof record.path === 'string' ? record.path : '',
        operation: typeof record.operation === 'string' ? record.operation : 'create',
        contentType: typeof record.contentType === 'string' ? record.contentType : 'application/json',
        timestamp: Number.isFinite(record.timestamp) ? Math.trunc(record.timestamp) : 0,
        creatorAddress: typeof record.creatorAddress === 'string' ? record.creatorAddress : '',
        creatorMetaId: typeof record.creatorMetaId === 'string' ? record.creatorMetaId : '',
        globalMetaId: typeof record.globalMetaId === 'string' ? record.globalMetaId : '',
        payloadValid: record.payloadValid === true,
        validationErrors: Array.isArray(record.validationErrors) ? record.validationErrors : [],
        raw: record.raw && typeof record.raw === 'object' && !Array.isArray(record.raw)
            ? record.raw
            : {},
    };
}
function chooseLatest(left, right) {
    if (right.timestamp !== left.timestamp) {
        return right.timestamp > left.timestamp ? right : left;
    }
    return right.pinId.localeCompare(left.pinId) >= 0 ? right : left;
}
function normalizeState(value) {
    const empty = createEmptyLoomRawCacheState();
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return empty;
    }
    const input = value;
    const output = {
        version: 1,
        updatedAt: Number.isFinite(input.updatedAt) ? Math.trunc(input.updatedAt) : 0,
        records: emptyBuckets(),
    };
    const seen = new Map();
    const inputRecords = input.records && typeof input.records === 'object'
        ? input.records
        : {};
    for (const protocol of protocols_1.LOOM_PROTOCOL_NAMES) {
        const records = Array.isArray(inputRecords[protocol]) ? inputRecords[protocol] : [];
        for (const value of records) {
            const record = normalizeRecord({ ...value, protocol });
            if (!record)
                continue;
            const existing = seen.get(record.pinId);
            seen.set(record.pinId, existing ? chooseLatest(existing, record) : record);
        }
    }
    for (const record of seen.values()) {
        output.records[record.protocol].push(record);
    }
    for (const protocol of protocols_1.LOOM_PROTOCOL_NAMES) {
        output.records[protocol].sort((left, right) => right.timestamp - left.timestamp || right.pinId.localeCompare(left.pinId));
    }
    return output;
}
function createLoomRawCacheStore(homeDirOrPaths) {
    const cachePath = resolveCachePath(homeDirOrPaths);
    return {
        cachePath,
        async read() {
            try {
                const raw = await node_fs_1.promises.readFile(cachePath, 'utf8');
                return normalizeState(JSON.parse(raw));
            }
            catch {
                return createEmptyLoomRawCacheState();
            }
        },
        async write(state) {
            const normalized = normalizeState({
                ...state,
                updatedAt: Number.isFinite(state.updatedAt) && state.updatedAt > 0 ? state.updatedAt : Date.now(),
            });
            await node_fs_1.promises.mkdir(node_path_1.default.dirname(cachePath), { recursive: true });
            await node_fs_1.promises.writeFile(cachePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
            return normalized;
        },
        async update(records) {
            const current = await this.read();
            const nextRecords = emptyBuckets();
            for (const protocol of protocols_1.LOOM_PROTOCOL_NAMES) {
                nextRecords[protocol].push(...current.records[protocol]);
            }
            for (const record of records) {
                nextRecords[record.protocol].push(record);
            }
            return this.write({
                version: 1,
                updatedAt: Date.now(),
                records: nextRecords,
            });
        },
    };
}
