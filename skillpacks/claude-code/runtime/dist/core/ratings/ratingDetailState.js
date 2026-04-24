"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRatingDetailStateStore = createRatingDetailStateStore;
const node_fs_1 = require("node:fs");
const runtimeStateStore_1 = require("../state/runtimeStateStore");
const paths_1 = require("../state/paths");
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function createEmptyRatingDetailState() {
    return {
        items: [],
        latestPinId: null,
        backfillCursor: null,
        lastSyncedAt: null,
    };
}
function normalizeRatingDetailItem(value) {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const pinId = normalizeText(value.pinId);
    const serviceId = normalizeText(value.serviceId);
    const rate = normalizeNumber(value.rate);
    if (!pinId || !serviceId || rate === null) {
        return null;
    }
    return {
        pinId,
        serviceId,
        servicePaidTx: normalizeText(value.servicePaidTx) || null,
        rate,
        comment: normalizeText(value.comment) || null,
        raterGlobalMetaId: normalizeText(value.raterGlobalMetaId) || null,
        raterMetaId: normalizeText(value.raterMetaId) || null,
        createdAt: normalizeNumber(value.createdAt),
    };
}
function normalizeRatingDetailState(value) {
    if (!value || typeof value !== 'object') {
        return createEmptyRatingDetailState();
    }
    return {
        items: Array.isArray(value.items)
            ? value.items
                .map((item) => normalizeRatingDetailItem(item))
                .filter((item) => item !== null)
            : [],
        latestPinId: normalizeText(value.latestPinId) || null,
        backfillCursor: normalizeText(value.backfillCursor) || null,
        lastSyncedAt: normalizeNumber(value.lastSyncedAt),
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
function createRatingDetailStateStore(homeDirOrPaths) {
    const paths = typeof homeDirOrPaths === 'string' ? (0, paths_1.resolveMetabotPaths)(homeDirOrPaths) : homeDirOrPaths;
    return {
        paths,
        async ensureLayout() {
            await (0, runtimeStateStore_1.ensureRuntimeLayout)(paths);
            return paths;
        },
        async read() {
            await (0, runtimeStateStore_1.ensureRuntimeLayout)(paths);
            return normalizeRatingDetailState(await readJsonFile(paths.ratingDetailStatePath));
        },
        async write(nextState) {
            await (0, runtimeStateStore_1.ensureRuntimeLayout)(paths);
            const normalized = normalizeRatingDetailState(nextState);
            await node_fs_1.promises.writeFile(paths.ratingDetailStatePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
            return normalized;
        },
        async update(updater) {
            const currentState = await this.read();
            const nextState = await updater(currentState);
            return this.write(nextState);
        },
    };
}
