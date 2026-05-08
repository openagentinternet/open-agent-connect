"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureRuntimeLayout = ensureRuntimeLayout;
exports.createRuntimeStateStore = createRuntimeStateStore;
const node_fs_1 = require("node:fs");
const sellerOrderState_1 = require("../orders/sellerOrderState");
const paths_1 = require("./paths");
function cloneEmptyState() {
    return {
        identity: null,
        services: [],
        traces: [],
        sellerOrders: [],
    };
}
async function ensureRuntimeLayout(paths) {
    await Promise.all([
        node_fs_1.promises.mkdir(paths.runtimeRoot, { recursive: true }),
        node_fs_1.promises.mkdir(paths.a2aRoot, { recursive: true }),
        node_fs_1.promises.mkdir(paths.stateRoot, { recursive: true }),
        node_fs_1.promises.mkdir(paths.sessionsRoot, { recursive: true }),
        node_fs_1.promises.mkdir(paths.exportsRoot, { recursive: true }),
        node_fs_1.promises.mkdir(paths.locksRoot, { recursive: true }),
    ]);
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
function normalizeRuntimeIdentity(identity) {
    if (!identity || typeof identity !== 'object')
        return null;
    const legacy = identity;
    // Build addresses map from legacy flat fields if missing
    if (!identity['addresses'] || typeof identity['addresses'] !== 'object') {
        const addresses = {};
        const mvcAddr = typeof identity['mvcAddress'] === 'string' ? identity['mvcAddress'] : undefined;
        const btcAddr = typeof legacy.btcAddress === 'string' ? legacy.btcAddress : undefined;
        const dogeAddr = typeof legacy.dogeAddress === 'string' ? legacy.dogeAddress : undefined;
        if (mvcAddr)
            addresses.mvc = mvcAddr;
        if (btcAddr)
            addresses.btc = btcAddr;
        if (dogeAddr)
            addresses.doge = dogeAddr;
        identity = { ...identity, addresses };
    }
    return {
        metabotId: typeof identity['metabotId'] === 'number' ? identity['metabotId'] : 0,
        name: typeof identity['name'] === 'string' ? identity['name'] : '',
        createdAt: typeof identity['createdAt'] === 'number' ? identity['createdAt'] : 0,
        path: typeof identity['path'] === 'string' ? identity['path'] : '',
        publicKey: typeof identity['publicKey'] === 'string' ? identity['publicKey'] : '',
        chatPublicKey: typeof identity['chatPublicKey'] === 'string' ? identity['chatPublicKey'] : '',
        addresses: identity['addresses'] ?? {},
        mvcAddress: typeof identity['mvcAddress'] === 'string' ? identity['mvcAddress'] : '',
        metaId: typeof identity['metaId'] === 'string' ? identity['metaId'] : '',
        globalMetaId: typeof identity['globalMetaId'] === 'string' ? identity['globalMetaId'] : '',
        subsidyState: identity['subsidyState'],
        subsidyError: typeof identity['subsidyError'] === 'string' ? identity['subsidyError'] : null,
        syncState: identity['syncState'],
        syncError: typeof identity['syncError'] === 'string' ? identity['syncError'] : null,
        namePinId: typeof identity['namePinId'] === 'string' ? identity['namePinId'] : null,
        chatPublicKeyPinId: typeof identity['chatPublicKeyPinId'] === 'string' ? identity['chatPublicKeyPinId'] : null,
    };
}
function normalizeRuntimeState(value) {
    if (!value || typeof value !== 'object') {
        return cloneEmptyState();
    }
    return {
        identity: normalizeRuntimeIdentity(value.identity),
        services: Array.isArray(value.services) ? value.services : [],
        traces: Array.isArray(value.traces) ? value.traces : [],
        sellerOrders: Array.isArray(value.sellerOrders)
            ? (value.sellerOrders)
                .map((entry) => {
                try {
                    return (0, sellerOrderState_1.createSellerOrderRecord)(entry);
                }
                catch {
                    return null;
                }
            })
                .filter((entry) => Boolean(entry))
            : [],
    };
}
function createRuntimeStateStore(homeDirOrPaths) {
    const paths = typeof homeDirOrPaths === 'string' ? (0, paths_1.resolveMetabotPaths)(homeDirOrPaths) : homeDirOrPaths;
    return {
        paths,
        async ensureLayout() {
            await ensureRuntimeLayout(paths);
            return paths;
        },
        async readState() {
            await ensureRuntimeLayout(paths);
            return normalizeRuntimeState(await readJsonFile(paths.runtimeStatePath));
        },
        async writeState(nextState) {
            await ensureRuntimeLayout(paths);
            const normalized = normalizeRuntimeState(nextState);
            await node_fs_1.promises.writeFile(paths.runtimeStatePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
            return normalized;
        },
        async updateState(updater) {
            const currentState = await this.readState();
            const nextState = await updater(currentState);
            return this.writeState(nextState);
        },
        async readDaemon() {
            await ensureRuntimeLayout(paths);
            return readJsonFile(paths.daemonStatePath);
        },
        async writeDaemon(record) {
            await ensureRuntimeLayout(paths);
            await node_fs_1.promises.writeFile(paths.daemonStatePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
            return record;
        },
        async clearDaemon(pid) {
            await ensureRuntimeLayout(paths);
            const current = await readJsonFile(paths.daemonStatePath);
            if (pid && current && current.pid !== pid) {
                return;
            }
            try {
                await node_fs_1.promises.rm(paths.daemonStatePath);
            }
            catch (error) {
                const code = error.code;
                if (code !== 'ENOENT') {
                    throw error;
                }
            }
        },
    };
}
