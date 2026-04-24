"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MASTER_SUGGEST_MAX_ITEMS = exports.MASTER_SUGGEST_ACCEPT_COOLDOWN_MS = exports.MASTER_SUGGEST_SIGNATURE_COOLDOWN_MS = exports.MASTER_SUGGEST_REJECTION_COOLDOWN_MS = void 0;
exports.buildMasterSuggestionId = buildMasterSuggestionId;
exports.deriveMasterTriggerMemoryStateFromSuggestState = deriveMasterTriggerMemoryStateFromSuggestState;
exports.createMasterSuggestStateStore = createMasterSuggestStateStore;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const runtimeStateStore_1 = require("../state/runtimeStateStore");
const paths_1 = require("../state/paths");
exports.MASTER_SUGGEST_REJECTION_COOLDOWN_MS = 30 * 60 * 1000;
exports.MASTER_SUGGEST_SIGNATURE_COOLDOWN_MS = 30 * 60 * 1000;
exports.MASTER_SUGGEST_ACCEPT_COOLDOWN_MS = 30 * 60 * 1000;
exports.MASTER_SUGGEST_MAX_ITEMS = 100;
let atomicWriteSequence = 0;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeStringArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }
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
function normalizeNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.trunc(value);
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}
function normalizeNullableNumber(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}
function normalizeDraft(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? { ...value }
        : {};
}
function normalizeTarget(value) {
    const target = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
    return {
        servicePinId: normalizeText(target.servicePinId),
        providerGlobalMetaId: normalizeText(target.providerGlobalMetaId),
        masterKind: normalizeText(target.masterKind),
        displayName: normalizeText(target.displayName) || null,
    };
}
function normalizeRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const record = value;
    const suggestionId = normalizeText(record.suggestionId);
    const traceId = normalizeText(record.traceId);
    if (!suggestionId || !traceId) {
        return null;
    }
    const status = normalizeText(record.status);
    const normalizedStatus = status === 'accepted' || status === 'rejected'
        ? status
        : 'suggested';
    return {
        suggestionId,
        traceId,
        createdAt: normalizeNumber(record.createdAt) || Date.now(),
        updatedAt: normalizeNumber(record.updatedAt) || Date.now(),
        status: normalizedStatus,
        hostMode: normalizeText(record.hostMode) || 'codex',
        candidateMasterKind: normalizeText(record.candidateMasterKind) || null,
        candidateDisplayName: normalizeText(record.candidateDisplayName) || null,
        reason: normalizeText(record.reason),
        confidence: Number.isFinite(Number(record.confidence)) ? Number(record.confidence) : 0,
        failureSignatures: normalizeStringArray(record.failureSignatures),
        draft: normalizeDraft(record.draft),
        target: normalizeTarget(record.target),
        rejectionReason: normalizeText(record.rejectionReason) || null,
        acceptedAt: normalizeNullableNumber(record.acceptedAt),
        rejectedAt: normalizeNullableNumber(record.rejectedAt),
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
            .slice(0, exports.MASTER_SUGGEST_MAX_ITEMS)
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
function buildMasterSuggestionId(now) {
    return `master-suggest-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function deriveMasterTriggerMemoryStateFromSuggestState(input) {
    const state = normalizeState(input.state);
    const now = typeof input.now === 'number' && Number.isFinite(input.now) ? input.now : Date.now();
    return {
        suggestedTraceIds: normalizeStringArray(state.items.map((entry) => entry.traceId)).slice(-25),
        rejectedMasterKinds: normalizeStringArray(state.items
            .filter((entry) => entry.status === 'rejected')
            .filter((entry) => typeof entry.rejectedAt === 'number' && now - entry.rejectedAt <= exports.MASTER_SUGGEST_REJECTION_COOLDOWN_MS)
            .map((entry) => entry.candidateMasterKind)).slice(-25),
        recentFailureSignatures: normalizeStringArray(state.items
            .filter((entry) => ((entry.status === 'suggested'
            && now - entry.updatedAt <= exports.MASTER_SUGGEST_SIGNATURE_COOLDOWN_MS)
            || (entry.status === 'accepted'
                && now - (entry.acceptedAt ?? entry.updatedAt) <= exports.MASTER_SUGGEST_SIGNATURE_COOLDOWN_MS)
            || (entry.status === 'rejected'
                && typeof entry.rejectedAt === 'number'
                && now - entry.rejectedAt <= exports.MASTER_SUGGEST_SIGNATURE_COOLDOWN_MS)))
            .flatMap((entry) => entry.failureSignatures)).slice(-50),
        manuallyRequestedMasterKinds: normalizeStringArray(state.items
            .filter((entry) => entry.status === 'accepted')
            .filter((entry) => now - (entry.acceptedAt ?? entry.updatedAt) <= exports.MASTER_SUGGEST_ACCEPT_COOLDOWN_MS)
            .map((entry) => entry.candidateMasterKind)).slice(-25),
    };
}
function createMasterSuggestStateStore(homeDirOrPaths) {
    const paths = typeof homeDirOrPaths === 'string' ? (0, paths_1.resolveMetabotPaths)(homeDirOrPaths) : homeDirOrPaths;
    const statePath = paths.masterSuggestStatePath;
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
        async get(traceId, suggestionId) {
            const state = await this.read();
            const record = state.items.find((entry) => entry.traceId === traceId && entry.suggestionId === suggestionId);
            if (!record) {
                throw new Error(`Ask Master suggestion not found: ${traceId}:${suggestionId}`);
            }
            return record;
        },
        async put(record) {
            const normalizedRecord = normalizeRecord(record);
            if (!normalizedRecord) {
                throw new Error('Invalid Ask Master suggestion record.');
            }
            await this.update((current) => ({
                items: [
                    normalizedRecord,
                    ...current.items.filter((entry) => !(entry.traceId === normalizedRecord.traceId
                        && entry.suggestionId === normalizedRecord.suggestionId)),
                ].slice(0, exports.MASTER_SUGGEST_MAX_ITEMS),
            }));
            return normalizedRecord;
        },
    };
}
