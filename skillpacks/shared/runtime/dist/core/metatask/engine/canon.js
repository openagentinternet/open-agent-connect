"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.outerHash = exports.innerHash = exports.sha256Hex = exports.canonJ = void 0;
const node_crypto_1 = require("node:crypto");
const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const sortDeep = (value) => {
    if (Array.isArray(value))
        return value.map(sortDeep);
    if (isPlainObject(value)) {
        const entries = Object.entries(value)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        const out = {};
        for (const [key, val] of entries)
            out[key] = sortDeep(val);
        return out;
    }
    return value;
};
const canonJ = (obj) => Buffer.from(JSON.stringify(sortDeep(obj)), 'utf-8');
exports.canonJ = canonJ;
const sha256Hex = (data) => (0, node_crypto_1.createHash)('sha256').update(data).digest('hex');
exports.sha256Hex = sha256Hex;
/** Inner hash: sha256 over the result with the top-level "hash" key removed (shallow delete). */
const innerHash = (result) => {
    const core = {};
    for (const [key, value] of Object.entries(result)) {
        if (key === 'hash')
            continue;
        core[key] = value;
    }
    return (0, exports.sha256Hex)((0, exports.canonJ)(core));
};
exports.innerHash = innerHash;
/** Outer hash: sha256 over the full result (with the inner hash embedded). */
const outerHash = (result) => (0, exports.sha256Hex)((0, exports.canonJ)(result));
exports.outerHash = outerHash;
