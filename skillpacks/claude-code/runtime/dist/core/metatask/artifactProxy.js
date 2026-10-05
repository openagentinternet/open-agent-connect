"use strict";
/**
 * Metafile artifact proxy (M9 — reviewer tooling): resolves a `metafile://`
 * reference to its bytes through the MAN content route, reassembling chunked
 * uploads (chunkList concat in listed order) and verifying the aggregate
 * sha256 against the manifest before serving. Content pins are immutable, so
 * resolved bytes cache in-process.
 *
 * Recipe (verified against the v1.3 pilot's S5 package, 2026-10-04):
 *  1. `GET https://manapi.metaid.io/content/<pinId>` → JSON manifest
 *     `{ sha256, fileSize, chunkNumber, chunkSize, dataType, name, chunkList[] }`.
 *  2. Small files answer with inline bytes directly; chunked files list
 *     `chunkList[{sha256, pinId}]`.
 *  3. Fetch each chunk via the same route (raw bytes), concatenate IN LISTED
 *     ORDER, verify sha256(file) == manifest.sha256.
 *  4. Serve with the manifest's dataType and name.
 * The suffixed URI form (`metafile://<pin>.gz`) 404s on the content route —
 * resolve by the bare 66-char pin id. Bare-pin `metafile://` URIs without an
 * extension are valid and must be accepted.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_MANAPI_CONTENT_BASE_URL = void 0;
exports.normalizeMetafileReference = normalizeMetafileReference;
exports.cachedMetafileContent = cachedMetafileContent;
exports.fetchMetafileContent = fetchMetafileContent;
const node_crypto_1 = require("node:crypto");
exports.DEFAULT_MANAPI_CONTENT_BASE_URL = 'https://manapi.metaid.io';
const DEFAULT_TIMEOUT_MS = 15_000;
/** Hard cap for a reassembled artifact (the S5 package is ~6.2MB; headroom ×4). */
const MAX_CONTENT_BYTES = 32 * 1024 * 1024;
const PIN_ID_RE = /^([0-9a-f]{64}i\d+)$/i;
/** metafile:// URI | bare pin | any MAN content URL → the bare 66-char pin id. */
function normalizeMetafileReference(reference) {
    let value = String(reference ?? '').trim();
    if (!value)
        return null;
    if (/^metafile:\/\//i.test(value))
        value = value.slice('metafile://'.length);
    if (/^https?:\/\//i.test(value)) {
        try {
            value = new URL(value).pathname.split('/').pop() ?? '';
        }
        catch {
            return null;
        }
    }
    value = value.split(/[?#]/)[0].trim();
    // Strip an extension-bearing suffix (.gz etc.) — the content route keys on
    // the bare pin and 404s on the suffixed form.
    const match = value.match(/^([0-9a-f]{64}i\d+)(?:\.[a-z0-9][a-z0-9+-]{0,31})?$/i);
    const pinId = match?.[1] ?? value;
    return PIN_ID_RE.test(pinId) ? pinId : null;
}
const asText = (value) => (typeof value === 'string' ? value.trim() : '');
async function fetchBytes(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
        const response = await options.fetchImpl(url, { signal: controller.signal });
        if (!response.ok)
            return null;
        const contentType = asText(response.headers.get('content-type')).split(';')[0]?.trim() || 'application/octet-stream';
        const body = Buffer.from(await response.arrayBuffer());
        return { body, contentType };
    }
    catch {
        return null;
    }
    finally {
        clearTimeout(timer);
    }
}
const contentCache = new Map();
/** Resolved-bytes cache so repeat downloads (immutable content) cost nothing. */
function cachedMetafileContent(pinId) {
    return contentCache.get(pinId) ?? null;
}
/**
 * Resolve one metafile reference to verified bytes. Returns null on any
 * failure (unknown pin, fetch error, size cap, sha256 mismatch) — a broken
 * artifact must never be served as good.
 */
async function fetchMetafileContent(reference, options = {}) {
    const pinId = normalizeMetafileReference(reference);
    if (!pinId)
        return null;
    const cached = contentCache.get(pinId);
    if (cached)
        return cached;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
        throw new Error('A fetch implementation is required for the metafile proxy.');
    }
    const baseUrl = (options.baseUrl ?? exports.DEFAULT_MANAPI_CONTENT_BASE_URL).replace(/\/+$/, '');
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const initial = await fetchBytes(`${baseUrl}/content/${encodeURIComponent(pinId)}`, { fetchImpl, timeoutMs });
    if (!initial)
        return null;
    // Inline bytes (small files): the content route answers with the artifact
    // itself. The manifest is a JSON object carrying sha256 + chunkList — and
    // the route serves it with content-type text/plain, so detect by SHAPE, not
    // by the declared type.
    let manifest = null;
    {
        try {
            const parsed = JSON.parse(initial.body.toString('utf8'));
            if (parsed && typeof parsed === 'object' && asText(parsed.sha256) && Array.isArray(parsed.chunkList)) {
                manifest = parsed;
            }
        }
        catch {
            manifest = null;
        }
    }
    let body;
    let sha256;
    let contentType;
    let fileName;
    if (manifest) {
        const chunks = manifest.chunkList;
        const parts = [];
        let total = 0;
        for (const chunk of chunks) {
            const chunkPin = normalizeMetafileReference(asText(chunk.pinId));
            if (!chunkPin)
                return null;
            const fetched = await fetchBytes(`${baseUrl}/content/${encodeURIComponent(chunkPin)}`, { fetchImpl, timeoutMs });
            if (!fetched)
                return null;
            total += fetched.body.length;
            if (total > MAX_CONTENT_BYTES)
                return null;
            parts.push(fetched.body);
        }
        body = Buffer.concat(parts);
        sha256 = asText(manifest.sha256);
        contentType = asText(manifest.dataType) || 'application/octet-stream';
        fileName = asText(manifest.name) || pinId;
    }
    else {
        if (initial.body.length === 0 || initial.body.length > MAX_CONTENT_BYTES)
            return null;
        body = initial.body;
        sha256 = '';
        contentType = initial.contentType;
        fileName = pinId;
    }
    if (sha256) {
        const digest = (0, node_crypto_1.createHash)('sha256').update(body).digest('hex');
        if (digest !== sha256)
            return null; // never serve bytes that fail the manifest
    }
    const resolved = { pinId, body, contentType, fileName, sha256 };
    contentCache.set(pinId, resolved);
    return resolved;
}
