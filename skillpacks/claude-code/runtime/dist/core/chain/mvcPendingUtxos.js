"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MVC_PENDING_UTXO_TTL_MS = void 0;
exports.getMvcUtxoOutpointKey = getMvcUtxoOutpointKey;
exports.rememberPendingMvcTransaction = rememberPendingMvcTransaction;
exports.resolveSpendableMvcUtxos = resolveSpendableMvcUtxos;
exports.__clearPendingMvcUtxosForTests = __clearPendingMvcUtxosForTests;
exports.MVC_PENDING_UTXO_TTL_MS = 10 * 60 * 1000;
/** Maps address:txid:outputIndex to pending spent outpoint state. */
const pendingSpentOutpoints = new Map();
const pendingAvailableUtxos = new Map();
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeOutpointTxid(value) {
    return normalizeText(value).toLowerCase();
}
function getMvcUtxoOutpointKey(input) {
    const outpointParts = [normalizeOutpointTxid(input.txId), String(input.outputIndex)];
    if (Object.hasOwn(input, 'address')) {
        return [normalizeText(input.address), ...outpointParts].join(':');
    }
    return outpointParts.join(':');
}
function prunePendingMvcUtxos(now = Date.now()) {
    for (const [key, value] of pendingSpentOutpoints.entries()) {
        if (value.expiresAt <= now)
            pendingSpentOutpoints.delete(key);
    }
    for (const [key, value] of pendingAvailableUtxos.entries()) {
        if (value.expiresAt <= now)
            pendingAvailableUtxos.delete(key);
    }
}
function rememberPendingMvcTransaction(input) {
    const now = input.now ?? Date.now();
    prunePendingMvcUtxos(now);
    const expiresAt = now + exports.MVC_PENDING_UTXO_TTL_MS;
    for (const utxo of input.spentUtxos) {
        const key = getMvcUtxoOutpointKey({
            address: input.address,
            txId: utxo.txId,
            outputIndex: utxo.outputIndex,
        });
        pendingSpentOutpoints.set(key, { expiresAt });
        pendingAvailableUtxos.delete(key);
    }
    for (const utxo of input.createdUtxos) {
        if (utxo.satoshis < 600)
            continue;
        const key = getMvcUtxoOutpointKey({
            address: input.address,
            txId: utxo.txId,
            outputIndex: utxo.outputIndex,
        });
        if (!pendingSpentOutpoints.has(key)) {
            pendingAvailableUtxos.set(key, { utxo, expiresAt });
        }
    }
}
function resolveSpendableMvcUtxos(input) {
    const now = input.now ?? Date.now();
    prunePendingMvcUtxos(now);
    const merged = new Map();
    for (const utxo of input.utxos) {
        merged.set(getMvcUtxoOutpointKey({
            address: input.address,
            txId: utxo.txId,
            outputIndex: utxo.outputIndex,
        }), utxo);
    }
    for (const [key, value] of pendingAvailableUtxos.entries()) {
        if (normalizeText(value.utxo.address) === normalizeText(input.address)) {
            merged.set(key, value.utxo);
        }
    }
    return [...merged.entries()]
        .filter(([key]) => !pendingSpentOutpoints.has(key))
        .map(([, utxo]) => utxo);
}
function __clearPendingMvcUtxosForTests() {
    pendingSpentOutpoints.clear();
    pendingAvailableUtxos.clear();
}
