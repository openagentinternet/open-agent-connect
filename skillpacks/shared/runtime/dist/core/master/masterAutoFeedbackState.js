"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MASTER_AUTO_SIGNATURE_COOLDOWN_MS = exports.MASTER_AUTO_TIMEOUT_COOLDOWN_MS = exports.MASTER_AUTO_REJECTION_COOLDOWN_MS = exports.MASTER_AUTO_FEEDBACK_MAX_ITEMS = void 0;
exports.deriveMasterTriggerMemoryStateFromAutoFeedbackState = deriveMasterTriggerMemoryStateFromAutoFeedbackState;
exports.findRecentAutoFeedbackForTarget = findRecentAutoFeedbackForTarget;
exports.createMasterAutoFeedbackStateStore = createMasterAutoFeedbackStateStore;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const runtimeStateStore_1 = require("../state/runtimeStateStore");
const paths_1 = require("../state/paths");
exports.MASTER_AUTO_FEEDBACK_MAX_ITEMS = 100;
exports.MASTER_AUTO_REJECTION_COOLDOWN_MS = 30 * 60 * 1000;
exports.MASTER_AUTO_TIMEOUT_COOLDOWN_MS = 15 * 60 * 1000;
exports.MASTER_AUTO_SIGNATURE_COOLDOWN_MS = 30 * 60 * 1000;
let atomicWriteSequence = 0;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(0, Math.trunc(value));
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}
function normalizeStatus(value) {
    const normalized = normalizeText(value);
    if (normalized === 'prepared'
        || normalized === 'confirmed'
        || normalized === 'rejected'
        || normalized === 'sent'
        || normalized === 'timed_out'
        || normalized === 'completed') {
        return normalized;
    }
    return 'prepared';
}
function normalizeRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const record = value;
    const traceId = normalizeText(record.traceId);
    if (!traceId) {
        return null;
    }
    const createdAt = normalizeNumber(record.createdAt) || Date.now();
    const updatedAt = normalizeNumber(record.updatedAt) || createdAt;
    return {
        traceId,
        masterKind: normalizeText(record.masterKind) || null,
        masterServicePinId: normalizeText(record.masterServicePinId) || null,
        triggerReasonSignature: normalizeText(record.triggerReasonSignature) || null,
        status: normalizeStatus(record.status),
        createdAt,
        updatedAt,
    };
}
function createEmptyState() {
    return {
        items: [],
    };
}
function normalizeState(value) {
    if (!value || typeof value !== 'object') {
        return createEmptyState();
    }
    const items = Array.isArray(value.items)
        ? value.items
            .map((entry) => normalizeRecord(entry))
            .filter((entry) => entry !== null)
            .slice(0, exports.MASTER_AUTO_FEEDBACK_MAX_ITEMS)
        : [];
    return { items };
}
async function readJsonFile(filePath) {
    try {
        const raw = await node_fs_1.promises.readFile(filePath, 'utf8');
        return JSON.parse(raw);
    }
    catch (error) {
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
function normalizeStringArray(value) {
    const seen = new Set();
    const normalized = [];
    for (const entry of value) {
        const text = normalizeText(entry);
        if (!text || seen.has(text)) {
            continue;
        }
        seen.add(text);
        normalized.push(text);
    }
    return normalized;
}
function deriveMasterTriggerMemoryStateFromAutoFeedbackState(input) {
    const state = normalizeState(input.state);
    const now = typeof input.now === 'number' && Number.isFinite(input.now) ? input.now : Date.now();
    return {
        suggestedTraceIds: normalizeStringArray(state.items.map((entry) => entry.traceId)).slice(-25),
        rejectedMasterKinds: [],
        recentFailureSignatures: normalizeStringArray(state.items
            .filter((entry) => ((entry.status === 'rejected' || entry.status === 'timed_out' || entry.status === 'completed')
            && now - entry.updatedAt <= exports.MASTER_AUTO_SIGNATURE_COOLDOWN_MS))
            .map((entry) => entry.triggerReasonSignature)).slice(-50),
        manuallyRequestedMasterKinds: [],
    };
}
function findRecentAutoFeedbackForTarget(input) {
    const state = normalizeState(input.state);
    const masterServicePinId = normalizeText(input.masterServicePinId);
    if (!masterServicePinId) {
        return null;
    }
    const now = typeof input.now === 'number' && Number.isFinite(input.now) ? input.now : Date.now();
    return state.items.find((entry) => (normalizeText(entry.masterServicePinId) === masterServicePinId
        && ((entry.status === 'rejected'
            && now - entry.updatedAt <= exports.MASTER_AUTO_REJECTION_COOLDOWN_MS)
            || (entry.status === 'timed_out'
                && now - entry.updatedAt <= exports.MASTER_AUTO_TIMEOUT_COOLDOWN_MS)))) ?? null;
}
function createMasterAutoFeedbackStateStore(homeDirOrPaths) {
    const paths = typeof homeDirOrPaths === 'string' ? (0, paths_1.resolveMetabotPaths)(homeDirOrPaths) : homeDirOrPaths;
    const statePath = paths.masterAutoFeedbackStatePath;
    return {
        paths,
        statePath,
        async read() {
            await (0, runtimeStateStore_1.ensureRuntimeLayout)(paths);
            return normalizeState(await readJsonFile(statePath));
        },
        async write(nextState) {
            await (0, runtimeStateStore_1.ensureRuntimeLayout)(paths);
            const normalized = normalizeState(nextState);
            await writeJsonAtomic(statePath, normalized);
            return normalized;
        },
        async update(updater) {
            const current = await this.read();
            const next = await updater(current);
            return this.write(next);
        },
        async get(traceId) {
            const state = await this.read();
            const record = state.items.find((entry) => entry.traceId === normalizeText(traceId));
            if (!record) {
                throw new Error(`Master auto feedback record not found: ${traceId}`);
            }
            return record;
        },
        async put(record) {
            const normalized = normalizeRecord(record);
            if (!normalized) {
                throw new Error('Master auto feedback record requires traceId.');
            }
            await this.update((current) => ({
                items: [
                    normalized,
                    ...current.items.filter((entry) => entry.traceId !== normalized.traceId),
                ].slice(0, exports.MASTER_AUTO_FEEDBACK_MAX_ITEMS),
            }));
            return normalized;
        },
    };
}
