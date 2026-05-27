"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyMetafileAvailability = verifyMetafileAvailability;
const promises_1 = require("node:timers/promises");
const metafileUrls_1 = require("./metafileUrls");
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_DELAY_MS = 250;
function normalizeAttempts(value) {
    const attempts = Math.floor(Number(value));
    return Number.isFinite(attempts) && attempts > 0 ? attempts : DEFAULT_ATTEMPTS;
}
function normalizeDelayMs(value) {
    const ms = Math.floor(Number(value));
    return Number.isFinite(ms) && ms >= 0 ? ms : DEFAULT_DELAY_MS;
}
function normalizeError(error) {
    if (error instanceof Error && typeof error.message === 'string' && error.message.trim()) {
        return error.message.trim();
    }
    const text = String(error ?? '').trim();
    return text || 'Metafile verification failed.';
}
function isBodySafeFallback(response) {
    return response.status === 403 || response.status === 405;
}
async function releaseResponseBody(response) {
    const body = response?.body;
    if (!body) {
        return;
    }
    try {
        if (typeof body.cancel === 'function') {
            await body.cancel();
            return;
        }
    }
    catch {
        return;
    }
    try {
        body.releaseLock?.();
    }
    catch {
        // Ignore cleanup failures.
    }
}
async function probeUrl(fetchImpl, url) {
    const headResponse = (await fetchImpl(url, { method: 'HEAD' }));
    if (headResponse?.ok) {
        await releaseResponseBody(headResponse);
        return { ok: true };
    }
    if (!isBodySafeFallback(headResponse)) {
        await releaseResponseBody(headResponse);
        return { ok: false, error: `HEAD ${headResponse?.status ?? 'unavailable'}` };
    }
    const getResponse = (await fetchImpl(url, { method: 'GET' }));
    if (getResponse?.ok) {
        await releaseResponseBody(getResponse);
        return { ok: true };
    }
    await releaseResponseBody(getResponse);
    return { ok: false, error: `GET ${getResponse?.status ?? 'unavailable'}` };
}
async function verifyMetafileAvailability(input) {
    const pinId = String(input?.pinId || '').trim();
    if (!pinId) {
        throw new Error('pinId is required.');
    }
    const fetchImpl = input.fetchImpl ?? fetch;
    const attempts = normalizeAttempts(input.attempts);
    const delayMs = normalizeDelayMs(input.delayMs);
    const urls = (0, metafileUrls_1.buildMetafileContentUrls)(pinId);
    const candidateUrls = [urls.accelerateUrl, urls.contentUrl, urls.legacyContentUrl];
    let lastError = 'Metafile verification failed.';
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        for (const url of candidateUrls) {
            try {
                const result = await probeUrl(fetchImpl, url);
                if (result.ok) {
                    return { ok: true, url, attempts: attempt };
                }
                if (result.error) {
                    lastError = result.error;
                }
            }
            catch (error) {
                lastError = normalizeError(error);
            }
        }
        if (attempt < attempts && delayMs > 0) {
            await (0, promises_1.setTimeout)(delayMs);
        }
    }
    return {
        ok: false,
        url: null,
        attempts,
        error: lastError,
    };
}
