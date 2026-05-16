"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOOM_PROTOCOL_PATHS = exports.LOOM_PROTOCOL_NAMES = exports.LOOM_PROTOCOLS = void 0;
exports.isLoomProtocolName = isLoomProtocolName;
exports.resolveLoomProtocol = resolveLoomProtocol;
const LOOM_VERSION = '1.0.0';
const LOOM_CONTENT_TYPE = 'application/json';
function spec(name, path) {
    return {
        name,
        path,
        version: LOOM_VERSION,
        contentType: LOOM_CONTENT_TYPE,
    };
}
exports.LOOM_PROTOCOLS = {
    task: spec('task', '/protocols/loom-task'),
    claim: spec('claim', '/protocols/loom-claim'),
    status: spec('status', '/protocols/loom-status'),
    delivery: spec('delivery', '/protocols/loom-delivery'),
    acceptance: spec('acceptance', '/protocols/loom-acceptance'),
    'claim-reject': spec('claim-reject', '/protocols/loom-claim-reject'),
};
exports.LOOM_PROTOCOL_NAMES = Object.freeze(Object.keys(exports.LOOM_PROTOCOLS));
exports.LOOM_PROTOCOL_PATHS = Object.freeze(exports.LOOM_PROTOCOL_NAMES.map((name) => exports.LOOM_PROTOCOLS[name].path));
function isLoomProtocolName(value) {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(exports.LOOM_PROTOCOLS, value);
}
function resolveLoomProtocol(value) {
    if (isLoomProtocolName(value)) {
        return exports.LOOM_PROTOCOLS[value];
    }
    if (typeof value === 'string') {
        const byPath = exports.LOOM_PROTOCOL_NAMES.map((name) => exports.LOOM_PROTOCOLS[name]).find((protocol) => protocol.path === value);
        if (byPath) {
            return byPath;
        }
    }
    throw new Error(`Unsupported Loom protocol: ${String(value)}`);
}
