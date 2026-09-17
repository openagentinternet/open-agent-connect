"use strict";
/**
 * Thin client for the metaso-p2p metaprotocol authoritative registry API
 * (so.metaid.io, docs/metaid_protocols/metaprotocol-registry-agent-tools.md §3):
 *
 * - GET /api/metaweb/protocols           — authoritative registry list (v2)
 * - GET /api/metaweb/protocols/check     — publish precheck (path occupancy)
 * - GET /api/metaweb/protocols/detail    — record + payload + version list
 * - GET /api/metaweb/pin/:pinId/versions — modify-chain versions
 *
 * OAC port of the IDBots feat/metaprotocol-registry-tools service. Same
 * envelope conventions as the other so.metaid.io aggregation APIs ({code,
 * data, message}, HTTP always 200, business error codes 40000/40400/50000).
 * The core never reads the environment — callers pass { baseUrl } resolved
 * from METABOT_METAWEB_API_BASE_URL.
 *
 * Read-only MANAPI fallback (manapi.metaid.io): when the MetaSo projection is
 * unreachable, callers degrade to GET /pin/path/list?path=/protocols/metaprotocol
 * plus client-side contentSummary parsing, and to the source pin's
 * modify_history for version chains. The fallback lives here so the tool/CLI
 * layers only orchestrate; nothing in this file ever writes.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetaprotocolResolveError = exports.METAPROTOCOL_REGISTRY_PATH = exports.DEFAULT_METAPROTOCOL_MANAPI_BASE_URL = exports.DEFAULT_METAPROTOCOL_BASE_URL = void 0;
exports.isMetaprotocolNotFoundError = isMetaprotocolNotFoundError;
exports.listMetaProtocols = listMetaProtocols;
exports.checkMetaProtocolPath = checkMetaProtocolPath;
exports.getMetaProtocolDetail = getMetaProtocolDetail;
exports.getMetaProtocolPinVersions = getMetaProtocolPinVersions;
exports.notRegisteredText = notRegisteredText;
exports.resolveMetaProtocolRecord = resolveMetaProtocolRecord;
exports.matchManapiRegistrations = matchManapiRegistrations;
exports.listMetaProtocolRegistrationsViaManapi = listMetaProtocolRegistrationsViaManapi;
exports.getMetaProtocolVersionsViaManapi = getMetaProtocolVersionsViaManapi;
exports.DEFAULT_METAPROTOCOL_BASE_URL = 'https://so.metaid.io';
exports.DEFAULT_METAPROTOCOL_MANAPI_BASE_URL = 'https://manapi.metaid.io';
/** On-chain directory of the protocol registry itself. */
exports.METAPROTOCOL_REGISTRY_PATH = '/protocols/metaprotocol';
const DEFAULT_TIMEOUT_MS = 10_000;
/** Fallback paging cap: 20 pages x 100 pins. */
const MANAPI_FALLBACK_MAX_PAGES = 20;
/** Fallback cap on the modify_history width resolved through MANAPI. */
const MANAPI_FALLBACK_MAX_VERSIONS = 50;
/**
 * Business-resolution failure (not registered, ambiguous name, lookup
 * refused). Thrown by the resolver below so callers can tell it apart from a
 * transport error — which triggers the MANAPI degraded fallback instead.
 */
class MetaprotocolResolveError extends Error {
    constructor(message) {
        super(message);
        this.name = 'MetaprotocolResolveError';
    }
}
exports.MetaprotocolResolveError = MetaprotocolResolveError;
/** Transport-error test: 40400 is the registry's not-found business code. */
function isMetaprotocolNotFoundError(error) {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('40400');
}
function resolveOptions(options) {
    const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
        throw new Error('A fetch implementation is required for the metaprotocol registry.');
    }
    return {
        baseUrl: (options?.baseUrl ?? exports.DEFAULT_METAPROTOCOL_BASE_URL).replace(/\/+$/, ''),
        manapiBaseUrl: (options?.manapiBaseUrl ?? exports.DEFAULT_METAPROTOCOL_MANAPI_BASE_URL).replace(/\/+$/, ''),
        fetchImpl,
        timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };
}
function text(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function textList(value) {
    if (!Array.isArray(value))
        return [];
    return value.map((item) => String(item ?? '').trim()).filter(Boolean);
}
function normalizeAuthor(raw) {
    const record = (raw && typeof raw === 'object' ? raw : {});
    return {
        address: text(record.address),
        metaid: text(record.metaid ?? record.metaId),
        globalMetaId: text(record.globalMetaId),
        name: text(record.name),
    };
}
async function fetchEnvelope(url, fetchImpl, timeoutMs, apiLabel) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        let response;
        try {
            response = await fetchImpl(url, {
                signal: controller.signal,
                headers: { accept: 'application/json' },
            });
        }
        catch (error) {
            // Map the raw AbortError to an actionable timeout message — the model
            // sees this text verbatim in the tool result.
            if (error instanceof Error && error.name === 'AbortError') {
                throw new Error(`${apiLabel} timed out after ${Math.round(timeoutMs / 1000)}s — try again later.`);
            }
            throw error;
        }
        const body = await response.json().catch(() => null);
        if (!body || typeof body !== 'object') {
            throw new Error(`${apiLabel} returned an invalid response (HTTP ${response.status}).`);
        }
        const code = Number(body.code);
        if (code === 0) {
            return (body.data && typeof body.data === 'object' ? body.data : {});
        }
        throw new Error(`${apiLabel} error ${code}: ${text(body.message) || 'unknown error'}`);
    }
    finally {
        clearTimeout(timer);
    }
}
// ---------------- §3.1: registry list ----------------
function normalizeListItem(raw) {
    const record = (raw && typeof raw === 'object' ? raw : {});
    const pinId = text(record.pinId);
    return {
        protocolPath: text(record.protocolPath),
        title: text(record.title),
        protocolName: text(record.protocolName),
        intro: text(record.intro),
        version: text(record.version),
        chainName: text(record.chainName),
        pinId,
        currentPinId: text(record.currentPinId) || pinId,
        createdAt: Number(record.createdAt) || 0,
        updatedAt: Number(record.updatedAt) || 0,
        confirmed: record.confirmed !== false,
        author: normalizeAuthor(record.author),
        conflictsCount: Number(record.conflictsCount) || 0,
    };
}
/** §3.1 — authoritative registry list, createdAt desc (newest registrations first). */
async function listMetaProtocols(params = {}, options) {
    const { baseUrl, fetchImpl, timeoutMs } = resolveOptions(options);
    const url = new URL(`${baseUrl}/api/metaweb/protocols`);
    if (params.query?.trim())
        url.searchParams.set('q', params.query.trim());
    if (params.publisher?.trim())
        url.searchParams.set('publisher', params.publisher.trim());
    if (params.path?.trim())
        url.searchParams.set('path', params.path.trim());
    if (params.includeConflicts === true)
        url.searchParams.set('includeConflicts', 'true');
    if (typeof params.size === 'number' && params.size > 0) {
        url.searchParams.set('size', String(Math.min(100, Math.floor(params.size))));
    }
    if (params.cursor?.trim())
        url.searchParams.set('cursor', params.cursor.trim());
    const data = await fetchEnvelope(url.toString(), fetchImpl, timeoutMs, 'MetaSo protocol registry');
    return {
        items: Array.isArray(data.items) ? data.items.map(normalizeListItem) : [],
        rejected: Array.isArray(data.rejected)
            ? data.rejected.map((raw) => {
                const record = (raw && typeof raw === 'object' ? raw : {});
                return { pinId: text(record.pinId), reason: text(record.reason) };
            })
            : [],
        nextCursor: text(data.nextCursor) || null,
        hasMore: data.hasMore === true,
    };
}
// ---------------- §3.2: publish precheck ----------------
function normalizeCheck(raw, requestedPath) {
    const existingRaw = (raw.existing && typeof raw.existing === 'object' ? raw.existing : null);
    const pinId = existingRaw ? text(existingRaw.pinId) : '';
    return {
        path: text(raw.path) || requestedPath,
        available: raw.available === true,
        existing: existingRaw
            ? {
                pinId,
                currentPinId: text(existingRaw.currentPinId) || pinId,
                title: text(existingRaw.title),
                protocolName: text(existingRaw.protocolName),
                version: text(existingRaw.version),
                createdAt: Number(existingRaw.createdAt) || 0,
                confirmed: existingRaw.confirmed !== false,
                author: normalizeAuthor(existingRaw.author),
            }
            : null,
    };
}
/** §3.2 — path occupancy precheck. Unconfirmed (mempool) registrations count as occupied. */
async function checkMetaProtocolPath(path, options) {
    const { baseUrl, fetchImpl, timeoutMs } = resolveOptions(options);
    const trimmed = text(path);
    if (!trimmed)
        throw new Error('path is required for the protocol registry check.');
    const url = new URL(`${baseUrl}/api/metaweb/protocols/check`);
    url.searchParams.set('path', trimmed);
    const data = await fetchEnvelope(url.toString(), fetchImpl, timeoutMs, 'MetaSo protocol registry check');
    return normalizeCheck(data, trimmed);
}
// ---------------- §3.3: record detail ----------------
function normalizePayload(raw) {
    const record = (raw && typeof raw === 'object' ? raw : {});
    return {
        title: text(record.title),
        path: text(record.path),
        version: text(record.version),
        authors: text(record.authors),
        intro: text(record.intro),
        protocolName: text(record.protocolName),
        protocolAttachments: textList(record.protocolAttachments),
        metadata: record.metadata ?? '',
        protocolContent: typeof record.protocolContent === 'string' ? record.protocolContent : '',
        protocolContentType: text(record.protocolContentType) || 'application/json',
    };
}
function normalizeDetail(raw) {
    const recordRaw = (raw.record && typeof raw.record === 'object' ? raw.record : {});
    const attributionOf = (value) => (text(value) === 'local' ? 'local' : 'chain');
    return {
        record: { ...normalizeListItem(recordRaw), payload: normalizePayload(recordRaw.payload) },
        versions: Array.isArray(raw.versions)
            ? raw.versions.map((entry) => {
                const record = (entry && typeof entry === 'object' ? entry : {});
                return {
                    pinId: text(record.pinId),
                    version: text(record.version),
                    timestamp: Number(record.timestamp) || 0,
                    author: normalizeAuthor(record.author),
                    attribution: attributionOf(record.attribution),
                };
            })
            : [],
        conflicts: Array.isArray(raw.conflicts) ? raw.conflicts : [],
        invalidModifies: Array.isArray(raw.invalidModifies) ? raw.invalidModifies : [],
    };
}
/** §3.3 — one record's authoritative latest version. `path` wins over `pinId` when both are given. */
async function getMetaProtocolDetail(input, options) {
    const { baseUrl, fetchImpl, timeoutMs } = resolveOptions(options);
    const url = new URL(`${baseUrl}/api/metaweb/protocols/detail`);
    const path = text(input.path);
    const pinId = text(input.pinId);
    if (path)
        url.searchParams.set('path', path);
    else if (pinId)
        url.searchParams.set('pinId', pinId);
    else
        throw new Error('path or pinId is required for the protocol registry detail.');
    const data = await fetchEnvelope(url.toString(), fetchImpl, timeoutMs, 'MetaSo protocol registry detail');
    return normalizeDetail(data);
}
// ---------------- §3.4: version chain ----------------
/** §3.4 — modify-chain versions of a pin (any pinId in the chain resolves to its record's chain). */
async function getMetaProtocolPinVersions(pinId, options) {
    const { baseUrl, fetchImpl, timeoutMs } = resolveOptions(options);
    const trimmed = text(pinId);
    if (!trimmed)
        throw new Error('pinId is required to read the protocol version chain.');
    const data = await fetchEnvelope(`${baseUrl}/api/metaweb/pin/${encodeURIComponent(trimmed)}/versions`, fetchImpl, timeoutMs, 'MetaSo pin versions');
    return {
        pinId: text(data.pinId) || trimmed,
        latest: text(data.latest),
        attribution: text(data.attribution) === 'local' ? 'local' : 'chain',
        versions: Array.isArray(data.versions)
            ? data.versions.map((raw) => {
                const record = (raw && typeof raw === 'object' ? raw : {});
                return {
                    pinId: text(record.pinId),
                    // The server sends `version` as a JSON NUMBER (1, 2, …) — the
                    // text() helper would blank it; stringify explicitly.
                    version: record.version === undefined || record.version === null ? '' : String(record.version),
                    createdAt: Number(record.createdAt) || 0,
                    operation: text(record.operation),
                    author: normalizeAuthor(record.author),
                };
            })
            : [],
    };
}
// ---------------- §4.3 resolution order (shared by reads and update gate) ----------------
function notRegisteredText(locator) {
    return `Protocol "${locator}" is not registered yet. It can be published with post_metaprotocol (action "publish").`;
}
/**
 * Resolve one protocol to its authoritative record (§4.3 order:
 * protocolPath → protocolName exact display-name match → pinId). Throws
 * MetaprotocolResolveError for business failures (the caller surfaces the
 * message verbatim) and rethrows transport errors so the caller can degrade
 * to the MANAPI fallback.
 */
async function resolveMetaProtocolRecord(input, options) {
    const protocolPath = text(input.protocolPath);
    const protocolName = text(input.protocolName);
    const pinId = text(input.pinId);
    const pickNameMatch = async (page) => {
        const matches = page.items.filter((item) => item.protocolName.toLowerCase() === protocolName.toLowerCase());
        if (matches.length === 0)
            throw new MetaprotocolResolveError(notRegisteredText(protocolName));
        if (matches.length > 1) {
            throw new MetaprotocolResolveError(`Multiple protocols are registered under the name "${protocolName}": ${matches
                .map((item) => item.protocolPath)
                .join(', ')}. Resolve with the protocolPath (most precise).`);
        }
        // Exactly one display-name hit: open its record for the authoritative body.
        const detail = await getMetaProtocolDetail({ path: matches[0].protocolPath }, options);
        if (!detail.record.protocolPath)
            throw new MetaprotocolResolveError(notRegisteredText(protocolName));
        return detail.record;
    };
    try {
        if (protocolPath) {
            const detail = await getMetaProtocolDetail({ path: protocolPath }, options);
            if (!detail.record.protocolPath)
                throw new MetaprotocolResolveError(notRegisteredText(protocolPath));
            return detail.record;
        }
        if (protocolName) {
            return await pickNameMatch(await listMetaProtocols({ query: protocolName, size: 50 }, options));
        }
        const detail = await getMetaProtocolDetail({ pinId }, options);
        if (!detail.record.protocolPath)
            throw new MetaprotocolResolveError(notRegisteredText(pinId));
        return detail.record;
    }
    catch (error) {
        if (error instanceof MetaprotocolResolveError)
            throw error;
        if (isMetaprotocolNotFoundError(error)) {
            throw new MetaprotocolResolveError(notRegisteredText(protocolPath || protocolName || pinId));
        }
        throw error;
    }
}
/** Locate fallback registrations by payload path/name (case-insensitive). */
function matchManapiRegistrations(registrations, locator) {
    const wantedPath = text(locator.protocolPath).toLowerCase();
    const wantedName = text(locator.protocolName).toLowerCase();
    return registrations.filter((entry) => {
        const payloadPath = entry.payload && typeof entry.payload.path === 'string' ? entry.payload.path.toLowerCase() : '';
        const payloadName = entry.payload && typeof entry.payload.protocolName === 'string' ? entry.payload.protocolName.toLowerCase() : '';
        if (wantedPath)
            return payloadPath === wantedPath;
        return payloadName === wantedName;
    });
}
// ---------------- MANAPI read-only fallback ----------------
/**
 * MANAPI answers the shared envelope with code === 1 meaning success (unlike
 * the MetaSo aggregation APIs where code === 0 means success). Returns the
 * raw `data` object.
 */
async function fetchManapiEnvelope(url, fetchImpl, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        let response;
        try {
            response = await fetchImpl(url, {
                signal: controller.signal,
                headers: { accept: 'application/json' },
            });
        }
        catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                throw new Error(`MANAPI timed out after ${Math.round(timeoutMs / 1000)}s — try again later.`);
            }
            throw error;
        }
        const body = await response.json().catch(() => null);
        if (!body || typeof body !== 'object') {
            throw new Error(`MANAPI returned an invalid response (HTTP ${response.status}).`);
        }
        if (Number(body.code) !== 1) {
            throw new Error(`MANAPI error ${Number(body.code) || '?'}: ${text(body.message) || 'unknown error'}`);
        }
        return (body.data && typeof body.data === 'object' ? body.data : {});
    }
    finally {
        clearTimeout(timer);
    }
}
/**
 * contentSummary is a truncated JSON string of the pin payload (it may be cut
 * mid-string); originalContentBody is the base64 full payload. Prefer the
 * summary, decode the full body only when the summary does not parse.
 */
function parseManapiPayload(record) {
    const summary = typeof record.contentSummary === 'string' ? record.contentSummary : '';
    if (summary) {
        try {
            const parsed = JSON.parse(summary);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
                return parsed;
        }
        catch {
            // Truncated summary — fall through to the full body.
        }
    }
    const original = typeof record.originalContentBody === 'string' ? record.originalContentBody : '';
    if (original) {
        try {
            const parsed = JSON.parse(Buffer.from(original, 'base64').toString('utf8'));
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
                return parsed;
        }
        catch {
            // Unparseable payload — the caller treats it as rejected.
        }
    }
    return null;
}
function normalizeManapiRegistration(raw) {
    const record = (raw && typeof raw === 'object' ? raw : {});
    return {
        pinId: text(record.id),
        timestamp: Number(record.timestamp) || 0,
        operation: text(record.operation),
        version: record.version === undefined || record.version === null ? '' : String(record.version),
        address: text(record.address),
        metaid: text(record.metaid ?? record.metaId),
        globalMetaId: text(record.globalMetaId),
        payload: parseManapiPayload(record),
    };
}
/**
 * Degraded registry scan: every /protocols/metaprotocol registration pin
 * (newest first), payloads parsed client-side. Only first-version create pins
 * carry the /protocols/metaprotocol path — modify pins live at @<sourcePinId>
 * — so version chains are NOT included here (see getMetaProtocolVersionsViaManapi).
 */
async function listMetaProtocolRegistrationsViaManapi(options) {
    const { manapiBaseUrl, fetchImpl, timeoutMs } = resolveOptions(options);
    const registrations = [];
    let cursor = null;
    for (let page = 0; page < MANAPI_FALLBACK_MAX_PAGES; page += 1) {
        const query = new URLSearchParams({ path: exports.METAPROTOCOL_REGISTRY_PATH });
        query.set('size', '100');
        if (cursor)
            query.set('cursor', cursor);
        const data = await fetchManapiEnvelope(`${manapiBaseUrl}/pin/path/list?${query.toString()}`, fetchImpl, timeoutMs);
        const list = Array.isArray(data.list) ? data.list : [];
        for (const raw of list)
            registrations.push(normalizeManapiRegistration(raw));
        cursor = text(data.nextCursor) || null;
        if (!cursor || list.length === 0)
            break;
    }
    return registrations;
}
function normalizeManapiVersion(pinId, data) {
    const payload = parseManapiPayload(data);
    const bodyVersion = payload && typeof payload.version === 'string' ? payload.version : '';
    return {
        pinId: text(data.id) || pinId,
        version: bodyVersion || (data.version === undefined || data.version === null ? '' : String(data.version)),
        timestamp: Number(data.timestamp) || 0,
        author: {
            address: text(data.address),
            metaid: text(data.metaid ?? data.metaId),
            globalMetaId: text(data.globalMetaId),
            name: '',
        },
    };
}
/**
 * Degraded version chain: the source pin's modify_history (chain order) with
 * per-version body versions, best-effort — a version pin that cannot be read
 * is skipped rather than failing the chain.
 */
async function getMetaProtocolVersionsViaManapi(sourcePinId, options) {
    const { manapiBaseUrl, fetchImpl, timeoutMs } = resolveOptions(options);
    const trimmed = text(sourcePinId);
    if (!trimmed)
        throw new Error('pinId is required to resolve MANAPI fallback versions.');
    const data = await fetchManapiEnvelope(`${manapiBaseUrl}/api/pin/${encodeURIComponent(trimmed)}`, fetchImpl, timeoutMs);
    const history = Array.isArray(data.modify_history)
        ? data.modify_history.map((item) => text(item)).filter(Boolean)
        : [];
    const chain = history.length > 0 ? history : [trimmed];
    const versions = [];
    for (const pinId of chain.slice(0, MANAPI_FALLBACK_MAX_VERSIONS)) {
        try {
            const pinData = await fetchManapiEnvelope(`${manapiBaseUrl}/api/pin/${encodeURIComponent(pinId)}`, fetchImpl, timeoutMs);
            versions.push(normalizeManapiVersion(pinId, pinData));
        }
        catch {
            // Best-effort chain: skip the unreadable version instead of failing all.
        }
    }
    return versions;
}
