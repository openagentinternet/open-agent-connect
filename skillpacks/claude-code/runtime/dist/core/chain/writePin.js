"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeChainWriteRequest = normalizeChainWriteRequest;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeChainWriteRequest(input) {
    const operation = normalizeText(input.operation).toLowerCase() || 'create';
    if (operation !== 'init' && operation !== 'create' && operation !== 'modify' && operation !== 'revoke') {
        throw new Error(`Unsupported chain operation: ${input.operation}`);
    }
    const path = normalizeText(input.path);
    if (operation !== 'init' && !path) {
        throw new Error('Chain write path is required.');
    }
    const encryption = normalizeText(input.encryption) || '0';
    if (encryption !== '0' && encryption !== '1' && encryption !== '2') {
        throw new Error(`Unsupported chain write encryption value: ${input.encryption}`);
    }
    const encoding = normalizeText(input.encoding).toLowerCase() || 'utf-8';
    if (encoding !== 'utf-8' && encoding !== 'base64') {
        throw new Error(`Unsupported chain write encoding: ${input.encoding}`);
    }
    const network = normalizeText(input.network).toLowerCase() || 'mvc';
    if (network !== 'mvc' && network !== 'btc' && network !== 'doge') {
        throw new Error(`Unsupported chain write network: ${input.network}`);
    }
    if (typeof input.payload !== 'string') {
        throw new Error('Chain write payload must be a string.');
    }
    return {
        operation,
        path,
        encryption,
        version: normalizeText(input.version) || '1.0',
        contentType: normalizeText(input.contentType) || 'application/json',
        payload: input.payload,
        encoding,
        network,
    };
}
