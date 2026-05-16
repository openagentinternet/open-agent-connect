"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readLoomRawChainRecords = readLoomRawChainRecords;
const protocols_1 = require("./protocols");
const validation_1 = require("./validation");
const DEFAULT_CHAIN_API_BASE_URL = 'https://manapi.metaid.io';
const DEFAULT_PAGE_SIZE = 200;
const DEFAULT_MAX_PAGES = 20;
const UNIX_SECONDS_MAX = 10_000_000_000;
function normalizeBaseUrl(value) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return (normalized || DEFAULT_CHAIN_API_BASE_URL).replace(/\/$/, '');
}
function normalizePositiveInteger(value, fallback) {
    return Number.isFinite(value) && value > 0
        ? Math.floor(value)
        : fallback;
}
function toString(value) {
    if (typeof value === 'string')
        return value.trim();
    if (value == null)
        return '';
    return String(value).trim();
}
function normalizeTimestampMs(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0)
        return 0;
    return numeric < UNIX_SECONDS_MAX ? Math.trunc(numeric * 1000) : Math.trunc(numeric);
}
function getListPage(payload) {
    const data = payload && typeof payload === 'object'
        ? payload.data
        : null;
    const dataObject = data && typeof data === 'object' && !Array.isArray(data)
        ? data
        : {};
    return {
        list: Array.isArray(dataObject.list)
            ? dataObject.list.filter((entry) => Boolean(entry && typeof entry === 'object'))
            : [],
        nextCursor: typeof dataObject.nextCursor === 'string'
            ? dataObject.nextCursor
            : typeof dataObject.cursor === 'string'
                ? dataObject.cursor
                : null,
    };
}
function parsePayload(row) {
    const rawPayload = row.contentSummary ?? row.content ?? row.payload;
    if (rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)) {
        return { payload: rawPayload, parseErrors: [] };
    }
    if (typeof rawPayload === 'string' && rawPayload.trim()) {
        try {
            const parsed = JSON.parse(rawPayload);
            return { payload: parsed, parseErrors: [] };
        }
        catch (error) {
            return {
                payload: {},
                parseErrors: [
                    {
                        path: '',
                        code: 'invalid_json',
                        message: error instanceof Error ? error.message : 'payload must be valid JSON.',
                    },
                ],
            };
        }
    }
    return {
        payload: {},
        parseErrors: [
            {
                path: '',
                code: 'missing_payload',
                message: 'Loom record payload was not present in the chain row.',
            },
        ],
    };
}
function normalizePath(row, protocol) {
    const path = toString(row.path);
    return path || protocols_1.LOOM_PROTOCOLS[protocol].path;
}
function resolveRecordProtocol(path, requestedProtocol) {
    if (path === protocols_1.LOOM_PROTOCOLS[requestedProtocol].path) {
        return { protocol: requestedProtocol, pathErrors: [] };
    }
    return {
        protocol: requestedProtocol,
        pathErrors: [
            {
                path: 'path',
                code: 'invalid_path',
                message: `Unexpected Loom row path "${path}" while reading ${protocols_1.LOOM_PROTOCOLS[requestedProtocol].path}.`,
            },
        ],
    };
}
function normalizeOperation(row) {
    const operation = toString(row.operation ?? row.Operation).toLowerCase();
    return operation || 'create';
}
function normalizePinId(row) {
    return toString(row.id ?? row.pinId ?? row.pinID ?? row.txid ?? row.txId);
}
function normalizeRecord(row, protocol) {
    const pinId = normalizePinId(row);
    if (!pinId)
        return null;
    const path = normalizePath(row, protocol);
    const resolved = resolveRecordProtocol(path, protocol);
    const parsed = parsePayload(row);
    const payloadValidation = parsed.parseErrors.length
        ? parsed.parseErrors
        : (0, validation_1.validateLoomPayload)(resolved.protocol, parsed.payload).errors;
    const validationErrors = [
        ...resolved.pathErrors,
        ...payloadValidation,
    ];
    return {
        pinId,
        protocol: resolved.protocol,
        path,
        operation: normalizeOperation(row),
        contentType: toString(row.contentType ?? row.content_type) || 'application/json',
        timestamp: normalizeTimestampMs(row.timestamp ?? row.updatedAt ?? row.createdAt),
        creatorAddress: toString(row.createAddress ?? row.create_address ?? row.address),
        creatorMetaId: toString(row.metaid ?? row.metaId ?? row.createMetaId),
        globalMetaId: toString(row.globalMetaId ?? row.global_meta_id),
        payload: parsed.payload,
        payloadValid: validationErrors.length === 0,
        validationErrors,
        raw: row,
    };
}
async function fetchProtocolRecords(input) {
    let cursor = null;
    const seenCursors = new Set();
    const records = [];
    for (let page = 0; page < input.maxPages; page += 1) {
        const url = new URL(`${input.chainApiBaseUrl}/pin/path/list`);
        url.searchParams.set('path', protocols_1.LOOM_PROTOCOLS[input.protocol].path);
        url.searchParams.set('size', String(input.pageSize));
        if (cursor) {
            url.searchParams.set('cursor', cursor);
        }
        const response = await input.fetchImpl(url.toString());
        if (!response.ok) {
            throw new Error(`loom_chain_reader_http_${response.status}`);
        }
        const payload = await response.json();
        const pageRows = getListPage(payload);
        for (const row of pageRows.list) {
            const record = normalizeRecord(row, input.protocol);
            if (record) {
                records.push(record);
            }
        }
        if (!pageRows.nextCursor || seenCursors.has(pageRows.nextCursor)) {
            break;
        }
        seenCursors.add(pageRows.nextCursor);
        cursor = pageRows.nextCursor;
    }
    return records;
}
async function readLoomRawChainRecords(options = {}) {
    const fetchImpl = options.fetchImpl ?? fetch;
    const chainApiBaseUrl = normalizeBaseUrl(options.chainApiBaseUrl);
    const pageSize = normalizePositiveInteger(options.pageSize, DEFAULT_PAGE_SIZE);
    const maxPages = normalizePositiveInteger(options.maxPages, DEFAULT_MAX_PAGES);
    const byProtocol = {
        task: 0,
        claim: 0,
        status: 0,
        delivery: 0,
        acceptance: 0,
        'claim-reject': 0,
    };
    const records = [];
    for (const protocol of protocols_1.LOOM_PROTOCOL_NAMES) {
        const protocolRecords = await fetchProtocolRecords({
            fetchImpl,
            chainApiBaseUrl,
            protocol,
            pageSize,
            maxPages,
        });
        byProtocol[protocol] = protocolRecords.length;
        records.push(...protocolRecords);
    }
    return { records, byProtocol };
}
