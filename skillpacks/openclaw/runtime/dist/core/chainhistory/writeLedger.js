"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldRecordChainWrite = shouldRecordChainWrite;
exports.wrapSignerWithChainHistory = wrapSignerWithChainHistory;
const store_1 = require("./store");
// Private chat, group chat, and group task pins are persisted by their own
// chat stores; identity sync pins under `/info/` are republished state, not
// user content.
const EXCLUDED_EXACT_PATHS = new Set([
    '/protocols/simplemsg',
    '/protocols/simplegroupcreate',
    '/protocols/simplegroupjoin',
    '/protocols/simplegroupchat',
    '/protocols/simplegroupremoveuser',
]);
const EXCLUDED_PATH_PREFIX = '/info/';
/** Whether a chain write to `path` belongs in the chain history store. */
function shouldRecordChainWrite(path) {
    if (!path) {
        return true;
    }
    if (EXCLUDED_EXACT_PATHS.has(path)) {
        return false;
    }
    return !path.startsWith(EXCLUDED_PATH_PREFIX);
}
/** Map one write request payload to the store's content fields: full text for
 * plain string payloads (the store caps/truncates it), byte counts only for
 * base64 strings and Buffers. */
function describeWritePayload(request) {
    const payload = request.payload;
    if (typeof payload === 'string') {
        if (request.encoding === 'base64') {
            return { contentText: null, contentBytes: Buffer.from(payload, 'base64').byteLength };
        }
        return { contentText: payload };
    }
    if (Buffer.isBuffer(payload)) {
        return { contentText: null, contentBytes: payload.byteLength };
    }
    return { contentText: null, contentBytes: 0 };
}
/** Wrap `signer` so every successful writePin is recorded under
 * `paths.chainHistoryRoot`. Identity reads delegate unchanged; a failed
 * writePin propagates unchanged and is never recorded. */
function wrapSignerWithChainHistory(signer, paths, deps = {}) {
    const store = deps.store ?? (0, store_1.createChainHistoryStore)(paths);
    const warn = deps.warn ?? console.warn;
    return {
        getIdentity: () => signer.getIdentity(),
        getPrivateChatIdentity: () => signer.getPrivateChatIdentity(),
        writePin: async (request) => {
            const result = await signer.writePin(request);
            const pinId = typeof result.pinId === 'string' ? result.pinId.trim() : '';
            if (!pinId || !shouldRecordChainWrite(request.path)) {
                return result;
            }
            try {
                await store.recordWrite({
                    pinId,
                    txId: result.txids?.[0] ?? null,
                    path: request.path ?? null,
                    operation: request.operation ?? result.operation ?? null,
                    network: request.network ?? result.network ?? null,
                    ...describeWritePayload(request),
                    contentType: request.contentType ?? null,
                    occurredAtMs: Date.now(),
                });
            }
            catch (error) {
                warn(`[chain-history] failed to record chain write: ${error instanceof Error ? error.message : String(error)}`);
            }
            return result;
        },
    };
}
