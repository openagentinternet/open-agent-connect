"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProductOrderRecordId = getProductOrderRecordId;
exports.createProductStateStore = createProductStateStore;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("../state/paths");
const runtimeStateStore_1 = require("../state/runtimeStateStore");
const productValidation_1 = require("./productValidation");
const PRODUCT_STATE_SCHEMA_VERSION = 1;
const LOCKFILE_BASE_DELAY_MS = 25;
const LOCKFILE_MAX_ATTEMPTS = 200;
const LOCKFILE_STALE_WITH_PID_MS = 5 * 60 * 1000;
const LOCKFILE_STALE_WITHOUT_PID_MS = 30_000;
function getProductOrderRecordId(record) {
    return normalizeText(record.productOrderPinId)
        || normalizeText(record.orderTxid)
        || normalizeText(record.paymentTxid)
        || `${record.role}:${record.listingPinId}:${record.skuId}:${record.localUpdatedAt}`;
}
function emptyState() {
    return {
        version: PRODUCT_STATE_SCHEMA_VERSION,
        ownedListings: [],
        directoryCache: [],
        buyerOrders: [],
        sellerOrders: [],
    };
}
function normalizeText(value) {
    if (typeof value === 'string')
        return value.trim();
    if (typeof value === 'number' && Number.isFinite(value))
        return String(value);
    return '';
}
function normalizeNullableText(value) {
    const normalized = normalizeText(value);
    return normalized || null;
}
function hasOwnProperty(source, key) {
    return Object.prototype.hasOwnProperty.call(source, key);
}
function normalizeNullableBoolean(value) {
    return typeof value === 'boolean' ? value : null;
}
function normalizeNumber(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}
function normalizeNullableNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
}
function listingSummary(payload) {
    return {
        name: payload.name,
        title: payload.title,
        productType: payload.productType,
        skuCount: payload.skus.length,
        fulfillmentSkills: [...payload.fulfillment.fulfillmentSkills],
    };
}
function normalizeListingPayload(value) {
    const result = (0, productValidation_1.validateProductListingPayload)(value);
    return result.ok ? result.value : null;
}
function normalizeProductOrderPayload(value) {
    const result = (0, productValidation_1.validateProductOrderPayload)(value);
    return result.ok ? result.value : null;
}
function requireListingPayload(value) {
    const result = (0, productValidation_1.validateProductListingPayload)(value);
    if (!result.ok) {
        throw new Error(`Invalid product listing payload: ${result.code}`);
    }
    return result.value;
}
function requireText(value, fieldName) {
    const normalized = normalizeText(value);
    if (!normalized) {
        throw new Error(`${fieldName} is required.`);
    }
    return normalized;
}
function normalizeOwnedListing(value) {
    if (!value || typeof value !== 'object')
        return null;
    const source = value;
    const listingPinId = normalizeText(source.listingPinId);
    const payload = normalizeListingPayload(source.payload);
    if (!listingPinId || !payload)
        return null;
    const summary = listingSummary(payload);
    return {
        listingPinId,
        localMetabotSlug: normalizeNullableText(source.localMetabotSlug),
        ...summary,
        payload,
        available: source.available !== false,
        revokedAt: source.revokedAt === null ? null : normalizeNumber(source.revokedAt, 0) || null,
        localUpdatedAt: normalizeNumber(source.localUpdatedAt, 0),
    };
}
function normalizeDirectoryItem(value) {
    if (!value || typeof value !== 'object')
        return null;
    const source = value;
    const listingPinId = normalizeText(source.listingPinId);
    const payload = normalizeListingPayload(source.payload);
    if (!listingPinId || !payload)
        return null;
    const summary = listingSummary(payload);
    return {
        listingPinId,
        ...summary,
        payload,
        sellerGlobalMetaId: normalizeNullableText(source.sellerGlobalMetaId),
        sellerName: normalizeNullableText(source.sellerName),
        sellerMvcAddress: normalizeNullableText(source.sellerMvcAddress),
        sellerChatPublicKey: normalizeNullableText(source.sellerChatPublicKey),
        online: source.online === true,
        cachedAt: normalizeNumber(source.cachedAt, 0),
    };
}
function normalizeDeliverySummary(value) {
    if (!value || typeof value !== 'object')
        return null;
    const source = value;
    const result = normalizeNullableText(source.result);
    const deliveryPinId = normalizeNullableText(source.deliveryPinId);
    const deliveredAt = normalizeNullableNumber(source.deliveredAt);
    if (!result && !deliveryPinId && deliveredAt === null)
        return null;
    return {
        result,
        deliveryPinId,
        deliveredAt,
    };
}
function normalizeSelectedSku(value) {
    if (!value || typeof value !== 'object')
        return null;
    const source = value;
    if (!normalizeText(source.skuId))
        return null;
    return source;
}
function normalizeBuyerOrder(value) {
    if (!value || typeof value !== 'object')
        return null;
    const source = value;
    if (!normalizeText(source.listingPinId) || !normalizeText(source.skuId))
        return null;
    return {
        role: 'buyer',
        productOrderPinId: normalizeNullableText(source.productOrderPinId),
        listingPinId: normalizeText(source.listingPinId),
        skuId: normalizeText(source.skuId),
        paymentTxid: normalizeNullableText(source.paymentTxid),
        productOrderPayload: normalizeProductOrderPayload(source.productOrderPayload),
        orderTxid: normalizeNullableText(source.orderTxid),
        sellerGlobalMetaId: normalizeNullableText(source.sellerGlobalMetaId),
        buyerGlobalMetaId: normalizeNullableText(source.buyerGlobalMetaId),
        traceId: normalizeNullableText(source.traceId),
        sessionId: normalizeNullableText(source.sessionId),
        deliverySummary: normalizeDeliverySummary(source.deliverySummary),
        state: source.state || 'created',
        localUpdatedAt: normalizeNumber(source.localUpdatedAt, 0),
    };
}
function normalizeSellerOrder(value) {
    if (!value || typeof value !== 'object')
        return null;
    const source = value;
    if (!normalizeText(source.productOrderPinId) ||
        !normalizeText(source.listingPinId) ||
        !normalizeText(source.skuId) ||
        !normalizeText(source.paymentTxid)) {
        return null;
    }
    return {
        role: 'seller',
        productOrderPinId: normalizeText(source.productOrderPinId),
        listingPinId: normalizeText(source.listingPinId),
        skuId: normalizeText(source.skuId),
        paymentTxid: normalizeText(source.paymentTxid),
        productOrderPayload: normalizeProductOrderPayload(source.productOrderPayload),
        orderTxid: normalizeNullableText(source.orderTxid),
        buyerGlobalMetaId: normalizeNullableText(source.buyerGlobalMetaId),
        fulfillmentSkills: Array.isArray(source.fulfillmentSkills)
            ? source.fulfillmentSkills.filter((skill) => typeof skill === 'string')
            : [],
        paymentVerified: normalizeNullableBoolean(source.paymentVerified),
        selectedSku: normalizeSelectedSku(source.selectedSku),
        fulfillmentState: source.fulfillmentState || null,
        deliveryPinId: normalizeNullableText(source.deliveryPinId),
        deliverySummary: normalizeDeliverySummary(source.deliverySummary),
        failureReason: normalizeNullableText(source.failureReason),
        state: source.state || 'created',
        localUpdatedAt: normalizeNumber(source.localUpdatedAt, 0),
    };
}
function normalizeState(value) {
    if (!value || typeof value !== 'object') {
        return emptyState();
    }
    return {
        version: PRODUCT_STATE_SCHEMA_VERSION,
        ownedListings: Array.isArray(value.ownedListings)
            ? value.ownedListings.map(normalizeOwnedListing).filter((entry) => Boolean(entry))
            : [],
        directoryCache: Array.isArray(value.directoryCache)
            ? value.directoryCache.map(normalizeDirectoryItem).filter((entry) => Boolean(entry))
            : [],
        buyerOrders: Array.isArray(value.buyerOrders)
            ? value.buyerOrders.map(normalizeBuyerOrder).filter((entry) => Boolean(entry))
            : [],
        sellerOrders: Array.isArray(value.sellerOrders)
            ? value.sellerOrders.map(normalizeSellerOrder).filter((entry) => Boolean(entry))
            : [],
    };
}
async function readJsonFile(filePath) {
    try {
        const raw = await node_fs_1.promises.readFile(filePath, 'utf8');
        return JSON.parse(raw);
    }
    catch (error) {
        const code = error.code;
        if (code === 'ENOENT')
            return null;
        if (error instanceof SyntaxError)
            return null;
        throw error;
    }
}
async function writeJsonFileAtomically(filePath, value) {
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    let handle = null;
    try {
        await node_fs_1.promises.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
        handle = await node_fs_1.promises.open(tempPath, 'w');
        await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
        await handle.sync();
        await handle.close();
        handle = null;
        await node_fs_1.promises.rename(tempPath, filePath);
        try {
            const directoryHandle = await node_fs_1.promises.open(node_path_1.default.dirname(filePath), 'r');
            try {
                await directoryHandle.sync();
            }
            finally {
                await directoryHandle.close();
            }
        }
        catch (error) {
            const code = error.code;
            if (code !== 'EINVAL' && code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EBADF') {
                throw error;
            }
        }
    }
    catch (error) {
        if (handle) {
            await handle.close();
        }
        await node_fs_1.promises.rm(tempPath, { force: true });
        throw error;
    }
}
async function sleep(ms) {
    await new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}
function isProcessAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) {
        return false;
    }
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        const code = error.code;
        return code !== 'ESRCH';
    }
}
async function readLockInfo(filePath) {
    try {
        const raw = await node_fs_1.promises.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        return {
            pid: typeof parsed.pid === 'number' ? parsed.pid : undefined,
            acquiredAt: typeof parsed.acquiredAt === 'number' ? parsed.acquiredAt : undefined,
        };
    }
    catch {
        return null;
    }
}
async function withLock(lockPath, operation) {
    for (let attempt = 0; attempt < LOCKFILE_MAX_ATTEMPTS; attempt += 1) {
        try {
            const handle = await node_fs_1.promises.open(lockPath, 'wx');
            try {
                await handle.writeFile(`${JSON.stringify({ pid: process.pid, acquiredAt: Date.now() })}\n`, 'utf8');
                return await operation();
            }
            finally {
                await handle.close();
                try {
                    await node_fs_1.promises.rm(lockPath, { force: true });
                }
                catch {
                    // Best effort cleanup; stale lock recovery handles leftover lock files later.
                }
            }
        }
        catch (error) {
            const code = error.code;
            if (code !== 'EEXIST') {
                throw error;
            }
            try {
                const lockInfo = await readLockInfo(lockPath);
                const stat = await node_fs_1.promises.stat(lockPath);
                const lockPid = typeof lockInfo?.pid === 'number' ? lockInfo.pid : null;
                const acquiredAt = typeof lockInfo?.acquiredAt === 'number' ? lockInfo.acquiredAt : stat.mtimeMs;
                const ownerAlive = lockPid ? isProcessAlive(lockPid) : false;
                if (lockPid && !ownerAlive) {
                    await node_fs_1.promises.rm(lockPath, { force: true });
                    continue;
                }
                const staleThreshold = lockPid ? LOCKFILE_STALE_WITH_PID_MS : LOCKFILE_STALE_WITHOUT_PID_MS;
                const stale = Date.now() - acquiredAt > staleThreshold;
                if (!lockPid && stale) {
                    await node_fs_1.promises.rm(lockPath, { force: true });
                    continue;
                }
            }
            catch {
                // Another writer may have released the lock between stat/remove attempts.
            }
            await sleep(Math.min(LOCKFILE_BASE_DELAY_MS * (attempt + 1), 250));
        }
    }
    throw new Error(`Timed out acquiring product-state lock: ${lockPath}`);
}
function upsertBy(items, predicate, next) {
    const index = items.findIndex(predicate);
    if (index < 0) {
        return [next, ...items];
    }
    return [next, ...items.slice(0, index), ...items.slice(index + 1)];
}
function createProductStateStore(homeDirOrPaths) {
    const paths = typeof homeDirOrPaths === 'string' ? (0, paths_1.resolveMetabotPaths)(homeDirOrPaths) : homeDirOrPaths;
    const productsRoot = node_path_1.default.join(paths.runtimeRoot, 'products');
    const productStatePath = node_path_1.default.join(productsRoot, 'products-state.json');
    const lockPath = node_path_1.default.join(paths.locksRoot, 'product-state.lock');
    let pendingWrite = Promise.resolve();
    const ensureLayout = async () => {
        await (0, runtimeStateStore_1.ensureRuntimeLayout)(paths);
        await node_fs_1.promises.mkdir(productsRoot, { recursive: true });
        return paths;
    };
    const runExclusive = async (operation) => {
        const next = pendingWrite.then(async () => {
            await ensureLayout();
            return withLock(lockPath, operation);
        }, async () => {
            await ensureLayout();
            return withLock(lockPath, operation);
        });
        pendingWrite = next.then(() => undefined, () => undefined);
        return next;
    };
    const store = {
        paths,
        productsRoot,
        productStatePath,
        ensureLayout,
        async readState() {
            await ensureLayout();
            return normalizeState(await readJsonFile(productStatePath));
        },
        async writeState(nextState) {
            return runExclusive(async () => {
                await ensureLayout();
                const normalized = normalizeState(nextState);
                await writeJsonFileAtomically(productStatePath, normalized);
                return normalized;
            });
        },
        async updateState(updater) {
            return runExclusive(async () => {
                await ensureLayout();
                const current = normalizeState(await readJsonFile(productStatePath));
                const next = await updater(current);
                const normalized = normalizeState(next);
                await writeJsonFileAtomically(productStatePath, normalized);
                return normalized;
            });
        },
        async upsertOwnedListing(input) {
            const listingPinId = requireText(input.listingPinId, 'listingPinId');
            const payload = requireListingPayload(input.payload);
            const record = {
                listingPinId,
                localMetabotSlug: normalizeNullableText(input.localMetabotSlug),
                ...listingSummary(payload),
                payload,
                available: input.available !== false,
                revokedAt: input.revokedAt ?? null,
                localUpdatedAt: input.localUpdatedAt ?? Date.now(),
            };
            await this.updateState(state => ({
                ...state,
                ownedListings: upsertBy(state.ownedListings, item => item.listingPinId === record.listingPinId, record),
            }));
            return record;
        },
        async upsertDirectoryItem(input) {
            const listingPinId = requireText(input.listingPinId, 'listingPinId');
            const payload = requireListingPayload(input.payload);
            const record = {
                listingPinId,
                ...listingSummary(payload),
                payload,
                sellerGlobalMetaId: normalizeNullableText(input.sellerGlobalMetaId),
                sellerName: normalizeNullableText(input.sellerName),
                sellerMvcAddress: normalizeNullableText(input.sellerMvcAddress),
                sellerChatPublicKey: normalizeNullableText(input.sellerChatPublicKey),
                online: input.online === true,
                cachedAt: input.cachedAt ?? Date.now(),
            };
            await this.updateState(state => ({
                ...state,
                directoryCache: upsertBy(state.directoryCache, item => item.listingPinId === record.listingPinId, record),
            }));
            return record;
        },
        async upsertBuyerOrder(input) {
            const listingPinId = requireText(input.listingPinId, 'listingPinId');
            const skuId = requireText(input.skuId, 'skuId');
            const productOrderPinId = normalizeNullableText(input.productOrderPinId);
            const paymentTxid = normalizeNullableText(input.paymentTxid);
            const orderTxid = normalizeNullableText(input.orderTxid);
            let record = null;
            await this.updateState(state => {
                const existing = state.buyerOrders.find(item => Boolean(productOrderPinId && item.productOrderPinId === productOrderPinId) ||
                    Boolean(paymentTxid && item.paymentTxid === paymentTxid) ||
                    Boolean(orderTxid && item.orderTxid === orderTxid)) ?? null;
                const nextRecord = {
                    role: 'buyer',
                    productOrderPinId: normalizeNullableText(hasOwnProperty(input, 'productOrderPinId')
                        ? input.productOrderPinId
                        : existing?.productOrderPinId),
                    listingPinId,
                    skuId,
                    paymentTxid: normalizeNullableText(hasOwnProperty(input, 'paymentTxid') ? input.paymentTxid : existing?.paymentTxid),
                    productOrderPayload: normalizeProductOrderPayload(hasOwnProperty(input, 'productOrderPayload')
                        ? input.productOrderPayload
                        : existing?.productOrderPayload),
                    orderTxid: normalizeNullableText(hasOwnProperty(input, 'orderTxid') ? input.orderTxid : existing?.orderTxid),
                    sellerGlobalMetaId: normalizeNullableText(hasOwnProperty(input, 'sellerGlobalMetaId')
                        ? input.sellerGlobalMetaId
                        : existing?.sellerGlobalMetaId),
                    buyerGlobalMetaId: normalizeNullableText(hasOwnProperty(input, 'buyerGlobalMetaId')
                        ? input.buyerGlobalMetaId
                        : existing?.buyerGlobalMetaId),
                    traceId: normalizeNullableText(hasOwnProperty(input, 'traceId') ? input.traceId : existing?.traceId),
                    sessionId: normalizeNullableText(hasOwnProperty(input, 'sessionId') ? input.sessionId : existing?.sessionId),
                    deliverySummary: normalizeDeliverySummary(hasOwnProperty(input, 'deliverySummary') ? input.deliverySummary : existing?.deliverySummary),
                    state: input.state || existing?.state || 'created',
                    localUpdatedAt: input.localUpdatedAt ?? Date.now(),
                };
                record = nextRecord;
                return {
                    ...state,
                    buyerOrders: upsertBy(state.buyerOrders, item => Boolean(nextRecord.productOrderPinId && item.productOrderPinId === nextRecord.productOrderPinId) ||
                        Boolean(nextRecord.paymentTxid && item.paymentTxid === nextRecord.paymentTxid) ||
                        Boolean(nextRecord.orderTxid && item.orderTxid === nextRecord.orderTxid), nextRecord),
                };
            });
            if (!record) {
                throw new Error('Buyer order upsert did not produce a record.');
            }
            return record;
        },
        async upsertSellerOrder(input) {
            const productOrderPinId = requireText(input.productOrderPinId, 'productOrderPinId');
            const listingPinId = requireText(input.listingPinId, 'listingPinId');
            const skuId = requireText(input.skuId, 'skuId');
            const paymentTxid = requireText(input.paymentTxid, 'paymentTxid');
            const record = {
                role: 'seller',
                productOrderPinId,
                listingPinId,
                skuId,
                paymentTxid,
                productOrderPayload: normalizeProductOrderPayload(input.productOrderPayload),
                orderTxid: normalizeNullableText(input.orderTxid),
                buyerGlobalMetaId: normalizeNullableText(input.buyerGlobalMetaId),
                fulfillmentSkills: [...(input.fulfillmentSkills || [])],
                paymentVerified: normalizeNullableBoolean(input.paymentVerified),
                selectedSku: normalizeSelectedSku(input.selectedSku),
                fulfillmentState: input.fulfillmentState || null,
                deliveryPinId: normalizeNullableText(input.deliveryPinId),
                deliverySummary: normalizeDeliverySummary(input.deliverySummary),
                failureReason: normalizeNullableText(input.failureReason),
                state: input.state || 'created',
                localUpdatedAt: input.localUpdatedAt ?? Date.now(),
            };
            await this.updateState(state => ({
                ...state,
                sellerOrders: upsertBy(state.sellerOrders, item => item.productOrderPinId === record.productOrderPinId ||
                    item.paymentTxid === record.paymentTxid ||
                    Boolean(record.orderTxid && item.orderTxid === record.orderTxid), record),
            }));
            return record;
        },
        async claimSellerOrderFulfillment(input) {
            const productOrderPinId = requireText(input.productOrderPinId, 'productOrderPinId');
            const listingPinId = requireText(input.listingPinId, 'listingPinId');
            const skuId = requireText(input.skuId, 'skuId');
            const paymentTxid = requireText(input.paymentTxid, 'paymentTxid');
            const orderTxid = requireText(input.orderTxid, 'orderTxid');
            let result = null;
            await this.updateState(state => {
                const existing = state.sellerOrders.find(item => item.productOrderPinId === productOrderPinId) ?? null;
                const samePurchase = Boolean(existing) && existing?.paymentTxid === paymentTxid;
                if (samePurchase &&
                    existing?.state === 'delivered' &&
                    (existing.deliveryPinId || existing.deliverySummary?.deliveryPinId)) {
                    result = { status: 'duplicate_delivered', record: existing };
                    return state;
                }
                if (samePurchase && existing?.state === 'fulfilling') {
                    result = { status: 'in_progress', record: existing };
                    return state;
                }
                const record = {
                    role: 'seller',
                    productOrderPinId,
                    listingPinId,
                    skuId,
                    paymentTxid,
                    productOrderPayload: normalizeProductOrderPayload(input.productOrderPayload),
                    orderTxid: normalizeNullableText(existing?.orderTxid ?? orderTxid),
                    buyerGlobalMetaId: normalizeNullableText(input.buyerGlobalMetaId),
                    fulfillmentSkills: [...(input.fulfillmentSkills || [])],
                    paymentVerified: null,
                    selectedSku: normalizeSelectedSku(input.selectedSku),
                    fulfillmentState: 'fulfilling',
                    deliveryPinId: null,
                    deliverySummary: null,
                    failureReason: null,
                    state: 'fulfilling',
                    localUpdatedAt: input.localUpdatedAt ?? Date.now(),
                };
                result = { status: 'claimed', record };
                return {
                    ...state,
                    sellerOrders: upsertBy(state.sellerOrders, item => item.productOrderPinId === record.productOrderPinId, record),
                };
            });
            if (!result) {
                throw new Error('Seller order fulfillment claim did not produce a result.');
            }
            return result;
        },
        async findListingByPinId(listingPinId) {
            const normalized = normalizeText(listingPinId);
            const state = await this.readState();
            const owned = state.ownedListings.find(item => item.listingPinId === normalized);
            if (owned)
                return { source: 'ownedListings', item: owned };
            const cached = state.directoryCache.find(item => item.listingPinId === normalized);
            return cached ? { source: 'directoryCache', item: cached } : null;
        },
        async listOrders() {
            const state = await this.readState();
            return [
                ...state.buyerOrders.map(item => ({ source: 'buyerOrders', item })),
                ...state.sellerOrders.map(item => ({ source: 'sellerOrders', item })),
            ];
        },
        async findOrderByOrderId(orderId) {
            const normalized = normalizeText(orderId);
            const orders = await this.listOrders();
            return orders.find(order => getProductOrderRecordId(order.item) === normalized) ?? null;
        },
        async findOrderByProductOrderPinId(productOrderPinId) {
            const normalized = normalizeText(productOrderPinId);
            const state = await this.readState();
            const buyer = state.buyerOrders.find(item => item.productOrderPinId === normalized);
            if (buyer)
                return { source: 'buyerOrders', item: buyer };
            const seller = state.sellerOrders.find(item => item.productOrderPinId === normalized);
            return seller ? { source: 'sellerOrders', item: seller } : null;
        },
        async findSellerOrderByProductOrderPinId(productOrderPinId) {
            const normalized = normalizeText(productOrderPinId);
            const state = await this.readState();
            const seller = state.sellerOrders.find(item => item.productOrderPinId === normalized);
            return seller ? { source: 'sellerOrders', item: seller } : null;
        },
        async findOrderByPaymentTxid(paymentTxid) {
            const normalized = normalizeText(paymentTxid);
            const state = await this.readState();
            const buyer = state.buyerOrders.find(item => item.paymentTxid === normalized);
            if (buyer)
                return { source: 'buyerOrders', item: buyer };
            const seller = state.sellerOrders.find(item => item.paymentTxid === normalized);
            return seller ? { source: 'sellerOrders', item: seller } : null;
        },
        async findOrderByOrderTxid(orderTxid) {
            const normalized = normalizeText(orderTxid);
            const state = await this.readState();
            const buyer = state.buyerOrders.find(item => item.orderTxid === normalized);
            if (buyer)
                return { source: 'buyerOrders', item: buyer };
            const seller = state.sellerOrders.find(item => item.orderTxid === normalized);
            return seller ? { source: 'sellerOrders', item: seller } : null;
        },
    };
    return store;
}
