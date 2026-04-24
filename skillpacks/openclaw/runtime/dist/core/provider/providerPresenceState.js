"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createProviderPresenceStateStore = createProviderPresenceStateStore;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const runtimeStateStore_1 = require("../state/runtimeStateStore");
const paths_1 = require("../state/paths");
let atomicWriteSequence = 0;
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
function createEmptyPresenceState() {
    return {
        enabled: false,
        lastHeartbeatAt: null,
        lastHeartbeatPinId: null,
        lastHeartbeatTxid: null,
    };
}
function normalizeProviderPresenceState(value) {
    if (!value || typeof value !== 'object') {
        return createEmptyPresenceState();
    }
    return {
        enabled: value.enabled === true,
        lastHeartbeatAt: normalizeNumber(value.lastHeartbeatAt),
        lastHeartbeatPinId: normalizeText(value.lastHeartbeatPinId) || null,
        lastHeartbeatTxid: normalizeText(value.lastHeartbeatTxid) || null,
    };
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
function createProviderPresenceStateStore(homeDirOrPaths) {
    const paths = typeof homeDirOrPaths === 'string' ? (0, paths_1.resolveMetabotPaths)(homeDirOrPaths) : homeDirOrPaths;
    return {
        paths,
        async read() {
            await (0, runtimeStateStore_1.ensureRuntimeLayout)(paths);
            const current = await readJsonFile(paths.providerPresenceStatePath);
            return normalizeProviderPresenceState(current);
        },
        async write(nextState) {
            await (0, runtimeStateStore_1.ensureRuntimeLayout)(paths);
            const normalized = normalizeProviderPresenceState(nextState);
            await writeJsonAtomic(paths.providerPresenceStatePath, normalized);
            return normalized;
        },
        async update(updater) {
            const current = await this.read();
            const next = await updater(current);
            return this.write(next);
        },
    };
}
