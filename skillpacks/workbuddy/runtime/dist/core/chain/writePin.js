"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chainWritePayloadToBuffer = chainWritePayloadToBuffer;
exports.normalizeChainWriteRequest = normalizeChainWriteRequest;
const avatarChainWrite_1 = require("../identity/avatarChainWrite");
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function chainWritePayloadToBuffer(input) {
    if (Buffer.isBuffer(input.payload)) {
        return Buffer.from(input.payload);
    }
    if (input.encoding === 'base64') {
        return Buffer.from(input.payload, 'base64');
    }
    return Buffer.from(input.payload, 'utf-8');
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
    const rawPayload = input.payload;
    const payloadIsBuffer = Buffer.isBuffer(rawPayload);
    const encoding = normalizeText(input.encoding).toLowerCase() || (payloadIsBuffer ? 'binary' : 'utf-8');
    if (encoding !== 'utf-8' && encoding !== 'base64' && encoding !== 'binary') {
        throw new Error(`Unsupported chain write encoding: ${input.encoding}`);
    }
    const network = normalizeText(input.network).toLowerCase() || 'mvc';
    if (network !== 'mvc' && network !== 'btc' && network !== 'doge' && network !== 'opcat') {
        throw new Error(`Unsupported chain write network: ${input.network}`);
    }
    let payload;
    if (typeof rawPayload === 'string' || Buffer.isBuffer(rawPayload)) {
        payload = rawPayload;
    }
    else {
        throw new Error('Chain write payload must be a string or Buffer.');
    }
    if (Buffer.isBuffer(payload) && encoding !== 'binary') {
        throw new Error('Chain write Buffer payloads must use binary encoding.');
    }
    if (!Buffer.isBuffer(payload) && encoding === 'binary') {
        throw new Error('Chain write binary payloads must be Buffers.');
    }
    const request = {
        operation: operation,
        path,
        encryption: encryption,
        version: normalizeText(input.version) || '1.0',
        contentType: normalizeText(input.contentType) || 'application/json',
        payload,
        encoding: encoding,
        network: network,
    };
    (0, avatarChainWrite_1.validateAvatarChainWriteRequest)(request);
    return request;
}
