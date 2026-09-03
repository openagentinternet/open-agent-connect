"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readInputFromMetawebPin = readInputFromMetawebPin;
exports.recordMetawebPinRead = recordMetawebPinRead;
const store_1 = require("./store");
function textOrNull(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
/** Map one MetaWeb pin to a recordRead input. Returns null when the pin has
 * no usable pinId (nothing to key the record on). Tolerates missing nested
 * fields (`meta`, `creator`) on partial pin shapes. */
function readInputFromMetawebPin(pin, source) {
    const pinId = textOrNull(pin?.pinId);
    if (!pinId) {
        return null;
    }
    return {
        pinId,
        path: textOrNull(pin.path),
        protocol: textOrNull(pin.protocol),
        title: textOrNull(pin.meta?.title),
        authorGlobalMetaId: textOrNull(pin.creator?.globalMetaId),
        contentText: typeof pin.text === 'string' && pin.text ? pin.text : null,
        source: textOrNull(source),
    };
}
/** Record one MetaWeb pin read into the chain history store. Best-effort:
 * never throws; store failures go to `warn` (default console.warn). */
async function recordMetawebPinRead(paths, pin, source, deps = {}) {
    const warn = deps.warn ?? console.warn;
    try {
        const input = readInputFromMetawebPin(pin, source);
        if (!input) {
            return;
        }
        await (0, store_1.createChainHistoryStore)(paths).recordRead(input);
    }
    catch (error) {
        warn(`[chain-history] failed to record chain read: ${error instanceof Error ? error.message : String(error)}`);
    }
}
