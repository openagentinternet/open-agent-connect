"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMvcSponsorV2Client = createMvcSponsorV2Client;
const DEFAULT_ASSIST_OPEN_API_BASE_URL = 'https://www.metaso.network/assist-open-api';
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}
function normalizeBaseUrl(value) {
    const text = normalizeText(value);
    return (text || DEFAULT_ASSIST_OPEN_API_BASE_URL).replace(/\/+$/, '');
}
function readObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
function pickText(record, ...keys) {
    for (const key of keys) {
        const value = normalizeText(record[key]);
        if (value) {
            return value;
        }
    }
    return '';
}
function normalizeReason(stage, message) {
    if (/available amount not enough|quota not granted|insufficient quota|insufficient balance/i.test(message)) {
        return 'insufficient_quota';
    }
    if (stage === 'pre' && /\b(address not match|txin empty|tx in empty|rejected|invalid tx|invalid transaction|first input)\b/i.test(message)) {
        return 'pre_rejected';
    }
    if (stage === 'commit' || /commit/i.test(message)) {
        return 'commit_failed';
    }
    return 'service_unavailable';
}
function createSponsorError(stage, message, extra = {}) {
    const serviceMessage = normalizeText(message) || `MVC sponsor ${stage} failed.`;
    const error = new Error(serviceMessage);
    error.code = `mvc_fee_assist_${stage}_failed`;
    error.stage = stage;
    error.reason = extra.reason ?? normalizeReason(stage, serviceMessage);
    error.serviceMessage = serviceMessage;
    if (extra.status !== undefined) {
        error.status = extra.status;
    }
    if (extra.data !== undefined) {
        error.data = extra.data;
    }
    return error;
}
function unwrapEnvelope(body, stage) {
    const record = readObject(body);
    if (!record) {
        throw createSponsorError(stage, 'Sponsor service returned a non-object response.');
    }
    if (!('code' in record)) {
        return record;
    }
    const code = Number(record.code);
    if (Number.isFinite(code) && code === 0) {
        const data = readObject(record.data);
        if (!data) {
            throw createSponsorError(stage, 'Sponsor service returned an empty data payload.', {
                data: record.data,
            });
        }
        return data;
    }
    throw createSponsorError(stage, pickText(record, 'message', 'msg', 'error') || `Sponsor service returned code ${normalizeText(record.code) || 'unknown'}.`, { data: record.data });
}
async function parseJsonResponse(response, stage) {
    try {
        return await response.json();
    }
    catch (error) {
        throw createSponsorError(stage, `Sponsor service returned invalid JSON${response.status ? ` (HTTP ${response.status})` : ''}.`, { status: response.status });
    }
}
async function requestJson(fetchImpl, url, init, stage) {
    let response;
    try {
        response = await fetchImpl(url, init);
    }
    catch (error) {
        throw createSponsorError(stage, error instanceof Error ? error.message : String(error));
    }
    const body = await parseJsonResponse(response, stage);
    if (!response.ok) {
        const record = readObject(body);
        throw createSponsorError(stage, record ? pickText(record, 'message', 'msg', 'error') || `Sponsor service request failed with HTTP ${response.status}.`
            : `Sponsor service request failed with HTTP ${response.status}.`, {
            status: response.status,
            data: record?.data,
        });
    }
    return unwrapEnvelope(body, stage);
}
function normalizeBoolean(value) {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value !== 0;
    }
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true' || normalized === '1')
            return true;
        if (normalized === 'false' || normalized === '0')
            return false;
    }
    return null;
}
function normalizeRequiredNumber(stage, record, ...keys) {
    for (const key of keys) {
        const raw = record[key];
        if (typeof raw === 'string' && !raw.trim()) {
            continue;
        }
        const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : Number.NaN;
        if (Number.isFinite(value)) {
            return value;
        }
    }
    throw createSponsorError(stage, `Sponsor ${stage} response is missing required fields.`, {
        data: record,
        reason: stage === 'commit' ? 'commit_failed' : stage === 'pre' ? 'pre_rejected' : 'service_unavailable',
    });
}
function normalizeOptionalNumber(record, ...keys) {
    for (const key of keys) {
        const raw = record[key];
        if (typeof raw === 'string' && !raw.trim()) {
            continue;
        }
        const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : Number.NaN;
        if (Number.isFinite(value)) {
            return value;
        }
    }
    return undefined;
}
function normalizeUserInputIndexes(value) {
    if (!Array.isArray(value) || value.length === 0) {
        throw new Error('missing');
    }
    const result = [];
    for (const item of value) {
        if (typeof item === 'string' && !item.trim()) {
            throw new Error('invalid');
        }
        const numeric = Number(item);
        if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric < 0) {
            throw new Error('invalid');
        }
        result.push(numeric);
    }
    return result;
}
function normalizeAddressInfo(record) {
    const exists = normalizeBoolean(record.exists);
    const rawStatus = pickText(record, 'status');
    const sponsorMode = pickText(record, 'sponsorMode', 'sponsor_mode');
    const grantRequired = normalizeBoolean(record.grantRequired ?? record.grant_required);
    const status = rawStatus || (sponsorMode && grantRequired !== null ? sponsorMode : '');
    if (exists === null || !status) {
        throw createSponsorError('address_info', 'Sponsor address info response is missing required fields.', {
            data: record,
        });
    }
    return {
        exists,
        balance: normalizeRequiredNumber('address_info', record, 'balance'),
        grantedAmount: normalizeRequiredNumber('address_info', record, 'grantedAmount', 'granted_amount'),
        reservedAmount: normalizeRequiredNumber('address_info', record, 'reservedAmount', 'reserved_amount'),
        spentAmount: normalizeRequiredNumber('address_info', record, 'spentAmount', 'spent_amount'),
        availableAmount: normalizeRequiredNumber('address_info', record, 'availableAmount', 'available_amount'),
        status,
        raw: record,
    };
}
function normalizeChallenge(record) {
    const challengeId = pickText(record, 'challengeId', 'challenge_id');
    const message = pickText(record, 'message');
    if (!challengeId || !message) {
        throw createSponsorError('challenge', 'Sponsor challenge response is missing required fields.', {
            data: record,
        });
    }
    const expiresAt = pickText(record, 'expiresAt', 'expires_at');
    return {
        challengeId,
        message,
        expiresAt: expiresAt || undefined,
        raw: record,
    };
}
function normalizePreResult(record) {
    const preparedTxHex = pickText(record, 'preparedTxHex', 'prepared_tx_hex');
    const orderId = pickText(record, 'orderId', 'order_id');
    if (!preparedTxHex || !orderId) {
        throw createSponsorError('pre', 'Sponsor pre response is missing required fields.', {
            data: record,
            reason: 'pre_rejected',
        });
    }
    let userInputIndexes;
    try {
        userInputIndexes = normalizeUserInputIndexes(record.userInputIndexes ?? record.user_input_indexes);
    }
    catch {
        throw createSponsorError('pre', 'Sponsor pre response is missing required fields.', {
            data: record,
            reason: 'pre_rejected',
        });
    }
    const expiresAt = pickText(record, 'expiresAt', 'expires_at');
    return {
        preparedTxHex,
        orderId,
        minerFee: normalizeRequiredNumber('pre', record, 'minerFee', 'miner_fee'),
        userInputIndexes,
        expiresAt: expiresAt || undefined,
        raw: record,
    };
}
function normalizeCommitResult(record) {
    const txId = pickText(record, 'txId', 'txid');
    if (!txId) {
        throw createSponsorError('commit', 'Sponsor commit response is missing required fields.', {
            data: record,
            reason: 'commit_failed',
        });
    }
    const result = {
        txId,
        raw: record,
    };
    const txSize = normalizeOptionalNumber(record, 'txSize', 'tx_size');
    const minerFee = normalizeOptionalNumber(record, 'minerFee', 'miner_fee');
    if (txSize !== undefined) {
        result.txSize = txSize;
    }
    if (minerFee !== undefined) {
        result.minerFee = minerFee;
    }
    return result;
}
function createJsonHeaders() {
    return {
        accept: 'application/json',
        'content-type': 'application/json',
    };
}
function requireText(stage, field, value) {
    const normalized = normalizeText(value);
    if (normalized) {
        return normalized;
    }
    throw createSponsorError(stage, `${field} is required`, {
        reason: stage === 'commit' ? 'commit_failed' : stage === 'pre' ? 'pre_rejected' : 'invalid_request',
    });
}
function createMvcSponsorV2Client(input = {}) {
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const fetchImpl = (input.fetchImpl ?? fetch);
    return {
        baseUrl,
        async getAddressInfo(payload) {
            const address = requireText('address_info', 'address', payload?.address);
            const url = new URL(`${baseUrl}/v2/assist/gas/address/info`);
            url.searchParams.set('address', address);
            url.searchParams.set('gasChain', 'mvc');
            const record = await requestJson(fetchImpl, url.toString(), {
                method: 'GET',
                headers: {
                    accept: 'application/json',
                },
            }, 'address_info');
            return normalizeAddressInfo(record);
        },
        async getChallenge() {
            const record = await requestJson(fetchImpl, `${baseUrl}/v2/assist/gas/mvc/challenge`, {
                method: 'POST',
                headers: createJsonHeaders(),
                body: JSON.stringify({}),
            }, 'challenge');
            return normalizeChallenge(record);
        },
        async preSponsor(payload) {
            const record = await requestJson(fetchImpl, `${baseUrl}/v2/assist/gas/mvc/pre`, {
                method: 'POST',
                headers: createJsonHeaders(),
                body: JSON.stringify({
                    address: requireText('pre', 'address', payload?.address),
                    txHex: requireText('pre', 'txHex', payload?.txHex),
                    challengeId: requireText('pre', 'challengeId', payload?.challengeId),
                    publicKey: requireText('pre', 'publicKey', payload?.publicKey),
                    signature: requireText('pre', 'signature', payload?.signature),
                }),
            }, 'pre');
            return normalizePreResult(record);
        },
        async commitSponsor(payload) {
            const record = await requestJson(fetchImpl, `${baseUrl}/v2/assist/gas/mvc/commit`, {
                method: 'POST',
                headers: createJsonHeaders(),
                body: JSON.stringify({
                    orderId: requireText('commit', 'orderId', payload?.orderId),
                    signedTxHex: requireText('commit', 'signedTxHex', payload?.signedTxHex),
                    publicKey: requireText('commit', 'publicKey', payload?.publicKey),
                    signature: requireText('commit', 'signature', payload?.signature),
                }),
            }, 'commit');
            return normalizeCommitResult(record);
        },
    };
}
