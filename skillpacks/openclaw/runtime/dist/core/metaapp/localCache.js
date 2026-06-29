"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMetaAppLocalCacheStore = createMetaAppLocalCacheStore;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("../state/paths");
function resolvePaths(pathsOrHomeDir) {
    return typeof pathsOrHomeDir === 'string' ? (0, paths_1.resolveMetabotPaths)(pathsOrHomeDir) : pathsOrHomeDir;
}
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
}
function normalizeOperation(value) {
    const operation = normalizeText(value).toLowerCase();
    return operation === 'create' || operation === 'modify' || operation === 'revoke'
        ? operation
        : null;
}
function normalizeSource(value) {
    return value === 'local' || value === 'indexer' ? value : null;
}
function normalizeTags(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const seen = new Set();
    const result = [];
    for (const item of value) {
        const normalized = normalizeText(item);
        if (!normalized || seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        result.push(normalized);
    }
    return result;
}
function normalizeRaw(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }
    return value;
}
function normalizeBoolean(value) {
    if (typeof value === 'boolean') {
        return value;
    }
    return undefined;
}
function normalizeStatus(value) {
    if (typeof value === 'string' && value.trim()) {
        return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    return undefined;
}
function normalizeRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const record = value;
    const pinId = normalizeText(record.pinId);
    const firstPinId = normalizeText(record.firstPinId);
    const operation = normalizeOperation(record.operation);
    const source = normalizeSource(record.source);
    const updatedAt = normalizeNumber(record.updatedAt);
    const title = normalizeText(record.title);
    const appName = normalizeText(record.appName);
    const version = normalizeText(record.version);
    const runtime = normalizeText(record.runtime);
    const indexFile = normalizeText(record.indexFile);
    const contentType = normalizeText(record.contentType);
    const codeType = normalizeText(record.codeType);
    const ownerGlobalMetaId = normalizeText(record.ownerGlobalMetaId);
    const ownerAddress = normalizeText(record.ownerAddress);
    const network = normalizeText(record.network);
    const metawebUrl = normalizeText(record.metawebUrl);
    if (!pinId
        || !firstPinId
        || operation === null
        || !title
        || !appName
        || !version
        || !runtime
        || !indexFile
        || !contentType
        || !codeType
        || !ownerGlobalMetaId
        || !ownerAddress
        || !network
        || !metawebUrl
        || updatedAt === null
        || source === null) {
        return null;
    }
    const normalized = {
        pinId,
        firstPinId,
        operation,
        title,
        appName,
        version,
        runtime,
        indexFile,
        code: normalizeText(record.code),
        content: normalizeText(record.content),
        contentType,
        codeType,
        tags: normalizeTags(record.tags),
        ownerGlobalMetaId,
        ownerAddress,
        network,
        metawebUrl,
        updatedAt,
        source,
    };
    const localUiUrl = normalizeText(record.localUiUrl);
    if (localUiUrl)
        normalized.localUiUrl = localUiUrl;
    const disabled = normalizeBoolean(record.disabled);
    if (disabled !== undefined)
        normalized.disabled = disabled;
    const status = normalizeStatus(record.status);
    if (status !== undefined)
        normalized.status = status;
    const runUrl = normalizeText(record.runUrl);
    if (runUrl)
        normalized.runUrl = runUrl;
    const downloadUrl = normalizeText(record.downloadUrl);
    if (downloadUrl)
        normalized.downloadUrl = downloadUrl;
    const raw = normalizeRaw(record.raw);
    if (raw)
        normalized.raw = raw;
    return normalized;
}
function createEmptyState() {
    return {
        version: 1,
        records: [],
        updatedAt: null,
    };
}
function recordGroupKey(record) {
    return normalizeText(record.firstPinId) || normalizeText(record.pinId);
}
function isHiddenOperation(operation) {
    return operation === 'revoke';
}
function normalizeState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return createEmptyState();
    }
    const state = value;
    return {
        version: 1,
        records: Array.isArray(state.records)
            ? state.records
                .map((record) => normalizeRecord(record))
                .filter((record) => record !== null)
            : [],
        updatedAt: normalizeNumber(state.updatedAt),
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
async function writeState(filePath, state) {
    const normalized = normalizeState(state);
    await node_fs_1.promises.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
    await node_fs_1.promises.writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    return normalized;
}
function createMetaAppLocalCacheStore(pathsOrHomeDir) {
    const paths = resolvePaths(pathsOrHomeDir);
    const metaappsRoot = node_path_1.default.join(paths.stateRoot, 'metaapps');
    const localCachePath = node_path_1.default.join(metaappsRoot, 'local-cache.json');
    const indexerCachePath = node_path_1.default.join(metaappsRoot, 'indexer-cache.json');
    return {
        localCachePath,
        indexerCachePath,
        async readLocal() {
            await node_fs_1.promises.mkdir(metaappsRoot, { recursive: true });
            return normalizeState(await readJsonFile(localCachePath));
        },
        async writeLocal(state) {
            return writeState(localCachePath, state);
        },
        async upsertLocal(record) {
            const normalizedRecord = normalizeRecord({ ...record, source: 'local' });
            if (!normalizedRecord) {
                return this.readLocal();
            }
            const current = await this.readLocal();
            const existingIndex = current.records.findIndex((item) => item.pinId === normalizedRecord.pinId);
            const records = [...current.records];
            if (existingIndex >= 0) {
                records[existingIndex] = normalizedRecord;
            }
            else {
                records.push(normalizedRecord);
            }
            return this.writeLocal({
                version: 1,
                records,
                updatedAt: normalizedRecord.updatedAt,
            });
        },
        async readIndexer() {
            await node_fs_1.promises.mkdir(metaappsRoot, { recursive: true });
            return normalizeState(await readJsonFile(indexerCachePath));
        },
        async writeIndexer(state) {
            return writeState(indexerCachePath, state);
        },
        async listMerged() {
            const [indexerState, localState] = await Promise.all([
                this.readIndexer(),
                this.readLocal(),
            ]);
            const hiddenGroupKeys = new Set();
            for (const item of [...indexerState.records, ...localState.records]) {
                const groupKey = recordGroupKey(item);
                if (groupKey && isHiddenOperation(item.operation)) {
                    hiddenGroupKeys.add(groupKey);
                }
            }
            const seenPinIds = new Set();
            const merged = [];
            for (const item of indexerState.records) {
                if (isHiddenOperation(item.operation) || hiddenGroupKeys.has(recordGroupKey(item))) {
                    continue;
                }
                seenPinIds.add(item.pinId);
                merged.push(item);
            }
            for (const item of localState.records) {
                if (isHiddenOperation(item.operation) || hiddenGroupKeys.has(recordGroupKey(item)) || seenPinIds.has(item.pinId)) {
                    continue;
                }
                seenPinIds.add(item.pinId);
                merged.push(item);
            }
            return merged;
        },
    };
}
