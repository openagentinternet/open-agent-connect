"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createChainEvolutionReader = createChainEvolutionReader;
const protocol_1 = require("../protocol");
const publishedArtifactProtocol_1 = require("./publishedArtifactProtocol");
const DEFAULT_CHAIN_API_BASE_URL = 'https://manapi.metaid.io';
function normalizeBaseUrl(value) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return (normalized || DEFAULT_CHAIN_API_BASE_URL).replace(/\/$/, '');
}
function getFetchImpl(fetchImpl) {
    return fetchImpl ?? fetch;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function toNonEmptyString(value) {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function parseContentSummary(value) {
    if (isRecord(value))
        return value;
    if (typeof value !== 'string')
        return null;
    try {
        const parsed = JSON.parse(value);
        return isRecord(parsed) ? parsed : null;
    }
    catch {
        return null;
    }
}
function extractListRows(payload) {
    if (!isRecord(payload) || !isRecord(payload.data)) {
        throw new Error('invalid_page_payload');
    }
    const { list } = payload.data;
    if (!Array.isArray(list)) {
        throw new Error('invalid_page_payload');
    }
    return list.filter((entry) => isRecord(entry));
}
function normalizeMetadataPayload(item) {
    const summary = parseContentSummary(item.contentSummary);
    if (summary) {
        return summary;
    }
    return item;
}
function extractPinPayload(payload) {
    if (!isRecord(payload)) {
        return null;
    }
    if (isRecord(payload.data)) {
        const dataSummary = parseContentSummary(payload.data.contentSummary);
        return dataSummary ?? payload.data;
    }
    const summary = parseContentSummary(payload.contentSummary);
    return summary ?? payload;
}
function extractContentPayload(payload) {
    if (!isRecord(payload)) {
        return payload;
    }
    if (isRecord(payload.data)) {
        const content = payload.data.content ?? payload.data.body ?? payload.data.payload;
        return content ?? payload.data;
    }
    const content = payload.content ?? payload.body ?? payload.payload;
    return content ?? payload;
}
function normalizePinId(pinId) {
    return pinId.trim();
}
function createInvalidSearchResultError(detail) {
    return new Error(`evolution_search_result_invalid:${detail}`);
}
function createChainEvolutionReader(input) {
    const chainApiBaseUrl = normalizeBaseUrl(input.chainApiBaseUrl);
    const fetchImpl = getFetchImpl(input.fetchImpl);
    return {
        async fetchMetadataRows() {
            const url = new URL(`${chainApiBaseUrl}/pin/path/list`);
            url.searchParams.set('path', protocol_1.EVOLUTION_ARTIFACT_PROTOCOL_PATH);
            url.searchParams.set('size', String(publishedArtifactProtocol_1.EVOLUTION_SEARCH_MAX_RAW_ROWS));
            const response = await fetchImpl(url.toString());
            if (!response.ok) {
                throw new Error(`chain_evolution_http_${response.status}`);
            }
            let payload;
            try {
                payload = await response.json();
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                throw createInvalidSearchResultError(message || 'invalid_page_payload');
            }
            let rows;
            try {
                rows = extractListRows(payload);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                throw createInvalidSearchResultError(message || 'invalid_page_payload');
            }
            return rows
                .map((item) => {
                const pinId = toNonEmptyString(item.id);
                if (!pinId) {
                    return null;
                }
                return {
                    pinId,
                    payload: normalizeMetadataPayload(item),
                };
            })
                .filter((entry) => Boolean(entry))
                .slice(0, publishedArtifactProtocol_1.EVOLUTION_SEARCH_MAX_RAW_ROWS);
        },
        async readMetadataPinById(pinId) {
            const normalizedPinId = normalizePinId(pinId);
            if (!normalizedPinId) {
                return null;
            }
            const response = await fetchImpl(`${chainApiBaseUrl}/pin/${encodeURIComponent(normalizedPinId)}`);
            if (response.status === 404) {
                return null;
            }
            if (!response.ok) {
                throw new Error(`chain_evolution_http_${response.status}`);
            }
            const payload = await response.json();
            return extractPinPayload(payload);
        },
        async readArtifactBodyByUri(uri) {
            const contentPinId = (0, publishedArtifactProtocol_1.parseMetafilePinId)(uri);
            if (!contentPinId) {
                throw new Error(`Invalid metafile URI: ${uri}`);
            }
            const response = await fetchImpl(`${chainApiBaseUrl}/content/${encodeURIComponent(contentPinId)}`);
            if (!response.ok) {
                throw new Error(`chain_evolution_http_${response.status}`);
            }
            const payload = await response.json();
            return extractContentPayload(payload);
        },
    };
}
