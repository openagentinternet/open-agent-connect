"use strict";
/**
 * Deliverable verification (IDBots verifyPinSources + re-verify loop parity):
 * confirm that a deliverable's pin actually exists on-chain before the
 * acceptance summary vouches for it. The primary source is the metaso-p2p
 * pin read (GET /api/metaweb/pin/:pinId); indexer lag is absorbed by the
 * engine's 10-minute re-verification pass rather than by blocking ingest.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractDeliverablePinId = extractDeliverablePinId;
exports.createMetasoPinVerifier = createMetasoPinVerifier;
exports.verifyTaskDeliverables = verifyTaskDeliverables;
const metasoInfrastructure_1 = require("../network/metasoInfrastructure");
const DEFAULT_TIMEOUT_MS = 10_000;
/** Extract a bare chain pin id (64 hex + i<n>) from a deliverable URI. */
function extractDeliverablePinId(uri) {
    const match = /([0-9a-f]{64}i\d+)/i.exec(uri ?? '');
    return match ? match[1].toLowerCase() : null;
}
/** metaso-p2p pin existence check; envelope code 0 = found, 40400 = missing. */
function createMetasoPinVerifier(options = {}) {
    const baseUrl = (options.baseUrl ?? metasoInfrastructure_1.DEFAULT_METASO_P2P_BASE_URL).replace(/\/+$/, '');
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    return async (pinId) => {
        if (typeof fetchImpl !== 'function')
            return 'error';
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        try {
            const response = await fetchImpl(`${baseUrl}/api/metaweb/pin/${encodeURIComponent(pinId)}`, {
                signal: controller.signal,
                headers: { accept: 'application/json' },
            });
            const envelope = await response.json().catch(() => null);
            if (!envelope || typeof envelope !== 'object')
                return 'error';
            const code = Number(envelope.code);
            if (code === 0)
                return 'found';
            if (code === 40400)
                return 'not_found';
            return 'error';
        }
        catch {
            return 'error';
        }
        finally {
            clearTimeout(timer);
        }
    };
}
/**
 * Verify every unconfirmed deliverable row of a task. Confirmed pins flip
 * `confirmation` to confirmed and `pending` rows to `delivered` (IDBots
 * parity: verification is what "delivers" a deliverable); errors keep the
 * row unconfirmed for the next re-verification pass.
 */
async function verifyTaskDeliverables(store, taskId, verifier, options = {}) {
    const now = options.now ?? Date.now;
    const rows = await store.listDeliverables(taskId);
    const report = { checked: 0, confirmed: 0, stillUnconfirmed: 0 };
    for (const row of rows) {
        if (row.confirmation === 'confirmed' || row.status === 'rejected' || row.status === 'accepted')
            continue;
        const pinId = extractDeliverablePinId(row.uri) ?? (row.msgPinId && /^([0-9a-f]{64}i\d+)$/i.test(row.msgPinId) ? row.msgPinId.toLowerCase() : null);
        if (!pinId)
            continue;
        report.checked += 1;
        const verdict = await verifier(pinId);
        if (verdict === 'found') {
            report.confirmed += 1;
            await store.updateDeliverableVerification(row.id, JSON.stringify({ sources: [{ source: 'metaso', result: 'found' }], checkedAt: now() }), 'confirmed', row.status === 'pending' ? 'delivered' : undefined);
        }
        else {
            report.stillUnconfirmed += 1;
            options.log?.(`[GroupTaskEngine] Deliverable ${row.id} of task ${taskId} still unverified (${verdict})`);
        }
    }
    return report;
}
