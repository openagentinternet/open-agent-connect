"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OWNER_NAME_CHAIN_PATH = void 0;
exports.buildOwnerProfileChainWrites = buildOwnerProfileChainWrites;
exports.writeOwnerProfileChainRequests = writeOwnerProfileChainRequests;
const avatarChainWrite_1 = require("../identity/avatarChainWrite");
exports.OWNER_NAME_CHAIN_PATH = '/info/name';
function buildOwnerProfileChainWrites(fields) {
    const requests = [];
    const name = typeof fields.name === 'string' ? fields.name.trim() : '';
    if (name) {
        requests.push({
            operation: 'create',
            path: exports.OWNER_NAME_CHAIN_PATH,
            encryption: '0',
            version: '1.0',
            contentType: 'text/plain',
            payload: name,
            encoding: 'utf-8',
            network: 'mvc',
        });
    }
    if (typeof fields.avatarDataUrl === 'string') {
        requests.push((0, avatarChainWrite_1.buildAvatarChainWriteRequest)({
            operation: 'create',
            avatarDataUrl: fields.avatarDataUrl,
            network: 'mvc',
        }));
    }
    return requests;
}
/**
 * Sequential writes with the same inter-write delay the Bot profile sync uses
 * (each pin spends the previous write's change UTXO).
 */
async function writeOwnerProfileChainRequests(signer, requests, options = {}) {
    const delayMs = options.delayMs ?? 3_000;
    const results = [];
    for (const request of requests) {
        if (results.length > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        results.push(await signer.writePin(request));
    }
    return results;
}
