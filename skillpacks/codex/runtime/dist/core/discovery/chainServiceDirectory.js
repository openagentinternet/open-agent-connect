"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CHAIN_SERVICE_MAX_PAGES = exports.DEFAULT_CHAIN_SERVICE_PAGE_SIZE = exports.CHAIN_SERVICE_PROTOCOL_PATH = void 0;
exports.getChainServiceListPage = getChainServiceListPage;
exports.isChainServiceListSemanticMiss = isChainServiceListSemanticMiss;
exports.parseChainServiceItem = parseChainServiceItem;
exports.resolveCurrentChainServices = resolveCurrentChainServices;
const serviceDirectory_1 = require("./serviceDirectory");
const UNIX_SECONDS_MAX = 10_000_000_000;
exports.CHAIN_SERVICE_PROTOCOL_PATH = '/protocols/skill-service';
exports.DEFAULT_CHAIN_SERVICE_PAGE_SIZE = 200;
exports.DEFAULT_CHAIN_SERVICE_MAX_PAGES = 20;
function toSafeString(value) {
    if (typeof value === 'string')
        return value.trim();
    if (value == null)
        return '';
    return String(value).trim();
}
function toSafeNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
function normalizeTimestampMs(value) {
    const parsed = toSafeNumber(value);
    if (!Number.isFinite(parsed) || parsed <= 0)
        return 0;
    return parsed < UNIX_SECONDS_MAX ? Math.trunc(parsed * 1000) : Math.trunc(parsed);
}
function normalizeOperation(value) {
    const normalized = toSafeString(value).toLowerCase();
    return normalized || 'create';
}
function normalizePath(value) {
    const normalized = toSafeString(value);
    return normalized || null;
}
function hasValidOperation(value) {
    const normalized = normalizeOperation(value);
    return normalized === 'create' || normalized === 'modify' || normalized === 'revoke';
}
function parseContentSummary(value) {
    if (!value)
        return null;
    if (typeof value === 'object' && !Array.isArray(value)) {
        return value;
    }
    if (typeof value !== 'string') {
        return null;
    }
    try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed;
        }
    }
    catch {
        return null;
    }
    return null;
}
function extractSourceServicePinId(input) {
    if (input.operation === 'create') {
        return input.pinId;
    }
    const pathTarget = input.path?.startsWith('@') ? input.path.slice(1).trim() : '';
    if (pathTarget) {
        return pathTarget;
    }
    if (input.originalId && !input.originalId.startsWith('/')) {
        return input.originalId;
    }
    return input.pinId;
}
function normalizePinId(row) {
    return row.pinId.trim();
}
function normalizeSourceServicePinId(row) {
    return row.sourceServicePinId.trim() || normalizePinId(row);
}
function compareRowsDesc(left, right) {
    const updatedSort = right.updatedAt - left.updatedAt;
    if (updatedSort !== 0)
        return updatedSort;
    return normalizePinId(right).localeCompare(normalizePinId(left));
}
function compareRowsAsc(left, right) {
    return compareRowsDesc(right, left);
}
function isServiceRowVisible(row) {
    if (row.operation === 'revoke')
        return false;
    if (row.available === 0)
        return false;
    const normalizedStatus = Math.trunc(row.status);
    return normalizedStatus === 0 || normalizedStatus === 1;
}
function resolveCanonicalSourcePinId(row, rowByPinId) {
    let currentPinId = normalizePinId(row);
    let nextPinId = normalizeSourceServicePinId(row);
    const visited = new Set([currentPinId]);
    while (nextPinId && nextPinId !== currentPinId && !visited.has(nextPinId)) {
        const nextRow = rowByPinId.get(nextPinId);
        if (!nextRow) {
            return nextPinId;
        }
        visited.add(nextPinId);
        currentPinId = nextPinId;
        nextPinId = normalizeSourceServicePinId(nextRow);
    }
    return nextPinId || currentPinId;
}
function getChainServiceListPage(payload) {
    const data = payload && typeof payload === 'object'
        ? payload.data
        : undefined;
    return {
        list: Array.isArray(data?.list)
            ? data.list.filter((entry) => Boolean(entry && typeof entry === 'object'))
            : [],
        nextCursor: typeof data?.nextCursor === 'string' ? data.nextCursor : null,
    };
}
function isChainServiceListSemanticMiss(payload) {
    const { list } = getChainServiceListPage(payload);
    if (list.length === 0) {
        return true;
    }
    const sample = list.slice(0, Math.min(list.length, 5));
    return !sample.some((item) => {
        const operation = item.operation ?? item.Operation;
        const status = item.status ?? item.Status;
        return hasValidOperation(operation) && Number.isFinite(Number(status));
    });
}
function parseChainServiceItem(item) {
    const pinId = toSafeString(item.id);
    const operation = normalizeOperation(item.operation ?? item.Operation);
    const status = Math.trunc(toSafeNumber(item.status ?? item.Status));
    const path = normalizePath(item.path);
    const originalId = normalizePath(item.originalId
        ?? item.originalID
        ?? item.originalPinId
        ?? item.original_pin_id);
    const providerMetaId = toSafeString(item.metaid ?? item.createMetaId);
    const providerAddress = toSafeString(item.createAddress ?? item.create_address ?? item.address);
    const updatedAt = normalizeTimestampMs(item.timestamp) || Date.now();
    const sourceServicePinId = extractSourceServicePinId({
        pinId,
        operation,
        path,
        originalId,
    });
    const summary = parseContentSummary(item.contentSummary);
    const providerGlobalMetaId = (0, serviceDirectory_1.normalizeComparableGlobalMetaId)(item.globalMetaId
        ?? summary?.providerMetaBot);
    if (!summary) {
        if (operation !== 'revoke' || !sourceServicePinId) {
            return null;
        }
        return {
            pinId: pinId || sourceServicePinId,
            providerMetaId,
            providerGlobalMetaId,
            providerAddress,
            serviceName: sourceServicePinId,
            displayName: 'Revoked service',
            description: '',
            price: '0',
            currency: '',
            paymentChain: null,
            settlementKind: null,
            mrc20Ticker: null,
            mrc20Id: null,
            serviceIcon: null,
            providerSkill: null,
            skillDocument: null,
            inputType: null,
            outputType: null,
            endpoint: null,
            paymentAddress: providerAddress || null,
            status,
            operation,
            path,
            originalId,
            sourceServicePinId,
            available: 0,
            updatedAt,
        };
    }
    const serviceName = toSafeString(summary.serviceName);
    if (!serviceName || !providerMetaId || !providerAddress) {
        return null;
    }
    return {
        pinId: pinId || sourceServicePinId || serviceName,
        providerMetaId,
        providerGlobalMetaId,
        providerAddress,
        serviceName,
        displayName: toSafeString(summary.displayName) || serviceName || 'Service',
        description: toSafeString(summary.description),
        price: toSafeString(summary.price),
        currency: toSafeString(summary.currency ?? summary.priceUnit),
        paymentChain: toSafeString(summary.paymentChain) || null,
        settlementKind: toSafeString(summary.settlementKind) || null,
        mrc20Ticker: toSafeString(summary.mrc20Ticker) || null,
        mrc20Id: toSafeString(summary.mrc20Id) || null,
        serviceIcon: toSafeString(summary.serviceIcon) || null,
        providerSkill: toSafeString(summary.providerSkill) || null,
        skillDocument: toSafeString(summary.skillDocument) || null,
        inputType: toSafeString(summary.inputType) || null,
        outputType: toSafeString(summary.outputType) || null,
        endpoint: toSafeString(summary.endpoint) || null,
        paymentAddress: toSafeString(summary.paymentAddress) || providerAddress || null,
        status,
        operation,
        path,
        originalId,
        sourceServicePinId,
        available: operation === 'revoke' || status < 0 ? 0 : 1,
        updatedAt,
    };
}
function resolveCurrentChainServices(rows) {
    const normalizedRows = rows
        .filter((row) => Boolean(row && normalizePinId(row)))
        .map((row) => ({ ...row }));
    const rowByPinId = new Map(normalizedRows.map((row) => [normalizePinId(row), row]));
    const rowsBySourcePinId = new Map();
    for (const row of normalizedRows) {
        const canonicalSourcePinId = resolveCanonicalSourcePinId(row, rowByPinId);
        const list = rowsBySourcePinId.get(canonicalSourcePinId) ?? [];
        list.push(row);
        rowsBySourcePinId.set(canonicalSourcePinId, list);
    }
    const currentServices = [...rowsBySourcePinId.entries()]
        .map(([sourceServicePinId, sourceRows]) => {
        const sortedRows = [...sourceRows].sort(compareRowsDesc);
        const latestRow = sortedRows[0];
        if (!latestRow || latestRow.operation === 'revoke') {
            return null;
        }
        const currentRow = sortedRows.find((row) => isServiceRowVisible(row));
        if (!currentRow) {
            return null;
        }
        const chainPinIds = [...new Set([...sourceRows]
                .sort(compareRowsAsc)
                .filter((row) => row.operation !== 'revoke')
                .map((row) => normalizePinId(row))
                .filter(Boolean))];
        return {
            servicePinId: normalizePinId(currentRow),
            sourceServicePinId,
            chainPinIds,
            providerGlobalMetaId: currentRow.providerGlobalMetaId,
            providerMetaId: currentRow.providerMetaId,
            providerAddress: currentRow.providerAddress,
            serviceName: currentRow.serviceName,
            displayName: currentRow.displayName,
            description: currentRow.description,
            price: currentRow.price,
            currency: currentRow.currency,
            paymentChain: currentRow.paymentChain,
            settlementKind: currentRow.settlementKind,
            mrc20Ticker: currentRow.mrc20Ticker,
            mrc20Id: currentRow.mrc20Id,
            serviceIcon: currentRow.serviceIcon,
            providerSkill: currentRow.providerSkill,
            skillDocument: currentRow.skillDocument,
            inputType: currentRow.inputType,
            outputType: currentRow.outputType,
            endpoint: currentRow.endpoint,
            paymentAddress: currentRow.paymentAddress,
            available: Boolean(currentRow.available),
            updatedAt: currentRow.updatedAt,
        };
    })
        .filter((row) => row !== null);
    return currentServices
        .sort((left, right) => right.updatedAt - left.updatedAt || right.servicePinId.localeCompare(left.servicePinId));
}
